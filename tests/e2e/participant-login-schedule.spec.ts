import { expect, test } from "@playwright/test";

import { cleanupLoginFixture, loginParticipant, loginTestDatabase, openParticipantLogin, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test("jadwal dipaginasi di server dan zona ditampilkan tanpa soal atau tes periode lain", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await client.query(
      `INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
       SELECT $1::bigint,'Jadwal tambahan ' || g || ' ' || $2,clock_timestamp() + g * interval '1 hour','WIB',60 FROM generate_series(1,23) g`,
      [f.periodA, f.suffix],
    );
    await client.query("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2030-01-01 00:00:00+00','WITA',60)", [f.periodA, `Zona WITA ${f.suffix}`]);
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    await expect(page.getByText("27 tes dalam periode ini")).toBeVisible();
    await expect(page.getByRole("list", { name: "Jadwal tes" }).getByRole("listitem")).toHaveCount(20);
    await expect(page.getByText("Halaman 1 dari 2")).toBeVisible();
    const first = page.getByRole("list", { name: "Jadwal tes" }).getByRole("listitem").first();
    await expect(first).toContainText(f.activeName); await expect(first).toContainText("Berlangsung");
    await page.getByRole("link", { name: "Berikutnya" }).click();
    await expect(page).toHaveURL(/halaman=2/); await expect(page.getByText("Halaman 2 dari 2")).toBeVisible();
    await expect(page.getByRole("list", { name: "Jadwal tes" }).getByRole("listitem")).toHaveCount(7);
    const wita = page.getByRole("listitem").filter({ hasText: `Zona WITA ${f.suffix}` });
    await expect(wita).toContainText("01/01/2030 08:00 WITA"); await expect(wita).toContainText("01/01/2030 09:00 WITA");
    await expect(page.getByText(f.pastName, { exact: true })).toBeVisible();
    await expect(page.getByText(f.hiddenName, { exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain(f.questionSecret);
    await page.goto(`/peserta?halaman=999999&periode=${f.periodB}`);
    await expect(page.getByText("Halaman 2 dari 2")).toBeVisible(); await expect(page.getByText(f.hiddenName, { exact: true })).toHaveCount(0);
    await page.goto("/peserta?halaman=0"); await expect(page.getByText("Halaman 1 dari 2")).toBeVisible();
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("username yang sama di dua periode memakai sandi dan jadwal masing-masing", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await openParticipantLogin(page, f.periodB, f.username, f.passwordA);
    await expect(page.getByRole("alert").filter({ hasText: "Periode, username, atau kata sandi" })).toBeVisible();
    await loginParticipant(page, f.periodB, f.username.toUpperCase(), f.passwordB);
    await expect(page.getByRole("heading", { name: `Halo, ${f.studentBName}!` })).toBeVisible();
    await expect(page.getByText(f.hiddenName, { exact: true })).toBeVisible();
    await expect(page.getByText(f.activeName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(f.studentAName, { exact: true })).toHaveCount(0);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("login dan jadwal responsif serta mode gelap tidak menampilkan navigasi admin", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await page.setViewportSize({ width: 320, height: 850 }); await page.goto("/peserta/login");
    const loginWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(loginWidth).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: "Ganti tema" }).click(); await page.getByRole("menuitem", { name: "Gelap" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    const mobileWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(mobileWidth).toBeLessThanOrEqual(320);
    await expect(page.getByRole("heading", { name: "Jadwal tes" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 }); await expect(page.getByRole("heading", { name: "Identitas peserta" })).toBeVisible();
    const desktopWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(desktopWidth).toBeLessThanOrEqual(1440);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
