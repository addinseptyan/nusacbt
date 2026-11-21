"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  // Preferensi lama "system" dipindahkan menjadi terang; tidak lagi mengikuti OS.
  useEffect(() => {
    if (ready && theme && theme !== "light" && theme !== "dark") setTheme("light");
  }, [ready, theme, setTheme]);
  const dark = ready && theme === "dark";
  return <Button type="button" variant="outline" size="icon-lg" className="relative size-10 rounded-xl bg-card" aria-label="Ganti tema" aria-pressed={dark} title={dark ? "Beralih ke tema terang" : "Beralih ke tema gelap"} disabled={!ready} onClick={() => setTheme(dark ? "light" : "dark")}>
    <Sun aria-hidden="true" className="size-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
    <Moon aria-hidden="true" className="absolute size-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
  </Button>;
}
