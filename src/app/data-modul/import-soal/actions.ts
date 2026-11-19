"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { applyQuestionImport, previewQuestionImport, questionImportError } from "@/lib/question-import-service";
import type { QuestionImportPreviewResult, QuestionImportSaveResult } from "@/lib/question-import-types";

export async function previewQuestionWord(form: FormData): Promise<QuestionImportPreviewResult> {
  const admin = await requireAdmin();
  try { return { ok: true, preview: await previewQuestionImport(form, admin.id) }; }
  catch (error) { return { ok: false, error: questionImportError(error, false) }; }
}

export async function saveQuestionWord(form: FormData): Promise<QuestionImportSaveResult> {
  const admin = await requireAdmin();
  try {
    const result = await applyQuestionImport(form, admin.id);
    revalidatePath("/data-modul/soal");
    revalidatePath("/data-modul/import-soal");
    return { ok: true, ...result };
  } catch (error) { return { ok: false, error: questionImportError(error, true) }; }
}
