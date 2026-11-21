import "server-only";
import type { PoolClient } from "pg";

import { EXAM_OPTION_IDS, validExamOptionOrder } from "@/lib/exam-attempt-validation.mjs";
import { gradeExamCounts } from "@/lib/exam-grading.mjs";
import { lockParticipantSession, participantCandidate, participantSessionHash, participantSessionStillActive } from "@/lib/participant-session-lock";
import { getPostgresPool } from "@/lib/postgres";

type AttemptRow = {
  id: string; examTestId: string; testName: string; runLabel: string; deadline: Date; questionCount: number;
  completedAt: Date | null; completionReason: "submitted" | "time_expired" | null; expired: boolean; now: Date;
};
type OptionContent = { text: string; rich: unknown | null; hasImage: boolean };
type RawQuestion = {
  position: number; answer: string | null; revision: string; doubtful: boolean; doubtRevision: string; order: string;
  prompt: string; promptRich: unknown | null; hasPromptImage: boolean; options: Record<string, OptionContent>;
};
export type AttemptView =
  | { state: "finished"; testName: string; runLabel: string; reason: "submitted" | "time_expired"; score: string | null }
  | { state: "working"; attemptId: string; testName: string; runLabel: string; deadline: string; serverNow: string;
      participant: { name: string; nisn: string; className: string; period: string };
      total: number; position: number; answered: number; navigation: { position: number; answered: boolean; doubtful: boolean }[];
      question: { prompt: string; promptRich: unknown | null; hasPromptImage: boolean; answer: string | null; revision: string;
        doubtful: boolean; doubtRevision: string;
        options: { id: string; label: string; text: string; rich: unknown | null; hasImage: boolean }[] } };
export type WorkResult = { ok: true; revision?: string; answer?: string | null } | { ok: false; error: string; login?: boolean; closed?: boolean; reload?: boolean; tooEarly?: boolean; windowMinutes?: number };
export type SubmissionCheck =
  | { ok: true; allowed: boolean; windowMinutes: number; answered: number; doubtful: number; total: number }
  | { ok: false; error: string; login?: boolean; closed?: boolean };

class WorkProblem extends Error {
  constructor(message: string, readonly login = false, readonly closed = false, readonly reload = false) { super(message); }
}
const LOGIN = "Sesi peserta sudah berakhir. Masuk kembali.";
const NOT_FOUND = "Pengerjaan tidak ditemukan atau bukan milik sesi ini.";

async function lockAttempt(client: PoolClient, attemptId: string, identityId: string): Promise<AttemptRow | null> {
  const result = await client.query<AttemptRow>(
    `SELECT id::text AS id,exam_test_id::text AS "examTestId",test_name_snapshot AS "testName",run_label_snapshot AS "runLabel",deadline,
       question_count AS "questionCount",completed_at AS "completedAt",completion_reason AS "completionReason",
       deadline<=clock_timestamp() AS expired,clock_timestamp() AS now
     FROM exam_attempts WHERE id=$1::bigint AND participant_identity_id=$2::bigint FOR UPDATE`, [attemptId, identityId],
  );
  return result.rows[0] ?? null;
}

/** Caller memegang FOR UPDATE atas attempt; hanya jawaban yang sudah commit dihitung. */
async function completeLockedAttempt(client: PoolClient, attempt: AttemptRow, requested: "submitted" | "time_expired") {
  if (attempt.completedAt) return;
  const counts = await client.query<{ total: number; answered: number; correct: number }>(
    `SELECT count(*)::int AS total,count(aq.answer)::int AS answered,
       count(*) FILTER (WHERE aq.answer=s.correct_option)::int AS correct
     FROM exam_attempt_questions aq JOIN exam_question_snapshots s ON s.id=aq.snapshot_id WHERE aq.attempt_id=$1::bigint`, [attempt.id],
  );
  const { total, answered, correct } = counts.rows[0];
  if (total !== attempt.questionCount || correct > answered || answered > total) throw new Error("Jumlah snapshot attempt tidak konsisten.");
  await client.query(
    `WITH moment AS (SELECT clock_timestamp() AS now)
     UPDATE exam_attempts a SET
       completed_at=GREATEST(a.started_at,LEAST(moment.now,a.deadline)),
       completion_reason=CASE WHEN moment.now>=a.deadline OR $4='time_expired' THEN 'time_expired' ELSE 'submitted' END,
       correct_count=$2::integer,answered_count=$3::integer
     FROM moment WHERE a.id=$1::bigint AND a.completed_at IS NULL`,
    [attempt.id, correct, answered, requested],
  );
}

