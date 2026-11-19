import { expect, test } from "@playwright/test";

import { encryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { hashParticipantPassword } from "../../src/lib/password.mjs";
import { cleanupLoginFixture, loginParticipant, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test("dua login bersamaan tetap hanya menghasilkan satu sesi sah", async ({ browser }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const first = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const second = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  const one = await first.newPage(); const two = await second.newPage();
  let pending: Promise<unknown>[] = [];
  try {
    for (const page of [one, two]) {
      await page.goto("/peserta/login"); await page.getByLabel("Periode ujian").selectOption(f.periodA);
      await page.getByLabel("Username peserta").fill(f.username); await page.getByLabel("Kata sandi", { exact: true }).fill(f.passwordA);
    }
    const postOne = one.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/peserta/login");
    const postTwo = two.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/peserta/login");
    pending = [postOne.then((r) => r.finished()), postTwo.then((r) => r.finished())];
    await Promise.all([one.getByRole("button", { name: "Masuk sebagai peserta" }).click(), two.getByRole("button", { name: "Masuk sebagai peserta" }).click()]);
    await Promise.all(pending);
    const responses = await Promise.all([one.request.get("/peserta", { maxRedirects: 0 }), two.request.get("/peserta", { maxRedirects: 0 })]);
    expect(responses.map((r) => r.status()).filter((status) => status === 200)).toHaveLength(1);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(1);
  } finally { await Promise.allSettled(pending); await first.close(); await second.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

test("reset sandi yang sedang bertransaksi tidak menghasilkan sesi dari sandi lama", async ({ page }) => {
  test.setTimeout(40_000);
  const client = loginTestDatabase(); const locker = loginTestDatabase(); await client.connect(); await locker.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const replacement = `Sandi-Baru-${f.suffix}-Fiktif!`;
  const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
  let committed = false;
  try {
    const hash = await hashParticipantPassword(replacement);
    const encrypted = encryptParticipantPassword(replacement, key, { identityId: f.identityA, periodId: f.periodA });
    await locker.query("BEGIN");
    await locker.query(`UPDATE participant_passwords SET password_hash=$2,nonce=$3,ciphertext=$4,authentication_tag=$5,
      updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE participant_identity_id=$1`,
    [f.identityA, hash, encrypted.nonce, encrypted.ciphertext, encrypted.authenticationTag]);
    await page.goto("/peserta/login"); await page.getByLabel("Periode ujian").selectOption(f.periodA);
    await page.getByLabel("Username peserta").fill(f.username); await page.getByLabel("Kata sandi", { exact: true }).fill(f.passwordA);
    const post = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/peserta/login");
    const submit = page.getByRole("button", { name: "Masuk sebagai peserta" }).click(); await post;
    await expect.poll(async () => Number((await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
       AND query LIKE '%participant_passwords%' AND query LIKE '%FOR SHARE%'`,
    )).rows[0].n), { timeout: 7000 }).toBeGreaterThan(0);
    await locker.query("COMMIT"); committed = true; await submit;
    await expect(page.getByRole("alert").filter({ hasText: "Periode, username, atau kata sandi" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(0);
    await loginParticipant(page, f.periodA, f.username, replacement);
  } finally {
    key.fill(0); if (!committed) await locker.query("ROLLBACK").catch(() => {});
    await locker.end(); await cleanupLoginFixture(client, f); await client.end();
  }
});

test("kembali setelah keluar tidak membuka lagi halaman yang dilindungi", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    await page.goto("/peserta?halaman=1"); await expect(page.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
    await page.getByRole("button", { name: "Keluar" }).click(); await expect(page).toHaveURL(/\/peserta\/login$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/peserta\/login\?sesi=berakhir$/);
    await expect(page.getByText(f.studentAName, { exact: true })).toHaveCount(0);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
