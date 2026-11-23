"use server";

import { revalidatePath } from "next/cache";

import {
  createAdminRole,
  deleteAdminRole,
  updateAdminRole,
  type AdminActionResult,
} from "@/lib/admin-users-service";
import type { AdminPermission } from "@/lib/admin-permissions.mjs";

function revalidateRolePages() {
  revalidatePath("/pengaturan/hak-akses");
  revalidatePath("/pengaturan/user");
}

export async function createAdminRoleAction(payload: {
  name: string;
  description: string;
  permissions: AdminPermission[];
}): Promise<AdminActionResult> {
  const res = await createAdminRole(payload);
  if (res.ok) revalidateRolePages();
  return res;
}

export async function updateAdminRoleAction(
  roleId: string,
  payload: {
    name: string;
    description: string;
    permissions: AdminPermission[];
  },
): Promise<AdminActionResult> {
  const res = await updateAdminRole(roleId, payload);
  if (res.ok) {
    revalidateRolePages();
    revalidatePath("/", "layout");
  }
  return res;
}

export async function deleteAdminRoleAction(roleId: string): Promise<AdminActionResult> {
  const res = await deleteAdminRole(roleId);
  if (res.ok) revalidateRolePages();
  return res;
}