async function finishIfExpired(client: PoolClient, attempt: AttemptRow) {
  if (!attempt.completedAt && attempt.expired) {
    await completeLockedAttempt(client, attempt, "time_expired");
    return true;
  }
  return false;
}

async function authenticatedAttempt(client: PoolClient, hash: Buffer, attemptId: string) {
  const candidate = await participantCandidate(client, hash);
  const participant = candidate && await lockParticipantSession(client, hash, candidate);
  if (!participant) throw new WorkProblem(LOGIN, true);
  const attempt = await lockAttempt(client, attemptId, participant.identityId);
  if (!attempt) throw new WorkProblem(NOT_FOUND);
  return { participant, attempt };
}

function checkedOptions(raw: RawQuestion) {
  if (!validExamOptionOrder(raw.order) || typeof raw.options !== "object" || raw.options === null) throw new Error("Urutan pilihan snapshot tidak valid.");
  return [...raw.order].map((id, index) => {
    const item = raw.options[id];
    if (!item || typeof item.text !== "string" || typeof item.hasImage !== "boolean") throw new Error("Pilihan snapshot tidak lengkap.");
    return { id, label: EXAM_OPTION_IDS[index], text: item.text, rich: item.rich ?? null, hasImage: item.hasImage };
  });
}

/** Pengaturan dikunci sampai commit. Tidak ada baris berarti nilai tersembunyi. */
async function finishedAttemptView(client: PoolClient, attempt: AttemptRow, reason: "submitted" | "time_expired"): Promise<Extract<AttemptView, { state: "finished" }>> {
  const policy = await client.query<{ visible: boolean }>(
    "SELECT visible_to_participants AS visible FROM exam_score_visibility WHERE exam_test_id=$1::bigint FOR SHARE", [attempt.examTestId],
  );
  let score: string | null = null;
  if (policy.rows[0]?.visible) {
    const result = await client.query<{ correct: number; total: number }>(
      "SELECT correct_count AS correct,question_count AS total FROM exam_attempts WHERE id=$1::bigint AND completed_at IS NOT NULL", [attempt.id],
    );
    const row = result.rows[0]; const grade = row && gradeExamCounts(row.correct, row.total);
    if (!grade || !grade.ok) throw new Error("Nilai pengerjaan tidak konsisten.");
    score = grade.display;
  }
  return { state: "finished", testName: attempt.testName, runLabel: attempt.runLabel, reason, score };
}

