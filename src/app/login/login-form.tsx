"use client";

import { useActionState } from "react";
import { ArrowRight, Info } from "lucide-react";

import { loginAction } from "@/app/login/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, { error: "" });

  return (
    <form action={action} className="mt-7 space-y-5">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <Info className="size-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <label htmlFor="username" className="text-sm font-semibold">Username admin</label>
        <Input id="username" name="username" autoComplete="username" maxLength={64} required placeholder="Masukkan username" className="h-11 rounded-xl" />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-semibold">Kata sandi</label>
        <Input id="password" name="password" type="password" autoComplete="current-password" maxLength={128} required placeholder="Masukkan kata sandi" className="h-11 rounded-xl" />
      </div>
      <Button type="submit" disabled={pending} className="h-11 w-full rounded-xl font-semibold">
        {pending ? "Memeriksa akun..." : "Masuk ke panel admin"}
        {!pending && <ArrowRight className="size-4" />}
      </Button>
      <p className="text-center text-xs leading-5 text-muted-foreground">Setelah lima kali gagal, akun dikunci sementara selama 15 menit.</p>
    </form>
  );
}
