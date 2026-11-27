"use client";

import { ChevronRight, LogOut, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { logoutAction } from "@/app/login/actions";
import { useAdminAppMode, useCurrentAdminUser } from "@/components/admin-user-context";
import { useBranding } from "@/components/branding-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { findNavigationPage } from "@/lib/navigation";

export function AppHeader() {
  const pathname = usePathname();
  const branding = useBranding();
  const currentUser = useCurrentAdminUser();
  const appMode = useAdminAppMode();
  const page = findNavigationPage(pathname);
  const displayName = currentUser?.fullName || currentUser?.username || "Admin";
  const roleLabel = currentUser
    ? currentUser.isSuperuser
      ? "Superadmin"
      : currentUser.roleName || "Operator"
    : branding.appName;
  const initial = displayName.slice(0, 1).toUpperCase() || "A";

  return (
    <header className="sticky top-0 z-40 flex h-[72px] shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-md sm:px-7 lg:px-9">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger aria-label="Buka atau tutup sidebar" className="size-9 rounded-lg text-muted-foreground hover:text-foreground" />
        <Separator orientation="vertical" className="h-5!" />
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[12px] sm:text-[13px]">
          <Link href="/" prefetch={false} className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline">Panel admin</Link>
          <ChevronRight className="hidden size-3.5 text-muted-foreground/60 sm:block" />
          {page && <><span className="hidden truncate text-muted-foreground lg:inline">{page.section}</span><ChevronRight className="hidden size-3.5 text-muted-foreground/60 lg:block" /></>}
          {page?.parent && <><Link href={page.parent.href} prefetch={false} className="hidden truncate text-muted-foreground transition-colors hover:text-foreground md:inline">{page.parent.title}</Link><ChevronRight className="hidden size-3.5 text-muted-foreground/60 md:block" /></>}
          <span aria-current="page" className="truncate font-semibold text-foreground">{page?.title ?? "Dashboard"}</span>
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-2.5 sm:gap-4">
        {appMode === "dev" && (
          <Link
            href="/pengaturan/aplikasi#mode-aplikasi"
            prefetch={false}
            data-testid="dev-mode-header-pill"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900 transition-colors hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          >
            <Wrench className="size-3" />
            <span>Mode Dev</span>
          </Link>
        )}
        <span className="hidden max-w-44 items-center gap-2 truncate rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-foreground sm:inline-flex">
          <span className="size-1.5 shrink-0 rounded-full bg-primary" /> <span className="truncate">{branding.schoolName || "Server lokal"}</span>
        </span>
        <ThemeToggle />
        <Separator orientation="vertical" className="hidden h-8! sm:block" />
        <div className="hidden items-center gap-2.5 sm:flex" data-testid="header-user-info">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#e9eefb] text-xs font-bold text-[#6677bd] dark:bg-indigo-950 dark:text-indigo-300">{initial}</span>
          <span className="flex min-w-0 max-w-48 flex-col gap-0.5 leading-none">
            <span className="truncate text-[12px] font-semibold text-foreground">{displayName}</span>
            <span className="truncate text-[10px] text-muted-foreground">{roleLabel} · {branding.appName}</span>
          </span>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm" aria-label="Keluar" className="rounded-lg px-2 text-muted-foreground">
            <LogOut className="size-4" /><span className="hidden sm:inline">Keluar</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
