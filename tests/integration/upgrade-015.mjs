// Uji upgrade nyata pada DATABASE KOSONG khusus tes. Jangan gunakan database
// sekolah. Tidak membuat/menghapus database dan menolak nama/konfirmasi lain.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import pg from "pg";

import { decryptSixDigitToken, digestSixDigitToken, encryptSixDigitToken, examTokenKeyVerifier } from "../../src/lib/exam-token-crypto.mjs";
import { participantSessionDigest } from "../../src/lib/participant-login-validation.mjs";
import { decryptParticipantPassword, participantKeyVerifier } from "../../src/lib/participant-password-crypto.mjs";
import { hashPassword, verifyPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";

const database = "nusacbt_upgrade_015_test";
if (process.env.PGDATABASE !== database || process.env.NUSACBT_CONFIRM_TEST_DATABASE !== database) {
  throw new Error(`Wajib memakai PGDATABASE=${database} dan NUSACBT_CONFIRM_TEST_DATABASE=${database}; gunakan database kosong khusus uji.`);
}
const root = fileURLToPath(new URL("../..", import.meta.url));
const vectorFile = JSON.parse(await readFile(new URL("../fixtures/participant-password-v014.json", import.meta.url), "utf8"));
const vector = vectorFile.vectors[0];
const key = Buffer.from(vectorFile.key, "base64");
const tokenKey = Buffer.alloc(32, 91); // Kunci fiktif, sengaja berbeda dengan kunci peserta.
const oldToken = randomBytes(32).toString("base64url");
const adminUsername = "admin_upgrade_fiktif";
const adminPassword = "Admin-Upgrade-Fiktif-2026!";
const username = "peserta_upgrade";
const periodName = "Periode Upgrade 015 Fiktif";
const client = new pg.Client(postgresConfig());
let temp;
let child;
let browser;

function encodeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Identifier uji tidak valid.");
  return `"${value}"`;
}

async function snapshot(tables, sequences) {
  const result = {};
  for (const table of tables) {
    const rows = await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) AS rows FROM ${encodeIdentifier(table)} r`);
    result[`table:${table}`] = createHash("sha256").update(JSON.stringify(rows.rows[0].rows)).digest("hex");
  }
  const states = (await client.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  for (const sequence of sequences) result[`sequence:${sequence}`] = states.find((row) => row.sequencename === sequence)?.last_value ?? null;
  return result;
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port uji tidak tersedia.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startTestServer(port, participantKeyFile, examTokenKeyFile) {
  const processHandle = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", root, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, NUSACBT_PARTICIPANT_KEY_FILE: participantKeyFile, NUSACBT_EXAM_TOKEN_KEY_FILE: examTokenKeyFile, NUSACBT_COOKIE_SECURE: "false", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server upgrade uji tidak siap; jalankan npm run build terlebih dahulu.")), 30_000);
      const onOutput = (chunk) => { output += chunk.toString(); if (output.includes("Ready in")) { clearTimeout(timer); resolve(); } };
      processHandle.stdout.on("data", onOutput); processHandle.stderr.on("data", onOutput);
      processHandle.once("error", (error) => { clearTimeout(timer); reject(error); });
      processHandle.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server upgrade uji berhenti (${code}).`)); });
    });
    return processHandle;
  } catch (error) { processHandle.kill("SIGKILL"); throw error; }
}

