import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";

import { EXAM_TOKEN_ADVISORY_LOCK } from "@/lib/exam-token-constants.mjs";
import { digestSixDigitToken, examTokenKeyVerifier, normalizeSixDigitToken, sameTokenVerifier } from "@/lib/exam-token-crypto.mjs";
import { readConfiguredTokenKey } from "@/lib/exam-token-key";
import { snapshotExamQuestions } from "@/lib/exam-attempt-snapshot";
import { lockParticipantSession, participantCandidate, participantSessionHash, participantSessionStillActive, type ParticipantCandidate } from "@/lib/participant-session-lock";
import { getPostgresPool } from "@/lib/postgres";

export type StartAttemptResult = { ok: true; attemptId: string } | { ok: false; error: string; login?: boolean };
class StartProblem extends Error {
  constructor(message: string, readonly login = false) { super(message); }
}
const NO_ACCESS = "Jadwal tidak dapat dimulai. Periksa jadwal dan hubungi pengawas.";
const TOKEN_ERROR = "Token tidak cocok atau akses token sementara terkunci. Hubungi pengawas.";
type TokenRow = { codeVersion: number; digest: Buffer };

/** Caller memegang advisory token lock; token khusus aktif lebih dahulu. */
async function tokenMatches(client: PoolClient, testId: string, code: string, key: Buffer) {
  const binding = await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id=1 FOR SHARE");
  if (!binding.rowCount || !sameTokenVerifier(binding.rows[0].verifier, examTokenKeyVerifier(key))) {
    throw new StartProblem("Token belum dapat diperiksa. Minta pengawas memeriksa konfigurasi server.");
  }
  const token = await client.query<TokenRow>(
    `SELECT code_version AS "codeVersion",token_hash AS digest FROM exam_access_tokens
     WHERE revoked_at IS NULL AND issued_at<=clock_timestamp() AND expires_at>clock_timestamp()
       AND ((scope='test' AND exam_test_id=$1::bigint) OR scope='global')
     ORDER BY CASE WHEN scope='test' THEN 0 ELSE 1 END LIMIT 1`, [testId],
  );
  const current = token.rows[0];
  if (!current || current.codeVersion !== 2) return false;
  const digest = digestSixDigitToken(code, key);
  try { return current.digest.length === digest.length && timingSafeEqual(current.digest, digest); }
  finally { digest.fill(0); }
}

