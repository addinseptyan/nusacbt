import { expect, test } from "@playwright/test";

import { tokenCalendarDate, tokenDayBounds } from "../../src/lib/exam-token-date.mjs";
import { loginAsAdmin } from "./helpers";
import { suffix, testDatabase } from "./question-helpers";
import { cleanupTokens, confirmIssue, globalPanel, issueForm, openTokenHistory, showAllTokenDates, testPanel, tokenBaseline, visibleCode } from "./token-helpers";

test("filter tanggal berdasarkan zona dan irisan jadwal, termasuk tes sejak kemarin", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const period = (await client.query<{ id: string }>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2026-01-01') RETURNING id::text AS id", [`Filter Token ${tag}`])).rows[0].id; periods.push(period);
    const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
    const today = tokenCalendarDate(now, "WIB"); const todayStart = Date.parse(tokenDayBounds(today, "WIB").start);
    const selectedDate = tokenCalendarDate(new Date(todayStart + 3 * 86_400_000), "WIB");
    const selectedStart = Date.parse(tokenDayBounds(selectedDate, "WIB").start);
    async function insert(name: string, start: number, duration: number) {
      return (await client.query<{ id: string }>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,$3,'WIB',$4) RETURNING id::text AS id", [period, `${name} ${tag}`, new Date(start).toISOString(), duration])).rows[0].id;
    }
    const yesterday = await insert("Melintasi kemarin", todayStart - 60_000, 1500);
    const active = await insert("Sedang berlangsung", now.getTime() - 30 * 60_000, 90);
    const past = await insert("Sudah berakhir", todayStart - 86_400_000, 5);
    const tomorrow = await insert("Besok", todayStart + 86_400_000 + 3_600_000, 60);
    const early = await insert("Hanya WITA", selectedStart - 30 * 60_000, 10);
    const endAtStart = await insert("Tepat berakhir awal hari", selectedStart - 5 * 60_000, 5);
    const crossing = await insert("Melintasi awal hari", selectedStart - 15 * 60_000, 30);
    const startAtStart = await insert("Tepat mulai awal hari", selectedStart, 5);
    const late = await insert("Hanya WIB", selectedStart + 23 * 3_600_000 + 30 * 60_000, 10);
    const startAtEnd = await insert("Tepat mulai hari berikut", selectedStart + 86_400_000, 5);

    await loginAsAdmin(page); await page.goto("/data-tes/token");
    await expect(page.getByRole("link", { name: "Hari ini", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Zona waktu")).toHaveValue("WIB");
    await expect(testPanel(page, yesterday)).toContainText("Berlangsung (jadwal)");
    await expect(testPanel(page, active)).toContainText("Berlangsung (jadwal)");
    await expect(testPanel(page, past)).toHaveCount(0); await expect(testPanel(page, tomorrow)).toHaveCount(0);
    await confirmIssue(await issueForm(page, "global")); const globalCode = await visibleCode(page);
    await page.getByLabel("Pilih tanggal").fill(selectedDate); await page.getByRole("button", { name: "Tampilkan", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`tanggal=${selectedDate}`));
    for (const id of [crossing, startAtStart, late]) await expect(testPanel(page, id)).toBeVisible();
    for (const id of [early, endAtStart, startAtEnd, past]) await expect(testPanel(page, id)).toHaveCount(0);
    await confirmIssue(await issueForm(page, `tes ${startAtStart}`)); const specificCode = await visibleCode(page, `tes ${startAtStart}`);
    await expect(testPanel(page, late)).toContainText("Menggunakan token global");
    await page.getByLabel("Zona waktu").selectOption("WITA");
    await expect(page).toHaveURL(/zona=WITA/); await expect(page.getByLabel("Pilih tanggal")).toHaveValue(selectedDate);
    for (const id of [early, endAtStart, crossing, startAtStart]) await expect(testPanel(page, id)).toBeVisible();
    for (const id of [late, startAtEnd, past]) await expect(testPanel(page, id)).toHaveCount(0);
    expect(await visibleCode(page)).toBe(globalCode); expect(await visibleCode(page, `tes ${startAtStart}`)).toBe(specificCode);
    await openTokenHistory(page); await expect(page.getByLabel("Zona waktu")).toHaveValue("WITA");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Riwayat token");
    await expect(page.getByRole("link", { name: "Token", exact: true })).toHaveAttribute("aria-current", "location");
    await page.getByLabel("Zona waktu").selectOption("WIT"); await expect(page).toHaveURL(/zona=WIT/);
    await page.getByRole("link", { name: "Kembali ke Token" }).click(); await expect(page).toHaveURL(/zona=WIT/); await expect(page.getByLabel("Pilih tanggal")).toHaveValue(selectedDate);
    expect(await visibleCode(page, `tes ${startAtStart}`)).toBe(specificCode);
    await page.getByRole("link", { name: "Hari ini", exact: true }).click(); await expect(testPanel(page, startAtStart)).toHaveCount(0);
    const response = await page.goto("/data-tes/token"); await expect(testPanel(page, startAtStart)).toHaveCount(0);
    const html = await response!.text();
    expect(html).not.toContain(`>${specificCode}</span>`); expect(html).not.toContain(`\\"code\\":\\"${specificCode}\\"`);
    expect(await visibleCode(page)).toBe(globalCode);
    await showAllTokenDates(page);
    for (const id of [yesterday, active, tomorrow, early, endAtStart, crossing, startAtStart, late, startAtEnd]) await expect(testPanel(page, id)).toBeVisible();
    await expect(testPanel(page, past)).toHaveCount(0);
    await page.goto("/data-tes/token?tanggal=2026-02-30&zona=invalid");
    await expect(page.getByRole("link", { name: "Hari ini", exact: true })).toHaveAttribute("aria-current", "page"); await expect(page.getByLabel("Zona waktu")).toHaveValue("WIB");
    await page.goto(`/data-tes/token?tanggal=all&tanggal=${selectedDate}&zona=WITA&zona=WIT`);
    await expect(page.getByRole("link", { name: "Hari ini", exact: true })).toHaveAttribute("aria-current", "page"); await expect(page.getByLabel("Zona waktu")).toHaveValue("WIB");
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("daftar tes dipaginasi di server dan pilihan tanggal/zona bertahan setelah riwayat", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const period = (await client.query<{ id: string }>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2026-01-01') RETURNING id::text AS id", [`Paginasi Token ${tag}`])).rows[0].id; periods.push(period);
    const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
    const today = tokenCalendarDate(now, "WIB"); const todayStart = Date.parse(tokenDayBounds(today, "WIB").start);
    const chosen = tokenCalendarDate(new Date(todayStart + 2 * 86_400_000), "WIB"); const start = tokenDayBounds(chosen, "WIB").start;
    const rows = (await client.query<{ id: string }>(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
      SELECT $1,$2 || ' ' || lpad(g::text,2,'0'),$3::timestamptz+interval '1 hour'+g*interval '1 minute','WIB',60
      FROM generate_series(1,45) g RETURNING id::text AS id`, [period, `Tes paginasi ${tag}`, start])).rows;
    await loginAsAdmin(page); await page.goto(`/data-tes/token?tanggal=${chosen}`);
    await expect(page.getByText("45 tes", { exact: true })).toBeVisible(); await expect(page.getByText("Halaman 1 dari 3")).toBeVisible();
    await expect(page.getByRole("list", { name: "Tes berlangsung dan mendatang" }).locator(":scope > li")).toHaveCount(20);
    await expect(testPanel(page, rows[0].id)).toBeVisible(); await expect(testPanel(page, rows[20].id)).toHaveCount(0);
    await confirmIssue(await issueForm(page, "global")); const global = await visibleCode(page);
    await page.getByRole("link", { name: "Berikutnya" }).click(); await expect(page.getByText("Halaman 2 dari 3")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`tanggal=${chosen}.*halaman=2`)); await expect(testPanel(page, rows[20].id)).toBeVisible(); await expect(testPanel(page, rows[0].id)).toHaveCount(0);
    expect(await visibleCode(page)).toBe(global); await expect(globalPanel(page)).toContainText("Aktif");
    await openTokenHistory(page); await page.getByLabel("Zona waktu").selectOption("WITA"); await expect(page).toHaveURL(/zona=WITA/);
    await page.getByRole("link", { name: "Kembali ke Token" }).click(); await expect(page.getByText("Halaman 2 dari 3")).toBeVisible();
    await expect(page.getByLabel("Zona waktu")).toHaveValue("WITA"); await expect(page.getByLabel("Pilih tanggal")).toHaveValue(chosen);
    await page.getByRole("link", { name: "Berikutnya" }).click(); await expect(page.getByText("Halaman 3 dari 3")).toBeVisible();
    await expect(page.getByRole("list", { name: "Tes berlangsung dan mendatang" }).locator(":scope > li")).toHaveCount(5);
    await expect(testPanel(page, rows[44].id)).toBeVisible();
    await page.goto(`/data-tes/token?tanggal=${chosen}&halaman=999`); await expect(page.getByText("Halaman 3 dari 3")).toBeVisible();
    await page.goto(`/data-tes/token?tanggal=${chosen}&halaman=-1`); await expect(page.getByText("Halaman 1 dari 3")).toBeVisible();
    await page.getByRole("link", { name: "Hari ini", exact: true }).click();
    await expect(page.getByText("Tidak ada tes berlangsung atau mendatang pada tanggal ini.", { exact: false })).toBeVisible();
    await expect(page.getByText("0 tes", { exact: true })).toBeVisible();
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("filter hari ini meminta data baru ketika estimasi jam melewati pergantian hari", async ({ page }) => {
  await loginAsAdmin(page); await page.goto("/data-tes/token");
  await expect(page.getByRole("button", { name: "Aktifkan token global" })).toBeEnabled();
  const refresh = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/data-tes/token" && response.request().method() === "GET" && url.searchParams.has("_rsc");
  }, { timeout: 10_000 });
  // Simulasi hanya mempercepat jam monotonic browser; database tetap memakai
  // clock_timestamp. Server kemudian mengembalikan hari yang sebenarnya.
  await page.evaluate(() => {
    const original = performance.now.bind(performance);
    Object.defineProperty(performance, "now", { configurable: true, value: () => original() + 86_400_000 });
  });
  expect((await refresh).ok()).toBe(true);
  await expect(page.getByRole("link", { name: "Hari ini", exact: true })).toHaveAttribute("aria-current", "page");
});
