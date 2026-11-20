"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin-auth";
import { passwordErrorMessage, revealParticipantPassword, saveParticipantPasswords } from "@/lib/participant-password-service";
import type { PasswordActionResult, PasswordRevealResult } from "@/lib/participant-password-types";

export async function savePasswords(formData: FormData): Promise<PasswordActionResult> {
  await requireAdmin();
  try {
    const message = await saveParticipantPasswords(formData);
    revalidatePath("/data-peserta/sandi");
    revalidatePath("/data-peserta/akun");
    return { ok: true, message };
  } catch (error) {
    return { ok: false, error: passwordErrorMessage(error) };
  }
}

export async function revealPassword(formData: FormData): Promise<PasswordRevealResult> {
  await requireAdmin();
  try {
    const password = await revealParticipantPassword(formData);
    revalidatePath("/data-peserta/akun");
    return { ok: true, password };
  } catch (error) {
    return { ok: false, error: passwordErrorMessage(error) };
  }
}
