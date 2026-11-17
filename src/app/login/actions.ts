"use server";

import { redirect } from "next/navigation";

import { authenticateAdmin, endAdminSession, setAdminSessionCookie } from "@/lib/admin-auth";

export type LoginState = { error: string };

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const username = formData.get("username");
  const password = formData.get("password");
  let token: string | null;
  try {
    token = await authenticateAdmin(username, password);
    if (token) await setAdminSessionCookie(token);
  } catch {
    return { error: "Tidak dapat menghubungi database atau konfigurasi sesi belum benar. Periksa pengaturan server." };
  }
  if (!token) {
    return { error: "Username atau kata sandi salah, atau akun terkunci sementara setelah beberapa percobaan." };
  }
  redirect("/");
}

export async function logoutAction() {
  await endAdminSession();
  redirect("/login");
}
