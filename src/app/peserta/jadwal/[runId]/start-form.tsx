"use client";

import { useActionState } from "react";
import Link from "next/link";

import { beginExamAction } from "@/app/peserta/jadwal/[runId]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function StartForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState(beginExamAction, { error: "" });
  return <form action={action} className="mt-6 space-y-4">
    <input type="hidden" name="runId" value={runId} />
    <div className="space-y-2">
      <label htmlFor="exam-token" className="text-sm font-semibold">Token tes</label>
      <Input id="exam-token" name="token" required inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6}
        autoComplete="off" placeholder="6 angka dari pengawas" className="h-11 max-w-xs rounded-xl tracking-widest" disabled={pending} />
      <p className="text-xs leading-5 text-muted-foreground">Masukkan enam angka, termasuk angka nol di depan. Token hanya diperiksa ketika mulai.</p>
    </div>
    {state.error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      {state.error} {state.login && <Link className="underline" href="/peserta/login?sesi=berakhir">Masuk kembali</Link>}
    </div>}
    <Button type="submit" className="rounded-xl" disabled={pending}>{pending ? "Menyiapkan soal…" : "Mulai pengerjaan"}</Button>
    {pending && <p role="status" className="text-xs text-muted-foreground">Menyiapkan soal. Jika koneksi terputus, muat ulang jadwal untuk memeriksa apakah tes sudah dimulai.</p>}
  </form>;
}
