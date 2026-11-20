"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Refresh data halaman yang sama tanpa navigasi penuh atau memaksa posisi scroll. */
export function RefreshScheduleButton({ page }: { page: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button asChild variant="outline" className={`h-9 rounded-xl px-3 text-xs font-semibold ${pending ? "opacity-70" : ""}`}>
      <a href={`/peserta?halaman=${page}`} aria-busy={pending} aria-disabled={pending || undefined}
        onClick={(event) => {
          // Tautan tetap dapat dibuka di tab baru atau digunakan tanpa JavaScript.
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (!pending) startTransition(() => router.refresh());
        }}>
        <RefreshCw className={`size-3.5 ${pending ? "motion-safe:animate-spin" : ""}`} />
        {pending ? "Memuat..." : "Muat ulang"}
      </a>
    </Button>
  );
}
