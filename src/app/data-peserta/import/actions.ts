"use server";

import { revalidatePath } from "next/cache";

import { PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { applyImport, importErrorMessage, previewImport } from "@/lib/student-import-service";
import type { ImportResult, PreviewResult } from "@/lib/student-import-types";

export async function previewStudents(formData: FormData): Promise<PreviewResult> {
  const { admin, allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  try {
    return { ok: true, preview: await previewImport(formData, admin.id) };
  } catch (error) {
    return { ok: false, error: importErrorMessage(error, false) };
  }
}

export async function saveImportedStudents(formData: FormData): Promise<ImportResult> {
  const { admin, allowed } = await requireAdminAccess("students.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  try {
    const counts = await applyImport(formData, admin.id);
    revalidatePath("/data-peserta/siswa");
    revalidatePath("/data-peserta/import");
    return { ok: true, counts };
  } catch (error) {
    return { ok: false, error: importErrorMessage(error, true) };
  }
}
