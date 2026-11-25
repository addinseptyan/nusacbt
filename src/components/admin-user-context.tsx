"use client";

import { createContext, useContext, useMemo } from "react";

import type { AdminSessionUser } from "@/lib/admin-auth";
import type { AppModeId } from "@/lib/app-settings-validation.mjs";

const AdminUserContext = createContext<AdminSessionUser | null>(null);
const AppModeContext = createContext<AppModeId>("production");

export function AdminUserProvider({
  value,
  appMode = "production",
  children,
}: Readonly<{
  value: AdminSessionUser | null;
  appMode?: AppModeId;
  children: React.ReactNode;
}>) {
  const key = value
    ? `${value.id}|${value.username}|${value.fullName}|${value.isSuperuser}|${value.roleId ?? ""}|${value.roleName ?? ""}|${value.permissions.join(",")}`
    : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => value, [key]);
  return (
    <AdminUserContext.Provider value={stable}>
      <AppModeContext.Provider value={appMode}>{children}</AppModeContext.Provider>
    </AdminUserContext.Provider>
  );
}

export function useCurrentAdminUser(): AdminSessionUser | null {
  return useContext(AdminUserContext);
}

export function useAdminAppMode(): AppModeId {
  return useContext(AppModeContext);
}

export function useCanDevCascadeDelete(): boolean {
  const user = useContext(AdminUserContext);
  const mode = useContext(AppModeContext);
  return Boolean(user?.isSuperuser && mode === "dev");
}
