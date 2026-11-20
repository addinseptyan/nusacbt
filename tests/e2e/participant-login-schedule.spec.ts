import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { activateLoginPeriod, cleanupLoginFixture, loginParticipant, loginTestDatabase, openParticipantLogin, resetLoginGlobal, seedLoginFixture, seedPublishedSchedules } from "./participant-login-helpers";

test("jadwal dipaginasi di server dan zona ditampilkan tanpa soal atau tes periode lain", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    const added = await client.query<{ id: string }>(
      `INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
       SELECT $1::bigint,'Jadwal tambahan ' || g || ' ' || $2,clock_timestamp() + g * interval '1 hour','WIB',60 FROM generate_series(1,23) g RETURNING id::text AS id`,
      [f.periodA, f.suffix],
    );
    const witaExam = await client.query<{ id: string }>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2030-01-01 00:00:00+00','WITA',60) RETURNING id::text AS id", [f.periodA, `Zona WITA ${f.suffix}`]);
    await seedPublishedSchedules(client, [...added.rows.map((r) => r.id), witaExam.rows[0].id], f.studentA, f.placementA);
    await loginParticipant(page, f.username, f.passwordA);
    await expect(page.getByText("27 jadwal untukmu dalam periode ini")).toBeVisible();
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

test("username yang sama di dua periode memakai sandi dan jadwal periode yang diaktifkan admin", async ({ page, browser }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await loginAsAdmin(admin);
    await activateLoginPeriod(admin, f.periodBName);
    await openParticipantLogin(page, f.username, f.passwordA);
    await expect(page.getByRole("alert").filter({ hasText: "Username atau kata sandi" })).toBeVisible();
    await loginParticipant(page, f.username.toUpperCase(), f.passwordB);
    await expect(page.getByRole("heading", { name: `Halo, ${f.studentBName}!` })).toBeVisible();
    await expect(page.getByText(f.hiddenName, { exact: true })).toBeVisible();
    await expect(page.getByText(f.activeName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(f.studentAName, { exact: true })).toHaveCount(0);
  } finally { await adminContext.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

async function positionRefresh(page: Page): Promise<number> {
  const refresh = page.getByRole("link", { name: "Muat ulang", exact: true });
  await refresh.scrollIntoViewIfNeeded();
  await refresh.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(1, top - Math.min(150, window.innerHeight / 3)));
  });
  await expect(refresh).toBeInViewport();
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  return scroll;
}

for (const size of [{ name: "desktop", width: 1440, height: 650 }, { name: "ponsel", width: 390, height: 640 }]) {
  test(`muat ulang ${size.name} memperbarui jadwal tanpa kehilangan scroll dan halaman`, async ({ page, browser }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
    const f = await seedLoginFixture(client);
    try {
      const added = await client.query<{ id: string }>(
        `INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
         SELECT $1::bigint,'Jadwal scroll ' || g || ' ' || $2,clock_timestamp() + g * interval '1 hour','WIB',60
         FROM generate_series(1,23) g RETURNING id::text AS id`, [f.periodA, f.suffix],
      );
      await seedPublishedSchedules(client, added.rows.map((row) => row.id), f.studentA, f.placementA);
      await loginParticipant(page, f.username, f.passwordA);
      await expect(page.getByText("26 jadwal untukmu dalam periode ini")).toBeVisible();
      const refreshedName = `Jadwal terbarui ${f.suffix}`;
      await client.query("UPDATE exam_tests SET name=$1 WHERE id=$2", [refreshedName, f.activeTest]);
      const firstScroll = await positionRefresh(page); const firstUrl = page.url();
      await page.getByRole("link", { name: "Muat ulang", exact: true }).click();
      await expect(page.getByText(refreshedName, { exact: true })).toBeVisible();
      await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - firstScroll)).toBeLessThanOrEqual(2);
      expect(page.url()).toBe(firstUrl);

      await page.getByRole("link", { name: "Berikutnya" }).click();
      await expect(page.getByText("Halaman 2 dari 2")).toBeVisible();
      const secondName = `Jadwal halaman dua ${f.suffix}`;
      await client.query("UPDATE exam_tests SET name=$1 WHERE id=$2", [secondName, added.rows[22].id]);
      const secondScroll = await positionRefresh(page); const secondUrl = page.url();
      await page.getByRole("link", { name: "Muat ulang", exact: true }).click();
      await expect(page.getByText(secondName, { exact: true })).toBeVisible();
      await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - secondScroll)).toBeLessThanOrEqual(2);
      expect(page.url()).toBe(secondUrl);
      expect(await page.content()).not.toContain(f.questionSecret);

      // Tautan tetap menjadi fallback apabila JavaScript tidak tersedia.
      if (size.name === "ponsel") {
        const fallback = await browser.newContext({ baseURL: "http://127.0.0.1:3100", javaScriptEnabled: false });
        try {
          await fallback.addCookies(await page.context().cookies());
          const noJs = await fallback.newPage(); await noJs.goto("/peserta?halaman=2");
          await expect(noJs.getByRole("link", { name: "Muat ulang", exact: true })).toHaveAttribute("href", "/peserta?halaman=2");
          const fallbackName = `Jadwal fallback ${f.suffix}`;
          await client.query("UPDATE exam_tests SET name=$1 WHERE id=$2", [fallbackName, added.rows[22].id]);
          await noJs.getByRole("link", { name: "Muat ulang", exact: true }).click();
          await expect(noJs.getByText(fallbackName, { exact: true })).toBeVisible();
        } finally { await fallback.close(); }
      }
      await client.query("DELETE FROM participant_sessions WHERE participant_identity_id=$1::bigint", [f.identityA]);
      await page.getByRole("link", { name: "Muat ulang", exact: true }).click();
      await expect(page).toHaveURL(/\/peserta\/login\?sesi=berakhir/);
    } finally { await cleanupLoginFixture(client, f); await client.end(); }
  });
}

test("login dan jadwal responsif serta mode gelap tidak menampilkan navigasi admin", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await page.setViewportSize({ width: 320, height: 850 }); await page.goto("/peserta/login");
    const loginWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(loginWidth).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: "Ganti tema" }).click(); await page.getByRole("menuitem", { name: "Gelap" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await loginParticipant(page, f.username, f.passwordA);
    const mobileWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(mobileWidth).toBeLessThanOrEqual(320);
    await expect(page.getByRole("heading", { name: "Jadwal tes" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 }); await expect(page.getByRole("heading", { name: "Identitas peserta" })).toBeVisible();
    const desktopWidth = await page.evaluate(() => document.documentElement.scrollWidth); expect(desktopWidth).toBeLessThanOrEqual(1440);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
