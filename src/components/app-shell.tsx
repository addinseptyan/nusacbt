"use client";

import { usePathname } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  // Ruang peserta memiliki tata letak sendiri dan tidak menampilkan navigasi admin.
  if (pathname === "/login" || pathname === "/peserta" || pathname.startsWith("/peserta/")) return children;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
