"use server";

import { revalidatePath } from "next/cache";
import { PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { applyQuestionImport, previewQuestionImport, questionImportError } from "@/lib/question-import-service";
import type { QuestionImportPreviewResult, QuestionImportSaveResult } from "@/lib/question-import-types";

export async function previewQuestionWord(form: FormData): Promise<QuestionImportPreviewResult> {
  const { admin, allowed } = await requireAdminAccess("questions.import");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  try { return { ok: true, preview: await previewQuestionImport(form, admin.id) }; }
  catch (error) { return { ok: false, error: questionImportError(error, false) }; }
}

export async function saveQuestionWord(form: FormData): Promise<QuestionImportSaveResult> {
  const { admin, allowed } = await requireAdminAccess("questions.import");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  try {
    const result = await applyQuestionImport(form, admin.id);
    revalidatePath("/data-modul/soal");
    revalidatePath("/data-modul/import-soal");
    return { ok: true, ...result };
  } catch (error) { return { ok: false, error: questionImportError(error, true) }; }
}
