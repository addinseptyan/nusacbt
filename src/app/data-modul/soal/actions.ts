"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { normalizeQuestionImage, QUESTION_IMAGE_MAX_BYTES } from "@/lib/question-image.mjs";
import { validateRichInput } from "@/lib/question-rich.mjs";
import { QUESTION_IMAGE_SLOTS, QUESTION_LETTERS, type QuestionActionResult, type QuestionImageSlot } from "@/lib/question-types";
import { validateQuestionContent, validateQuestionDraft } from "@/lib/question-validation.mjs";
import { validTopicRevision } from "@/lib/topic-validation.mjs";

type ImageChange =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "set"; data: Buffer; mime: "image/png" | "image/jpeg" };

type Draft = { topicId: string; prompt: string; options: string[]; correctOption: string; rich: (unknown | null)[] };
type ImageChanges = Record<QuestionImageSlot, ImageChange>;
type Existing = {
  revision: string;
  hasPrompt: boolean;
  hasA: boolean;
  hasB: boolean;
  hasC: boolean;
  hasD: boolean;
  hasE: boolean;
  hasPromptRich: boolean;
  hasARich: boolean;
  hasBRich: boolean;
  hasCRich: boolean;
  hasDRich: boolean;
  hasERich: boolean;
};

const imagePrefixes: Record<QuestionImageSlot, string> = {
  prompt: "prompt", A: "option_a", B: "option_b", C: "option_c", D: "option_d", E: "option_e",
};

class QuestionProblem extends Error {
  constructor(message: string, readonly reload = false) { super(message); }
}

function hasSqlState(error: unknown, ...codes: string[]) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

async function readImageChanges(formData: FormData): Promise<{ ok: true; changes: ImageChanges } | { ok: false; error: string }> {
  const changes = {} as ImageChanges;
  // Satu per satu untuk membatasi memori ketika enam gambar dipilih sekaligus.
  for (const slot of QUESTION_IMAGE_SLOTS) {
    const label = slot === "prompt" ? "Gambar soal" : `Gambar pilihan ${slot}`;
    const removeValue = formData.get(`remove_${slot}`);
    if (removeValue !== null && removeValue !== "1") return { ok: false, error: `${label}: pilihan penghapusan tidak valid.` };
    const remove = removeValue === "1";
    const file = formData.get(`image_${slot}`);
    if (typeof file === "string") return { ok: false, error: `${label}: file tidak valid.` };
    const emptyField = file === null || (file.size === 0 && file.name === "");
    if (emptyField) { changes[slot] = { kind: remove ? "remove" : "keep" }; continue; }
    if (remove) return { ok: false, error: `${label}: pilih mengganti atau menghapus gambar, bukan keduanya.` };
    if (!file || file.size < 1 || file.size > QUESTION_IMAGE_MAX_BYTES) return { ok: false, error: `${label}: ukuran maksimal 1 MiB.` };
    let bytes: Buffer;
    try { bytes = Buffer.from(await file.arrayBuffer()); }
    catch { return { ok: false, error: `${label}: file tidak dapat dibaca.` }; }
    if (bytes.length !== file.size || bytes.length > QUESTION_IMAGE_MAX_BYTES) return { ok: false, error: `${label}: ukuran file tidak valid.` };
    const normalized = await normalizeQuestionImage(bytes);
    if (!normalized.ok) return { ok: false, error: `${label}: ${normalized.error}` };
    changes[slot] = { kind: "set", data: normalized.data, mime: normalized.mime };
  }
  return { ok: true, changes };
}

function effectiveImages(changes: ImageChanges, existing: Existing | null) {
  const old: Record<QuestionImageSlot, boolean> = {
    prompt: Boolean(existing?.hasPrompt), A: Boolean(existing?.hasA), B: Boolean(existing?.hasB),
    C: Boolean(existing?.hasC), D: Boolean(existing?.hasD), E: Boolean(existing?.hasE),
  };
  return QUESTION_IMAGE_SLOTS.map((slot) => changes[slot].kind === "set" || (changes[slot].kind === "keep" && old[slot]));
}

