"use server";

import { redirect } from "next/navigation";

import { validDataId } from "@/lib/class-validation.mjs";
import { startExamAttempt } from "@/lib/exam-attempt-start";

export type StartFormState = { error: string; login?: boolean };

export async function beginExamAction(_previous: StartFormState, form: FormData): Promise<StartFormState> {
  if (form.getAll("runId").length !== 1 || form.getAll("token").length !== 1) return { error: "Data mulai tes tidak valid. Muat ulang halaman." };
  const runId = validDataId(form.get("runId"));
  if (!runId) return { error: "Jadwal tidak valid. Muat ulang halaman." };
  const result = await startExamAttempt(runId, form.get("token"));
  if (!result.ok) return { error: result.error, login: result.login };
  redirect(`/peserta/pengerjaan/${result.attemptId}`);
}
