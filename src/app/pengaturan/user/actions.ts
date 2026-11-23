"use server";

import { revalidatePath } from "next/cache";

import {
  createAdminUser,
  resetAdminUserPassword,
  toggleAdminUserActive,
  unlockAdminUser,
  updateAdminUser,
  type AdminActionResult,
} from "@/lib/admin-users-service";

function revalidateUserPages() {
  revalidatePath("/pengaturan/user");
  revalidatePath("/pengaturan/hak-akses");
}

export async function createAdminUserAction(payload: {
  username: string;
  fullName: string;
  password: string;
  passwordConfirmation: string;
  isSuperuser: boolean;
  isActive: boolean;
  roleId: string | null;
}): Promise<AdminActionResult> {
  const res = await createAdminUser(payload);
  if (res.ok) revalidateUserPages();
  return res;
}

export async function updateAdminUserAction(
  userId: string,
  payload: {
    fullName: string;
    isSuperuser: boolean;
    isActive: boolean;
    roleId: string | null;
  },
): Promise<AdminActionResult> {
  const res = await updateAdminUser(userId, payload);
  if (res.ok) {
    revalidateUserPages();
    revalidatePath("/", "layout");
  }
  return res;
}

export async function resetAdminUserPasswordAction(
  userId: string,
  payload: { password: string; passwordConfirmation: string },
): Promise<AdminActionResult> {
  const res = await resetAdminUserPassword(userId, payload);
  if (res.ok) revalidateUserPages();
  return res;
}

export async function toggleAdminUserActiveAction(
  userId: string,
  active: boolean,
): Promise<AdminActionResult> {
  const res = await toggleAdminUserActive(userId, active);
  if (res.ok) {
    revalidateUserPages();
    revalidatePath("/", "layout");
  }
  return res;
}

export async function unlockAdminUserAction(userId: string): Promise<AdminActionResult> {
  const res = await unlockAdminUser(userId);
  if (res.ok) revalidateUserPages();
  return res;
}
