"use server";

import { validDataId } from "@/lib/class-validation.mjs";
import { examAnswer, examAnswerRevision, examQuestionPosition } from "@/lib/exam-attempt-validation.mjs";
import { saveExamAnswer, submitExamAttempt, type WorkResult } from "@/lib/exam-attempt-work";

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

export async function submitExamAction(form: FormData): Promise<WorkResult> {
  if (!(form instanceof FormData) || form.getAll("attemptId").length !== 1) return { ok: false, error: "Identitas pengerjaan tidak valid." };
  const attemptId = validDataId(form.get("attemptId"));
  if (!attemptId) return { ok: false, error: "Identitas pengerjaan tidak valid." };
  return submitExamAttempt(attemptId);
}
