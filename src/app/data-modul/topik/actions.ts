"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import type { TopicActionResult } from "@/lib/topic-types";
import { validTopicRevision, validateTopicName } from "@/lib/topic-validation.mjs";

type Mutation =
  | { kind: "create"; name: string }
  | { kind: "update"; id: string; revision: string; name: string }
  | { kind: "delete"; id: string; revision: string };

class TopicProblem extends Error {
  constructor(message: string, readonly reload = false) { super(message); }
}

function hasSqlState(error: unknown, ...codes: string[]) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

function hasConstraint(error: unknown, name: string) {
  return typeof error === "object" && error !== null && "constraint" in error && error.constraint === name;
}

async function applyMutation(mutation: Mutation): Promise<TopicActionResult> {
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    // Sesi dikunci bersama transaksi; expiry juga diperiksa tepat sebelum commit.
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new TopicProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    if (!adminHasPermission(admin, "topics.manage")) throw new TopicProblem(PERMISSION_DENIED_MESSAGE);
    if (mutation.kind === "create") {
      await client.query("INSERT INTO question_topics(name) VALUES ($1)", [mutation.name]);
    } else {
      const result = mutation.kind === "update"
        ? await client.query(
          `UPDATE question_topics SET name = $1,
             updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
           WHERE id = $2::bigint AND xmin::text = $3 RETURNING id`,
          [mutation.name, mutation.id, mutation.revision],
        )
        : await client.query("DELETE FROM question_topics WHERE id = $1::bigint AND xmin::text = $2 RETURNING id", [mutation.id, mutation.revision]);
      if (!result.rowCount) throw new TopicProblem("Data sudah berubah atau sudah dihapus. Muat ulang daftar sebelum mencoba lagi.", true);
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new TopicProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof TopicProblem) return { ok: false, error: error.message, reload: error.reload };
    if (hasSqlState(error, "23505") && hasConstraint(error, "question_topics_name_ci_idx")) {
      return { ok: false, error: "Nama topik atau mata pelajaran sudah digunakan, termasuk dengan huruf besar atau kecil berbeda." };
    }
    // RESTRICT menghasilkan 23503 di PostgreSQL 17 dan 23001 di PostgreSQL 18.
    if (mutation.kind === "delete" && hasSqlState(error, "23503", "23001")) {
      return { ok: false, error: "Topik atau mata pelajaran masih digunakan oleh data lain dan tidak dapat dihapus." };
    }
    return { ok: false, error: "Hasil perubahan belum dapat dipastikan. Periksa koneksi dan migrasi, lalu muat ulang daftar sebelum mencoba lagi.", reload: true };
  } finally { client?.release(); }

  revalidatePath("/data-modul/topik");
  return { ok: true, message: mutation.kind === "create" ? "Topik berhasil ditambahkan." : mutation.kind === "update" ? "Topik berhasil diubah." : "Topik berhasil dihapus." };
}

export async function saveTopic(formData: FormData): Promise<TopicActionResult> {
  const { allowed } = await requireAdminAccess("topics.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validDataId(rawId);
  if (rawId !== null && rawId !== "" && !id) return { ok: false, error: "Identitas topik tidak valid." };
  const parsed = validateTopicName(formData.get("name"));
  if (!parsed.ok) return parsed;
  if (!id) return applyMutation({ kind: "create", name: parsed.value });
  const revision = validTopicRevision(formData.get("revision"));
  if (!revision) return { ok: false, error: "Versi data tidak valid. Muat ulang daftar." };
  return applyMutation({ kind: "update", id, revision, name: parsed.value });
}

export async function deleteTopic(formData: FormData): Promise<TopicActionResult> {
  const { allowed } = await requireAdminAccess("topics.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const id = validDataId(formData.get("id"));
  const revision = validTopicRevision(formData.get("revision"));
  if (!id || !revision) return { ok: false, error: "Identitas atau versi data tidak valid. Muat ulang daftar." };
  return applyMutation({ kind: "delete", id, revision });
}
