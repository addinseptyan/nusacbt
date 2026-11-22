"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (ready && theme && theme !== "light" && theme !== "dark") setTheme("light");
  }, [ready, theme, setTheme]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    document.documentElement.classList.remove("theme-changing");
  }, []);
  const dark = ready && theme === "dark";
  function toggle() {
    if (timer.current) clearTimeout(timer.current);
    document.documentElement.classList.add("theme-changing");
    setTheme(dark ? "light" : "dark");
    timer.current = setTimeout(() => document.documentElement.classList.remove("theme-changing"), 340);
  }
  const icon = "theme-toggle-icon size-[18px] transition-[transform,opacity] duration-300 ease-in-out motion-reduce:transition-none";
  return <Button type="button" variant="outline" size="icon-lg" className="relative size-10 rounded-xl bg-card" aria-label="Ganti tema" aria-pressed={dark} title={dark ? "Beralih ke tema terang" : "Beralih ke tema gelap"} disabled={!ready} onClick={toggle}>
    <Sun aria-hidden="true" className={`${icon} rotate-0 scale-100 opacity-100 dark:-rotate-90 dark:scale-0 dark:opacity-0`} />
    <Moon aria-hidden="true" className={`${icon} absolute rotate-90 scale-0 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100`} />
  </Button>;
}
