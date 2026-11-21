"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, requireAdmin } from "@/lib/admin-auth";
import { examAnswerRevision } from "@/lib/exam-attempt-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

export type ScoreVisibilityResult = { ok: true; message: string } | { ok: false; error: string; reload?: boolean };
class VisibilityProblem extends Error { constructor(message: string, readonly reload = false) { super(message); } }

/** Kebijakan satu kategori berlaku untuk semua tes dan riwayat yang selesai. */
export async function saveScoreCategoryVisibility(form: FormData): Promise<ScoreVisibilityResult> {
  await requireAdmin();
  if (!(form instanceof FormData) || ["kind", "revision", "visible"].some((name) => form.getAll(name).length !== 1)) {
    return { ok: false, error: "Data pengaturan tidak valid. Muat ulang halaman.", reload: true };
  }
  const kind = form.get("kind");
  const revision = examAnswerRevision(form.get("revision"));
  const raw = form.get("visible");
  if ((kind !== "regular" && kind !== "makeup" && kind !== "remedial") || revision === null || (raw !== "true" && raw !== "false")) {
    return { ok: false, error: "Data pengaturan tidak valid. Muat ulang halaman.", reload: true };
  }
  const visible = raw === "true";
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new VisibilityProblem("Sesi admin berakhir. Masuk kembali dan periksa pengaturan.", true);
    const row = (await client.query<{ visible: boolean; revision: string }>(
      "SELECT visible_to_participants AS visible,revision::text AS revision FROM exam_score_category_visibility WHERE kind=$1 FOR UPDATE", [kind],
    )).rows[0];
    if (!row) throw new VisibilityProblem("Pengaturan kategori belum tersedia. Periksa migrasi database.", true);
    if (row.revision === revision) {
      if (row.visible !== visible) await client.query(
        `UPDATE exam_score_category_visibility SET visible_to_participants=$2,revision=revision+1,
         updated_at=clock_timestamp(),updated_by=$3::bigint WHERE kind=$1`, [kind, visible, admin.id],
      );
    } else if (!(BigInt(row.revision) === BigInt(revision) + BigInt(1) && row.visible === visible)) {
      // Retry dengan respons hilang diizinkan hanya untuk perubahan identik tepat satu revisi.
      throw new VisibilityProblem("Pengaturan nilai sudah berubah di tab atau oleh admin lain. Muat ulang sebelum mengubah.", true);
    }
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new VisibilityProblem("Sesi admin berakhir. Masuk kembali dan periksa pengaturan.", true);
    await client.query("COMMIT");
    revalidatePath("/data-tes/pengaturan-pengerjaan");
    revalidatePath("/peserta");
    return { ok: true, message: visible ? "Nilai kategori ini sekarang tersedia bagi pemilik pengerjaan yang selesai." : "Nilai kategori ini disembunyikan pada permintaan berikutnya." };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof VisibilityProblem) return { ok: false, error: error.message, reload: error.reload };
    return { ok: false, error: "Hasil perubahan belum dapat dipastikan. Muat ulang untuk memeriksa.", reload: true };
  } finally { client?.release(); }
}
