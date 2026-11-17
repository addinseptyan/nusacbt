import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "NusaCBT — Panel Admin",
  description: "Fondasi aplikasi ujian berbasis jaringan lokal untuk sekolah.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <AppHeader />
                {children}
              </SidebarInset>
            </SidebarProvider>
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
