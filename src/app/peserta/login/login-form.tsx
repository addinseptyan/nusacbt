"use client";

import { useActionState, useState } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff } from "lucide-react";

import { participantLoginAction } from "@/app/peserta/login/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActiveLoginPeriod } from "@/lib/participant-auth";

export function ParticipantLoginForm({ activePeriods, available }: { activePeriods: ActiveLoginPeriod[]; available: boolean }) {
  const [state, action, pending] = useActionState(participantLoginAction, { error: "" });
  const [username, setUsername] = useState("");
  const [periodId, setPeriodId] = useState(() => (activePeriods.length === 1 ? activePeriods[0].id : ""));
  const [visible, setVisible] = useState(false);
  const enabled = activePeriods.length > 0;
  const multiPeriod = activePeriods.length > 1;
  const canLogin = available && enabled;

  return (
    <form action={action} className="mt-6 space-y-4">
      {state.error && <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{state.error}</AlertDescription></Alert>}
      {available && !enabled && <Alert role="status"><CircleAlert className="size-4" /><AlertDescription>Login peserta belum diaktifkan. Hubungi pengawas.</AlertDescription></Alert>}
      {multiPeriod && (
        <div className="space-y-2">
          <label htmlFor="participant-period" className="text-sm font-semibold">Periode ujian</label>
          <select
            id="participant-period"
            name="periodId"
            required
            disabled={!canLogin || pending}
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <option value="">Pilih periode ujian</option>
            {activePeriods.map((period) => (
              <option key={period.id} value={period.id}>{period.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor="participant-username" className="text-sm font-semibold">Username peserta</label>
        <Input id="participant-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={64} required disabled={!canLogin || pending}
          value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Masukkan username" className="h-11 rounded-xl" />
      </div>
      <div className="space-y-2">
        <label htmlFor="participant-password" className="text-sm font-semibold">Kata sandi</label>
        <div className="relative">
          <Input id="participant-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" maxLength={256} required disabled={!canLogin || pending}
            placeholder="Masukkan kata sandi" className="h-11 rounded-xl pr-12" />
          <button type="button" aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} aria-pressed={visible} onClick={() => setVisible(!visible)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-xl focus-visible:ring-2 focus-visible:outline-none">
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" disabled={!canLogin || pending} className="mt-2 h-11 w-full rounded-xl font-semibold">
        {pending ? "Memeriksa akun..." : "Masuk sebagai peserta"}{!pending && <ArrowRight className="size-4" />}
      </Button>
      <p className="text-center text-xs leading-5 text-muted-foreground">Setelah lima percobaan gagal, akses dikunci sementara selama 15 menit.</p>
    </form>
  );
}
