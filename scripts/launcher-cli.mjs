import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

import { normalizeAdminUsername } from "../src/lib/admin-username.mjs";
import {
  createParticipantKeyFile,
  ParticipantKeyFileError,
  readParticipantKeyFile,
} from "../src/lib/participant-password-crypto.mjs";
import { hashPassword, validNewAdminPassword } from "../src/lib/password.mjs";
import { postgresConfig } from "../src/lib/postgres-config.mjs";
import { requireUtf8Database } from "./migration-encoding.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(appDir, "migrations");
const MIGRATION_LOCK = 2026111701;
const ADMIN_LOCK = 2026111702;

function parseArgs(argv) {
  const cmd = argv[2] || "check";
  let dataDir = process.cwd();
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === "--data-dir" && argv[i + 1]) {
      dataDir = argv[++i];
    }
  }
  return { cmd, dataDir: resolve(dataDir) };
}

function loadEnvFromDataDir(dataDir) {
  const silentLog = { info: () => {}, error: () => {} };
  nextEnv.loadEnvConfig(dataDir, false, silentLog);
}

async function readAppVersion() {
  try {
    const raw = await readFile(join(appDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // Abaikan dan kembalikan fallback default.
  }
  return "1.0.1";
}

async function getMigrationFiles() {
  if (!existsSync(migrationsDir)) return [];
  const entries = await readdir(migrationsDir);
  return entries.filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort();
}

async function runMigrationsOnClient(client) {
  await requireUtf8Database(client);
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
  let locked = true;
  const applied = [];
  const skipped = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS nusacbt_schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = await getMigrationFiles();
    if (files.length === 0) throw new Error("Tidak ada file migrasi yang ditemukan.");
    for (const file of files) {
      const sql = (await readFile(join(migrationsDir, file), "utf8")).replace(/\r\n/g, "\n");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("SELECT checksum FROM nusacbt_schema_migrations WHERE version = $1", [file]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Migrasi ${file} sudah diterapkan tetapi isinya berubah.`);
        }
        skipped.push(file);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO nusacbt_schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }
    return { applied, skipped, total: files.length };
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
      locked = false;
    }
  }
}

async function inspectKeys(dataDir) {
  const participantPath = process.env.NUSACBT_PARTICIPANT_KEY_FILE?.trim() || join(dataDir, "keys", "participant.key");
  const tokenPath = process.env.NUSACBT_EXAM_TOKEN_KEY_FILE?.trim() || join(dataDir, "keys", "exam-token.key");
  let participantOk = false;
  let participantReason = "missing";
  let tokenOk = false;
  let tokenReason = "missing";
  let keysDistinct = false;
  let participantBuf = null;
  let tokenBuf = null;

  try {
    participantBuf = await readParticipantKeyFile(participantPath, appDir);
    participantOk = true;
    participantReason = "ready";
  } catch (error) {
    participantReason = error instanceof ParticipantKeyFileError ? error.reason : "unreadable";
  }

  try {
    tokenBuf = await readParticipantKeyFile(tokenPath, appDir);
    if (participantBuf && timingSafeEqual(participantBuf, tokenBuf)) {
      tokenOk = false;
      tokenReason = "same";
    } else {
      tokenOk = true;
      tokenReason = "ready";
      keysDistinct = true;
    }
  } catch (error) {
    tokenReason = error instanceof ParticipantKeyFileError ? error.reason : "unreadable";
  } finally {
    participantBuf?.fill(0);
    tokenBuf?.fill(0);
  }

  return {
    participantPath,
    participantOk,
    participantReason,
    tokenPath,
    tokenOk,
    tokenReason,
    keysDistinct,
  };
}

async function handleCheck(dataDir) {
  loadEnvFromDataDir(dataDir);
  const version = await readAppVersion();
  const envFile = join(dataDir, ".env.local");
  const envExists = existsSync(envFile);
  const hasServerEntry = existsSync(join(appDir, "server.js")) || existsSync(join(appDir, ".next"));
  const migrationFiles = await getMigrationFiles();
  const keys = await inspectKeys(dataDir);

  const db = {
    configured: Boolean(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD),
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || "5432") || 5432,
    database: process.env.PGDATABASE || "nusacbt",
    user: process.env.PGUSER || "nusacbt_app",
    connected: false,
    isUtf8: false,
    encoding: "",
    appliedMigrations: 0,
    totalMigrations: migrationFiles.length,
    pendingMigrations: migrationFiles.length,
    adminCount: 0,
    activeAttemptsCount: 0,
    errorCode: "",
    error: "",
  };

  if (!db.configured) {
    db.errorCode = "missing_env";
    db.error = "Konfigurasi database (.env.local) belum disiapkan.";
  } else {
    let client;
    try {
      client = new pg.Client(postgresConfig());
      await client.connect();
      db.connected = true;

      const encRow = await client.query("SHOW server_encoding");
      const dbEncRow = await client.query("SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = current_database()");
      const enc = dbEncRow.rows[0]?.enc || encRow.rows[0]?.server_encoding || "";
      db.encoding = enc;
      db.isUtf8 = enc.toUpperCase() === "UTF8";
      if (!db.isUtf8) {
        db.errorCode = "not_utf8";
        db.error = `Encoding database adalah ${enc}, harus UTF8.`;
      }

      const migTable = await client.query("SELECT to_regclass('public.nusacbt_schema_migrations') IS NOT NULL AS exists");
      if (migTable.rows[0]?.exists) {
        const appliedRes = await client.query("SELECT version FROM nusacbt_schema_migrations");
        const appliedSet = new Set(appliedRes.rows.map((r) => r.version));
        db.appliedMigrations = appliedRes.rowCount ?? 0;
        db.pendingMigrations = migrationFiles.filter((file) => !appliedSet.has(file)).length;
      }

      const adminTable = await client.query("SELECT to_regclass('public.admin_users') IS NOT NULL AS exists");
      if (adminTable.rows[0]?.exists) {
        const adminRes = await client.query("SELECT count(*)::int AS n FROM admin_users");
        db.adminCount = adminRes.rows[0]?.n ?? 0;
      }

      const attemptTable = await client.query("SELECT to_regclass('public.exam_attempts') IS NOT NULL AS exists");
      if (attemptTable.rows[0]?.exists) {
        const activeRes = await client.query(
          "SELECT count(*)::int AS n FROM exam_attempts WHERE completed_at IS NULL AND deadline > now()",
        );
        db.activeAttemptsCount = activeRes.rows[0]?.n ?? 0;
      }
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "3D000") db.errorCode = "database_not_found";
      else if (code === "28P01" || code === "28000") db.errorCode = "auth_failed";
      else if (code === "ECONNREFUSED" || code === "ENOTFOUND") db.errorCode = "cannot_connect";
      else db.errorCode = "db_error";
      db.error = error instanceof Error ? error.message : "Gagal terhubung ke PostgreSQL.";
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  return {
    ok: true,
    version,
    tag: `v${version}`,
    appDir,
    dataDir,
    appReady: hasServerEntry,
    envFile,
    envExists,
    keys,
    db,
  };
}

function cleanSingleLineEnvValue(val, label) {
  if (typeof val !== "string" || !val.trim() || /[\r\n\u0000]/.test(val)) {
    throw new Error(`${label} tidak valid.`);
  }
  return val.trim();
}

export function formatEnvLine(key, val) {
  const dollarSafe = val.replace(/\$/g, "\\$");
  if (!/[\s"'#`$]/.test(val)) {
    return `${key}=${dollarSafe}`;
  }
  if (!val.includes("'")) {
    return `${key}='${dollarSafe}'`;
  }
  if (!val.includes('"')) {
    return `${key}="${dollarSafe}"`;
  }
  if (!val.includes("`")) {
    return `${key}=\`${dollarSafe}\``;
  }
  throw new Error(`Nilai ${key} mengandung kombinasi tanda kutip yang tidak didukung.`);
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) throw new Error("Input konfigurasi JSON kosong.");
  return JSON.parse(raw);
}

async function handleSetup(dataDir) {
  const input = await readStdinJson();
  const host = cleanSingleLineEnvValue(input.host || "127.0.0.1", "Host PostgreSQL");
  const port = Number(input.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port PostgreSQL tidak valid.");
  const database = cleanSingleLineEnvValue(input.database || "nusacbt", "Nama database");
  const user = cleanSingleLineEnvValue(input.user || "nusacbt_app", "User database");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(database)) throw new Error("Nama database hanya boleh huruf, angka, dan underscore.");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(user)) throw new Error("Nama user database hanya boleh huruf, angka, dan underscore.");
  if (typeof input.password !== "string" || !input.password || /[\r\n\u0000]/.test(input.password)) {
    throw new Error("Kata sandi user database wajib diisi dan tidak boleh mengandung baris baru.");
  }
  const password = input.password;
  const cookieSecure = input.cookieSecure === true ? "true" : "false";

  if (input.createDbIfMissing) {
    const adminUser = cleanSingleLineEnvValue(input.adminUser || "postgres", "User admin PostgreSQL");
    if (typeof input.adminPassword !== "string" || !input.adminPassword) {
      throw new Error("Kata sandi superuser PostgreSQL wajib diisi untuk membuat database baru.");
    }
    const adminClient = new pg.Client({
      host,
      port,
      database: "postgres",
      user: adminUser,
      password: input.adminPassword,
      connectionTimeoutMillis: 5000,
    });
    try {
      await adminClient.connect();
      const roleExists = await adminClient.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [user]);
      const identUser = adminClient.escapeIdentifier(user);
      const litPass = adminClient.escapeLiteral(password);
      if (roleExists.rowCount === 0) {
        await adminClient.query(`CREATE ROLE ${identUser} WITH LOGIN PASSWORD ${litPass}`);
      }
      const dbExists = await adminClient.query("SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1", [database]);
      const identDb = adminClient.escapeIdentifier(database);
      if (dbExists.rowCount === 0) {
        await adminClient.query(`CREATE DATABASE ${identDb} OWNER ${identUser} ENCODING 'UTF8' TEMPLATE template0`);
      } else if (String(dbExists.rows[0].enc).toUpperCase() !== "UTF8") {
        throw new Error(`Database ${database} sudah ada tetapi encoding-nya ${dbExists.rows[0].enc}, bukan UTF8.`);
      }
      await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE ${identDb} TO ${identUser}`);
    } finally {
      await adminClient.end().catch(() => {});
    }
  }

  await mkdir(dataDir, { recursive: true });
  const keysDir = join(dataDir, "keys");
  await mkdir(keysDir, { recursive: true });

  const participantKeyPath = join(keysDir, "participant.key");
  const tokenKeyPath = join(keysDir, "exam-token.key");

  if (!isAbsolute(participantKeyPath) || !isAbsolute(tokenKeyPath)) {
    throw new Error("Path file kunci harus absolut.");
  }

  for (const keyPath of [participantKeyPath, tokenKeyPath]) {
    if (!existsSync(keyPath)) {
      await createParticipantKeyFile(keyPath, appDir);
    } else {
      // Pastikan file kunci yang sudah ada tetap valid dan tidak rusak.
      const existingBuf = await readParticipantKeyFile(keyPath, appDir);
      existingBuf.fill(0);
    }
  }

  const envLines = [
    "# Konfigurasi server lokal NusaCBT (dibuat oleh wizard launcher).",
    formatEnvLine("PGHOST", host),
    formatEnvLine("PGPORT", String(port)),
    formatEnvLine("PGDATABASE", database),
    formatEnvLine("PGUSER", user),
    formatEnvLine("PGPASSWORD", password),
    formatEnvLine("NUSACBT_PARTICIPANT_KEY_FILE", participantKeyPath),
    formatEnvLine("NUSACBT_EXAM_TOKEN_KEY_FILE", tokenKeyPath),
    formatEnvLine("NUSACBT_COOKIE_SECURE", cookieSecure),
  ];
  const envTarget = join(dataDir, ".env.local");
  const envTmp = join(dataDir, `.env.local.tmp.${process.pid}`);
  await writeFile(envTmp, `${envLines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(envTmp, envTarget);

  const client = new pg.Client({ host, port, database, user, password, connectionTimeoutMillis: 5000 });
  let migrationSummary;
  let adminCreated = false;
  try {
    await client.connect();
    migrationSummary = await runMigrationsOnClient(client);

    const existingAdmin = await client.query("SELECT 1 FROM admin_users LIMIT 1");
    if (existingAdmin.rowCount === 0) {
      const username = normalizeAdminUsername(input.initialAdminUsername);
      if (!username) {
        throw new Error("Username admin awal wajib diisi (3–64 karakter: huruf, angka, titik, garis bawah, atau tanda hubung).");
      }
      if (!validNewAdminPassword(input.initialAdminPassword)) {
        throw new Error("Kata sandi admin awal harus 12–128 karakter dan maksimal 512 byte.");
      }
      const passwordHash = await hashPassword(input.initialAdminPassword);
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [ADMIN_LOCK]);
        const checkAgain = await client.query("SELECT 1 FROM admin_users LIMIT 1");
        if (checkAgain.rowCount === 0) {
          await client.query(
            "INSERT INTO admin_users (username, password_hash, full_name, is_superuser, is_active) VALUES ($1, $2, $3, true, true)",
            [username, passwordHash, username],
          );
          adminCreated = true;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  return {
    ok: true,
    envFile: envTarget,
    participantKeyPath,
    tokenKeyPath,
    migrations: migrationSummary,
    adminCreated,
  };
}

async function handleMigrate(dataDir) {
  loadEnvFromDataDir(dataDir);
  const client = new pg.Client(postgresConfig());
  try {
    await client.connect();
    const summary = await runMigrationsOnClient(client);
    return { ok: true, ...summary };
  } finally {
    await client.end().catch(() => {});
  }
}

async function handleActiveExams(dataDir) {
  loadEnvFromDataDir(dataDir);
  const client = new pg.Client(postgresConfig());
  try {
    await client.connect();
    const tableCheck = await client.query("SELECT to_regclass('public.exam_attempts') IS NOT NULL AS exists");
    if (!tableCheck.rows[0]?.exists) return { ok: true, activeAttempts: 0 };
    const res = await client.query(
      "SELECT count(*)::int AS n FROM exam_attempts WHERE completed_at IS NULL AND deadline > now()",
    );
    return { ok: true, activeAttempts: res.rows[0]?.n ?? 0 };
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const { cmd, dataDir } = parseArgs(process.argv);
  if (cmd === "check") {
    console.log(JSON.stringify(await handleCheck(dataDir)));
    return;
  }
  if (cmd === "setup") {
    console.log(JSON.stringify(await handleSetup(dataDir)));
    return;
  }
  if (cmd === "migrate") {
    console.log(JSON.stringify(await handleMigrate(dataDir)));
    return;
  }
  if (cmd === "active-exams") {
    console.log(JSON.stringify(await handleActiveExams(dataDir)));
    return;
  }
  throw new Error(`Perintah tidak dikenal: ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Terjadi kesalahan launcher.",
      }),
    );
    process.exitCode = 1;
  });
}
