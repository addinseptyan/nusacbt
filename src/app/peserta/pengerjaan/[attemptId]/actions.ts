"use server";

import { validDataId } from "@/lib/class-validation.mjs";
import { examAnswer, examAnswerRevision, examQuestionPosition } from "@/lib/exam-attempt-validation.mjs";
import { checkExamSubmission, saveExamAnswer, saveExamDoubt, submitExamAttempt, type SubmissionCheck, type WorkResult } from "@/lib/exam-attempt-work";
import { examDoubtfulValue } from "@/lib/exam-work-settings-validation.mjs";

export async function saveExamAnswerAction(form: FormData): Promise<WorkResult> {
  if (!(form instanceof FormData) || ["attemptId", "position", "answer", "revision"].some((field) => form.getAll(field).length !== 1)) {
    return { ok: false, error: "Data jawaban tidak valid. Muat ulang soal.", reload: true };
  }
  const attemptId = validDataId(form.get("attemptId"));
  const position = examQuestionPosition(form.get("position"));
  const revision = examAnswerRevision(form.get("revision"));
  const raw = form.get("answer"); const answer = raw === "" ? null : examAnswer(raw);
  if (!attemptId || !position || revision === null || (raw !== "" && !answer)) {
    return { ok: false, error: "Data jawaban tidak valid. Muat ulang soal.", reload: true };
  }
  return saveExamAnswer(attemptId, position, answer, revision);
}

export async function saveExamDoubtAction(form: FormData): Promise<WorkResult> {
  if (!(form instanceof FormData) || ["attemptId", "position", "doubtful", "revision"].some((field) => form.getAll(field).length !== 1)) {
    return { ok: false, error: "Data tanda ragu tidak valid. Muat ulang soal.", reload: true };
  }
  const attemptId = validDataId(form.get("attemptId"));
  const position = examQuestionPosition(form.get("position"));
  const revision = examAnswerRevision(form.get("revision"));
  const doubtful = examDoubtfulValue(form.get("doubtful"));
  if (!attemptId || !position || revision === null || doubtful === null) {
    return { ok: false, error: "Data tanda ragu tidak valid. Muat ulang soal.", reload: true };
  }
  return saveExamDoubt(attemptId, position, doubtful, revision);
}

export async function checkExamSubmissionAction(form: FormData): Promise<SubmissionCheck> {
  if (!(form instanceof FormData) || form.getAll("attemptId").length !== 1) return { ok: false, error: "Identitas pengerjaan tidak valid." };
  const attemptId = validDataId(form.get("attemptId"));
  if (!attemptId) return { ok: false, error: "Identitas pengerjaan tidak valid." };
  return checkExamSubmission(attemptId);
}

export async function submitExamAction(form: FormData): Promise<WorkResult> {
  if (!(form instanceof FormData) || form.getAll("attemptId").length !== 1) return { ok: false, error: "Identitas pengerjaan tidak valid." };
  const attemptId = validDataId(form.get("attemptId"));
  if (!attemptId) return { ok: false, error: "Identitas pengerjaan tidak valid." };
  return submitExamAttempt(attemptId);
}
