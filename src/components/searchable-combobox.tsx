"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "cn";

export type ComboboxOption = {
  value: string;
  label: string;
  tags?: string[];
  subtitle?: string;
  keywords?: string;
};

export function SearchableCombobox({
  id,
  name,
  options,
  value,
  onChange,
  placeholder = "Pilih opsi...",
  searchPlaceholder = "Ketik untuk mencari...",
  emptyOptionLabel,
  emptyResultsText = "Tidak ada pilihan yang cocok.",
  disabled = false,
  required = false,
  allowClear = false,
  ariaLabel,
  className,
}: {
  id?: string;
  name?: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyOptionLabel?: string;
  emptyResultsText?: string;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const generatedId = useId();
  const listId = `${id ?? generatedId}-listbox`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((opt) => opt.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("id-ID");
    if (!q) return options;
    return options.filter((opt) => {
      const hay = [
        opt.label,
        opt.subtitle ?? "",
        ...(opt.tags ?? []),
        opt.keywords ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("id-ID");
      return hay.includes(q);
    });
  }, [options, search]);

  const flatEntries = useMemo(() => {
    const items: Array<{ value: string; label: string; option?: ComboboxOption; isAll?: boolean }> = [];
    if (emptyOptionLabel && !search.trim()) {
      items.push({ value: "", label: emptyOptionLabel, isAll: true });
    } else if (emptyOptionLabel && emptyOptionLabel.toLocaleLowerCase("id-ID").includes(search.trim().toLocaleLowerCase("id-ID"))) {
      items.push({ value: "", label: emptyOptionLabel, isAll: true });
    }
    for (const opt of filtered) {
      items.push({ value: opt.value, label: opt.label, option: opt });
    }
    return items;
  }, [emptyOptionLabel, filtered, search]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function openDropdown() {
    if (disabled) return;
    setSearch("");
    setHighlighted(0);
    setOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function pick(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={containerRef} className={cn("relative w-full min-w-0", className)}>
      {name && <input type="hidden" name={name} value={value} />}
      <div className="relative flex items-center">
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-required={required}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openDropdown())}
          onKeyDown={(e) => {
            if (disabled) return;
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              openDropdown();
            }
          }}
          className={cn(
            "flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 py-1.5 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            allowClear && value ? "pr-14" : "pr-9",
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {selected ? (
              <>
                <span className="truncate font-medium text-foreground">{selected.label}</span>
                {selected.tags && selected.tags.length > 0 && (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
                {selected.subtitle && (
                  <span className="truncate text-xs text-muted-foreground">{selected.subtitle}</span>
                )}
              </>
            ) : (
              <span className="truncate text-muted-foreground">
                {emptyOptionLabel && value === "" ? emptyOptionLabel : placeholder}
              </span>
            )}
          </span>
        </button>

        {allowClear && value && !disabled && (
          <button
            type="button"
            aria-label="Hapus pilihan"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="absolute right-8 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}

        <ChevronsUpDown className="pointer-events-none absolute right-2.5 size-4 shrink-0 text-muted-foreground opacity-70" />
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlighted((prev) =>
                    flatEntries.length ? (prev + 1) % flatEntries.length : 0,
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlighted((prev) =>
                    flatEntries.length
                      ? (prev - 1 + flatEntries.length) % flatEntries.length
                      : 0,
                  );
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const entry = flatEntries[highlighted];
                  if (entry) pick(entry.value);
                }
              }}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul
            id={listId}
            role="listbox"
            className="max-h-60 overflow-y-auto p-1"
          >
            {flatEntries.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                {emptyResultsText}
              </li>
            ) : (
              flatEntries.map((entry, idx) => {
                const isSelected = entry.value === value;
                const isActive = idx === highlighted;
                return (
                  <li
                    key={entry.value === "" ? "__empty__" : entry.value}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlighted(idx)}
                    onClick={() => pick(entry.value)}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors",
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                      isSelected && "font-semibold",
                    )}
                  >
                    <Check
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0 text-primary",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("break-words", entry.isAll && "text-muted-foreground")}>
                          {entry.label}
                        </span>
                        {entry.option?.tags && entry.option.tags.length > 0 && (
                          <span className="inline-flex flex-wrap items-center gap-1">
                            {entry.option.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                      {entry.option?.subtitle && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {entry.option.subtitle}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
