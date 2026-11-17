"use client";

import { ChevronDown, Code2, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
import { navigation } from "@/lib/navigation";

export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function closeMobile() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
      <SidebarHeader className="px-6 pt-6 pb-5">
        <Link href="/" onClick={closeMobile} className="flex items-center gap-3" aria-label="NusaCBT, ke dashboard">
          <span className="flex size-11 items-center justify-center rounded-[14px] bg-primary text-xl font-extrabold tracking-[-0.12em] text-primary-foreground shadow-[0_7px_18px_rgba(20,138,104,0.19)]">
            N<span className="sr-only">usaCBT</span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[19px] leading-none font-bold tracking-[-0.045em] text-foreground">Nusa<span className="text-primary">CBT</span></span>
            <span className="text-[10px] leading-none font-semibold tracking-[0.13em] text-muted-foreground uppercase">Platform ujian sekolah</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 pt-2">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="px-3 text-[10px] font-bold tracking-[0.13em] text-muted-foreground/80">MENU UTAMA</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map((section) => {
                const Icon = section.icon;
                const active = section.href === pathname || Boolean(section.pages?.some((page) => page.href === pathname));
                const buttonClass = "h-11 gap-3 rounded-xl px-3 text-[13px] font-medium text-sidebar-foreground transition-colors data-active:bg-sidebar-accent data-active:font-semibold data-active:text-sidebar-accent-foreground";

                if (!section.pages) {
                  return (
                    <SidebarMenuItem key={section.title}>
                      <SidebarMenuButton asChild isActive={active} className={buttonClass}>
                        <Link href={section.href ?? "/"} onClick={closeMobile} aria-current={active ? "page" : undefined}>
                          <Icon className="size-[18px]!" />
                          <span>{section.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                const isOpen = expanded[section.title] ?? active;
                return (
                  <Collapsible
                    key={section.title}
                    asChild
                    open={isOpen}
                    onOpenChange={(open) => setExpanded((current) => ({ ...current, [section.title]: open }))}
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
                              <SidebarMenuSubButton asChild isActive={pathname === page.href} className="h-9 rounded-lg text-[12px]">
                                <Link href={page.href} onClick={closeMobile} aria-current={pathname === page.href ? "page" : undefined}>
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
        <div className="rounded-2xl border border-[#dcefe5] bg-[#f2faf5] p-3.5 dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-800 dark:text-emerald-300">
            <span className="flex size-7 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm dark:bg-emerald-900/60 dark:text-emerald-300"><Sparkles className="size-3.5" /></span>
            Tahap fondasi
          </div>
          <p className="mt-2 text-[11px] leading-[1.6] text-emerald-800/70 dark:text-emerald-200/70">Menu dan template tersedia sebagai pratinjau awal.</p>
        </div>
        <div className="flex items-center gap-1.5 px-1 pt-2 text-[10px] font-medium text-muted-foreground/75"><Code2 className="size-3" /> NusaCBT · v0.1.0</div>
      </SidebarFooter>
    </Sidebar>
  );
}
