import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { participantAttemptBucket } from "../../src/lib/participant-login-validation.mjs";
import { loginAsAdmin } from "./helpers";
import { insertLegacyPassword } from "./legacy-password-fixture";
import { activateLoginPeriod, cleanupLoginFixture, loginParticipant, loginTestDatabase, openParticipantLogin, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

const loginError = (page: Page) => page.getByRole("alert").filter({ hasText: "Username atau kata sandi" });

test("admin mengaktifkan, mengganti, kembali, dan menonaktifkan periode tanpa mengubah sandi", async ({ page, browser }) => {
  test.setTimeout(100_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const replayContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  try {
    const before = await client.query("SELECT * FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[]) ORDER BY participant_identity_id", [[f.identityA, f.identityB]]);
    await client.query("UPDATE participant_login_settings SET period_id=NULL WHERE id=1");
    await page.goto("/peserta/login");
    await expect(page.getByRole("status").filter({ hasText: "Login peserta belum diaktifkan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk sebagai peserta" })).toBeDisabled();
    await expect(page.getByLabel("Periode ujian")).toHaveCount(0);

    await loginAsAdmin(admin);
    await activateLoginPeriod(admin, f.periodAName);
    const originalLogin = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/peserta/login");
    await loginParticipant(page, f.username, f.passwordA);
    const oldLoginRequest = await originalLogin;
    await expect(page.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
    const oldCookie = (await page.context().cookies()).find((cookie) => cookie.name === "nusacbt_participant_session");
    if (!oldCookie) throw new Error("Cookie sesi peserta uji tidak ditemukan.");

    await activateLoginPeriod(admin, f.periodBName);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(0);
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
    await openParticipantLogin(page, f.username, f.passwordA); await expect(loginError(page)).toBeVisible();
    await loginParticipant(page, f.username, f.passwordB);
    await expect(page.getByRole("heading", { name: `Halo, ${f.studentBName}!` })).toBeVisible();
    await expect(page.getByText(f.hiddenName, { exact: true })).toBeVisible();

    await activateLoginPeriod(admin, f.periodAName);
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
    await replayContext.addCookies([oldCookie]);
    const replayPage = await replayContext.newPage(); await replayPage.goto("/peserta");
    await expect(replayPage).toHaveURL(/sesi=berakhir/); // Sesi A sebelum perpindahan tidak hidup kembali.
    await loginParticipant(page, f.username, f.passwordA);
    await admin.getByRole("button", { name: "Nonaktifkan login", exact: true }).click();
    const disable = admin.getByRole("dialog", { name: "Nonaktifkan login peserta?" });
    await expect(disable).toContainText("Semua sesi peserta sebelumnya diakhiri");
    await disable.getByRole("button", { name: "Ya, nonaktifkan login" }).click();
    await expect(disable).toBeHidden();
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
    await expect(page.getByRole("status").filter({ hasText: "Login peserta belum diaktifkan" })).toBeVisible();
    // Tombol nonaktif bukan satu-satunya penjaga: replay langsung ke server tetap gagal.
    const headers = oldLoginRequest.headers(); const body = oldLoginRequest.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Aksi login tidak dapat diperiksa.");
    const replay = await page.request.post("/peserta/login", {
      headers: { origin: "http://127.0.0.1:3100", "content-type": headers["content-type"], "next-action": headers["next-action"] }, data: body, failOnStatusCode: false, maxRedirects: 0,
    });
    expect(await replay.text()).toContain("Username atau kata sandi");
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=ANY($1::bigint[])", [[f.identityA, f.identityB]])).rowCount).toBe(0);
    expect((await client.query("SELECT * FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[]) ORDER BY participant_identity_id", [[f.identityA, f.identityB]])).rows).toEqual(before.rows);
  } finally { await replayContext.close(); await adminContext.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

test("parameter periode palsu tidak memilih identitas di luar periode aktif", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await page.goto(`/peserta/login?period=${f.periodB}`);
    await expect(page.getByLabel("Periode ujian")).toHaveCount(0);
    await page.getByLabel("Username peserta").fill(f.username);
    await page.getByLabel("Kata sandi", { exact: true }).fill(f.passwordB);
    const outgoing = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/peserta/login");
    await page.getByRole("button", { name: "Masuk sebagai peserta" }).click();
    const original = await outgoing; await expect(loginError(page)).toBeVisible();
    const headers = original.headers(); const body = original.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Aksi login tidak dapat diperiksa.");
    const boundary = headers["content-type"].match(/boundary=(?:\"([^\"]+)\"|([^;]+))/)?.slice(1).find(Boolean);
    if (!boundary) throw new Error("Boundary multipart tidak ditemukan.");
    const serialized = body.toString("utf8");
    const nextField = `--${boundary}\r\nContent-Disposition: form-data; name="_1_username"`;
    if (!serialized.includes(nextField)) throw new Error("Format formulir aksi berubah.");
    const forgedPeriod = `--${boundary}\r\nContent-Disposition: form-data; name="_1_period"\r\n\r\n${f.periodB}\r\n`;
    const response = await page.request.post("/peserta/login", {
      headers: { origin: "http://127.0.0.1:3100", "content-type": headers["content-type"], "next-action": headers["next-action"] },
      data: Buffer.from(serialized.replace(nextField, forgedPeriod + nextField)), failOnStatusCode: false, maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Username atau kata sandi");
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityB])).rowCount).toBe(0);
    const bucketA = participantAttemptBucket(f.periodA, f.username); const bucketB = participantAttemptBucket(f.periodB, f.username);
    expect((await client.query<{ failed: number }>("SELECT failed_attempts AS failed FROM participant_login_attempts WHERE bucket_hash=$1", [bucketA])).rows[0].failed).toBe(2);
    expect((await client.query("SELECT 1 FROM participant_login_attempts WHERE bucket_hash=$1", [bucketB])).rowCount).toBe(0);
    await loginParticipant(page, f.username, f.passwordA);
    await expect(page.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("pengaturan menolak admin usang, tanpa sesi, dan Origin asing", async ({ page, browser }) => {
  test.setTimeout(80_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const staleContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const stale = await staleContext.newPage();
  const anonymous = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  try {
    await loginAsAdmin(page); await loginAsAdmin(stale);
    await page.goto("/data-peserta/periode"); await stale.goto("/data-peserta/periode");
    await stale.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
    const staleDialog = stale.getByRole("dialog", { name: "Aktifkan periode login?" });
    await page.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
    const dialog = page.getByRole("dialog", { name: "Aktifkan periode login?" });
    const outgoing = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/periode");
    await dialog.getByRole("button", { name: "Ya, aktifkan login" }).click();
    const request = await outgoing; await expect(dialog).toBeHidden();
    // A → B → A tetap harus membuat dialog dari A semula menjadi usang.
    await activateLoginPeriod(page, f.periodAName);
    await staleDialog.getByRole("button", { name: "Ya, aktifkan login" }).click();
    await expect(staleDialog.getByRole("alert").filter({ hasText: "Periode login sudah berubah di sesi lain" })).toBeVisible();
    const headers = request.headers(); const body = request.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Aksi admin tidak dapat diperiksa.");
    const foreign = await page.request.post("/data-peserta/periode", {
      headers: { origin: "https://attacker.invalid", "content-type": headers["content-type"], "next-action": headers["next-action"] }, data: body, failOnStatusCode: false,
    });
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    const unauth = await anonymous.request.post("/data-peserta/periode", {
      headers: { origin: "http://127.0.0.1:3100", "content-type": headers["content-type"], "next-action": headers["next-action"] }, data: body, failOnStatusCode: false, maxRedirects: 0,
    });
    expect(unauth.headers()["x-action-redirect"] ?? unauth.headers().location ?? "").toContain("/login");
    expect((await client.query<{ period: string }>("SELECT period_id::text AS period FROM participant_login_settings WHERE id=1")).rows[0].period).toBe(f.periodA);

    await staleDialog.getByRole("button", { name: "Batal" }).click(); await stale.reload();
    await stale.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
    const revoked = stale.getByRole("dialog", { name: "Aktifkan periode login?" });
    const cookie = (await staleContext.cookies()).find((item) => item.name === "nusacbt_admin_session");
    if (!cookie) throw new Error("Cookie admin uji tidak ada.");
    await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [createHash("sha256").update(cookie.value).digest("hex")]);
    await revoked.getByRole("button", { name: "Ya, aktifkan login" }).click();
    await expect(stale).toHaveURL(/\/login$/);
    expect((await client.query<{ period: string }>("SELECT period_id::text AS period FROM participant_login_settings WHERE id=1")).rows[0].period).toBe(f.periodA);
  } finally { await anonymous.close(); await staleContext.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

test("login yang sedang berjalan tidak meninggalkan sesi lama setelah periode berganti", async ({ page, browser }) => {
  test.setTimeout(80_000);
  const client = loginTestDatabase(); const locker = loginTestDatabase(); await client.connect(); await locker.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const pending: Promise<unknown>[] = [];
  try {
    await loginAsAdmin(admin); await admin.goto("/data-peserta/periode");
    await locker.query("BEGIN"); await locker.query("SELECT participant_identity_id FROM participant_passwords WHERE participant_identity_id=$1 FOR UPDATE", [f.identityA]);
    await page.goto("/peserta/login"); await page.getByLabel("Username peserta").fill(f.username); await page.getByLabel("Kata sandi", { exact: true }).fill(f.passwordA);
    const loginPost = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/peserta/login");
    pending.push(loginPost.then((response) => response.finished()));
    pending.push(page.getByRole("button", { name: "Masuk sebagai peserta" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_passwords%' AND query LIKE '%FOR SHARE%'`)).rows[0].n), { timeout: 10_000 }).toBeGreaterThan(0);
    await admin.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
    const dialog = admin.getByRole("dialog", { name: "Aktifkan periode login?" });
    const adminPost = admin.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-peserta/periode");
    pending.push(adminPost.then((response) => response.finished()));
    pending.push(dialog.getByRole("button", { name: "Ya, aktifkan login" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_login_settings%' AND query LIKE '%FOR UPDATE%'`)).rows[0].n), { timeout: 10_000 }).toBeGreaterThan(0);
    await locker.query("COMMIT");
    await Promise.all(pending); await expect(dialog).toBeHidden();
    expect((await client.query<{ period: string }>("SELECT period_id::text AS period FROM participant_login_settings WHERE id=1")).rows[0].period).toBe(f.periodB);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(0);
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
    await loginParticipant(page, f.username, f.passwordB);
  } finally {
    await locker.query("ROLLBACK").catch(() => {}); await Promise.allSettled(pending); await locker.end();
    await adminContext.close(); await cleanupLoginFixture(client, f); await client.end();
  }
});

test("kegagalan mengakhiri sesi membatalkan perubahan periode secara atomik", async ({ page, browser }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const trigger = `e2e_period_${f.suffix}`; const fn = `${trigger}_fn`;
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await loginParticipant(page, f.username, f.passwordA); await loginAsAdmin(admin); await admin.goto("/data-peserta/periode");
    await client.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.participant_identity_id = ${f.identityA} THEN RAISE EXCEPTION 'synthetic period switch failure'; END IF; RETURN OLD; END $$`);
    await client.query(`CREATE TRIGGER ${trigger} BEFORE DELETE ON participant_sessions FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    await admin.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
    const dialog = admin.getByRole("dialog", { name: "Aktifkan periode login?" });
    await dialog.getByRole("button", { name: "Ya, aktifkan login" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "belum dapat dipastikan" })).toBeVisible();
    expect((await client.query<{ period: string }>("SELECT period_id::text AS period FROM participant_login_settings WHERE id=1")).rows[0].period).toBe(f.periodA);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(1);
    await page.reload(); await expect(page.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON participant_sessions`); await client.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    await adminContext.close(); await cleanupLoginFixture(client, f); await client.end();
  }
});

test("sandi lama tetap bisa masuk dan ditampilkan, lalu reset hanya menerima format baru", async ({ page, browser }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const legacy = "  Sandi Lama Fiktif 2026  ";
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=$1", [f.identityA]);
    await insertLegacyPassword(client, f.identityA, f.periodA, legacy);
    await loginParticipant(page, f.username, legacy);
    await loginAsAdmin(admin); await admin.goto(`/data-peserta/sandi?periode=${f.periodA}`);
    const row = admin.getByRole("list", { name: "Daftar sandi peserta" }).getByRole("listitem").filter({ hasText: f.studentAName });
    await row.getByRole("button", { name: /^Lihat sandi / }).click();
    const reveal = admin.getByRole("dialog", { name: "Lihat sandi peserta" });
    await reveal.getByRole("button", { name: "Tampilkan sandi" }).click();
    expect(await reveal.locator("output").textContent()).toBe(legacy);
    await reveal.getByRole("button", { name: "Tutup" }).click();
    await row.getByRole("button", { name: /^Reset sandi / }).click();
    const reset = admin.getByRole("dialog", { name: "Reset sandi peserta" });
    await reset.getByRole("radio", { name: /Manual/ }).check();
    await reset.getByLabel("Sandi baru", { exact: true }).fill("RESETTES"); await reset.getByLabel("Ulangi sandi baru").fill("RESETTES");
    await reset.getByRole("button", { name: "Ya, reset sandi" }).click(); await expect(reset).toBeHidden();
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
    await openParticipantLogin(page, f.username, legacy); await expect(loginError(page)).toBeVisible();
    await loginParticipant(page, f.username, "RESETTES");
  } finally { await adminContext.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

test("periode aktif dan sesi tidak berubah jika sesi admin kedaluwarsa saat menunggu transaksi", async ({ page, browser }) => {
  test.setTimeout(50_000);
  const client = loginTestDatabase(); const locker = loginTestDatabase(); await client.connect(); await locker.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const pending: Promise<unknown>[] = [];
  try {
    await loginParticipant(page, f.username, f.passwordA); await loginAsAdmin(admin); await admin.goto("/data-peserta/periode");
    await admin.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
    const dialog = admin.getByRole("dialog", { name: "Aktifkan periode login?" });
    const cookie = (await adminContext.cookies()).find((item) => item.name === "nusacbt_admin_session");
    if (!cookie) throw new Error("Cookie admin uji tidak ada.");
    const digest = createHash("sha256").update(cookie.value).digest("hex");
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp() + interval '8 seconds' WHERE token_hash=$1", [digest]);
    await locker.query("BEGIN"); await locker.query("SELECT id FROM participant_login_settings WHERE id=1 FOR UPDATE");
    const response = admin.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/periode");
    pending.push(response.then((item) => item.finished())); pending.push(dialog.getByRole("button", { name: "Ya, aktifkan login" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_login_settings%' AND query LIKE '%FOR UPDATE%'`)).rows[0].n), { timeout: 6_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at <= clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0]?.expired, { timeout: 12_000 }).toBe(true);
    await locker.query("COMMIT"); await Promise.all(pending);
    await expect(dialog.getByRole("alert").filter({ hasText: "Sesi admin sudah berakhir" })).toBeVisible();
    expect((await client.query<{ period: string }>("SELECT period_id::text AS period FROM participant_login_settings WHERE id=1")).rows[0].period).toBe(f.periodA);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(1);
    await page.reload(); await expect(page.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
  } finally {
    await locker.query("ROLLBACK").catch(() => {}); await Promise.allSettled(pending); await locker.end();
    await adminContext.close(); await cleanupLoginFixture(client, f); await client.end();
  }
});

test("database membatasi pengaturan menjadi satu baris dan melindungi periode yang aktif", async () => {
  const client = loginTestDatabase(); await client.connect();
  try {
    await client.query("BEGIN");
    const period = (await client.query<{ id: string }>("INSERT INTO exam_periods(name,start_date) VALUES('Periode batas uji',DATE '2026-01-01') RETURNING id::text AS id")).rows[0].id;
    await client.query("UPDATE participant_login_settings SET period_id=$1 WHERE id=1", [period]);
    for (const [sql, args, codes] of [
      ["INSERT INTO participant_login_settings(id) VALUES(2)", [], ["23514"]],
      ["INSERT INTO participant_login_settings(id) VALUES(1)", [], ["23505"]],
      ["UPDATE participant_login_settings SET period_id=9223372036854775807 WHERE id=1", [], ["23503"]],
      ["DELETE FROM exam_periods WHERE id=$1", [period], ["23503", "23001"]],
    ] as Array<[string, string[], string[]]>) {
      await client.query("SAVEPOINT check_setting");
      try { await expect(client.query(sql, args)).rejects.toMatchObject({ code: expect.stringMatching(new RegExp(`^(${codes.join("|")})$`)) }); }
      finally { await client.query("ROLLBACK TO SAVEPOINT check_setting"); }
    }
    expect((await client.query<{ period: string }>("SELECT period_id::text AS period FROM participant_login_settings WHERE id=1")).rows[0].period).toBe(period);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});

test.describe("pengaturan periode login di layar kecil", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test("daftar dan konfirmasi tetap dapat digunakan dalam mode gelap", async ({ page }) => {
    const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
    const f = await seedLoginFixture(client);
    try {
      await loginAsAdmin(page); await page.getByRole("button", { name: "Ganti tema" }).click();
      await page.goto("/data-peserta/periode"); await expect(page.locator("html")).toHaveClass(/dark/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await page.setViewportSize({ width: 320, height: 320 });
      await page.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
      const dialog = page.getByRole("dialog", { name: "Aktifkan periode login?" });
      const box = await dialog.boundingBox(); if (!box) throw new Error("Dialog tidak terlihat.");
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      const confirm = dialog.getByRole("button", { name: "Ya, aktifkan login" });
      await confirm.scrollIntoViewIfNeeded(); await expect(confirm).toBeInViewport(); await confirm.click();
      await expect(dialog).toBeHidden();
    } finally { await cleanupLoginFixture(client, f); await client.end(); }
  });
});

test("login yang menunggu penggantian memakai periode baru, bukan nilai sebelum transaksi", async ({ page, browser }) => {
  test.setTimeout(70_000);
  const client = loginTestDatabase(); const locker = loginTestDatabase(); await client.connect(); await locker.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const entrantContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const entrant = await entrantContext.newPage();
  const pending: Promise<unknown>[] = [];
  try {
    await loginParticipant(page, f.username, f.passwordA); await loginAsAdmin(admin); await admin.goto("/data-peserta/periode");
    await locker.query("BEGIN"); await locker.query("SELECT token_hash FROM participant_sessions WHERE participant_identity_id=$1 FOR UPDATE", [f.identityA]);
    await admin.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
    const dialog = admin.getByRole("dialog", { name: "Aktifkan periode login?" });
    const adminPost = admin.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-peserta/periode");
    pending.push(adminPost.then((response) => response.finished())); pending.push(dialog.getByRole("button", { name: "Ya, aktifkan login" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'DELETE FROM participant_sessions%'`)).rows[0].n), { timeout: 10_000 }).toBeGreaterThan(0);
    await entrant.goto("/peserta/login"); await entrant.getByLabel("Username peserta").fill(f.username); await entrant.getByLabel("Kata sandi", { exact: true }).fill(f.passwordA);
    const loginPost = entrant.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/peserta/login");
    pending.push(loginPost.then((response) => response.finished())); pending.push(entrant.getByRole("button", { name: "Masuk sebagai peserta" }).click());
    await expect.poll(async () => Number((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_login_settings%' AND query LIKE '%FOR SHARE%'`)).rows[0].n), { timeout: 10_000 }).toBeGreaterThan(0);
    await locker.query("COMMIT"); await Promise.all(pending); await expect(dialog).toBeHidden();
    await expect(loginError(entrant)).toBeVisible();
    expect((await client.query<{ period: string }>("SELECT period_id::text AS period FROM participant_login_settings WHERE id=1")).rows[0].period).toBe(f.periodB);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=ANY($1::bigint[])", [[f.identityA, f.identityB]])).rowCount).toBe(0);
    await loginParticipant(entrant, f.username, f.passwordB);
  } finally {
    await locker.query("ROLLBACK").catch(() => {}); await Promise.allSettled(pending); await locker.end();
    await entrantContext.close(); await adminContext.close(); await cleanupLoginFixture(client, f); await client.end();
  }
});

test("pengaturan yang hilang menutup akses dan meminta pemeriksaan database", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await loginParticipant(page, f.username, f.passwordA);
    await client.query("DELETE FROM participant_login_settings WHERE id=1");
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
    await expect(page.getByRole("alert").filter({ hasText: "Server belum dapat memuat data" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk sebagai peserta" })).toBeDisabled();
  } finally {
    await client.query("DELETE FROM participant_sessions WHERE participant_identity_id=ANY($1::bigint[])", [[f.identityA, f.identityB]]);
    await client.query("INSERT INTO participant_login_settings(id,period_id) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET period_id=EXCLUDED.period_id", [f.periodA]);
    await cleanupLoginFixture(client, f); await client.end();
  }
});

test("perubahan data periode tujuan menolak dialog aktivasi yang usang", async ({ page, browser }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await loginParticipant(page, f.username, f.passwordA); await loginAsAdmin(admin); await admin.goto("/data-peserta/periode");
    await admin.getByRole("button", { name: `Aktifkan login ${f.periodBName}` }).click();
    const dialog = admin.getByRole("dialog", { name: "Aktifkan periode login?" });
    await client.query("UPDATE exam_periods SET name=name || ' revisi' WHERE id=$1", [f.periodB]);
    await dialog.getByRole("button", { name: "Ya, aktifkan login" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Data periode tujuan sudah berubah" })).toBeVisible();
    expect((await client.query<{ period: string }>("SELECT period_id::text AS period FROM participant_login_settings WHERE id=1")).rows[0].period).toBe(f.periodA);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(1);
    await page.reload(); await expect(page.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
  } finally { await adminContext.close(); await cleanupLoginFixture(client, f); await client.end(); }
});
