"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, requireAdmin } from "@/lib/admin-auth";
import { examAnswerRevision } from "@/lib/exam-attempt-validation.mjs";
import { examSubmissionWindowMinutes } from "@/lib/exam-work-settings-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

export type WorkSettingState = { revision: string; message: string; ok?: boolean; reload?: boolean };
class SettingProblem extends Error { constructor(message: string, readonly reload = false) { super(message); } }

export async function saveWorkSetting(previous: WorkSettingState, form: FormData): Promise<WorkSettingState> {
  await requireAdmin();
  if (!(form instanceof FormData) || ["minutes", "revision"].some((name) => form.getAll(name).length !== 1)) {
    return { revision: previous.revision, message: "Data pengaturan tidak valid. Muat ulang.", reload: true };
  }
  const minutes = examSubmissionWindowMinutes(form.get("minutes"));
  const revision = examAnswerRevision(form.get("revision"));
  if (minutes === null || revision === null) return { revision: previous.revision, message: "Masukkan bilangan bulat 1–10080 menit dan pastikan versi formulir masih berlaku." };
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect(); await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new SettingProblem("Sesi admin berakhir. Masuk kembali, lalu periksa pengaturan.", true);
    const result = await client.query<{ minutes: number; revision: string }>(
      'SELECT submission_window_minutes AS minutes,revision::text AS revision FROM exam_work_settings WHERE id=1 FOR UPDATE',
    );
    const row = result.rows[0]; if (!row) throw new SettingProblem("Pengaturan belum tersedia. Periksa migrasi database.", true);
    let currentRevision = row.revision;
    if (row.revision === revision) {
      if (row.minutes !== minutes) {
        const changed = await client.query<{ revision: string }>(
          `UPDATE exam_work_settings SET submission_window_minutes=$1::integer,revision=revision+1,
           updated_at=clock_timestamp(),updated_by=$2::bigint WHERE id=1 RETURNING revision::text AS revision`, [minutes, admin.id],
        );
        currentRevision = changed.rows[0].revision;
      }
    } else if (!(BigInt(row.revision) === BigInt(revision) + BigInt(1) && row.minutes === minutes)) {
      throw new SettingProblem("Pengaturan sudah berubah di tab atau oleh admin lain. Muat ulang sebelum menyimpan.", true);
    }
    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== admin.id) throw new SettingProblem("Sesi admin berakhir. Masuk kembali, lalu periksa pengaturan.", true);
    await client.query("COMMIT");
    revalidatePath("/data-tes/pengaturan-pengerjaan");
    return { revision: currentRevision, ok: true, message: `Tersimpan. Pengumpulan manual tersedia pada ${minutes} menit terakhir.` };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof SettingProblem) return { revision: previous.revision, message: error.message, reload: error.reload };
    return { revision: previous.revision, message: "Hasil penyimpanan belum dapat dipastikan. Muat ulang untuk memeriksa.", reload: true };
  } finally { client?.release(); }
}