try {
  await client.connect();
  assert.equal((await client.query("SELECT current_database() AS name, current_setting('server_encoding') AS encoding")).rows[0].name, database);
  assert.equal((await client.query("SHOW server_encoding")).rows[0].server_encoding, "UTF8");
  const objects = await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1");
  if (objects.rowCount) throw new Error("Database uji tidak kosong; tidak ada perubahan yang dilakukan.");

  // Terapkan migrasi asli 001–014 dan simpan checksum dengan format migrator.
  const files = (await readdir(join(root, "migrations"))).filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort();
  const oldFiles = files.filter((file) => Number(file.slice(0, 3)) <= 14);
  assert.equal(oldFiles.length, 14);
  assert.ok(files.includes("015_participant_password_and_active_period.sql"));
  await client.query("CREATE TABLE nusacbt_schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const file of oldFiles) {
    const sql = (await readFile(join(root, "migrations", file), "utf8")).replace(/\r\n/g, "\n");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    try { await client.query(sql); await client.query("INSERT INTO nusacbt_schema_migrations(version,checksum) VALUES($1,$2)", [file, checksum]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  }

  // Fixture sandi dibuat dengan implementasi PR #17 sebelum aturan baru.
  const adminHash = await hashPassword(adminPassword);
  await client.query("BEGIN");
  try {
    const adminId = (await client.query("INSERT INTO admin_users(username,password_hash) VALUES($1,$2) RETURNING id", [adminUsername, adminHash])).rows[0].id;
    const majorId = (await client.query("INSERT INTO school_majors(name) VALUES('JURUSAN UJI') RETURNING id")).rows[0].id;
    const classId = (await client.query("INSERT INTO school_classes(level,major_id) VALUES('X',$1) RETURNING id", [majorId])).rows[0].id;
    await client.query("INSERT INTO exam_periods(id,name,start_date,end_date) OVERRIDING SYSTEM VALUE VALUES(19,$1,'2025-01-01','2025-12-31')", [periodName]);
    await client.query("SELECT setval(pg_get_serial_sequence('exam_periods','id'),19,true)");
    const studentId = (await client.query("INSERT INTO school_students(name,nisn) VALUES('Siswa Lama Uji','0123456789') RETURNING id")).rows[0].id;
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,19,$2,'X JURUSAN UJI')", [studentId, classId]);
    await client.query("INSERT INTO participant_identities(id,student_id,period_id,participant_number,username) OVERRIDING SYSTEM VALUE VALUES(42,$1,19,'UJI-042',$2)", [studentId, username]);
    await client.query("SELECT setval(pg_get_serial_sequence('participant_identities','id'),42,true)");
    await client.query("INSERT INTO participant_password_key_binding(id,verifier) VALUES(1,$1)", [participantKeyVerifier(key)]);
    await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES(42,$1,$2,$3,$4)", [vector.hash, Buffer.from(vector.nonce, "base64"), Buffer.from(vector.ciphertext, "base64"), Buffer.from(vector.authenticationTag, "base64")]);
    await client.query("INSERT INTO participant_password_audit(participant_identity_id,admin_id,event) VALUES(42,$1,'create_manual')", [adminId]);
    const examId = (await client.query("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES(19,'Tes Lama Uji',clock_timestamp()+interval '1 hour','WIB',60) RETURNING id")).rows[0].id;
    const topicId = (await client.query("INSERT INTO question_topics(name) VALUES('Topik Uji') RETURNING id")).rows[0].id;
    const questionId = (await client.query("INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option) VALUES($1,'ما قيمة √٤؟ 🧪','A','B','C','D','E','A') RETURNING id", [topicId])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [examId, questionId]);
    await client.query("INSERT INTO exam_token_key_binding(id,verifier) VALUES(1,$1)", [examTokenKeyVerifier(tokenKey)]);
    const tokenId = (await client.query("SELECT nextval(pg_get_serial_sequence('exam_access_tokens','id'))::text AS id")).rows[0].id;
    const code = "654321"; const encrypted = encryptSixDigitToken(code, tokenKey, { id: tokenId, scope: "test" });
    await client.query(`WITH t AS (SELECT clock_timestamp() AS issued) INSERT INTO exam_access_tokens(id,scope,exam_test_id,test_name_snapshot,token_hash,duration_minutes,issued_at,expires_at,code_version,code_nonce,code_ciphertext,code_tag)
      OVERRIDING SYSTEM VALUE SELECT $1::bigint,'test',$2,'Tes Lama Uji',$3,15,issued,issued+interval '15 minutes',2,$4,$5,$6 FROM t`,
    [tokenId, examId, digestSixDigitToken(code, tokenKey), encrypted.nonce, encrypted.ciphertext, encrypted.tag]);
    await client.query(`INSERT INTO participant_sessions(token_hash,participant_identity_id,placement_id,username_snapshot,identity_revision,password_revision,password_hash_digest,expires_at)
      SELECT $1,i.id,pl.id,i.username,i.updated_at,pw.updated_at,sha256(convert_to(pw.password_hash,'UTF8')),clock_timestamp()+interval '8 hours'
      FROM participant_identities i JOIN participant_passwords pw ON pw.participant_identity_id=i.id
      JOIN student_class_placements pl ON pl.student_id=i.student_id AND pl.period_id=i.period_id AND pl.ended_at IS NULL WHERE i.id=42`, [participantSessionDigest(oldToken)]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }

  const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'nusacbt_schema_migrations' ORDER BY table_name")).rows.map((row) => row.table_name);
  const sequences = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows.map((row) => row.sequencename);
  const before = await snapshot(tables, sequences);
  for (let run = 0; run < 2; run += 1) {
    const result = spawnSync(process.execPath, [join(root, "scripts/migrate.mjs")], { cwd: root, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, encoding: "utf8" });
    assert.equal(result.status, 0, `Migrasi uji gagal: ${result.stderr}`);
  }
  assert.deepEqual(await snapshot(tables, sequences), before);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM nusacbt_schema_migrations")).rows[0].n, files.length);
  assert.deepEqual((await client.query("SELECT id,period_id FROM participant_login_settings")).rows, [{ id: 1, period_id: null }]);
  assert.equal((await client.query("SELECT 1 FROM participant_sessions")).rowCount, 1); // Tidak dihapus selama migrasi.
  const old = (await client.query("SELECT password_hash AS hash,nonce,ciphertext,authentication_tag AS \"authenticationTag\" FROM participant_passwords WHERE participant_identity_id=42")).rows[0];
  assert.equal(await verifyPassword(vector.password, old.hash), true);
  assert.equal(decryptParticipantPassword(old, key, vectorFile.binding), vector.password);
  assert.deepEqual((await client.query("SELECT verifier FROM participant_password_key_binding WHERE id=1")).rows[0].verifier, participantKeyVerifier(key));
  const token = (await client.query("SELECT id::text AS id,scope,code_nonce AS nonce,code_ciphertext AS ciphertext,code_tag AS tag,token_hash AS digest FROM exam_access_tokens")).rows[0];
  assert.equal(decryptSixDigitToken(token, tokenKey, token), "654321");
  assert.deepEqual(token.digest, digestSixDigitToken("654321", tokenKey));
  assert.equal((await client.query("SELECT prompt_text FROM question_bank")).rows[0].prompt_text, "ما قيمة √٤؟ 🧪");
  assert.equal((await client.query("SELECT count(*)::int AS n FROM exam_schedule_runs")).rows[0].n, 0);
  console.log(`Migrasi 014 → terbaru (015–019) dua kali: ${tables.length} tabel lama dan ${sequences.length} sequence identik; sandi, token, Unicode dan binding terverifikasi.`);

  // Aplikasi baru menggunakan database upgrade dan file kunci fiktif terpisah.
  temp = await mkdtemp(join(tmpdir(), "nusacbt-upgrade-015-"));
  const participantKeyFile = join(temp, "participant-test.key"); const tokenKeyFile = join(temp, "token-test.key");
  await writeFile(participantKeyFile, `${key.toString("base64")}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(tokenKeyFile, `${tokenKey.toString("base64")}\n`, { mode: 0o600, flag: "wx" });
  const port = await unusedPort(); child = await startTestServer(port, participantKeyFile, tokenKeyFile);
  const baseURL = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
  const participant = await browser.newContext({ baseURL });
  const admin = await browser.newContext({ baseURL });
  try {
    await participant.addCookies([{ name: "nusacbt_participant_session", value: oldToken, domain: "127.0.0.1", path: "/peserta", httpOnly: true, sameSite: "Strict" }]);
    const page = await participant.newPage(); await page.goto("/peserta");
    assert.match(page.url(), /\/peserta\/login\?sesi=berakhir$/);
    assert.equal(await page.getByRole("button", { name: "Masuk sebagai peserta" }).isDisabled(), true);
    const adminPage = await admin.newPage(); await adminPage.goto("/login");
    await adminPage.getByLabel("Username admin").fill(adminUsername); await adminPage.getByLabel("Kata sandi").fill(adminPassword);
    await adminPage.getByRole("button", { name: "Masuk ke panel admin" }).click();
    await adminPage.waitForURL(/\/$/); await adminPage.goto("/data-peserta/periode");
    await adminPage.getByRole("button", { name: `Aktifkan login ${periodName}` }).click();
    await adminPage.getByRole("dialog", { name: "Aktifkan periode login?" }).getByRole("button", { name: "Ya, aktifkan login" }).click();
    await adminPage.getByRole("dialog", { name: "Aktifkan periode login?" }).waitFor({ state: "hidden" });
    assert.equal((await client.query("SELECT 1 FROM participant_sessions")).rowCount, 0);
    await page.goto("/peserta"); assert.match(page.url(), /\/peserta\/login\?sesi=berakhir$/); // Cookie lama tidak hidup kembali.
    await page.getByLabel("Username peserta").fill(username); await page.getByLabel("Kata sandi", { exact: true }).fill(vector.password);
    await page.getByRole("button", { name: "Masuk sebagai peserta" }).click(); await page.waitForURL(/\/peserta$/);
    assert.equal(await page.getByRole("heading", { name: "Halo, Siswa Lama Uji!" }).isVisible(), true);
    // Rancangan lama masih ada untuk admin tetapi tidak otomatis dirilis.
    assert.equal(await page.getByText("Tes Lama Uji", { exact: true }).count(), 0);
    await adminPage.goto("/data-tes/daftar");
    assert.equal(await adminPage.getByText("Tes Lama Uji", { exact: true }).isVisible(), true);
    await adminPage.goto("/data-peserta/sandi?periode=19");
    const row = adminPage.getByRole("list", { name: "Daftar sandi peserta" }).getByRole("listitem").filter({ hasText: "Siswa Lama Uji" });
    await row.getByRole("button", { name: /^Lihat sandi / }).click();
    const reveal = adminPage.getByRole("dialog", { name: "Lihat sandi peserta" });
    await reveal.getByRole("button", { name: "Tampilkan sandi" }).click();
    await reveal.locator("output").waitFor(); assert.equal(await reveal.locator("output").textContent(), vector.password);
    await reveal.getByRole("button", { name: "Tutup" }).click();
    await row.getByRole("button", { name: /^Reset sandi / }).click();
    const reset = adminPage.getByRole("dialog", { name: "Reset sandi peserta" });
    await reset.getByRole("radio", { name: /Manual/ }).check();
    await reset.getByLabel("Sandi baru", { exact: true }).fill("TESTBARU"); await reset.getByLabel("Ulangi sandi baru").fill("TESTBARU");
    await reset.getByRole("button", { name: "Ya, reset sandi" }).click(); await reset.waitFor({ state: "hidden" });
    await page.goto("/peserta"); assert.match(page.url(), /\/peserta\/login\?sesi=berakhir$/);
    await page.getByLabel("Username peserta").fill(username); await page.getByLabel("Kata sandi", { exact: true }).fill("TESTBARU");
    await page.getByRole("button", { name: "Masuk sebagai peserta" }).click(); await page.waitForURL(/\/peserta$/);
    assert.equal((await client.query("SELECT octet_length(ciphertext) AS n FROM participant_passwords WHERE participant_identity_id=42")).rows[0].n, 8);
    console.log("Aplikasi upgrade: sesi lama ditolak, admin memilih periode, sandi lama masuk/ditampilkan, reset 8 huruf dan login baru berhasil.");
  } finally { await participant.close(); await admin.close(); }
} finally {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited; clearTimeout(timer);
  }
  if (temp) await rm(temp, { recursive: true, force: true });
  key.fill(0); tokenKey.fill(0); await client.end().catch(() => {});
}
