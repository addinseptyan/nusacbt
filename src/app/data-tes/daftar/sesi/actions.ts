"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { saveSessionPlanValue } from "@/lib/exam-session-service";
import type { ScheduleActionResult } from "@/lib/exam-session-types";

export async function saveSessionPlan(form: FormData): Promise<ScheduleActionResult> {
  await requireAdmin();
  const values = form.getAll("plan");
  if (values.length !== 1 || typeof values[0] !== "string" || values[0].length > 1_000_000) {
    return { ok: false, error: "Data kelompok sesi tidak valid. Muat ulang halaman.", reload: true };
  }
  let raw: unknown;
  try { raw = JSON.parse(values[0]); } catch { return { ok: false, error: "Data kelompok sesi tidak valid. Muat ulang halaman.", reload: true }; }
  const result = await saveSessionPlanValue(raw);
  if (result.ok) { revalidatePath("/data-tes/daftar"); revalidatePath("/data-tes/daftar/sesi"); }
  return result;
}
