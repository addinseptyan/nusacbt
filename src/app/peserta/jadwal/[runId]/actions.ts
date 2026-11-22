"use server";

import { redirect } from "next/navigation";

import { validDataId } from "@/lib/class-validation.mjs";
import { examAnswerRevision } from "@/lib/exam-attempt-validation.mjs";
import { startExamAttempt } from "@/lib/exam-attempt-start";

export type StartFormState = { error: string; login?: boolean };

export async function beginExamAction(_previous: StartFormState, form: FormData): Promise<StartFormState> {
  if (!(form instanceof FormData) || form.getAll("runId").length !== 1 || form.getAll("token").length !== 1 || form.getAll("expectedFinalRevision").length !== 1 || form.getAll("retakeId").length > 1) return { error: "Data mulai tes tidak valid. Muat ulang halaman." };
  const runId = validDataId(form.get("runId"));
  const rawRetake = form.get("retakeId");
  const retakeId = rawRetake === null ? null : validDataId(rawRetake);
  const expectedFinalRevision = examAnswerRevision(form.get("expectedFinalRevision"));
  if (!runId || expectedFinalRevision === null || (rawRetake !== null && !retakeId)) return { error: "Jadwal atau izin tidak valid. Muat ulang halaman." };
  const result = await startExamAttempt(runId, form.get("token"), retakeId, expectedFinalRevision);
  if (!result.ok) return { error: result.error, login: result.login };
  redirect(`/peserta/pengerjaan/${result.attemptId}`);
}
