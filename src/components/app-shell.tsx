"use client";

import { usePathname } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { BrandingProvider } from "@/components/branding-context";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { PublicAppSettings } from "@/lib/app-settings-types";

export function AppShell({
  branding,
  children,
}: Readonly<{ branding: PublicAppSettings; children: React.ReactNode }>) {
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

  return <BrandingProvider value={branding}>{content}</BrandingProvider>;
}
