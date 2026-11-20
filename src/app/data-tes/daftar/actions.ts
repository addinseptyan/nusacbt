"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, requireAdmin } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { EXAM_TEST_FORM_VERSION, validateExamTestDraft } from "@/lib/exam-test-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { validTopicRevision } from "@/lib/topic-validation.mjs";

type ActionResult = { ok: true; message: string } | { ok: false; error: string; reload?: boolean };
type Draft = Extract<ReturnType<typeof validateExamTestDraft>, { ok: true }>["value"];
type Mutation = { kind: "save"; id: string | null; revision: string | null; draft: Draft } | { kind: "delete"; id: string; revision: string };

class TestProblem extends Error {
  constructor(message: string, readonly reload = false) { super(message); }
}

function hasSqlState(error: unknown, ...codes: string[]) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

async function mutate(mutation: Mutation): Promise<ActionResult> {
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new TestProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");

    if (mutation.kind === "delete") {
      const result = await client.query("DELETE FROM exam_tests WHERE id=$1::bigint AND xmin::text=$2 RETURNING id", [mutation.id, mutation.revision]);
      if (!result.rowCount) throw new TestProblem("Tes sudah berubah atau dihapus. Muat ulang daftar sebelum mencoba lagi.", true);
    } else {
      const { draft } = mutation;
      if (mutation.id) {
        // Baris induk dikunci untuk semua perubahan soal dan pelaksanaan.
        const result = await client.query<{ revision: string; periodId: string }>("SELECT xmin::text AS revision,period_id::text AS \"periodId\" FROM exam_tests WHERE id=$1::bigint FOR UPDATE", [mutation.id]);
        if (!result.rowCount || result.rows[0].revision !== mutation.revision) throw new TestProblem("Tes sudah berubah atau dihapus. Muat ulang daftar sebelum mencoba lagi.", true);
        const uses = await client.query<{ total: number; published: boolean; maxCustom: number }>(
          `SELECT count(*)::int AS total,COALESCE(bool_or(r.published_at IS NOT NULL),false) AS published,
             COALESCE(max((SELECT count(*)::int FROM exam_schedule_custom_questions q WHERE q.run_id=r.id)),0)::int AS "maxCustom"
           FROM exam_schedule_runs r WHERE r.exam_test_id=$1::bigint`, [mutation.id],
        );
        const usage = uses.rows[0];
        if (usage.published) throw new TestProblem("Tarik rilis semua pelaksanaan tes sebelum mengubah rancangan.", true);
        if (usage.total && result.rows[0].periodId !== draft.periodId) throw new TestProblem("Periode tidak dapat diubah ketika tes memiliki pelaksanaan. Hapus pelaksanaan terlebih dahulu.");
        if (usage.maxCustom > draft.questionIds.length) throw new TestProblem("Jumlah soal rancangan tidak boleh lebih sedikit daripada soal remidi khusus yang sudah dipilih.");
      }
      const period = await client.query("SELECT id FROM exam_periods WHERE id=$1::bigint FOR KEY SHARE", [draft.periodId]);
      if (!period.rowCount) throw new TestProblem("Periode sudah dihapus. Muat ulang daftar dan pilih periode lain.", true);
      if (draft.questionIds.length) {
        // FOR SHARE menunggu perubahan isi maupun penghapusan soal, bukan hanya
        // perubahan kunci. Urutan kunci konsisten untuk menghindari deadlock.
        const questions = await client.query<{ id: string; revision: string }>(
          "SELECT id::text AS id, xmin::text AS revision FROM question_bank WHERE id=ANY($1::bigint[]) ORDER BY id FOR SHARE",
          [draft.questionIds],
        );
        const actual = new Map(questions.rows.map((row) => [row.id, row.revision]));
        if (draft.questionIds.some((id, index) => actual.get(id) !== draft.questionRevisions[index])) {
          throw new TestProblem("Ada soal yang berubah atau dihapus sejak daftar dimuat. Muat ulang daftar dan periksa pilihan soal.", true);
        }
      }
      const values = [draft.periodId, draft.name, draft.startsAt, draft.timeZone, draft.durationMinutes, draft.shuffleQuestions, draft.shuffleOptions];
      let id: string;
      if (mutation.id) {
        const result = await client.query<{ id: string }>(
          `UPDATE exam_tests SET period_id=$1::bigint, name=$2, starts_at=$3::timestamptz, time_zone=$4,
             duration_minutes=$5, shuffle_questions=$6, shuffle_options=$7,
             updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
           WHERE id=$8::bigint AND xmin::text=$9 RETURNING id::text AS id`,
          [...values, mutation.id, mutation.revision],
        );
        if (!result.rowCount) throw new TestProblem("Tes sudah berubah atau dihapus. Muat ulang daftar sebelum mencoba lagi.", true);
        id = result.rows[0].id;
        await client.query("DELETE FROM exam_test_questions WHERE exam_test_id=$1::bigint", [id]);
        // Durasi sesi reguler/susulan selalu mengikuti induk, dan hanya dapat
        // berubah saat semua pelaksanaannya masih draf.
        await client.query(`UPDATE exam_schedule_runs SET duration_minutes=$2,
          updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
          WHERE exam_test_id=$1::bigint AND kind IN ('regular','makeup') AND duration_minutes<>$2`, [id, draft.durationMinutes]);
      } else {
        const result = await client.query<{ id: string }>(
          `INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes,shuffle_questions,shuffle_options)
           VALUES($1::bigint,$2,$3::timestamptz,$4,$5,$6,$7) RETURNING id::text AS id`, values,
        );
        id = result.rows[0].id;
      }
      if (draft.questionIds.length) {
        await client.query(
          `INSERT INTO exam_test_questions(exam_test_id,question_id,position)
           SELECT $1::bigint, question_id, position::integer FROM unnest($2::bigint[]) WITH ORDINALITY AS selected(question_id,position)`,
          [id, draft.questionIds],
        );
      }
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new TestProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof TestProblem) return { ok: false, error: error.message, reload: error.reload };
    if (hasSqlState(error, "23503", "23001")) {
      return { ok: false, error: mutation.kind === "delete" ? "Tes masih digunakan oleh data lain dan tidak dapat dihapus." : "Periode atau soal sudah berubah. Muat ulang daftar dan periksa kembali.", reload: mutation.kind === "save" };
    }
    return { ok: false, error: "Hasil perubahan belum dapat dipastikan. Periksa koneksi dan migrasi, lalu muat ulang daftar sebelum mencoba lagi.", reload: true };
  } finally { client?.release(); }

  revalidatePath("/data-tes/daftar");
  revalidatePath("/data-tes/token");
  revalidatePath("/data-tes/token/riwayat");
  revalidatePath("/data-modul/soal");
  revalidatePath("/data-peserta/periode");
  return { ok: true, message: mutation.kind === "delete" ? "Rancangan tes berhasil dihapus." : mutation.id ? "Rancangan tes berhasil diubah." : "Rancangan tes berhasil ditambahkan." };
}

