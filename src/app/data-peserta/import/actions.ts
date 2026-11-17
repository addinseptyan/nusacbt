"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin-auth";
import { applyImport, importErrorMessage, previewImport } from "@/lib/student-import-service";
import type { ImportResult, PreviewResult } from "@/lib/student-import-types";

export async function previewStudents(formData: FormData): Promise<PreviewResult> {
  const admin = await requireAdmin();
  try {
    return { ok: true, preview: await previewImport(formData, admin.id) };
  } catch (error) {
    return { ok: false, error: importErrorMessage(error, false) };
  }
}

export async function saveImportedStudents(formData: FormData): Promise<ImportResult> {
  const admin = await requireAdmin();
  try {
    const counts = await applyImport(formData, admin.id);
    revalidatePath("/data-peserta/siswa");
    revalidatePath("/data-peserta/import");
    return { ok: true, counts };
  } catch (error) {
    return { ok: false, error: importErrorMessage(error, true) };
  }
}
