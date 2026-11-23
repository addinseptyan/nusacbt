import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getPublicAppSettingsSafe } from "@/lib/app-settings-service";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicAppSettingsSafe();
  return {
    title: `${settings.appName} — Panel Admin`,
    description: settings.appDescription || "Aplikasi ujian berbasis jaringan lokal untuk sekolah.",
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const branding = await getPublicAppSettingsSafe();

  return (
    <html lang="id" data-palette={branding.colorPalette} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <TooltipProvider>
            <AppShell branding={branding}>{children}</AppShell>
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