async function insertQuestion(client: PoolClient, draft: Draft, changes: ImageChanges) {
  const columns = ["topic_id", "prompt_text", ...QUESTION_LETTERS.map((letter) => `option_${letter.toLowerCase()}_text`), "correct_option"];
  const values: unknown[] = [draft.topicId, draft.prompt, ...draft.options, draft.correctOption];
  for (const [index, slot] of QUESTION_IMAGE_SLOTS.entries()) {
    columns.push(`${imagePrefixes[slot]}_rich`);
    values.push(draft.rich[index] === null ? null : JSON.stringify(draft.rich[index]));
  }
  for (const slot of QUESTION_IMAGE_SLOTS) {
    const prefix = imagePrefixes[slot];
    columns.push(`${prefix}_image`, `${prefix}_image_mime`);
    const change = changes[slot];
    values.push(change.kind === "set" ? change.data : null, change.kind === "set" ? change.mime : null);
  }
  const placeholders = values.map((_, index) => `$${index + 1}`);
  await client.query(`INSERT INTO question_bank (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`, values);
}

async function updateQuestion(client: PoolClient, id: string, revision: string, draft: Draft, changes: ImageChanges) {
  const values: unknown[] = [draft.topicId, draft.prompt, ...draft.options, draft.correctOption];
  const assignments = ["topic_id = $1", "prompt_text = $2", ...QUESTION_LETTERS.map((letter, index) => `option_${letter.toLowerCase()}_text = $${index + 3}`), "correct_option = $8"];
  for (const [index, slot] of QUESTION_IMAGE_SLOTS.entries()) {
    values.push(draft.rich[index] === null ? null : JSON.stringify(draft.rich[index]));
    assignments.push(`${imagePrefixes[slot]}_rich = $${values.length}`);
  }
  for (const slot of QUESTION_IMAGE_SLOTS) {
    const prefix = imagePrefixes[slot];
    const change = changes[slot];
    if (change.kind === "remove") assignments.push(`${prefix}_image = NULL`, `${prefix}_image_mime = NULL`);
    if (change.kind === "set") {
      values.push(change.data, change.mime);
      assignments.push(`${prefix}_image = $${values.length - 1}`, `${prefix}_image_mime = $${values.length}`);
    }
  }
  assignments.push("updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')");
  values.push(id, revision);
  const result = await client.query(
    `UPDATE question_bank SET ${assignments.join(", ")} WHERE id = $${values.length - 1}::bigint AND xmin::text = $${values.length} RETURNING id`, values,
  );
  if (!result.rowCount) throw new QuestionProblem("Soal sudah berubah atau dihapus. Muat ulang daftar sebelum mencoba lagi.", true);
}

async function applyQuestionMutation(mutation: { kind: "save"; id: string | null; revision: string | null; draft: Draft; changes: ImageChanges } | { kind: "delete"; id: string; revision: string }): Promise<QuestionActionResult> {
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new QuestionProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    if (!adminHasPermission(admin, "questions.manage")) throw new QuestionProblem(PERMISSION_DENIED_MESSAGE);
    if (mutation.kind === "delete") {
      const deleted = await client.query("DELETE FROM question_bank WHERE id=$1::bigint AND xmin::text=$2 RETURNING id", [mutation.id, mutation.revision]);
      if (!deleted.rowCount) throw new QuestionProblem("Soal sudah berubah atau dihapus. Muat ulang daftar sebelum mencoba lagi.", true);
    } else {
      let existing: Existing | null = null;
      if (mutation.id) {
        const result = await client.query<Existing>(
          `SELECT xmin::text AS revision, prompt_image IS NOT NULL AS "hasPrompt", option_a_image IS NOT NULL AS "hasA",
           option_b_image IS NOT NULL AS "hasB", option_c_image IS NOT NULL AS "hasC", option_d_image IS NOT NULL AS "hasD",
           option_e_image IS NOT NULL AS "hasE", prompt_rich IS NOT NULL AS "hasPromptRich",
           option_a_rich IS NOT NULL AS "hasARich", option_b_rich IS NOT NULL AS "hasBRich", option_c_rich IS NOT NULL AS "hasCRich",
           option_d_rich IS NOT NULL AS "hasDRich", option_e_rich IS NOT NULL AS "hasERich"
           FROM question_bank WHERE id=$1::bigint FOR UPDATE`, [mutation.id],
        );
        existing = result.rows[0] ?? null;
        if (!existing || existing.revision !== mutation.revision) throw new QuestionProblem("Soal sudah berubah atau dihapus. Muat ulang daftar sebelum mencoba lagi.", true);
        // A stale/older client may submit only plaintext. Never let it silently
        // erase rich content that is already stored for any of the six fields.
        const hasRich = [existing.hasPromptRich, existing.hasARich, existing.hasBRich, existing.hasCRich, existing.hasDRich, existing.hasERich];
        if (hasRich.some((present, index) => present && mutation.draft.rich[index] === null)) throw new QuestionProblem("Format soal belum terbaca lengkap. Muat ulang halaman dan gunakan editor terbaru agar format tidak hilang.", true);
      }
      const content = validateQuestionContent(mutation.draft, effectiveImages(mutation.changes, existing));
      if (!content.ok) throw new QuestionProblem(content.error);
      if (mutation.id && mutation.revision) await updateQuestion(client, mutation.id, mutation.revision, mutation.draft, mutation.changes);
      else await insertQuestion(client, mutation.draft, mutation.changes);
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new QuestionProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof QuestionProblem) return { ok: false, error: error.message, reload: error.reload };
    if (mutation.kind === "save" && hasSqlState(error, "23503")) {
      return { ok: false, error: "Topik atau mata pelajaran tidak ditemukan atau sudah dihapus. Muat ulang daftar.", reload: true };
    }
    // ON DELETE RESTRICT menghasilkan 23503 di PG17 dan 23001 di PG18.
    if (mutation.kind === "delete" && hasSqlState(error, "23503", "23001")) {
      return { ok: false, error: "Soal masih digunakan oleh data lain dan tidak dapat dihapus." };
    }
    return { ok: false, error: "Hasil perubahan belum dapat dipastikan. Periksa koneksi dan migrasi, lalu muat ulang daftar sebelum mencoba lagi.", reload: true };
  } finally { client?.release(); }

  revalidatePath("/data-modul/soal");
  return { ok: true, message: mutation.kind === "delete" ? "Soal berhasil dihapus." : mutation.id ? "Soal berhasil diubah." : "Soal berhasil ditambahkan." };
}

