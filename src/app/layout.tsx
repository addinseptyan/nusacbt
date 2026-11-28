import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

import { AppShell } from "@/components/app-shell";
import { PreviewSessionSync } from "@/components/preview-session-sync";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getAdminSessionSafe } from "@/lib/admin-auth";
import { getAdminAppModeSafe, getPublicAppSettingsSafe } from "@/lib/app-settings-service";
import { getPreviewAdminTokenForClient, isPreviewIframeAuthEnabled } from "@/lib/preview-session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicAppSettingsSafe();
  const logoVersion = encodeURIComponent(settings.revision);
  const icons: Metadata["icons"] = settings.hasLogo
    ? {
        icon: [
          { url: `/api/branding/logo?v=${logoVersion}` },
          { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
        ],
        shortcut: [`/api/branding/logo?v=${logoVersion}`],
        apple: [{ url: `/api/branding/logo?v=${logoVersion}` }],
      }
    : {
        icon: [
          { url: "/icon.svg", type: "image/svg+xml" },
          { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
        ],
        shortcut: ["/favicon.ico"],
        apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
      };

  return {
    title: {
      default: `${settings.appName} — Panel Admin`,
      template: `%s — ${settings.appName}`,
    },
    description: settings.appDescription || "Aplikasi ujian berbasis jaringan lokal untuk sekolah.",
    icons,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const previewAuth = isPreviewIframeAuthEnabled();
  const [branding, adminUser] = await Promise.all([
    getPublicAppSettingsSafe(),
    getAdminSessionSafe(),
  ]);
  const [appMode, previewAdminToken] = await Promise.all([
    adminUser ? getAdminAppModeSafe() : Promise.resolve("production" as const),
    previewAuth && adminUser ? getPreviewAdminTokenForClient() : Promise.resolve(null),
  ]);

  return (
    <html lang="id" data-palette={branding.colorPalette} suppressHydrationWarning>
      <body>
        {previewAuth && (
          <PreviewSessionSync
            adminAction={previewAdminToken ? { type: "set", token: previewAdminToken } : undefined}
          />
        )}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <TooltipProvider>
            <AppShell branding={branding} adminUser={adminUser} appMode={appMode}>
              {children}
            </AppShell>
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
