"use client";

import { ChevronRight, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { logoutAction } from "@/app/login/actions";
import { useBranding } from "@/components/branding-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { findNavigationPage } from "@/lib/navigation";

export function AppHeader() {
  const pathname = usePathname();
  const branding = useBranding();
  const page = findNavigationPage(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-[72px] shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-md sm:px-7 lg:px-9">
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
        <span className="hidden max-w-44 items-center gap-2 truncate rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-foreground sm:inline-flex">
          <span className="size-1.5 shrink-0 rounded-full bg-primary" /> <span className="truncate">{branding.schoolName || "Server lokal"}</span>
        </span>
        <ThemeToggle />
        <Separator orientation="vertical" className="hidden h-8! sm:block" />
        <div className="hidden items-center gap-2.5 sm:flex">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#e9eefb] text-xs font-bold text-[#6677bd] dark:bg-indigo-950 dark:text-indigo-300">A</span>
          <span className="flex flex-col gap-0.5 leading-none"><span className="text-[12px] font-semibold text-foreground">Admin</span><span className="text-[10px] text-muted-foreground">{branding.appName}</span></span>
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
