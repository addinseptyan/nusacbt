"use client";

import { createContext, useContext, useMemo } from "react";

import type { AdminSessionUser } from "@/lib/admin-auth";

const AdminUserContext = createContext<AdminSessionUser | null>(null);

export function AdminUserProvider({
  value,
  children,
}: Readonly<{ value: AdminSessionUser | null; children: React.ReactNode }>) {
  const key = value
    ? `${value.id}|${value.username}|${value.fullName}|${value.isSuperuser}|${value.roleId ?? ""}|${value.roleName ?? ""}|${value.permissions.join(",")}`
    : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => value, [key]);
  return <AdminUserContext.Provider value={stable}>{children}</AdminUserContext.Provider>;
}

export function useCurrentAdminUser(): AdminSessionUser | null {
  return useContext(AdminUserContext);
}