export async function saveQuestion(formData: FormData): Promise<QuestionActionResult> {
  const { allowed } = await requireAdminAccess("questions.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  // Jangan memilih diam-diam salah satu nilai apabila permintaan mengandung
  // lebih dari satu kategori, kunci, versi, teks, atau perubahan gambar.
  const fields = ["id", "revision", "topicId", "prompt", "prompt_rich", "correctOption",
    ...QUESTION_LETTERS.flatMap((letter) => [`option_${letter}`, `option_${letter}_rich`]),
    ...QUESTION_IMAGE_SLOTS.flatMap((slot) => [`image_${slot}`, `remove_${slot}`])];
  if (fields.some((field) => formData.getAll(field).length > 1)) {
    return { ok: false, error: "Data soal mengandung nilai ganda. Periksa formulir dan coba lagi." };
  }
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validDataId(rawId);
  if (rawId !== null && rawId !== "" && !id) return { ok: false, error: "Identitas soal tidak valid." };
  const revision = id ? validTopicRevision(formData.get("revision")) : null;
  if (id && !revision) return { ok: false, error: "Versi soal tidak valid. Muat ulang daftar.", reload: true };
  const names = ["prompt", ...QUESTION_LETTERS.map((letter) => `option_${letter}`)];
  const values: (FormDataEntryValue | null)[] = [];
  const rich: (unknown | null)[] = [];
  for (const [index, name] of names.entries()) {
    const raw = formData.get(`${name}_rich`);
    if (raw === null) { values.push(formData.get(name)); rich.push(null); continue; }
    try {
      const checked = validateRichInput(raw, index === 0 ? 5000 : 2000);
      values.push(checked.plain);
      rich.push(checked.doc);
    } catch (error) {
      const label = index === 0 ? "Isi soal" : `Pilihan ${QUESTION_LETTERS[index - 1]}`;
      return { ok: false, error: `${label}: ${error instanceof Error ? error.message : "Format tidak valid."}` };
    }
  }
  const parsed = validateQuestionDraft({
    topicId: formData.get("topicId"), prompt: values[0],
    options: values.slice(1), correctOption: formData.get("correctOption"),
  });
  if (!parsed.ok) return parsed;
  const images = await readImageChanges(formData);
  if (!images.ok) return images;
  return applyQuestionMutation({ kind: "save", id, revision, draft: { ...parsed.value, rich }, changes: images.changes });
}

export async function deleteQuestion(formData: FormData): Promise<QuestionActionResult> {
  const { allowed } = await requireAdminAccess("questions.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  if (formData.getAll("id").length !== 1 || formData.getAll("revision").length !== 1) {
    return { ok: false, error: "Identitas atau versi soal tidak valid. Muat ulang daftar.", reload: true };
  }
  const id = validDataId(formData.get("id"));
  const revision = validTopicRevision(formData.get("revision"));
  if (!id || !revision) return { ok: false, error: "Identitas atau versi soal tidak valid. Muat ulang daftar.", reload: true };
  return applyQuestionMutation({ kind: "delete", id, revision });
}
