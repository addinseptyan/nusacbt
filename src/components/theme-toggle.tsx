"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { setTheme } = useTheme();

  function changeTheme(theme: string, message: string) {
    setTheme(theme);
    toast.success(message);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-lg" className="relative size-10 rounded-xl bg-card" aria-label="Ganti tema">
          <Sun className="size-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground">Tampilan</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 rounded-lg px-2 py-2" onClick={() => changeTheme("light", "Tema terang diaktifkan")}>
          <Sun /> Terang
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 rounded-lg px-2 py-2" onClick={() => changeTheme("dark", "Tema gelap diaktifkan")}>
          <Moon /> Gelap
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 rounded-lg px-2 py-2" onClick={() => changeTheme("system", "Tema mengikuti sistem")}>
          <Laptop /> Ikuti sistem
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
