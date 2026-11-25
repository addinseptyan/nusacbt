"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { MonitoringOption } from "./monitoring-data";

/** Combobox standar shadcn UI (Popover + Command) dengan nilai kosong "Semua tes". */
export function SearchableTest({ options, selectedId }: { options: MonitoringOption[]; selectedId: string | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(selectedId ?? "");

  const selected = options.find((t) => t.id === value) ?? null;
  const label = (t: MonitoringOption) => `${t.name} · ${t.period}${t.year ? ` · ${t.year}` : ""}`;
  const displayLabel = selected
    ? label(selected)
    : value
      ? `Tes tidak ditemukan [${value}]`
      : "Semua tes";

  return (
    <div className="min-w-0">
      <label htmlFor="monitor-test" className="mb-1 block text-xs font-semibold">
        Nama tes
      </label>
      <input type="hidden" name="tes" value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="monitor-test"
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Nama tes"
            className="h-10 w-full justify-between rounded-lg border-input bg-background px-3 text-sm font-normal hover:bg-background"
          >
            <span className={`truncate ${!selected && !value ? "text-muted-foreground" : "text-foreground"}`}>
              {displayLabel}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted-foreground opacity-70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-[260px] p-0">
          <Command>
            <CommandInput placeholder="Cari nama tes atau periode..." />
            <CommandList>
              <CommandEmpty>Tes tidak ditemukan.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__all__ Semua tes"
                  data-checked={value === ""}
                  onSelect={() => {
                    setValue("");
                    setOpen(false);
                  }}
                >
                  <span className="truncate font-medium">Semua tes</span>
                </CommandItem>
                {options.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${t.name} ${t.period} ${t.year ?? ""} ${t.id}`}
                    data-checked={value === t.id}
                    onSelect={() => {
                      setValue(t.id);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {t.period}
                        {t.year ? ` · ${t.year}` : ""}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
