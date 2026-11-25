"use client";

import { usePathname } from "next/navigation";

import { AdminUserProvider } from "@/components/admin-user-context";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { BrandingProvider } from "@/components/branding-context";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { AdminSessionUser } from "@/lib/admin-auth";
import type { PublicAppSettings } from "@/lib/app-settings-types";
import type { AppModeId } from "@/lib/app-settings-validation.mjs";

export function AppShell({
  branding,
  adminUser,
  appMode = "production",
  children,
}: Readonly<{
  branding: PublicAppSettings;
  adminUser: AdminSessionUser | null;
  appMode?: AppModeId;
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const content =
    pathname === "/login" || pathname === "/peserta" || pathname.startsWith("/peserta/")
      ? children
      : (
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <AppHeader />
              {children}
            </SidebarInset>
          </SidebarProvider>
        );

  return (
    <BrandingProvider value={branding}>
      <AdminUserProvider value={adminUser} appMode={appMode}>
        {content}
      </AdminUserProvider>
    </BrandingProvider>
  );
}
