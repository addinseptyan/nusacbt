import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, seedLoginFixture } from "./participant-login-helpers";

const baseURL = "http://127.0.0.1:3100";
const endpoint = "/data-peserta/kartu/siapkan";
const headers = { Origin: baseURL, "Content-Type": "application/json", "X-NusaCBT-Cards": "1" };
test.use({ actionTimeout: 15_000 });

type Payload = { mode: "prepare" | "verify"; filters: string; candidates: Array<{ identityId: string; studentId: string; token: string }>; includePassword: boolean };

async function capturePayload(page: import("@playwright/test").Page, periodId: string, studentName: string) {
  const params = new URLSearchParams({ periode: periodId });
  await page.goto(`/data-peserta/kartu?${params}`);
  await page.getByRole("checkbox", { name: new RegExp(`^Pilih ${studentName} NISN`) }).check();
  const waiting = page.waitForResponse((response) => response.url().includes(endpoint) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Pratinjau kartu" }).click();
  const response = await waiting; expect(response.status()).toBe(200);
  await expect(page.getByRole("dialog", { name: /Pratinjau/ })).toBeVisible();
  const payload = response.request().postDataJSON() as Payload;
  await page.getByRole("dialog", { name: /Pratinjau/ }).getByRole("button", { name: "Tutup" }).click();
  return payload;
}
async function count(client: import("pg").Client, id: string) {
  return (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM participant_password_audit WHERE participant_identity_id=$1 AND event='reveal'", [id])).rows[0].n;
}

test("pratinjau bersandi tidak dicetak bila sandi berubah sebelum pemeriksaan ulang", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); const f = await seedLoginFixture(client);
  try {
    await loginAsAdmin(page); await page.goto(`/data-peserta/kartu?periode=${f.periodA}`);
    await page.getByRole("checkbox", { name: new RegExp(`^Pilih ${f.studentAName} NISN`) }).check();
    await page.getByRole("checkbox", { name: /Sertakan sandi pada kartu/ }).check();
    await page.getByRole("button", { name: "Pratinjau kartu" }).click();
    await page.getByRole("dialog", { name: "Tampilkan sandi pada kartu?" }).getByRole("button", { name: "Ya, tampilkan sandi" }).click();
    const preview = page.getByRole("dialog", { name: /Pratinjau/ }); await expect(preview).toContainText(f.passwordA);
    expect(await count(client, f.identityA)).toBe(1);
    // xmin berubah meskipun updated_at sengaja dipertahankan.
    await client.query("UPDATE participant_passwords SET ciphertext=ciphertext WHERE participant_identity_id=$1", [f.identityA]);
    await page.evaluate(() => { window.print = () => { document.documentElement.setAttribute("data-print-called", "yes"); }; });
    const responsePromise = page.waitForResponse((response) => response.url().includes(endpoint) && response.request().postDataJSON()?.mode === "verify");
    await preview.getByRole("button", { name: "Cetak / Simpan PDF" }).click();
    const response = await responsePromise; expect(response.status()).toBe(409); expect(await response.text()).not.toContain(f.passwordA);
    await expect(preview).toBeHidden(); await expect(page.getByRole("alert").filter({ hasText: "berubah" })).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-print-called", "yes");
    await expect(page.locator("[data-participant-card-secret]")).toHaveCount(0);
    expect(await count(client, f.identityA)).toBe(1);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("periode login berubah ketika permintaan menunggu lock: sandi dan audit tidak dikirim", async ({ page }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); const blocker = loginTestDatabase(); await client.connect(); await blocker.connect();
  const f = await seedLoginFixture(client);
  try {
    await loginAsAdmin(page); const payload = await capturePayload(page, f.periodA, f.studentAName);
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM participant_login_settings WHERE id=1 FOR UPDATE");
    const pending = page.request.post(endpoint, { headers, data: { ...payload, includePassword: true }, timeout: 30_000 });
    await expect.poll(async () => (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM participant_login_settings WHERE id=1 FOR SHARE%'`)).rows[0].n,
      { timeout: 12_000 }).toBeGreaterThan(0);
    await blocker.query("UPDATE participant_login_settings SET period_id=$1 WHERE id=1", [f.periodB]);
    await blocker.query("COMMIT");
    const response = await pending; expect(response.status()).toBe(409);
    expect(await response.text()).not.toContain(f.passwordA); expect(await count(client, f.identityA)).toBe(0);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await cleanupLoginFixture(client, f); await blocker.end(); await client.end(); }
});

test("kegagalan audit atau integritas ciphertext membatalkan seluruh pengungkapan", async ({ page }) => {
  test.setTimeout(70_000);
  const client = loginTestDatabase(); await client.connect(); const f = await seedLoginFixture(client);
  const functionName = `card_audit_fail_${f.suffix}`; const triggerName = `card_audit_trigger_${f.suffix}`;
  try {
    await loginAsAdmin(page); let payload = await capturePayload(page, f.periodA, f.studentAName);
    await client.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.participant_identity_id=${f.identityA}::bigint AND NEW.event='reveal' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON participant_password_audit FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    const failedAudit = await page.request.post(endpoint, { headers, data: { ...payload, includePassword: true } });
    expect(failedAudit.status()).toBe(503); expect(await failedAudit.text()).not.toContain(f.passwordA); expect(await count(client, f.identityA)).toBe(0);
    await client.query(`DROP TRIGGER ${triggerName} ON participant_password_audit`); await client.query(`DROP FUNCTION ${functionName}()`);
    await client.query("UPDATE participant_passwords SET authentication_tag=decode(repeat('00',16),'hex') WHERE participant_identity_id=$1", [f.identityA]);
    payload = await capturePayload(page, f.periodA, f.studentAName);
    const failedDecrypt = await page.request.post(endpoint, { headers, data: { ...payload, includePassword: true } });
    expect(failedDecrypt.status()).toBe(409); expect(await failedDecrypt.text()).toContain("integritas data");
    expect(await failedDecrypt.text()).not.toContain(f.passwordA); expect(await count(client, f.identityA)).toBe(0);
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON participant_password_audit`).catch(() => {});
    await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => {});
    await cleanupLoginFixture(client, f); await client.end();
  }
});

test("sesi admin yang habis saat menunggu lock tidak menerima sandi dan tidak meninggalkan audit", async ({ page }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); const blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); const f = await seedLoginFixture(client);
  try {
    await loginAsAdmin(page); const payload = await capturePayload(page, f.periodA, f.studentAName);
    const token = (await page.context().cookies()).find((cookie) => cookie.name === "nusacbt_admin_session")?.value;
    if (!token) throw new Error("Sesi fixture tidak ditemukan.");
    const digest = createHash("sha256").update(token).digest("hex");
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '5 seconds' WHERE token_hash=$1", [digest]);
    await blocker.query("BEGIN"); await blocker.query("SELECT token_hash FROM admin_sessions WHERE token_hash=$1 FOR UPDATE", [digest]);
    const pending = page.request.post(endpoint, { headers, data: { ...payload, includePassword: true }, timeout: 30_000 });
    await expect.poll(async () => (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE OF s, a%'`)).rows[0].n,
      { timeout: 12_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0].expired,
      { timeout: 15_000 }).toBe(true);
    await blocker.query("COMMIT");
    const response = await pending; expect(response.status()).toBe(401); expect(await response.text()).not.toContain(f.passwordA);
    expect(await count(client, f.identityA)).toBe(0);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await cleanupLoginFixture(client, f); await blocker.end(); await client.end(); }
});

