import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

async function expectExamNavigation(page: Page, title: string) {
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(title);
  await expect(breadcrumb.getByRole("link", { name: "Daftar Tes" })).toHaveAttribute("href", "/data-tes/daftar");
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar.getByRole("button", { name: "Data Tes", exact: true })).toHaveAttribute("data-active", "true");
  const parent = sidebar.getByRole("link", { name: "Daftar Tes", exact: true });
  await expect(parent).toHaveAttribute("data-active", "true");
  await expect(parent).toHaveAttribute("aria-current", "location");
}

test("tooltip, breadcrumb, dan sidebar mengenali kelompok serta pelaksanaan", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await loginAsAdmin(page);
    await page.goto("/data-tes/daftar");
    const groupLink = page.getByRole("link", { name: "Atur kelompok sesi" });
    await groupLink.focus();
    await expect(page.locator('[data-slot="tooltip-content"]').filter({ hasText: "Bagi siswa ke kelompok tetap per periode" })).toBeVisible();
    await expect(groupLink).toHaveAttribute("aria-describedby", /.+/);
    await groupLink.click();
    await expect(page).toHaveURL(/\/data-tes\/daftar\/sesi$/);
    await expectExamNavigation(page, "Kelompok Sesi");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Data Tes");

    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Daftar Tes" }).click();
    await page.getByLabel("Cari tes").fill(f.activeName);
    const runLink = page.getByRole("link", { name: `Pelaksanaan tes ${f.activeTest}` });
    await runLink.focus();
    await expect(page.locator('[data-slot="tooltip-content"]').filter({ hasText: "Atur jadwal, peserta, dan rilis tes ini" })).toBeVisible();
    await expect(runLink).toHaveAttribute("aria-describedby", /.+/);
    await runLink.click();
    await expect(page).toHaveURL(new RegExp(`/data-tes/daftar/${f.activeTest}$`));
    await expectExamNavigation(page, "Pelaksanaan Tes");

    // Rute dengan ID tidak valid tetap menjelaskan lokasi dan tidak menampilkan Dashboard.
    await page.goto("/data-tes/daftar/bukan-id");
    await expect(page.getByRole("alert").filter({ hasText: "Pelaksanaan belum dapat dimuat" })).toContainText("Identitas tes tidak valid");
    await expectExamNavigation(page, "Pelaksanaan Tes");

    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText("Kelompok Sesi");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: "Buka atau tutup sidebar" }).click();
    const mobile = page.getByRole("dialog", { name: "Sidebar" });
    await expect(mobile.getByRole("button", { name: "Data Tes", exact: true })).toHaveAttribute("data-active", "true");
    await expect(mobile.getByRole("link", { name: "Daftar Tes", exact: true })).toHaveAttribute("aria-current", "location");
    await mobile.getByRole("link", { name: "Daftar Tes", exact: true }).click();
    await expect(mobile).toBeHidden();
    await expect(page).toHaveURL(/\/data-tes\/daftar$/);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("badge draf dan dirilis berbeda, menghormati reduced motion, dan mengikuti perubahan rilis", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const label = `Draf UI ${f.suffix}`;
  try {
    const admin = (await client.query<{ id: string }>("SELECT id::text AS id FROM admin_users WHERE username=$1", [process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    const run = (await client.query<{ id: string }>(
      `INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by)
       VALUES($1,$2,'makeup',$3,'2044-01-01 00:00:00+00','WIB',90,$4) RETURNING id::text AS id`,
      [f.activeTest, f.periodA, label, admin],
    )).rows[0].id;
    await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,$3,'makeup',$4,$5)", [run, f.activeTest, f.periodA, f.studentA, f.placementA]);
    await loginAsAdmin(page); await page.goto(`/data-tes/daftar/${f.activeTest}`);
    const list = page.getByRole("list", { name: "Daftar pelaksanaan tes" });
    const draftRow = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `Susulan · ${label}` }) });
    const publishedRow = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Susulan · Jadwal fiktif" }) });
    const draft = draftRow.locator('[data-status="draft"]');
    const published = publishedRow.locator('[data-status="published"]');
    await expect(draft).toHaveText("Draf"); await expect(published).toHaveText("Dirilis");
    expect(await draft.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(await published.evaluate((el) => getComputedStyle(el).backgroundColor));
    const ping = draft.locator('[aria-hidden="true"] > span').first();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(ping).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(ping).toHaveCSS("animation-name", "ping");
    await expect(ping).toHaveCSS("animation-iteration-count", "3");
    await page.getByRole("button", { name: "Ganti tema" }).click();
    await page.getByRole("menuitem", { name: "Gelap" }).click();
    expect(await draft.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(await published.evaluate((el) => getComputedStyle(el).backgroundColor));

    await draftRow.getByRole("button", { name: `Rilis ${label}` }).click();
    const publish = page.getByRole("dialog", { name: "Rilis jadwal pelaksanaan?" });
    await publish.getByRole("button", { name: "Ya, rilis jadwal" }).click(); await expect(publish).toBeHidden();
    await expect(draftRow.locator('[data-status="published"]')).toHaveText("Dirilis");
    await draftRow.getByRole("button", { name: `Tarik rilis ${label}` }).click();
    const unpublish = page.getByRole("dialog", { name: "Tarik rilis jadwal?" });
    await unpublish.getByRole("button", { name: "Ya, tarik rilis" }).click(); await expect(unpublish).toBeHidden();
    await expect(draftRow.locator('[data-status="draft"]')).toHaveText("Draf");
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