/** Kunci jawaban tidak pernah dikirim; nilai hanya jika selesai dan diizinkan server. */
export async function loadExamAttempt(attemptId: string, requestedPosition: number): Promise<AttemptView | "login" | "missing"> {
  const hash = await participantSessionHash(); if (!hash) return "login";
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const { participant, attempt } = await authenticatedAttempt(client, hash, attemptId);
    const justExpired = await finishIfExpired(client, attempt);
    if (attempt.completedAt || justExpired) {
      const finished = await finishedAttemptView(client, attempt, justExpired ? "time_expired" : attempt.completionReason!);
      if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
      await client.query("COMMIT");
      return finished;
    }
    const position = Math.min(Math.max(1, requestedPosition), attempt.questionCount);
    const navigation = (await client.query<{ position: number; answered: boolean; doubtful: boolean }>(
      `SELECT position,answer IS NOT NULL AS answered,is_doubtful AS doubtful
       FROM exam_attempt_questions WHERE attempt_id=$1::bigint ORDER BY position`, [attempt.id],
    )).rows;
    if (navigation.length !== attempt.questionCount) throw new Error("Snapshot attempt tidak lengkap.");
    const question = (await client.query<RawQuestion>(
      `SELECT aq.position,aq.answer,aq.answer_revision::text AS revision,aq.is_doubtful AS doubtful,
       aq.doubt_revision::text AS "doubtRevision",aq.option_order AS "order",
       s.prompt_text AS prompt,s.prompt_rich AS "promptRich",s.has_prompt_image AS "hasPromptImage",s.options
       FROM exam_attempt_questions aq JOIN exam_question_snapshots s ON s.id=aq.snapshot_id
       WHERE aq.attempt_id=$1::bigint AND aq.position=$2::integer`, [attempt.id, position],
    )).rows[0];
    if (!question) throw new Error("Soal snapshot tidak tersedia.");
    const options = checkedOptions(question);
    if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
    // Jika waktu habis selama loading, jangan kirim soal untuk attempt tertutup.
    const now = (await client.query<{ now: Date; expired: boolean }>("SELECT clock_timestamp() AS now,deadline<=clock_timestamp() AS expired FROM exam_attempts WHERE id=$1::bigint", [attempt.id])).rows[0];
    if (now.expired) {
      await completeLockedAttempt(client, attempt, "time_expired");
      const finished = await finishedAttemptView(client, attempt, "time_expired");
      if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
      await client.query("COMMIT"); return finished;
    }
    await client.query("COMMIT");
    return { state: "working", attemptId: attempt.id, testName: attempt.testName, runLabel: attempt.runLabel,
      deadline: attempt.deadline.toISOString(), serverNow: now.now.toISOString(), total: attempt.questionCount, position,
      participant: { name: participant.studentName, nisn: participant.studentNisn, className: participant.className, period: participant.periodName },
      answered: navigation.filter((item) => item.answered).length, navigation,
      question: { prompt: question.prompt, promptRich: question.promptRich, hasPromptImage: question.hasPromptImage,
        answer: question.answer, revision: question.revision, doubtful: question.doubtful, doubtRevision: question.doubtRevision, options } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof WorkProblem) return error.login ? "login" : "missing";
    throw error;
  } finally { client.release(); }
}

/** Revision melindungi tab usang; retry respons hilang tetap idempoten. */
export async function saveExamAnswer(attemptId: string, position: number, desired: string | null, expectedRevision: string): Promise<WorkResult> {
  const hash = await participantSessionHash(); if (!hash) return { ok: false, error: LOGIN, login: true };
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const { participant, attempt } = await authenticatedAttempt(client, hash, attemptId);
    if (attempt.completedAt || await finishIfExpired(client, attempt)) {
      if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
      await client.query("COMMIT"); return { ok: false, error: "Waktu habis atau tes sudah selesai.", closed: true };
    }
    const found = await client.query<{ answer: string | null; revision: string }>(
      'SELECT answer,answer_revision::text AS revision FROM exam_attempt_questions WHERE attempt_id=$1::bigint AND position=$2::integer FOR UPDATE', [attempt.id, position],
    );
    const row = found.rows[0]; if (!row) throw new WorkProblem("Nomor soal tidak ditemukan.", false, false, true);
    let revision = row.revision;
    if (revision === expectedRevision) {
      if (row.answer !== desired) {
        const changed = await client.query<{ revision: string }>(
          `UPDATE exam_attempt_questions SET answer=$3,answer_revision=answer_revision+1,answered_at=clock_timestamp()
           WHERE attempt_id=$1::bigint AND position=$2::integer RETURNING answer_revision::text AS revision`, [attempt.id, position, desired],
        );
        revision = changed.rows[0].revision;
      }
    } else if (!(BigInt(revision) === BigInt(expectedRevision) + BigInt(1) && row.answer === desired)) {
      throw new WorkProblem("Jawaban telah berubah pada tab atau perangkat lain. Muat ulang untuk memeriksanya.", false, false, true);
    }
    if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
    const remaining = await client.query("SELECT 1 FROM exam_attempts WHERE id=$1::bigint AND deadline>clock_timestamp() AND completed_at IS NULL", [attempt.id]);
    if (!remaining.rowCount) throw new WorkProblem("Waktu habis sebelum jawaban dikonfirmasi tersimpan.", false, true);
    await client.query("COMMIT"); return { ok: true, revision, answer: desired };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof WorkProblem) return { ok: false, error: error.message, login: error.login || undefined, closed: error.closed || undefined, reload: error.reload || undefined };
    return { ok: false, error: "Jawaban belum dapat dipastikan tersimpan. Coba simpan lagi; jangan anggap aman sebelum ada konfirmasi." };
  } finally { client.release(); }
}