/** Pemeriksaan awal murah agar token salah tidak memicu penyalinan soal/gambar. */
async function precheck(client: PoolClient, hash: Buffer, runId: string, code: string, key: Buffer): Promise<StartAttemptResult | { ok: true; ready: true }> {
  await client.query("BEGIN");
  try {
    const candidate = await participantCandidate(client, hash);
    const participant = candidate && await lockParticipantSession(client, hash, candidate);
    if (!participant) throw new StartProblem("Sesi peserta sudah berakhir. Masuk kembali.", true);
    const schedule = await client.query<{ testId: string }>(
      `SELECT r.exam_test_id::text AS "testId" FROM exam_schedule_runs r
       JOIN exam_schedule_participants rp ON rp.run_id=r.id AND rp.student_id=$2::bigint
       WHERE r.id=$1::bigint AND r.period_id=$3::bigint AND r.published_at IS NOT NULL
         AND r.starts_at<=clock_timestamp() AND r.starts_at+r.duration_minutes*interval '1 minute'>clock_timestamp()`,
      [runId, participant.studentId, participant.periodId],
    );
    if (!schedule.rowCount) throw new StartProblem(NO_ACCESS);
    const existing = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM exam_attempts WHERE run_id=$1::bigint AND participant_identity_id=$2::bigint", [runId, participant.identityId],
    );
    if (existing.rowCount) {
      if (!await participantSessionStillActive(client, hash, participant)) throw new StartProblem("Sesi peserta sudah berakhir. Masuk kembali.", true);
      await client.query("COMMIT");
      return { ok: true, attemptId: existing.rows[0].id };
    }
    await client.query("INSERT INTO exam_start_token_attempts(participant_identity_id) VALUES($1::bigint) ON CONFLICT DO NOTHING", [participant.identityId]);
    const failures = await client.query<{ attempts: number; locked: boolean; expired: boolean }>(
      `SELECT failed_attempts AS attempts,COALESCE(locked_until>clock_timestamp(),false) AS locked,
        COALESCE(locked_until<=clock_timestamp(),false) AS expired
       FROM exam_start_token_attempts WHERE participant_identity_id=$1::bigint FOR UPDATE`, [participant.identityId],
    );
    const global = await client.query<{ attempts: number; fresh: boolean }>(
      `SELECT failed_attempts AS attempts,window_started_at>clock_timestamp()-interval '1 minute'
        AND window_started_at<=clock_timestamp() AS fresh FROM exam_start_token_global_limit WHERE id=1 FOR UPDATE`,
    );
    if (!global.rowCount || !failures.rowCount) throw new Error("Pembatas token tidak tersedia.");
    if (failures.rows[0].locked || (global.rows[0].fresh && global.rows[0].attempts >= 60)) {
      await client.query("COMMIT"); return { ok: false, error: TOKEN_ERROR };
    }
    await client.query("SELECT pg_advisory_xact_lock($1)", [EXAM_TOKEN_ADVISORY_LOCK]);
    const matches = await tokenMatches(client, schedule.rows[0].testId, code, key);
    if (!await participantSessionStillActive(client, hash, participant)) throw new StartProblem("Sesi peserta sudah berakhir. Masuk kembali.", true);
    if (!matches) {
      const count = (failures.rows[0].expired ? 0 : failures.rows[0].attempts) + 1;
      await client.query(
        `UPDATE exam_start_token_attempts SET failed_attempts=LEAST($2::integer,5),
         locked_until=CASE WHEN $2::integer>=5 THEN clock_timestamp()+interval '15 minutes' ELSE NULL END,
         last_attempt_at=clock_timestamp() WHERE participant_identity_id=$1::bigint`, [participant.identityId, count],
      );
      await client.query(
        `UPDATE exam_start_token_global_limit SET
         window_started_at=CASE WHEN window_started_at<=clock_timestamp()-interval '1 minute' OR window_started_at>clock_timestamp()
           THEN clock_timestamp() ELSE window_started_at END,
         failed_attempts=CASE WHEN window_started_at<=clock_timestamp()-interval '1 minute' OR window_started_at>clock_timestamp()
           THEN 1 ELSE LEAST(failed_attempts+1,61) END WHERE id=1`,
      );
      await client.query("COMMIT"); return { ok: false, error: TOKEN_ERROR };
    }
    await client.query("UPDATE exam_start_token_attempts SET failed_attempts=0,locked_until=NULL,last_attempt_at=clock_timestamp() WHERE participant_identity_id=$1::bigint", [participant.identityId]);
    await client.query("COMMIT");
    return { ok: true, ready: true };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

type LockedTest = { id: string; name: string; shuffleQuestions: boolean; shuffleOptions: boolean };
type LockedRun = { id: string; kind: "regular" | "makeup" | "remedial"; label: string; zone: "WIB" | "WITA" | "WIT"; mode: "inherit" | "custom" };

/** Kunci tes lalu pelaksanaan, sama seperti mutasi admin. */
async function lockSchedule(client: PoolClient, runId: string, candidate: ParticipantCandidate) {
  const lookup = await client.query<{ testId: string }>("SELECT exam_test_id::text AS \"testId\" FROM exam_schedule_runs WHERE id=$1::bigint AND period_id=$2::bigint", [runId, candidate.periodId]);
  if (!lookup.rowCount) throw new StartProblem(NO_ACCESS);
  const tests = await client.query<LockedTest>(
    'SELECT id::text AS id,name,shuffle_questions AS "shuffleQuestions",shuffle_options AS "shuffleOptions" FROM exam_tests WHERE id=$1::bigint AND period_id=$2::bigint FOR SHARE',
    [lookup.rows[0].testId, candidate.periodId],
  );
  const runs = await client.query<LockedRun>(
    `SELECT id::text AS id,kind,label,time_zone AS zone,question_mode AS mode FROM exam_schedule_runs
     WHERE id=$1::bigint AND exam_test_id=$2::bigint AND period_id=$3::bigint AND published_at IS NOT NULL
       AND starts_at<=clock_timestamp() AND starts_at+duration_minutes*interval '1 minute'>clock_timestamp() FOR SHARE`,
    [runId, lookup.rows[0].testId, candidate.periodId],
  );
  if (!tests.rowCount || !runs.rowCount) throw new StartProblem(NO_ACCESS);
  return { test: tests.rows[0], run: runs.rows[0] };
}

export async function startExamAttempt(runId: string, rawCode: unknown): Promise<StartAttemptResult> {
  const hash = await participantSessionHash();
  if (!hash) return { ok: false, error: "Sesi peserta sudah berakhir. Masuk kembali.", login: true };
  const code = normalizeSixDigitToken(rawCode);
  if (!code) return { ok: false, error: "Token harus tepat enam angka." };
  let client: PoolClient | undefined; let key: Buffer | undefined;
  try {
    key = await readConfiguredTokenKey();
    client = await getPostgresPool().connect();
    const checked = await precheck(client, hash, runId, code, key);
    if (!checked.ok || "attemptId" in checked) return checked;

    await client.query("BEGIN");
    const candidate = await participantCandidate(client, hash);
    if (!candidate) throw new StartProblem("Sesi peserta sudah berakhir. Masuk kembali.", true);
    const { test, run } = await lockSchedule(client, runId, candidate);
    const participant = await lockParticipantSession(client, hash, candidate);
    if (!participant) throw new StartProblem("Sesi peserta sudah berakhir. Masuk kembali.", true);
    const roster = await client.query("SELECT 1 FROM exam_schedule_participants WHERE run_id=$1::bigint AND student_id=$2::bigint", [run.id, participant.studentId]);
    if (!roster.rowCount) throw new StartProblem(NO_ACCESS);
    const existing = await client.query<{ id: string }>("SELECT id::text AS id FROM exam_attempts WHERE run_id=$1::bigint AND participant_identity_id=$2::bigint", [run.id, participant.identityId]);
    if (existing.rowCount) {
      if (!await participantSessionStillActive(client, hash, participant)) throw new StartProblem("Sesi peserta sudah berakhir. Masuk kembali.", true);
      await client.query("COMMIT"); return { ok: true, attemptId: existing.rows[0].id };
    }
    const questions = run.mode === "custom"
      ? await client.query<{ id: string }>("SELECT question_id::text AS id FROM exam_schedule_custom_questions WHERE run_id=$1::bigint ORDER BY position", [run.id])
      : await client.query<{ id: string }>("SELECT question_id::text AS id FROM exam_test_questions WHERE exam_test_id=$1::bigint ORDER BY position", [test.id]);
    if (!questions.rowCount || questions.rowCount > 1000) throw new StartProblem("Soal tes belum siap. Hubungi pengawas.");
    const attempt = await client.query<{ id: string }>(
      `INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,
       class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,deadline,question_count)
       SELECT r.id,r.exam_test_id,r.period_id,r.kind,$2::bigint,$3::bigint,$4,$5,$6,$7,r.label,r.time_zone,
         r.starts_at+r.duration_minutes*interval '1 minute',$8::integer FROM exam_schedule_runs r
       WHERE r.id=$1::bigint AND r.published_at IS NOT NULL AND r.starts_at<=clock_timestamp()
         AND r.starts_at+r.duration_minutes*interval '1 minute'>clock_timestamp()
       ON CONFLICT (run_id,participant_identity_id) DO NOTHING RETURNING id::text AS id`,
      [run.id, participant.identityId, participant.studentId, participant.studentName, participant.participantNumber, participant.className, test.name, questions.rowCount],
    );
    if (!attempt.rowCount) {
      // Start bersamaan boleh memenangkan unique constraint di transaksi lain.
      // Bila benar-benar sudah ada, lanjutkan attempt itu, bukan membuat ulang.
      const winner = await client.query<{ id: string }>("SELECT id::text AS id FROM exam_attempts WHERE run_id=$1::bigint AND participant_identity_id=$2::bigint", [run.id, participant.identityId]);
      if (!winner.rowCount) throw new StartProblem(NO_ACCESS);
      if (!await participantSessionStillActive(client, hash, participant)) throw new StartProblem("Sesi peserta sudah berakhir. Masuk kembali.", true);
      await client.query("COMMIT"); return { ok: true, attemptId: winner.rows[0].id };
    }
    await snapshotExamQuestions(client, attempt.rows[0].id, questions.rows.map((row) => row.id), test.shuffleQuestions, test.shuffleOptions);
    // Token diperiksa lagi di transaksi yang membuat attempt. Mutasi token
    // menunggu advisory lock ini; expiry dan prioritas diperiksa sebelum commit.
    await client.query("SELECT pg_advisory_xact_lock($1)", [EXAM_TOKEN_ADVISORY_LOCK]);
    if (!await tokenMatches(client, test.id, code, key)) throw new StartProblem("Token berubah atau kedaluwarsa saat tes disiapkan. Minta token terbaru kepada pengawas.");
    if (!await participantSessionStillActive(client, hash, participant)) throw new StartProblem("Sesi peserta sudah berakhir. Masuk kembali.", true);
    const remaining = await client.query("SELECT 1 FROM exam_attempts WHERE id=$1::bigint AND deadline>clock_timestamp()", [attempt.rows[0].id]);
    if (!remaining.rowCount) throw new StartProblem("Waktu tes habis sebelum soal selesai disiapkan.");
    await client.query("COMMIT");
    return { ok: true, attemptId: attempt.rows[0].id };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof StartProblem) return { ok: false, error: error.message, login: error.login || undefined };
    return { ok: false, error: "Hasil mulai tes belum dapat dipastikan. Muat ulang jadwal sebelum mencoba lagi." };
  } finally { key?.fill(0); client?.release(); }
}
