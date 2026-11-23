"use server";

import { revalidatePath } from "next/cache";

import { PERMISSION_DENIED_MESSAGE, requireAdminAccess } from "@/lib/admin-auth";
import { unlockErrorMessage, unlockParticipantLogin } from "@/lib/participant-account-service";
import type { UnlockActionResult } from "@/lib/participant-account-types";

export async function unlockLogin(form: FormData): Promise<UnlockActionResult> {
  const { allowed } = await requireAdminAccess("participant_accounts.manage");
  if (!allowed) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  try {
    const message = await unlockParticipantLogin(form);
    revalidatePath("/data-peserta/akun");
    revalidatePath("/data-peserta/sandi");
    return { ok: true, message };
  } catch (error) {
    return { ok: false, error: unlockErrorMessage(error) };
  }
}