/** Tanda ragu memiliki revisi sendiri dan tidak pernah mengubah jawaban. */
export async function saveExamDoubt(attemptId: string, position: number, desired: boolean, expectedRevision: string): Promise<WorkResult> {
  const hash = await participantSessionHash(); if (!hash) return { ok: false, error: LOGIN, login: true };
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const { participant, attempt } = await authenticatedAttempt(client, hash, attemptId);
    if (attempt.completedAt || await finishIfExpired(client, attempt)) {
      if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
      await client.query("COMMIT"); return { ok: false, error: "Waktu habis atau tes sudah selesai.", closed: true };
    }
    const found = await client.query<{ doubtful: boolean; revision: string }>(
      'SELECT is_doubtful AS doubtful,doubt_revision::text AS revision FROM exam_attempt_questions WHERE attempt_id=$1::bigint AND position=$2::integer FOR UPDATE', [attempt.id, position],
    );
    const row = found.rows[0]; if (!row) throw new WorkProblem("Nomor soal tidak ditemukan.", false, false, true);
    let revision = row.revision;
    if (revision === expectedRevision) {
      if (row.doubtful !== desired) {
        const changed = await client.query<{ revision: string }>(
          `UPDATE exam_attempt_questions SET is_doubtful=$3,doubt_revision=doubt_revision+1
           WHERE attempt_id=$1::bigint AND position=$2::integer RETURNING doubt_revision::text AS revision`, [attempt.id, position, desired],
        );
        revision = changed.rows[0].revision;
      }
    } else if (!(BigInt(revision) === BigInt(expectedRevision) + BigInt(1) && row.doubtful === desired)) {
      throw new WorkProblem("Tanda ragu telah berubah pada tab atau perangkat lain. Muat ulang untuk memeriksanya.", false, false, true);
    }
    if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
    const remaining = await client.query("SELECT 1 FROM exam_attempts WHERE id=$1::bigint AND deadline>clock_timestamp() AND completed_at IS NULL", [attempt.id]);
    if (!remaining.rowCount) throw new WorkProblem("Waktu habis sebelum tanda ragu dikonfirmasi tersimpan.", false, true);
    await client.query("COMMIT"); return { ok: true, revision };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof WorkProblem) return { ok: false, error: error.message, login: error.login || undefined, closed: error.closed || undefined, reload: error.reload || undefined };
    return { ok: false, error: "Tanda ragu belum dapat dipastikan tersimpan. Coba simpan lagi; jangan anggap aman sebelum ada konfirmasi." };
  } finally { client.release(); }
}

