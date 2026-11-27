"use client";

import { useActionState } from "react";
import Link from "next/link";

import { saveWorkSetting } from "@/app/data-tes/pengaturan-pengerjaan/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function SettingForm({ minutes, revision }: { minutes: number; revision: string }) {
  const [state, action, pending] = useActionState(saveWorkSetting, { revision, message: "" });
  return <form action={action} className="space-y-4">
    <input type="hidden" name="revision" value={state.revision} />
    <div className="space-y-2">
      <label htmlFor="submission-minutes" className="block text-sm font-semibold">Batas pengumpulan manual</label>
      <div className="flex max-w-xs items-center gap-3"><Input id="submission-minutes" name="minutes" type="number" inputMode="numeric" min={1} max={10080} step={1} required defaultValue={minutes} disabled={pending || state.reload} className="h-11 rounded-xl" /><span className="text-sm text-muted-foreground">menit terakhir</span></div>
      <p className="text-xs leading-5 text-muted-foreground">Isi bilangan bulat 1–10080. Nilai awal adalah 5 menit.</p>
    </div>
    {state.message && <p role={state.ok ? "status" : "alert"} className={`rounded-xl border p-3 text-sm ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>{state.message}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" className="rounded-xl" disabled={pending || state.reload}>{pending && <Spinner aria-hidden="true" />}{pending ? "Menyimpan…" : "Simpan pengaturan"}</Button>
      {state.reload && <Button asChild variant="outline" className="rounded-xl"><Link href="/data-tes/pengaturan-pengerjaan">Muat ulang pengaturan</Link></Button>}</div>
  </form>;
}