export async function saveExamTest(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  // Identitas, versi dan pengaturan tunggal tidak boleh dipilih diam-diam jika
  // pengirim menyertakan beberapa nilai berbeda. Soal adalah daftar berurutan.
  const fields = ["formVersion", "id", "revision", "name", "periodId", "startLocal", "timeZone", "durationMinutes", "shuffleQuestions", "shuffleOptions"];
  if (fields.some((field) => formData.getAll(field).length > 1)) return { ok: false, error: "Data tes mengandung nilai ganda. Periksa formulir dan coba lagi." };
  if (formData.get("formVersion") !== EXAM_TEST_FORM_VERSION) return { ok: false, error: "Versi formulir tidak sesuai. Muat ulang halaman sebelum menyimpan.", reload: true };
  const rawId = formData.get("id");
  const id = rawId === null || rawId === "" ? null : validDataId(rawId);
  if (rawId !== null && rawId !== "" && !id) return { ok: false, error: "Identitas tes tidak valid.", reload: true };
  const revision = id ? validTopicRevision(formData.get("revision")) : null;
  if (id && !revision) return { ok: false, error: "Versi tes tidak valid. Muat ulang daftar.", reload: true };
  if (!id && formData.get("revision") !== null) return { ok: false, error: "Versi tes tidak valid. Muat ulang daftar.", reload: true };
  const parsed = validateExamTestDraft({
    name: formData.get("name"), periodId: formData.get("periodId"), startLocal: formData.get("startLocal"), timeZone: formData.get("timeZone"),
    durationMinutes: formData.get("durationMinutes"), shuffleQuestions: formData.get("shuffleQuestions"), shuffleOptions: formData.get("shuffleOptions"),
    questionIds: formData.getAll("questionIds"), questionRevisions: formData.getAll("questionRevisions"),
  });
  if (!parsed.ok) return parsed;
  return mutate({ kind: "save", id, revision, draft: parsed.value });
}

export async function deleteExamTest(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  if (formData.getAll("id").length !== 1 || formData.getAll("revision").length !== 1) return { ok: false, error: "Identitas atau versi tes tidak valid. Muat ulang daftar.", reload: true };
  const id = validDataId(formData.get("id"));
  const revision = validTopicRevision(formData.get("revision"));
  if (!id || !revision) return { ok: false, error: "Identitas atau versi tes tidak valid. Muat ulang daftar.", reload: true };
  return mutate({ kind: "delete", id, revision });
}