/** Gambar snapshot hanya untuk attempt dan sesi peserta pemilik yang masih aktif. */
export async function loadExamAttemptImage(attemptId: string, position: number, slot: string): Promise<{ data: Buffer; mime: string } | null> {
  const hash = await participantSessionHash(); if (!hash) return null;
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const candidate = await participantCandidate(client, hash);
    const participant = candidate && await lockParticipantSession(client, hash, candidate);
    if (!participant) { await client.query("ROLLBACK"); return null; }
    const image = await client.query<{ data: Buffer; mime: string }>(
      `SELECT img.data,img.mime FROM exam_attempts a
       JOIN exam_attempt_questions aq ON aq.attempt_id=a.id
       JOIN exam_question_snapshot_images img ON img.snapshot_id=aq.snapshot_id
       WHERE a.id=$1::bigint AND a.participant_identity_id=$2::bigint AND a.completed_at IS NULL
         AND a.deadline>clock_timestamp() AND aq.position=$3::integer AND img.slot=$4 FOR SHARE OF a`,
      [attemptId, participant.identityId, position, slot],
    );
    if (!await participantSessionStillActive(client, hash, participant)) { await client.query("ROLLBACK"); return null; }
    const active = await client.query("SELECT 1 FROM exam_attempts WHERE id=$1::bigint AND completed_at IS NULL AND deadline>clock_timestamp()", [attemptId]);
    await client.query("COMMIT");
    return active.rowCount ? image.rows[0] ?? null : null;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

type SubmissionPolicy = { windowMinutes: number; expired: boolean; allowed: boolean };

/** Kunci pengaturan sampai commit; keputusan menggunakan satu waktu PostgreSQL. */
async function lockedSubmissionPolicy(client: PoolClient, attemptId: string): Promise<SubmissionPolicy> {
  const result = await client.query<SubmissionPolicy>(
    `WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS now)
     SELECT s.submission_window_minutes AS "windowMinutes",a.deadline<=moment.now AS expired,
       a.deadline<=moment.now+s.submission_window_minutes*interval '1 minute' AS allowed
     FROM exam_attempts a CROSS JOIN exam_work_settings s CROSS JOIN moment
     WHERE a.id=$1::bigint AND s.id=1 FOR SHARE OF s`, [attemptId],
  );
  if (result.rowCount !== 1) throw new Error("Pengaturan pengerjaan tidak tersedia.");
  return result.rows[0];
}

/** Pemeriksaan dialog tidak menggantikan pemeriksaan ulang ketika benar-benar dikumpulkan. */
export async function checkExamSubmission(attemptId: string): Promise<SubmissionCheck> {
  const hash = await participantSessionHash(); if (!hash) return { ok: false, error: LOGIN, login: true };
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const { participant, attempt } = await authenticatedAttempt(client, hash, attemptId);
    if (attempt.completedAt) {
      if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
      await client.query("COMMIT"); return { ok: false, error: "Tes sudah selesai.", closed: true };
    }
    const policy = await lockedSubmissionPolicy(client, attempt.id);
    if (policy.expired) {
      await completeLockedAttempt(client, attempt, "time_expired");
      if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
      await client.query("COMMIT"); return { ok: false, error: "Waktu tes telah habis.", closed: true };
    }
    const counts = (await client.query<{ total: number; answered: number; doubtful: number }>(
      `SELECT count(*)::integer AS total,count(answer)::integer AS answered,
        count(*) FILTER (WHERE is_doubtful)::integer AS doubtful
       FROM exam_attempt_questions WHERE attempt_id=$1::bigint`, [attempt.id],
    )).rows[0];
    if (counts.total !== attempt.questionCount) throw new Error("Jumlah soal tidak konsisten.");
    if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
    await client.query("COMMIT");
    return { ok: true, allowed: policy.allowed, windowMinutes: policy.windowMinutes, ...counts };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof WorkProblem) return { ok: false, error: error.message, login: error.login || undefined };
    return { ok: false, error: "Batas pengumpulan belum dapat diperiksa. Periksa koneksi dan coba lagi." };
  } finally { client.release(); }
}

export async function submitExamAttempt(attemptId: string): Promise<WorkResult> {
  const hash = await participantSessionHash(); if (!hash) return { ok: false, error: LOGIN, login: true };
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const { participant, attempt } = await authenticatedAttempt(client, hash, attemptId);
    if (!attempt.completedAt) {
      const policy = await lockedSubmissionPolicy(client, attempt.id);
      if (!policy.expired && !policy.allowed) {
        if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
        await client.query("COMMIT");
        return { ok: false, tooEarly: true, windowMinutes: policy.windowMinutes,
          error: `Pengumpulan hanya tersedia pada ${policy.windowMinutes} menit terakhir.` };
      }
      await completeLockedAttempt(client, attempt, policy.expired ? "time_expired" : "submitted");
    }
    if (!await participantSessionStillActive(client, hash, participant)) throw new WorkProblem(LOGIN, true);
    await client.query("COMMIT"); return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof WorkProblem) return { ok: false, error: error.message, login: error.login || undefined };
    return { ok: false, error: "Hasil penyelesaian belum dapat dipastikan. Muat ulang untuk memeriksa sebelum mencoba lagi." };
  } finally { client.release(); }
}