test("respons sandi terlambat tidak muncul lagi setelah tab disembunyikan", async ({ page }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); await client.connect(); const f = await seedLoginFixture(client);
  let release: (() => void) | undefined;
  try {
    await loginAsAdmin(page); await page.goto(`/data-peserta/kartu?periode=${f.periodA}`);
    await page.getByRole("checkbox", { name: new RegExp(`^Pilih ${f.studentAName} NISN`) }).check();
    await page.getByRole("checkbox", { name: /Sertakan sandi pada kartu/ }).check();
    await page.getByRole("button", { name: "Pratinjau kartu" }).click();
    let arrived: (() => void) | undefined;
    const responseArrived = new Promise<void>((resolve) => { arrived = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**${endpoint}`, async (route) => {
      const response = await route.fetch(); arrived?.(); await gate;
      await route.fulfill({ response }).catch(() => {}); // Browser mungkin sudah membatalkan fetch.
    });
    await page.getByRole("dialog", { name: "Tampilkan sandi pada kartu?" }).getByRole("button", { name: "Ya, tampilkan sandi" }).click();
    await responseArrived; expect(await count(client, f.identityA)).toBe(1); // Server sudah commit audit.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    });
    release?.();
    await expect(page.getByText("Pratinjau ditutup saat halaman disembunyikan")).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Pratinjau/ })).toHaveCount(0);
    await expect(page.locator("[data-participant-card-secret]")).toHaveCount(0);
    expect(await page.content()).not.toContain(f.passwordA);
  } finally { release?.(); await page.unrouteAll({ behavior: "ignoreErrors" }); await cleanupLoginFixture(client, f); await client.end(); }
});

test("nama kelas atau identitas berubah setelah daftar dimuat menolak pengungkapan", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); const f = await seedLoginFixture(client);
  try {
    await loginAsAdmin(page); const payload = await capturePayload(page, f.periodA, f.studentAName);
    await client.query("UPDATE school_majors SET name=$2 WHERE id=$1", [f.majorId, `RUBAH-${f.suffix}`]);
    const changed = await page.request.post(endpoint, { headers, data: { ...payload, includePassword: true } });
    expect(changed.status()).toBe(409); expect(await changed.text()).not.toContain(f.passwordA);
    expect(await count(client, f.identityA)).toBe(0);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
