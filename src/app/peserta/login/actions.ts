"use server";

import { redirect } from "next/navigation";

import { authenticateParticipant, endParticipantSession, participantCookieSecure, setParticipantSessionCookie } from "@/lib/participant-auth";
import { parseOptionalParticipantPeriodId, parseParticipantCredentials } from "@/lib/participant-login-validation.mjs";

export type ParticipantLoginState = { error: string };
const AUTH_ERROR = "Username atau kata sandi tidak cocok, atau akses terkunci sementara. Hubungi pengawas jika masih tidak dapat masuk.";

export async function participantLoginAction(_previous: ParticipantLoginState, form: FormData): Promise<ParticipantLoginState> {
  const usernames = form.getAll("username");
  const passwords = form.getAll("password");
  const periods = form.getAll("periodId");
  const legacyPeriods = form.getAll("period");
  if (usernames.length !== 1 || passwords.length !== 1 || periods.length > 1 || legacyPeriods.length > 0) {
    return { error: AUTH_ERROR };
  }
  const credentials = parseParticipantCredentials(usernames[0], passwords[0]);
  const periodId = parseOptionalParticipantPeriodId(periods[0]);
  if (!credentials || periodId === "invalid") return { error: AUTH_ERROR };
  let token: string | null;
  try {
    // Validasi konfigurasi cookie sebelum mengganti sesi yang sudah ada.
    const secure = participantCookieSecure();
    token = await authenticateParticipant({ ...credentials, periodId });
    if (token) await setParticipantSessionCookie(token, secure);
  } catch {
    return { error: "Login belum dapat diproses. Minta pengelola memeriksa koneksi dan konfigurasi server." };
  }
  if (!token) return { error: AUTH_ERROR };
  redirect("/peserta");
}

export async function participantLogoutAction() {
  let failed = false;
  try { await endParticipantSession(); } catch { failed = true; }
  // Jangan mengklaim keluar bila penghapusan sesi di server gagal. Cookie
  // dipertahankan agar tindakan dapat dicoba lagi setelah database pulih.
  if (failed) redirect("/peserta/login?error=logout");
  redirect("/peserta/login");
}
