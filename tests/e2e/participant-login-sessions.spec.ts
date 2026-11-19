import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginParticipant, loginTestDatabase, openParticipantLogin, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test("login baru mengganti sesi lama tanpa memengaruhi admin atau sesi periode lain", async ({ browser, page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const second = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  const third = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  const newer = await second.newPage(); const otherPeriod = await third.newPage();
  try {
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    const firstCookie = (await page.context().cookies()).find((c) => c.name === "nusacbt_participant_session")!;
    await loginParticipant(otherPeriod, f.periodB, f.username, f.passwordB);
    await expect(otherPeriod.getByRole("heading", { name: `Halo, ${f.studentBName}!` })).toBeVisible();
    await loginParticipant(newer, f.periodA, f.username, f.passwordA);
    const secondCookie = (await newer.context().cookies()).find((c) => c.name === "nusacbt_participant_session")!;
    expect(firstCookie.value).not.toEqual(secondCookie.value);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(1);
    const stale = await page.request.get("/peserta", { maxRedirects: 0 });
    expect(stale.status()).toBeGreaterThanOrEqual(300); expect(stale.status()).toBeLessThan(400);
    expect((await stale.text())).not.toContain(f.studentAName);
    // Logout dengan token lama tidak menghapus sesi baru.
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/peserta\/login$/);
    await newer.reload(); await expect(newer.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
    await otherPeriod.reload(); await expect(otherPeriod.getByRole("heading", { name: `Halo, ${f.studentBName}!` })).toBeVisible();

    // Cookie admin dan peserta dapat hidup berdampingan, tetapi tidak saling memberi hak akses.
    await loginAsAdmin(newer); await newer.goto("/peserta");
    await expect(newer.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
    await newer.getByRole("button", { name: "Keluar" }).click(); await expect(newer).toHaveURL(/\/peserta\/login$/);
    await newer.goto("/"); await expect(newer.getByRole("heading", { name: /Selamat datang di NusaCBT/ })).toBeVisible();
  } finally { await second.close(); await third.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

test("pergantian penempatan, identitas, dan masa sesi membatalkan token lama tanpa menghidupkannya lagi", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    await client.query("UPDATE student_class_placements SET ended_at=clock_timestamp() WHERE id=$1", [f.placementA]);
    await page.reload(); await expect(page).toHaveURL(/sesi=berakhir/);
    await openParticipantLogin(page, f.periodA, f.username, f.passwordA);
    await expect(page.getByRole("alert").filter({ hasText: "Periode, username, atau kata sandi" })).toBeVisible();
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)", [f.studentA, f.periodA, f.classId, `X ${f.majorName}`]);
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    await client.query("UPDATE participant_identities SET username=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=$1", [f.identityA, `${f.username}x`]);
    await page.reload(); await expect(page).toHaveURL(/sesi=berakhir/);
    await client.query("UPDATE participant_identities SET username=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=$1", [f.identityA, f.username]);
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    await client.query("UPDATE participant_sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second' WHERE participant_identity_id=$1", [f.identityA]);
    await page.reload(); await expect(page).toHaveURL(/sesi=berakhir/);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("reset sandi dari admin mengakhiri sesi peserta dan hanya sandi baru yang diterima", async ({ browser, page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const replacement = `Sandi-Reset-${f.suffix}-Fiktif!`;
  try {
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    await loginAsAdmin(admin);
    await admin.goto(`/data-peserta/sandi?periode=${f.periodA}`);
    const row = admin.getByRole("list", { name: "Daftar sandi peserta" }).getByRole("listitem").filter({ hasText: f.studentAName });
    await row.getByRole("button", { name: /^Reset sandi / }).click();
    const dialog = admin.getByRole("dialog", { name: "Reset sandi peserta" });
    await dialog.getByRole("radio", { name: /Manual/ }).check();
    await dialog.getByLabel("Sandi baru", { exact: true }).fill(replacement);
    await dialog.getByLabel("Ulangi sandi baru").fill(replacement);
    await dialog.getByRole("button", { name: "Ya, reset sandi", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await client.query("SELECT event FROM participant_password_audit WHERE participant_identity_id=$1", [f.identityA])).rows.map((x) => x.event)).toContain("reset_manual");
    await page.reload(); await expect(page).toHaveURL(/sesi=berakhir/);
    await openParticipantLogin(page, f.periodA, f.username, f.passwordA);
    await expect(page.getByRole("alert").filter({ hasText: "Periode, username, atau kata sandi" })).toContainText("tidak cocok");
    await loginParticipant(page, f.periodA, f.username, replacement);
  } finally { await adminContext.close(); await cleanupLoginFixture(client, f); await client.end(); }
});
