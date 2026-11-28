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
    timer.current = setTimeout(() => document.documentElement.classList.remove("theme-changing"), 150);
  }
  const icon = "theme-toggle-icon size-[18px] motion-reduce:transition-none";
  return <Button type="button" variant="outline" size="icon-lg" className="relative size-10 rounded-xl bg-card" aria-label="Ganti tema" aria-pressed={dark} title={dark ? "Beralih ke tema terang" : "Beralih ke tema gelap"} disabled={!ready} onClick={toggle}>
    <span aria-hidden="true" className="relative flex size-[18px] items-center justify-center">
      <Sun aria-hidden="true" className={`${icon} [transform:rotate(0deg)_scale(1)] opacity-100 dark:[transform:rotate(360deg)_scale(0)] dark:opacity-0`} />
      <Moon aria-hidden="true" className={`${icon} absolute [transform:rotate(360deg)_scale(0)] opacity-0 dark:[transform:rotate(0deg)_scale(1)] dark:opacity-100`} />
    </span>
  </Button>;
}
