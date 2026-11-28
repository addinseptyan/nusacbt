import "server-only";

import { ensureGlobalTokenAutoRotated } from "@/lib/global-token-scheduler";
import { getPostgresPool } from "@/lib/postgres";

const BATCH_SIZE = 100;
const INTERVAL_MS = 2_000;
const RETRY_LOG_MS = 60_000;

/**
 * Semua keputusan memakai jam PostgreSQL. SKIP LOCKED mengizinkan beberapa
 * proses aplikasi berbagi pekerjaan dan tidak menunggu peserta yang sedang
 * menyimpan. Hanya attempt yang benar-benar kedaluwarsa dan lengkap dihitung.
 * Nilai tidak dibulatkan di sini: yang disimpan adalah jumlah benar/terjawab.
 */
export async function finalizeExpiredExamAttempts(): Promise<number> {
  const result = await getPostgresPool().query<{ id: string }>(
    `WITH due AS MATERIALIZED (
       SELECT id,question_count FROM exam_attempts
       WHERE completed_at IS NULL AND deadline<=clock_timestamp()
       ORDER BY deadline,id LIMIT $1::integer FOR UPDATE SKIP LOCKED
     ), totals AS (
       SELECT due.id, count(aq.position)::integer AS total,
         count(aq.answer)::integer AS answered,
         count(*) FILTER (WHERE aq.answer=s.correct_option)::integer AS correct
       FROM due JOIN exam_attempt_questions aq ON aq.attempt_id=due.id
       JOIN exam_question_snapshots s ON s.id=aq.snapshot_id GROUP BY due.id
     )
     UPDATE exam_attempts a SET completed_at=a.deadline,completion_reason='time_expired',
       correct_count=totals.correct,answered_count=totals.answered
     FROM due JOIN totals ON totals.id=due.id
     WHERE a.id=due.id AND a.completed_at IS NULL AND totals.total=due.question_count
     RETURNING a.id::text AS id`, [BATCH_SIZE],
  );
  return result.rowCount ?? 0;
}

type WorkerState = { started: boolean; lastErrorAt: number };
const workerGlobal = globalThis as typeof globalThis & { nusacbtExamFinalizer?: WorkerState };

/**
 * Dijalankan sekali per proses Next.js. Jika proses/database berhenti, jawaban
 * tetap tertutup pada deadline dan backlog dikerjakan saat layanan pulih.
 * Tidak ada ketergantungan pada browser peserta. Gunakan layanan Node yang
 * terus berjalan; deployment serverless/yang ditidurkan tidak menjamin jadwal.
 */
export function startExamFinalizer() {
  if (workerGlobal.nusacbtExamFinalizer?.started) return;
  const state: WorkerState = { started: true, lastErrorAt: 0 };
  workerGlobal.nusacbtExamFinalizer = state;
  const run = async () => {
    let delay = INTERVAL_MS;
    try {
      // Langsung lanjutkan batch berikutnya jika backlog masih penuh.
      if (await finalizeExpiredExamAttempts() === BATCH_SIZE) delay = 50;
      await ensureGlobalTokenAutoRotated();
    } catch {
      if (Date.now() - state.lastErrorAt >= RETRY_LOG_MS) {
        console.error("Penyelesaian otomatis ujian tertunda. Periksa PostgreSQL dan migrasi; layanan akan mencoba lagi.");
        state.lastErrorAt = Date.now();
      }
    } finally {
      const timer = setTimeout(run, delay);
      timer.unref();
    }
  };
  const timer = setTimeout(run, 500);
  timer.unref();
}
