// Untuk tes saja: meniru format AES-GCM PR #17 sehingga kita dapat membuat
// fixture sandi lama untuk ID/periode acak. Tidak dipakai aplikasi produksi.
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import pg from "pg";

import { participantKeyVerifier, readParticipantKeyFile, sameParticipantVerifier } from "../../src/lib/participant-password-crypto.mjs";
import { hashPassword } from "../../src/lib/password.mjs";

export async function insertLegacyPassword(client: pg.Client, identityId: string, periodId: string, password: string) {
  const master = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
  const derived = Buffer.from(hkdfSync("sha256", master, Buffer.from("NusaCBT participant password master key v1", "utf8"), Buffer.from("aes-256-gcm-v1", "utf8"), 32));
  try {
    const hash = await hashPassword(password); // Format scrypt sama dengan peserta sebelum perubahan.
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", derived, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(JSON.stringify(["nusacbt-participant-password-v1", periodId, identityId]), "utf8"));
    const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    await client.query("BEGIN");
    try {
      const verifier = participantKeyVerifier(master);
      await client.query("INSERT INTO participant_password_key_binding(id,verifier) VALUES(1,$1) ON CONFLICT(id) DO NOTHING", [verifier]);
      const binding = await client.query<{ verifier: Buffer }>("SELECT verifier FROM participant_password_key_binding WHERE id=1 FOR SHARE");
      if (!binding.rows[0] || !sameParticipantVerifier(binding.rows[0].verifier, verifier)) throw new Error("Kunci fixture tidak cocok.");
      await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES($1,$2,$3,$4,$5)", [identityId, hash, nonce, ciphertext, tag]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  } finally { derived.fill(0); master.fill(0); }
}
