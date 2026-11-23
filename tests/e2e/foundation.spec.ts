import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test("dashboard menampilkan tujuh menu dan modul dapat dibuka", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Selamat datang di NusaCBT/ })).toBeVisible();
  await expect(page.getByText("TERHUBUNG", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  for (const label of ["Data Modul", "Data Peserta", "Data Tes", "Laporan", "Tool", "Pengaturan"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Data Modul", exact: true }).click();
  await expect(page.getByRole("link", { name: "Import Soal Word" })).toBeVisible();
  await page.getByRole("link", { name: "Import Soal Word" }).click();
  await expect(page).toHaveURL(/\/data-modul\/import-soal$/);
  await expect(page.getByRole("heading", { name: "Import Soal Word" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pilih file dan kategori" })).toBeVisible();
});

test("mode gelap tersimpan setelah halaman dimuat ulang", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ganti tema" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Ganti tema" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});

test("preferensi sistem lama menjadi terang dan tidak lagi mengikuti OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/"); await page.evaluate(() => localStorage.setItem("theme", "system")); await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Ganti tema" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("menuitem", { name: "Ikuti sistem" })).toHaveCount(0);
  await page.emulateMedia({ colorScheme: "light" }); await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("dialog menjelaskan info sistem dan dapat ditutup", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Info sistem" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Operasional aman")).toBeVisible();
  await dialog.getByRole("button", { name: "Mengerti" }).click();
  await expect(dialog).toBeHidden();
});

test("kedua template contoh dapat diunduh", async ({ page }) => {
  await page.goto("/");
  for (const [href, filename] of [
    ["/templates/template-soal-nusacbt.docx", "template-soal-nusacbt.docx"],
    ["/templates/template-peserta-nusacbt.xlsx", "template-peserta-nusacbt.xlsx"],
  ]) {
    const downloadPromise = page.waitForEvent("download");
    await page.locator(`a[href="${href}"]`).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(filename);
    expect(await download.failure()).toBeNull();
  }
});

test("halaman awal tidak meminta aset dari host eksternal", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "127.0.0.1") {
      externalRequests.push(request.url());
    }
  });
  await page.goto("/", { waitUntil: "networkidle" });
  expect(externalRequests).toEqual([]);
});

test.describe("layar kecil", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sidebar dapat dibuka dan menavigasi tanpa overflow horizontal", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Buka atau tutup sidebar" }).click();
    const sidebar = page.getByRole("dialog");
    await sidebar.getByRole("button", { name: "Data Peserta", exact: true }).click();
    await sidebar.getByRole("link", { name: "Import Data Peserta" }).click();
    await expect(page).toHaveURL(/\/data-peserta\/import$/);
    await expect(page.getByRole("heading", { name: "Import Data Peserta" })).toBeVisible();
    await expect(sidebar).toBeHidden();
  });
});
