"use server";

import { validDataId } from "@/lib/class-validation.mjs";
import { loadExamAttempt } from "@/lib/exam-attempt-work";
import { participantSharedScores, type ParticipantSharedScores } from "@/lib/participant-auth";
import { participantPageNumber } from "@/lib/participant-login-validation.mjs";

export type ParticipantStatusResult =
  | { ok: true; state: "working" }
  | { ok: true; state: "finished"; reason: "submitted" | "time_expired"; score: string | null }
  | { ok: false; error: string; login?: boolean };
export type SharedScoresResult = { ok: true; data: ParticipantSharedScores } | { ok: false; error: string; login?: boolean };

/** Tidak mengirim isi soal jika status berubah menjadi masih berjalan. */
export async function participantAttemptStatus(rawId: string): Promise<ParticipantStatusResult> {
  const id = validDataId(rawId);
  if (!id) return { ok: false, error: "Pengerjaan tidak valid. Muat ulang jadwal." };
  try {
    const view = await loadExamAttempt(id, 1);
    if (view === "login") return { ok: false, error: "Sesi berakhir. Masuk kembali.", login: true };
    if (view === "missing") return { ok: false, error: "Pengerjaan tidak ditemukan atau tidak tersedia untuk sesi ini." };
    if (view.state === "working") return { ok: true, state: "working" };
    return { ok: true, state: "finished", reason: view.reason, score: view.score };
  } catch { return { ok: false, error: "Status belum dapat dimuat. Periksa koneksi dan coba lagi." }; }
}

/** Hanya mengembalikan nilai yang diizinkan dan milik sesi peserta saat ini. */
export async function participantSharedScoresAction(rawPage: string): Promise<SharedScoresResult> {
  try {
    const data = await participantSharedScores(participantPageNumber(rawPage));
    if (!data) return { ok: false, error: "Sesi berakhir. Masuk kembali.", login: true };
    return { ok: true, data };
  } catch { return { ok: false, error: "Nilai belum dapat dimuat. Periksa koneksi dan coba lagi." }; }
}
