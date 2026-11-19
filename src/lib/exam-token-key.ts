import "server-only";

import { timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import type { PoolClient } from "pg";

import { examTokenKeyVerifier, sameTokenVerifier } from "@/lib/exam-token-crypto.mjs";
import { ParticipantKeyFileError, readParticipantKeyFile } from "@/lib/participant-password-crypto.mjs";
import type { TokenKeyStatus } from "@/lib/exam-token-types";

export class ExamTokenKeyProblem extends Error {
  constructor(readonly status: Exclude<TokenKeyStatus, "ready">) { super(tokenKeyMessage(status)); }
}
export function tokenKeyMessage(status: TokenKeyStatus) {
  switch (status) {
    case "ready": return "Kunci token siap.";
    case "missing": return "Kunci token belum dikonfigurasi. Minta pengelola server menyiapkannya sesuai panduan.";
    case "invalid": return "File kunci tidak dapat dibaca atau tidak valid. Periksa konfigurasi dan izin file di server.";
    case "same": return "Kunci token harus berbeda dari kunci sandi peserta. Gunakan file kunci token terpisah.";
    case "mismatch": return "Kunci token tidak cocok dengan database. Pulihkan kunci token yang benar; jangan membuat kunci pengganti.";
    case "inconsistent": return "Pengikat kunci token database hilang. Pulihkan database dan kunci dari cadangan yang sesuai.";
  }
}

/** Membaca kunci terpisah di luar proyek; caller wajib mengosongkan Buffer. */
export async function readConfiguredTokenKey() {
  const root = process.env.NUSACBT_INTERNAL_PROJECT_ROOT;
  if (!root || !isAbsolute(root)) throw new ExamTokenKeyProblem("invalid");
  let token: Buffer;
  try { token = await readParticipantKeyFile(process.env.NUSACBT_EXAM_TOKEN_KEY_FILE, root); }
  catch (error) { throw new ExamTokenKeyProblem(error instanceof ParticipantKeyFileError && error.reason === "missing" ? "missing" : "invalid"); }
  try {
    if (process.env.NUSACBT_PARTICIPANT_KEY_FILE) {
      let participant: Buffer;
      try { participant = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, root); }
      catch { throw new ExamTokenKeyProblem("invalid"); }
      try { if (timingSafeEqual(token, participant)) throw new ExamTokenKeyProblem("same"); }
      finally { participant.fill(0); }
    }
    return token;
  } catch (error) { token.fill(0); throw error; }
}

export async function tokenKeyStatus(client: PoolClient, key: Buffer): Promise<TokenKeyStatus> {
  const binding = await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id=1");
  if (binding.rowCount) return sameTokenVerifier(binding.rows[0].verifier, examTokenKeyVerifier(key)) ? "ready" : "mismatch";
  const encrypted = await client.query<{ present: boolean }>("SELECT EXISTS(SELECT 1 FROM exam_access_tokens WHERE code_version=2) AS present");
  return encrypted.rows[0].present ? "inconsistent" : "ready";
}

// Panggil di dalam transaksi setelah advisory token lock; binding tidak dapat
// diganti selama operasi berlangsung. Binding awal hanya untuk database tanpa
// token versi 2 sehingga kunci yang salah tidak mencampur data lama dan baru.
export async function lockTokenKeyBinding(client: PoolClient, key: Buffer) {
  let row = await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id=1 FOR SHARE");
  if (!row.rowCount) {
    await client.query(`INSERT INTO exam_token_key_binding(id,verifier)
      SELECT 1,$1::bytea WHERE NOT EXISTS (SELECT 1 FROM exam_access_tokens WHERE code_version=2)
      ON CONFLICT (id) DO NOTHING`, [examTokenKeyVerifier(key)]);
    row = await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id=1 FOR SHARE");
  }
  if (!row.rowCount) throw new ExamTokenKeyProblem("inconsistent");
  if (!sameTokenVerifier(row.rows[0].verifier, examTokenKeyVerifier(key))) throw new ExamTokenKeyProblem("mismatch");
}
