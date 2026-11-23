"use server";

import { revalidatePath } from "next/cache";
import { PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { saveExamRunValue, changeExamRunValue } from "@/lib/exam-schedule-service";
import type { ScheduleActionResult } from "@/lib/exam-session-types";

async function parse(form: FormData): Promise<unknown | null> {
  const values=form.getAll("data");
  if (values.length!==1 || typeof values[0]!=="string" || values[0].length>1_000_000) return null;
  try { return JSON.parse(values[0]); } catch { return null; }
}
function refresh() { revalidatePath("/data-tes/daftar"); revalidatePath("/peserta"); revalidatePath("/data-tes/token"); revalidatePath("/data-tes/token/riwayat"); }

export async function saveExamRun(form: FormData): Promise<ScheduleActionResult> {
  const { allowed } = await requireAdminAccess("exams.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const raw=await parse(form);
  if (!raw) return {ok:false,error:"Data pelaksanaan tidak valid. Muat ulang halaman.",reload:true};
  const result=await saveExamRunValue(raw); if (result.ok) refresh(); return result;
}
export async function changeExamRun(form: FormData): Promise<ScheduleActionResult> {
  const { allowed } = await requireAdminAccess("exams.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  const raw=await parse(form);
  if (!raw) return {ok:false,error:"Permintaan tidak valid. Muat ulang halaman.",reload:true};
  const result=await changeExamRunValue(raw); if (result.ok) refresh(); return result;
}
