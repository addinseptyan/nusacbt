"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, requireAdmin } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { examAnswerRevision } from "@/lib/exam-attempt-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

export type ScoreVisibilityResult = { ok: true; message: string } | { ok: false; error: string; reload?: boolean };
class VisibilityProblem extends Error { constructor(message: string, readonly reload = false) { super(message); } }

/** Pengaturan per tes, bukan per pelaksanaan atau per peserta. */
export async function saveScoreVisibility(form: FormData): Promise<ScoreVisibilityResult> {
  await requireAdmin();
  if (!(form instanceof FormData) || ["testId", "revision", "visible"].some((name) => form.getAll(name).length !== 1)) {
    return { ok: false, error: "Data pengaturan tidak valid. Muat ulang halaman.", reload: true };
  }
  const testId = validDataId(form.get("testId"));
  const revision = examAnswerRevision(form.get("revision"));
  const raw = form.get("visible");
  if (!testId || revision === null || (raw !== "true" && raw !== "false")) return { ok: false, error: "Data pengaturan tidak valid. Muat ulang halaman.", reload: true };
  const visible = raw === "true";
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect(); await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new VisibilityProblem("Sesi admin berakhir. Masuk kembali dan periksa pengaturan.", true);
    const exists = await client.query("SELECT id FROM exam_tests WHERE id=$1::bigint FOR KEY SHARE", [testId]);
    if (!exists.rowCount) throw new VisibilityProblem("Tes sudah dihapus. Muat ulang halaman.", true);
    // Baris dibuat hanya saat pertama kali diatur; ketiadaan baris berarti false.
    await client.query("INSERT INTO exam_score_visibility(exam_test_id) VALUES($1::bigint) ON CONFLICT(exam_test_id) DO NOTHING", [testId]);
    const row = (await client.query<{ visible: boolean; revision: string }>(
      "SELECT visible_to_participants AS visible,revision::text AS revision FROM exam_score_visibility WHERE exam_test_id=$1::bigint FOR UPDATE", [testId],
    )).rows[0];
    if (!row) throw new Error("Pengaturan nilai tidak tersedia.");
    if (row.revision === revision) {
      if (row.visible !== visible) await client.query(
        `UPDATE exam_score_visibility SET visible_to_participants=$2,revision=revision+1,
         updated_at=clock_timestamp(),updated_by=$3::bigint WHERE exam_test_id=$1::bigint`, [testId, visible, admin.id],
      );
    } else if (!(BigInt(row.revision) === BigInt(revision) + BigInt(1) && row.visible === visible)) {
      throw new VisibilityProblem("Pengaturan nilai sudah berubah di tab atau oleh admin lain. Muat ulang sebelum mengubah.", true);
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new VisibilityProblem("Sesi admin berakhir. Masuk kembali dan periksa pengaturan.", true);
    await client.query("COMMIT");
    revalidatePath("/data-tes/monitoring"); revalidatePath("/peserta");
    return { ok: true, message: visible ? "Nilai pengerjaan yang selesai dibuka untuk peserta tes ini." : "Nilai pengerjaan tes ini disembunyikan kembali." };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof VisibilityProblem) return { ok: false, error: error.message, reload: error.reload };
    return { ok: false, error: "Hasil perubahan belum dapat dipastikan. Muat ulang untuk memeriksa.", reload: true };
  } finally { client?.release(); }
}
