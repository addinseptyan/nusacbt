import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type pg from "pg";

import { participantAttemptBucket } from "../../src/lib/participant-login-validation.mjs";
import { decryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginParticipant, loginTestDatabase, openParticipantLogin, resetLoginGlobal, seedLoginFixture, type LoginFixture } from "./participant-login-helpers";

const accountRow = (page: Page, name: string) => page.getByRole("list", { name: "Daftar akun peserta" }).getByRole("listitem").filter({ hasText: name });
const loginError = (page: Page) => page.getByRole("alert").filter({ hasText: "Username atau kata sandi" });
const bucket = (period: string, username: string) => participantAttemptBucket(period, username.toLowerCase());

async function openAccount(page: Page, period: string) {
  await page.goto(`/data-peserta/akun?periode=${period}`);
  await expect(page.getByRole("heading", { name: "Akun Peserta", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daftar akun peserta" })).toBeVisible();
}

async function openUnlock(page: Page, name: string) {
  await accountRow(page, name).getByRole("button", { name: /^Buka kunci login / }).click();
  const dialog = page.getByRole("dialog", { name: "Buka kunci login peserta?" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setLock(client: pg.Client, period: string, username: string, interval = "15 minutes") {
  await client.query(
    `INSERT INTO participant_login_attempts(bucket_hash,failed_attempts,locked_until,last_attempt_at)
     VALUES($1,5,clock_timestamp()+$2::interval,clock_timestamp())
     ON CONFLICT(bucket_hash) DO UPDATE SET failed_attempts=5,locked_until=EXCLUDED.locked_until,last_attempt_at=clock_timestamp()`,
    [bucket(period, username), interval],
  );
}

async function attempts(client: pg.Client, period: string, username: string) {
  return (await client.query(
    `SELECT failed_attempts, to_char(locked_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS locked_until,
       to_char(last_attempt_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_attempt_at
     FROM participant_login_attempts WHERE bucket_hash=$1`, [bucket(period, username)],
  )).rows[0] ?? null;
}

async function audit(client: pg.Client, f: LoginFixture) {
  return (await client.query<{ identity: string; admin: string; event: string; occurred: boolean }>(
    `SELECT a.participant_identity_id::text AS identity, u.username AS admin, a.event,
       a.occurred_at > clock_timestamp()-interval '5 minutes' AS occurred
     FROM participant_password_audit a JOIN admin_users u ON u.id=a.admin_id
     WHERE a.participant_identity_id=ANY($1::bigint[]) ORDER BY a.id`, [[f.identityA, f.identityB]],
  )).rows;
}

async function stableAccountData(client: pg.Client, f: LoginFixture) {
  const ids = [[f.identityA, f.identityB]];
  const result = [];
  for (const sql of [
    "SELECT * FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[]) ORDER BY participant_identity_id",
    "SELECT * FROM participant_identities WHERE id=ANY($1::bigint[]) ORDER BY id",
    "SELECT * FROM participant_sessions WHERE participant_identity_id=ANY($1::bigint[]) ORDER BY participant_identity_id",
  ]) result.push((await client.query(sql, ids)).rows);
  result.push((await client.query("SELECT * FROM participant_login_settings ORDER BY id")).rows);
  result.push((await client.query("SELECT * FROM participant_login_global_limit ORDER BY id")).rows);
  result.push((await client.query("SELECT * FROM participant_password_key_binding ORDER BY id")).rows);
  return result;
}

test("satu menu membuka kunci yang nyata dan terisolasi per peserta/periode tanpa mengubah sandi atau sesi", async ({ page, browser }) => {
  test.setTimeout(110_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const mixedUsername = f.username.toUpperCase(); const otherUsername = `lain${f.suffix}`;
  const participantContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const participant = await participantContext.newPage();
  const attemptContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const entrant = await attemptContext.newPage();
  try {
    // Username ASCII campuran kasus harus menghasilkan bucket yang sama dengan login.
    await client.query("UPDATE participant_identities SET username=$1 WHERE id=ANY($2::bigint[])", [mixedUsername, [f.identityA, f.identityB]]);
    await loginParticipant(participant, mixedUsername, f.passwordA);
    for (let i = 0; i < 5; i += 1) { await openParticipantLogin(entrant, f.username, "SALAHAAA"); await expect(loginError(entrant)).toBeVisible(); }
    expect((await attempts(client, f.periodA, f.username)).failed_attempts).toBe(5);
    await openParticipantLogin(entrant, mixedUsername, f.passwordA); await expect(loginError(entrant)).toBeVisible();
    await setLock(client, f.periodB, f.username); await setLock(client, f.periodA, otherUsername);
    const otherPeriod = await attempts(client, f.periodB, f.username);
    const otherBucket = await attempts(client, f.periodA, otherUsername);
    const stable = await stableAccountData(client, f);
    const cookie = (await participantContext.cookies()).find((item) => item.name === "nusacbt_participant_session");
    if (!cookie) throw new Error("Sesi fiktif tidak tersedia.");

    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Peserta", exact: true }).click();
    await page.getByRole("link", { name: "Akun Peserta", exact: true }).click();
    await expect(page.getByRole("link", { name: "Identitas Peserta", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sandi Peserta", exact: true })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Periode" })).toContainText(f.periodAName);
    await page.getByRole("combobox", { name: "Periode" }).click();
    await page.getByRole("option", { name: f.periodBName }).click();
    await expect(page).toHaveURL(new RegExp(`/data-peserta/akun\\?periode=${f.periodB}$`));
    await page.getByRole("combobox", { name: "Periode" }).click();
    await page.getByRole("option", { name: f.periodAName }).click();
    await expect(page).toHaveURL(new RegExp(`/data-peserta/akun\\?periode=${f.periodA}$`));
    const row = accountRow(page, f.studentAName);
    await expect(row).toContainText("Login terkunci"); await expect(row).toContainText(mixedUsername);
    const response = await page.request.get(`/data-peserta/akun?periode=${f.periodA}`);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    const html = await response.text();
    const hash = (await client.query<{ password_hash: string }>("SELECT password_hash FROM participant_passwords WHERE participant_identity_id=$1", [f.identityA])).rows[0].password_hash;
    for (const secret of [f.passwordA, f.passwordB, hash, cookie.value, process.env.NUSACBT_PARTICIPANT_KEY_FILE!]) expect(html).not.toContain(secret);

    let dialog = await openUnlock(page, f.studentAName);
    await expect(dialog).toContainText(f.studentAName); await expect(dialog).toContainText(f.periodAName); await expect(dialog).toContainText(mixedUsername);
    await expect(dialog).toContainText("Sandi, penempatan kelas, sesi peserta, dan pembatas global tidak diubah");
    await dialog.getByRole("button", { name: "Batal" }).click();
    expect(await attempts(client, f.periodA, f.username)).toMatchObject({ failed_attempts: 5 });
    expect(await audit(client, f)).toHaveLength(0);
    dialog = await openUnlock(page, f.studentAName);
    const post = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/akun");
    await dialog.getByRole("button", { name: "Ya, buka kunci" }).click();
    const result = await post; expect(result.headers()["cache-control"]).toContain("no-store");
    await expect(dialog).toBeHidden();
    await expect(row.getByRole("button", { name: /^Buka kunci login / })).toHaveCount(0);
    expect(await attempts(client, f.periodA, f.username)).toMatchObject({ failed_attempts: 0, locked_until: null });
    expect(await attempts(client, f.periodB, f.username)).toEqual(otherPeriod);
    expect(await attempts(client, f.periodA, otherUsername)).toEqual(otherBucket);
    expect(await stableAccountData(client, f)).toEqual(stable);
    expect(await audit(client, f)).toEqual([{ identity: f.identityA, admin: process.env.TEST_ADMIN_USERNAME, event: "unlock_login", occurred: true }]);
    await expect(page.getByRole("list", { name: "Riwayat tindakan akun" })).toContainText("Kunci login dibuka");
    await participant.reload(); await expect(participant.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
    await loginParticipant(entrant, mixedUsername, f.passwordA); // Sandi lama yang sama kini diterima.

    // Username sama di periode lain tetap terkunci, dan periode login tidak otomatis berganti.
    const beforeB = await stableAccountData(client, f);
    await openAccount(page, f.periodB); await expect(accountRow(page, f.studentBName)).toContainText("Login terkunci");
    dialog = await openUnlock(page, f.studentBName); await expect(dialog).toContainText(f.periodBName);
    await dialog.getByRole("button", { name: "Ya, buka kunci" }).click(); await expect(dialog).toBeHidden();
    expect(await attempts(client, f.periodB, f.username)).toMatchObject({ failed_attempts: 0, locked_until: null });
    expect(await stableAccountData(client, f)).toEqual(beforeB);
    expect((await audit(client, f)).map((item) => [item.identity, item.event])).toEqual([[f.identityA, "unlock_login"], [f.identityB, "unlock_login"]]);
  } finally {
    await attemptContext.close(); await participantContext.close();
    await cleanupLoginFixture(client, f, [{ period: f.periodA, username: otherUsername }]); await client.end();
  }
});

test("identitas, sandi manual, batch, pencarian, tampilan, dan reset bekerja dari daftar gabungan", async ({ page }) => {
  test.setTimeout(110_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  let extraId = "";
  try {
    const extraName = `Akun ekstra ${f.suffix}`;
    const nisn = String(randomInt(1_000_000_000)).padStart(10, "0");
    extraId = (await client.query<{ id: string }>("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id", [extraName, nisn])).rows[0].id;
    await client.query(`INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
      VALUES($1,$3,$4,$5),($2,$3,$4,$5)`, [f.studentB, extraId, f.periodA, f.classId, `X ${f.majorName}`]);
    await loginAsAdmin(page); await openAccount(page, f.periodA);
    const second = accountRow(page, f.studentBName);
    await expect(second).toContainText("Belum beridentitas");
    await second.getByRole("button", { name: /^Atur identitas / }).click();
    let dialog = page.getByRole("dialog", { name: "Atur identitas peserta" });
    await dialog.getByLabel("Nomor peserta").fill(`MAN-${f.suffix}`); await dialog.getByLabel("Username").fill(`man${f.suffix}`);
    await dialog.getByRole("button", { name: "Simpan identitas" }).click(); await expect(dialog).toBeHidden();
    await expect(second).toContainText("Beridentitas");
    await second.getByRole("button", { name: /^Ubah identitas / }).click();
    dialog = page.getByRole("dialog", { name: "Ubah identitas peserta" });
    await dialog.getByLabel("Nomor peserta").fill(`BARU-${f.suffix}`); await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog).toBeHidden(); await expect(second).toContainText(`BARU-${f.suffix}`);

    // Batch tidak dipengaruhi filter pencarian.
    await page.getByLabel("Cari peserta").fill("tidak-ada-peserta-ini");
    await expect(page.getByText("Peserta tidak ditemukan")).toBeVisible();
    await page.getByRole("button", { name: "Buat identitas otomatis" }).click();
    dialog = page.getByRole("dialog", { name: "Buat identitas otomatis?" });
    await expect(dialog).toContainText("1 siswa"); await dialog.getByRole("button", { name: "Ya, buat identitas" }).click(); await expect(dialog).toBeHidden();
    await page.getByLabel("Cari peserta").fill("");
    await expect(accountRow(page, extraName)).toContainText("Beridentitas");

    await second.getByRole("button", { name: /^Buat sandi / }).click(); dialog = page.getByRole("dialog", { name: "Buat sandi peserta" });
    await dialog.getByRole("radio", { name: /Manual/ }).check();
    await dialog.getByLabel("Sandi baru", { exact: true }).fill("ABCD1234"); await dialog.getByLabel("Ulangi sandi baru").fill("ABCD1234");
    await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("8 huruf kapital");
    await dialog.getByLabel("Sandi baru", { exact: true }).fill("SANDIBAR"); await dialog.getByLabel("Ulangi sandi baru").fill("SANDIBAR");
    await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click(); await expect(dialog).toBeHidden();
    await expect(second).toContainText("Sudah bersandi"); await expect(second.getByLabel("Tersamarkan")).toBeVisible();
    await page.getByLabel("Cari peserta").fill("tidak-ada-peserta-ini");
    await page.getByRole("button", { name: "Buat sandi otomatis" }).click();
    dialog = page.getByRole("dialog", { name: "Buat sandi otomatis?" });
    await expect(dialog).toContainText("1 peserta"); await dialog.getByRole("button", { name: "Ya, buat sandi" }).click(); await expect(dialog).toBeHidden();
    await page.getByLabel("Cari peserta").fill(""); await expect(accountRow(page, extraName)).toContainText("Sudah bersandi");
    const generated = (await client.query<{ id: string; nonce: Buffer; ciphertext: Buffer; authenticationTag: Buffer }>(
      `SELECT i.id::text AS id,pw.nonce,pw.ciphertext,pw.authentication_tag AS "authenticationTag" FROM participant_identities i
       JOIN participant_passwords pw ON pw.participant_identity_id=i.id WHERE i.student_id=$1 AND i.period_id=$2`, [extraId, f.periodA],
    )).rows[0];
    const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
    let generatedPassword;
    try { generatedPassword = decryptParticipantPassword(generated, key, { identityId: generated.id, periodId: f.periodA }); }
    finally { key.fill(0); }
    expect(generatedPassword).toMatch(/^[A-Z]{8}$/); expect(await page.content()).not.toContain(generatedPassword);
    expect(await page.content()).not.toContain("SANDIBAR");

    await second.getByRole("button", { name: /^Lihat sandi / }).click(); dialog = page.getByRole("dialog", { name: "Lihat sandi peserta" });
    const showPost = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/akun");
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click(); expect((await showPost).headers()["cache-control"]).toContain("no-store");
    await expect(dialog.locator("output")).toHaveText("SANDIBAR"); await dialog.getByRole("button", { name: "Tutup" }).click();
    await expect(dialog).toBeHidden(); expect(await page.content()).not.toContain("SANDIBAR");
    await second.getByRole("button", { name: /^Reset sandi / }).click(); dialog = page.getByRole("dialog", { name: "Reset sandi peserta" });
    await dialog.getByRole("radio", { name: /Manual/ }).check(); await dialog.getByLabel("Sandi baru", { exact: true }).fill("RESETABC");
    await dialog.getByLabel("Ulangi sandi baru").fill("RESETABC"); await dialog.getByRole("button", { name: "Ya, reset sandi" }).click(); await expect(dialog).toBeHidden();
    const events = (await client.query<{ event: string }>(`SELECT a.event FROM participant_password_audit a JOIN participant_identities i ON i.id=a.participant_identity_id
      WHERE i.student_id=$1 AND i.period_id=$2 ORDER BY a.id`, [f.studentB, f.periodA])).rows.map((item) => item.event);
    expect(events).toEqual(["create_manual", "reveal", "reset_manual"]);
    await expect(page.getByRole("list", { name: "Riwayat tindakan akun" })).toContainText("Sandi di-reset manual");
    expect(await page.content()).not.toContain("RESETABC");
  } finally {
    // Identitas tambahan hanya untuk tes ini, termasuk sandi/audit yang baru dibuat.
    await client.query("DELETE FROM participant_password_audit WHERE participant_identity_id IN (SELECT id FROM participant_identities WHERE period_id=$1 AND student_id=ANY($2::bigint[]))", [f.periodA, [f.studentB, extraId || "0"]]);
    await client.query("DELETE FROM participant_passwords WHERE participant_identity_id IN (SELECT id FROM participant_identities WHERE period_id=$1 AND student_id=ANY($2::bigint[]))", [f.periodA, [f.studentB, extraId || "0"]]);
    await client.query("DELETE FROM participant_identities WHERE period_id=$1 AND student_id=ANY($2::bigint[])", [f.periodA, [f.studentB, extraId || "0"]]);
    await client.query("DELETE FROM student_class_placements WHERE period_id=$1 AND student_id=ANY($2::bigint[])", [f.periodA, [f.studentB, extraId || "0"]]);
    if (extraId) await client.query("DELETE FROM school_students WHERE id=$1", [extraId]);
    await cleanupLoginFixture(client, f); await client.end();
  }
});

test("reset sandi tidak membuka kunci; setelah dibuka, lima kegagalan baru tetap mengunci", async ({ page, browser }) => {
  test.setTimeout(65_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const entrant = await context.newPage();
  try {
    await setLock(client, f.periodA, f.username); const before = await attempts(client, f.periodA, f.username);
    await loginAsAdmin(page); await openAccount(page, f.periodA);
    const row = accountRow(page, f.studentAName); await row.getByRole("button", { name: /^Reset sandi / }).click();
    let dialog = page.getByRole("dialog", { name: "Reset sandi peserta" });
    await dialog.getByRole("radio", { name: /Manual/ }).check(); await dialog.getByLabel("Sandi baru", { exact: true }).fill("SEMARANG");
    await dialog.getByLabel("Ulangi sandi baru").fill("SEMARANG"); await dialog.getByRole("button", { name: "Ya, reset sandi" }).click(); await expect(dialog).toBeHidden();
    expect(await attempts(client, f.periodA, f.username)).toEqual(before);
    await expect(row).toContainText("Login terkunci");
    dialog = await openUnlock(page, f.studentAName); await dialog.getByRole("button", { name: "Ya, buka kunci" }).click(); await expect(dialog).toBeHidden();
    await openParticipantLogin(entrant, f.username, f.passwordA); await expect(loginError(entrant)).toBeVisible();
    await loginParticipant(entrant, f.username, "SEMARANG");
    const wrongContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
    try {
      const wrong = await wrongContext.newPage();
      for (let i = 0; i < 5; i += 1) { await openParticipantLogin(wrong, f.username, "SALAHAAA"); await expect(loginError(wrong)).toBeVisible(); }
      expect(await attempts(client, f.periodA, f.username)).toMatchObject({ failed_attempts: 5 });
      await page.reload(); await expect(row).toContainText("Login terkunci");
      expect((await audit(client, f)).map((item) => item.event)).toEqual(["reset_manual", "unlock_login"]);
    } finally { await wrongContext.close(); }
  } finally { await context.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

test("batas global tidak direset oleh pembukaan kunci", async ({ page, browser }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const entrant = await context.newPage();
  try {
    await setLock(client, f.periodA, f.username); await client.query("UPDATE participant_login_global_limit SET attempts=180,window_started_at=clock_timestamp() WHERE id=1");
    await loginAsAdmin(page); await openAccount(page, f.periodA);
    const dialog = await openUnlock(page, f.studentAName); await dialog.getByRole("button", { name: "Ya, buka kunci" }).click(); await expect(dialog).toBeHidden();
    expect((await client.query<{ attempts: number }>("SELECT attempts FROM participant_login_global_limit WHERE id=1")).rows[0].attempts).toBe(180);
    await openParticipantLogin(entrant, f.username, f.passwordA); await expect(loginError(entrant)).toBeVisible();
    expect((await client.query<{ attempts: number }>("SELECT attempts FROM participant_login_global_limit WHERE id=1")).rows[0].attempts).toBe(181);
    expect(await attempts(client, f.periodA, f.username)).toMatchObject({ failed_attempts: 0, locked_until: null });
    await resetLoginGlobal(client); await loginParticipant(entrant, f.username, f.passwordA);
  } finally { await context.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

for (const change of ["siswa", "periode", "identitas", "penguncian", "kedaluwarsa"] as const) {
  test(`dialog usang ditolak jika ${change} berubah, tanpa audit palsu`, async ({ page }) => {
    const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
    try {
      await setLock(client, f.periodA, f.username); await loginAsAdmin(page); await openAccount(page, f.periodA);
      const dialog = await openUnlock(page, f.studentAName);
      if (change === "siswa") await client.query("UPDATE school_students SET name=name || ' revisi' WHERE id=$1", [f.studentA]);
      if (change === "periode") await client.query("UPDATE exam_periods SET name=name || ' revisi' WHERE id=$1", [f.periodA]);
      if (change === "identitas") await client.query("UPDATE participant_identities SET username='ubah-' || username WHERE id=$1", [f.identityA]);
      if (change === "penguncian") await client.query("UPDATE participant_login_attempts SET locked_until=locked_until+interval '1 minute' WHERE bucket_hash=$1", [bucket(f.periodA, f.username)]);
      if (change === "kedaluwarsa") await client.query("UPDATE participant_login_attempts SET locked_until=clock_timestamp()-interval '1 second' WHERE bucket_hash=$1", [bucket(f.periodA, f.username)]);
      const before = await attempts(client, f.periodA, f.username);
      await dialog.getByRole("button", { name: "Ya, buka kunci" }).click();
      await expect(dialog.getByRole("alert").filter({ hasText: /berubah|berakhir/ })).toBeVisible();
      expect(await attempts(client, f.periodA, f.username)).toEqual(before); expect(await audit(client, f)).toHaveLength(0);
      if (change === "kedaluwarsa") {
        await dialog.getByRole("button", { name: "Batal" }).click(); await page.reload();
        await expect(accountRow(page, f.studentAName).getByRole("button", { name: /^Buka kunci login / })).toHaveCount(0);
      }
    } finally { await cleanupLoginFixture(client, f); await client.end(); }
  });
}

test("dua admin membuka kunci bersamaan: hanya satu berhasil dan satu audit", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const other = await context.newPage();
  try {
    await setLock(client, f.periodA, f.username); await loginAsAdmin(page); await loginAsAdmin(other);
    await openAccount(page, f.periodA); await openAccount(other, f.periodA);
    const first = await openUnlock(page, f.studentAName); const second = await openUnlock(other, f.studentAName);
    await Promise.all([first.getByRole("button", { name: "Ya, buka kunci" }).click(), second.getByRole("button", { name: "Ya, buka kunci" }).click()]);
    await expect.poll(async () => Number(await first.isVisible()) + Number(await second.isVisible())).toBe(1);
    const loser = await first.isVisible() ? first : second;
    await expect(loser.getByRole("alert").filter({ hasText: /berakhir|berubah/ })).toBeVisible();
    expect(await attempts(client, f.periodA, f.username)).toMatchObject({ failed_attempts: 0, locked_until: null });
    expect(await audit(client, f)).toHaveLength(1);
  } finally { await context.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

test("pembukaan yang lebih dulu diantrekan tidak menghapus kegagalan login yang menyusul", async ({ page, browser }) => {
  test.setTimeout(70_000);
  const client = loginTestDatabase(); const locker = loginTestDatabase(); await client.connect(); await locker.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const entrant = await context.newPage();
  const pending: Promise<unknown>[] = [];
  try {
    await setLock(client, f.periodA, f.username); await loginAsAdmin(page); await openAccount(page, f.periodA);
    const dialog = await openUnlock(page, f.studentAName);
    await entrant.goto("/peserta/login"); await entrant.getByLabel("Username peserta").fill(f.username); await entrant.getByLabel("Kata sandi", { exact: true }).fill("SALAHAAA");
    await locker.query("BEGIN"); await locker.query("SELECT bucket_hash FROM participant_login_attempts WHERE bucket_hash=$1 FOR UPDATE", [bucket(f.periodA, f.username)]);
    const unlockResponse = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/akun");
    pending.push(unlockResponse.then((item) => item.finished())); pending.push(dialog.getByRole("button", { name: "Ya, buka kunci" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_login_attempts%' AND query LIKE '%locked_until > clock_timestamp() AS active%'`)).rows[0].n), { timeout: 10_000 }).toBeGreaterThan(0);
    const loginResponse = entrant.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/peserta/login");
    pending.push(loginResponse.then((item) => item.finished())); pending.push(entrant.getByRole("button", { name: "Masuk sebagai peserta" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_login_attempts%' AND query LIKE '%failed_attempts AS%'`)).rows[0].n), { timeout: 10_000 }).toBeGreaterThan(0);
    await locker.query("COMMIT"); await Promise.all(pending);
    await expect(dialog).toBeHidden(); await expect(loginError(entrant)).toBeVisible();
    expect(await attempts(client, f.periodA, f.username)).toMatchObject({ failed_attempts: 1, locked_until: null }); expect(await audit(client, f)).toHaveLength(1);
  } finally {
    await locker.query("ROLLBACK").catch(() => {}); await Promise.allSettled(pending); await locker.end(); await context.close(); await cleanupLoginFixture(client, f); await client.end();
  }
});

test("kunci yang kedaluwarsa ketika menunggu data siswa tidak diubah dan tidak diaudit", async ({ page }) => {
  test.setTimeout(45_000);
  const client = loginTestDatabase(); const locker = loginTestDatabase(); await client.connect(); await locker.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const pending: Promise<unknown>[] = [];
  try {
    await setLock(client, f.periodA, f.username, "8 seconds"); const before = await attempts(client, f.periodA, f.username);
    await loginAsAdmin(page); await openAccount(page, f.periodA); const dialog = await openUnlock(page, f.studentAName);
    await locker.query("BEGIN"); await locker.query("SELECT id FROM school_students WHERE id=$1 FOR UPDATE", [f.studentA]);
    const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/akun");
    pending.push(response.then((item) => item.finished())); pending.push(dialog.getByRole("button", { name: "Ya, buka kunci" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%school_students%' AND query LIKE '%FOR SHARE%'`)).rows[0].n), { timeout: 6_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT locked_until <= clock_timestamp() AS expired FROM participant_login_attempts WHERE bucket_hash=$1", [bucket(f.periodA, f.username)])).rows[0]?.expired, { timeout: 12_000 }).toBe(true);
    await locker.query("COMMIT"); await Promise.all(pending);
    await expect(dialog.getByRole("alert").filter({ hasText: "Penguncian sudah berakhir" })).toBeVisible();
    expect(await attempts(client, f.periodA, f.username)).toEqual(before); expect(await audit(client, f)).toHaveLength(0);
  } finally {
    await locker.query("ROLLBACK").catch(() => {}); await Promise.allSettled(pending); await locker.end(); await cleanupLoginFixture(client, f); await client.end();
  }
});

test("sesi admin yang kedaluwarsa selama menunggu membatalkan buka kunci dan audit", async ({ page }) => {
  test.setTimeout(45_000);
  const client = loginTestDatabase(); const locker = loginTestDatabase(); await client.connect(); await locker.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const pending: Promise<unknown>[] = [];
  try {
    await setLock(client, f.periodA, f.username); const before = await attempts(client, f.periodA, f.username);
    await loginAsAdmin(page); await openAccount(page, f.periodA); const dialog = await openUnlock(page, f.studentAName);
    const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
    if (!cookie) throw new Error("Sesi admin fiktif tidak tersedia.");
    const digest = createHash("sha256").update(cookie.value).digest("hex");
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '8 seconds' WHERE token_hash=$1", [digest]);
    await locker.query("BEGIN"); await locker.query("SELECT bucket_hash FROM participant_login_attempts WHERE bucket_hash=$1 FOR UPDATE", [bucket(f.periodA, f.username)]);
    const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/akun");
    pending.push(response.then((item) => item.finished())); pending.push(dialog.getByRole("button", { name: "Ya, buka kunci" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_login_attempts%' AND query LIKE '%locked_until > clock_timestamp() AS active%'`)).rows[0].n), { timeout: 6_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at <= clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0]?.expired, { timeout: 12_000 }).toBe(true);
    await locker.query("COMMIT"); await Promise.all(pending);
    await expect(dialog.getByRole("alert").filter({ hasText: "Sesi admin sudah berakhir" })).toBeVisible();
    expect(await attempts(client, f.periodA, f.username)).toEqual(before); expect(await audit(client, f)).toHaveLength(0);
  } finally {
    await locker.query("ROLLBACK").catch(() => {}); await Promise.allSettled(pending); await locker.end(); await cleanupLoginFixture(client, f); await client.end();
  }
});

test("kegagalan menulis audit membatalkan pembukaan kunci secara atomik", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  const trigger = `e2e_unlock_${f.suffix}`; const fn = `${trigger}_fn`;
  try {
    await setLock(client, f.periodA, f.username); const before = await attempts(client, f.periodA, f.username);
    await loginAsAdmin(page); await openAccount(page, f.periodA);
    await client.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.participant_identity_id = ${f.identityA} AND NEW.event = 'unlock_login' THEN RAISE EXCEPTION 'synthetic unlock audit failure'; END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON participant_password_audit FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    const dialog = await openUnlock(page, f.studentAName); await dialog.getByRole("button", { name: "Ya, buka kunci" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "belum dapat dipastikan" })).toBeVisible();
    expect(await attempts(client, f.periodA, f.username)).toEqual(before); expect(await audit(client, f)).toHaveLength(0);
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON participant_password_audit`); await client.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    await cleanupLoginFixture(client, f); await client.end();
  }
});

test("tindakan hanya untuk admin bersesi, menolak Origin asing dan peserta/periode palsu", async ({ page, browser }) => {
  test.setTimeout(70_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  const anonymous = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  try {
    await setLock(client, f.periodA, f.username); await setLock(client, f.periodB, f.username);
    // Samakan waktu agar uji peserta/periode palsu juga mencapai pemeriksaan identitas.
    await client.query("UPDATE participant_login_attempts SET locked_until=(SELECT locked_until FROM participant_login_attempts WHERE bucket_hash=$1) WHERE bucket_hash=$2", [bucket(f.periodA, f.username), bucket(f.periodB, f.username)]);
    const original = await attempts(client, f.periodA, f.username); const other = await attempts(client, f.periodB, f.username);
    await loginAsAdmin(page); await openAccount(page, f.periodA);
    const dialog = await openUnlock(page, f.studentAName);
    const requestPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/akun");
    await dialog.getByRole("button", { name: "Ya, buka kunci" }).click(); const request = await requestPromise; await expect(dialog).toBeHidden();
    const headers = request.headers(); const body = request.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Aksi buka kunci tidak dapat diperiksa.");
    await client.query("UPDATE participant_login_attempts SET failed_attempts=5,locked_until=$2::timestamptz WHERE bucket_hash=$1", [bucket(f.periodA, f.username), original.locked_until]);
    const beforeA = await attempts(client, f.periodA, f.username);
    const args = { "content-type": headers["content-type"], "next-action": headers["next-action"] };
    const foreign = await page.request.post("/data-peserta/akun", { headers: { ...args, origin: "https://attacker.invalid" }, data: body, failOnStatusCode: false, maxRedirects: 0 });
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    const unauth = await anonymous.request.post("/data-peserta/akun", { headers: { ...args, origin: "http://127.0.0.1:3100" }, data: body, failOnStatusCode: false, maxRedirects: 0 });
    expect(unauth.headers()["x-action-redirect"] ?? unauth.headers().location ?? "").toContain("/login");
    const anonymousPage = await anonymous.newPage(); await anonymousPage.goto(`/data-peserta/akun?periode=${f.periodA}`); await expect(anonymousPage).toHaveURL(/\/login/);
    function replaceField(field: string, value: string) {
      const text = body!.toString("utf8"); const pattern = new RegExp(`(Content-Disposition: form-data; name="[^"]*${field}"\\r\\n\\r\\n)([^\\r\\n]*)`);
      if (!pattern.test(text)) throw new Error(`Field ${field} tidak ditemukan dalam aksi uji.`);
      return Buffer.from(text.replace(pattern, (_match, prefix: string) => `${prefix}${value}`));
    }
    for (const [field, value] of [["periodId", f.periodB], ["studentId", f.studentB], ["lockedUntil", "not-a-date"]]) {
      const forged = await page.request.post("/data-peserta/akun", { headers: { ...args, origin: "http://127.0.0.1:3100" }, data: replaceField(field, value), failOnStatusCode: false, maxRedirects: 0 });
      const text = await forged.text(); expect(text).toContain('"ok":false');
      expect(await attempts(client, f.periodA, f.username)).toEqual(beforeA); expect(await attempts(client, f.periodB, f.username)).toEqual(other);
    }
    const boundary = headers["content-type"].match(/boundary=(?:\"([^\"]+)\"|([^;]+))/)?.slice(1).find(Boolean);
    const serialized = body.toString("utf8");
    const fieldName = serialized.match(/Content-Disposition: form-data; name="([^"]*periodId)"/)?.[1];
    if (!boundary || !fieldName) throw new Error("Format aksi uji tidak dapat diperiksa.");
    const fieldStart = serialized.indexOf(`Content-Disposition: form-data; name="${fieldName}"`);
    const nextBoundary = serialized.indexOf(`\r\n--${boundary}`, fieldStart);
    if (fieldStart < 0 || nextBoundary < 0) throw new Error("Field aksi uji tidak lengkap.");
    // Field FormData bertingkat harus berurutan agar keduanya diteruskan oleh decoder React.
    const duplicate = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${f.periodB}`;
    const duplicatedBody = Buffer.from(serialized.slice(0, nextBoundary) + duplicate + serialized.slice(nextBoundary));
    const duplicated = await page.request.post("/data-peserta/akun", { headers: { ...args, origin: "http://127.0.0.1:3100" }, data: duplicatedBody, failOnStatusCode: false, maxRedirects: 0 });
    expect(await duplicated.text()).toContain('"ok":false');
    expect(await attempts(client, f.periodA, f.username)).toEqual(beforeA); expect(await attempts(client, f.periodB, f.username)).toEqual(other);

    const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
    if (!cookie) throw new Error("Sesi admin fiktif tidak tersedia.");
    await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [createHash("sha256").update(cookie.value).digest("hex")]);
    const revoked = await page.request.post("/data-peserta/akun", { headers: { ...args, origin: "http://127.0.0.1:3100" }, data: body, failOnStatusCode: false, maxRedirects: 0 });
    expect(revoked.headers()["x-action-redirect"] ?? revoked.headers().location ?? "").toContain("/login");
    expect(await attempts(client, f.periodA, f.username)).toEqual(beforeA); expect(await attempts(client, f.periodB, f.username)).toEqual(other);
    expect(await audit(client, f)).toHaveLength(1);
  } finally { await anonymous.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

async function unusedPort(): Promise<number> {
  const server = createServer(); await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Port uji tidak tersedia.");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); return address.port;
}

async function missingKeyServer() {
  const port = await unusedPort(); const root = process.cwd();
  const child: ChildProcess = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", root, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, env: { ...process.env, NUSACBT_PARTICIPANT_KEY_FILE: "", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server uji tanpa kunci tidak siap.")), 30_000);
      const handle = (chunk: Buffer) => { if (chunk.toString().includes("Ready in")) { clearTimeout(timer); resolve(); } };
      child.stdout?.on("data", handle); child.stderr?.on("data", handle);
      child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", () => { clearTimeout(timer); reject(new Error("Server uji berhenti sebelum siap.")); });
    });
    return { child, baseURL: `http://127.0.0.1:${port}` };
  } catch (error) { child.kill("SIGKILL"); throw error; }
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000); await exited; clearTimeout(timer);
}

test("tanpa file kunci sandi: kelola sandi dinonaktifkan tetapi buka kunci tetap diaudit", async ({ browser }) => {
  test.setTimeout(70_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  let child: ChildProcess | undefined; let context;
  try {
    await setLock(client, f.periodA, f.username); const before = await stableAccountData(client, f);
    const server = await missingKeyServer(); child = server.child; context = await browser.newContext({ baseURL: server.baseURL }); const page = await context.newPage();
    await loginAsAdmin(page); await openAccount(page, f.periodA);
    await expect(page.getByRole("alert").filter({ hasText: "Kunci belum dikonfigurasi" })).toBeVisible();
    const row = accountRow(page, f.studentAName);
    await expect(row.getByRole("button", { name: /^Lihat sandi / })).toBeDisabled(); await expect(row.getByRole("button", { name: /^Reset sandi / })).toBeDisabled();
    const dialog = await openUnlock(page, f.studentAName); await dialog.getByRole("button", { name: "Ya, buka kunci" }).click(); await expect(dialog).toBeHidden();
    expect(await attempts(client, f.periodA, f.username)).toMatchObject({ failed_attempts: 0, locked_until: null });
    expect(await stableAccountData(client, f)).toEqual(before); expect(await audit(client, f)).toHaveLength(1);
  } finally { await context?.close(); if (child) await stopChild(child); await cleanupLoginFixture(client, f); await client.end(); }
});

test.describe("akun peserta di layar kecil", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("daftar dan dialog buka kunci dapat dipakai dalam mode gelap", async ({ page }) => {
    const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
    try {
      await setLock(client, f.periodA, f.username); await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await openAccount(page, f.periodA); await expect(page.locator("html")).toHaveClass(/dark/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await page.setViewportSize({ width: 320, height: 320 }); const dialog = await openUnlock(page, f.studentAName);
      const box = await dialog.boundingBox(); if (!box) throw new Error("Dialog tidak terlihat.");
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      const confirm: Locator = dialog.getByRole("button", { name: "Ya, buka kunci" }); await confirm.scrollIntoViewIfNeeded(); await expect(confirm).toBeInViewport(); await confirm.click(); await expect(dialog).toBeHidden();
    } finally { await cleanupLoginFixture(client, f); await client.end(); }
  });
});
