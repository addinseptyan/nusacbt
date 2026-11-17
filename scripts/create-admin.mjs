import nextEnv from "@next/env";
import promptPassword from "@inquirer/password";
import pg from "pg";

import { normalizeAdminUsername } from "../src/lib/admin-username.mjs";
import { hashPassword, validNewAdminPassword } from "../src/lib/password.mjs";
import { postgresConfig } from "../src/lib/postgres-config.mjs";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const username = normalizeAdminUsername(process.argv[2]);
const useStdin = process.argv.includes("--stdin");
let client;

try {
  if (!username) throw new Error("Gunakan: npm run admin:create -- <username> (3–64 karakter: huruf, angka, titik, garis bawah, atau tanda hubung).");
  let password;
  if (useStdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  } else {
    if (!process.stdin.isTTY) throw new Error("Terminal interaktif diperlukan. Untuk otomatisasi uji, gunakan --stdin.");
    password = await promptPassword({ message: "Kata sandi admin (12–128 karakter):", mask: true });
    const confirmation = await promptPassword({ message: "Ulangi kata sandi:", mask: true });
    if (password !== confirmation) throw new Error("Kata sandi dan konfirmasi tidak sama.");
  }
  if (!validNewAdminPassword(password)) throw new Error("Kata sandi harus 12–128 karakter dan maksimal 512 byte.");
  const passwordHash = await hashPassword(password);

  client = new pg.Client(postgresConfig());
  await client.connect();
  await client.query("BEGIN");
  try {
    // Hanya untuk bootstrap: jangan menimpa atau menambah akun bila admin sudah ada.
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026111702]);
    const existing = await client.query("SELECT 1 FROM admin_users LIMIT 1");
    if (existing.rowCount) throw new Error("Admin sudah ada. Pembuatan akun tambahan belum tersedia pada tahap ini.");
    await client.query("INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)", [username, passwordHash]);
    await client.query("COMMIT");
    console.log(`Akun admin ${username} berhasil dibuat.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
} catch (error) {
  console.error("Pembuatan admin gagal:", error instanceof Error && error.name !== "ExitPromptError" ? error.message : "dibatalkan");
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
