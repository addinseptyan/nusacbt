"use client";

import { ChevronDown, Code2, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useCurrentAdminUser } from "@/components/admin-user-context";
import { useBranding } from "@/components/branding-context";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { adminHasAnyPermission, adminHasPermission } from "@/lib/admin-permissions.mjs";
import { navigation, navigationPageContains } from "@/lib/navigation";

export function AppSidebar() {
  const pathname = usePathname();
  const branding = useBranding();
  const currentUser = useCurrentAdminUser();
  const { isMobile, setOpenMobile } = useSidebar();
  const [openState, setOpenState] = useState<{ forPath: string; section: string | null } | null>(null);
  const containsPage = (href: string) => navigationPageContains(href, pathname);
  const initialLetter = branding.appName.slice(0, 1).toUpperCase() || "N";

  const visibleSections = navigation
    .map((section) => {
      if (!section.pages) return section;
      if (!currentUser) return null;
      const pages = section.pages.filter((page) =>
        !page.permissions || adminHasAnyPermission(currentUser, page.permissions),
      );
      if (pages.length === 0) return null;
      return { ...section, pages };
    })
    .filter((section): section is NonNullable<typeof section> => section !== null);

  const activeSectionTitle =
    visibleSections.find((section) => Boolean(section.pages?.some((page) => containsPage(page.href))))?.title ?? null;
  const currentOpenSection = openState && openState.forPath === pathname ? openState.section : activeSectionTitle;

  const canManageAppSettings = adminHasPermission(currentUser, "app_settings.manage");

  function closeMobile() {
    if (isMobile) setOpenMobile(false);
  }

  const footerCardContent = (
    <>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-accent-foreground">
        <span className="flex size-7 items-center justify-center rounded-lg bg-card text-primary shadow-xs">
          <Settings2 className="size-3.5" />
        </span>
        <span className="truncate">{branding.schoolName || "Identitas sekolah"}</span>
      </div>
      <p className="mt-2 truncate text-[11px] leading-[1.5] text-muted-foreground">
        {branding.appDescription || "Atur nama sekolah, logo, kop & warna."}
      </p>
    </>
  );

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
      <SidebarHeader className="px-6 pt-6 pb-5">
        <Link href="/" prefetch={false} onClick={closeMobile} className="flex items-center gap-3" aria-label={`${branding.appName}, ke dashboard`}>
          {branding.hasLogo ? (
            <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-border bg-white p-1 shadow-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/branding/logo?v=${branding.revision}`} alt={`Logo ${branding.schoolName || branding.appName}`} className="size-full object-contain" />
            </span>
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-primary text-xl font-extrabold tracking-[-0.06em] text-primary-foreground shadow-[0_7px_18px_rgba(20,138,104,0.19)]">
              {initialLetter}
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[18px] leading-none font-bold tracking-[-0.035em] text-foreground">{branding.appName}</span>
            <span className="truncate text-[10px] leading-tight font-semibold tracking-[0.08em] text-muted-foreground uppercase">{branding.schoolName || branding.appDescription || "Platform ujian sekolah"}</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 pt-2">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="px-3 text-[10px] font-bold tracking-[0.13em] text-muted-foreground/80">MENU UTAMA</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {visibleSections.map((section) => {
                const Icon = section.icon;
                const active = section.href === pathname || Boolean(section.pages?.some((page) => containsPage(page.href)));
                const buttonClass = "h-11 gap-3 rounded-xl px-3 text-[13px] font-medium text-sidebar-foreground transition-colors data-active:bg-sidebar-accent data-active:font-semibold data-active:text-sidebar-accent-foreground";

                if (!section.pages) {
                  return (
                    <SidebarMenuItem key={section.title}>
                      <SidebarMenuButton asChild isActive={active} className={buttonClass}>
                        <Link href={section.href ?? "/"} prefetch={false} onClick={closeMobile} aria-current={active ? "page" : undefined}>
                          <Icon className="size-[18px]!" />
                          <span>{section.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                const isOpen = currentOpenSection === section.title;
                return (
                  <Collapsible
                    key={section.title}
                    asChild
                    open={isOpen}
                    onOpenChange={(open) =>
                      setOpenState({ forPath: pathname, section: open ? section.title : null })
                    }
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={active} className={buttonClass}>
                          <Icon className="size-[18px]!" />
                          <span>{section.title}</span>
                          <ChevronDown className={`ml-auto size-4! text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub className="my-1 gap-0.5 border-sidebar-border py-0.5">
                          {section.pages.map((page) => (
                            <SidebarMenuSubItem key={page.href}>
                              <SidebarMenuSubButton asChild isActive={containsPage(page.href)} className="h-9 rounded-lg text-[12px]">
                                <Link href={page.href} prefetch={false} onClick={closeMobile} aria-current={pathname === page.href ? "page" : containsPage(page.href) ? "location" : undefined}>
                                  <span>{page.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 pb-5 pt-4">
        {canManageAppSettings ? (
          <Link href="/pengaturan/aplikasi" prefetch={false} onClick={closeMobile} className="block rounded-2xl border border-border bg-accent/55 p-3.5 transition-colors hover:bg-accent">
            {footerCardContent}
          </Link>
        ) : (
          <div className="block rounded-2xl border border-border bg-accent/55 p-3.5">
            {footerCardContent}
          </div>
        )}
        <div className="flex items-center gap-1.5 px-1 pt-2 text-[10px] font-medium text-muted-foreground/75"><Code2 className="size-3" /> {branding.appName} · v0.1.0</div>
      </SidebarFooter>
    </Sidebar>
  );
}
