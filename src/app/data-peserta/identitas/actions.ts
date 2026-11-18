"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin-auth";
import { generateParticipantIdentities, identityErrorMessage, saveParticipantIdentity } from "@/lib/participant-identity-service";
import type { IdentityActionResult } from "@/lib/participant-identity-types";

export async function saveIdentity(formData: FormData): Promise<IdentityActionResult> {
  await requireAdmin();
  try {
    const message = await saveParticipantIdentity(formData);
    revalidatePath("/data-peserta/identitas");
    return { ok: true, message };
  } catch (error) {
    return { ok: false, error: identityErrorMessage(error) };
  }
}

export async function generateIdentities(formData: FormData): Promise<IdentityActionResult> {
  await requireAdmin();
  try {
    const message = await generateParticipantIdentities(formData);
    revalidatePath("/data-peserta/identitas");
    return { ok: true, message };
  } catch (error) {
    return { ok: false, error: identityErrorMessage(error) };
  }
}
