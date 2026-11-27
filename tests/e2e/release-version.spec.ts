import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";

const pkgVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;
const pkgTag = `v${pkgVersion}`;

test("/api/health, versi rilis sidebar, dan tombol cek pembaruan manual berfungsi dengan benar", async ({ page, request }) => {
  const healthRes = await request.get("/api/health");
  expect(healthRes.status()).toBe(200);
  expect(healthRes.headers()["cache-control"]).toContain("no-store");
  const health = await healthRes.json();
  expect(health.ok).toBe(true);
  expect(health.version).toBe(pkgVersion);
  expect(health.tag).toBe(pkgTag);
  expect(health.database).toBe("ready");
  expect(JSON.stringify(health)).not.toMatch(/password|secret|key/i);

  await loginAsAdmin(page);
  const sidebarFooter = page.locator('[data-slot="sidebar-footer"]');
  await expect(sidebarFooter).toContainText(pkgTag);
  await expect(sidebarFooter).not.toContainText("v0.1.0");

  await page.goto("/pengaturan/aplikasi");
  const updateCard = page.locator("#versi-pembaruan");
  await expect(updateCard).toBeVisible();
  await expect(updateCard).toContainText(pkgTag);
  await expect(updateCard).toContainText("addinseptyan/nusacbt");
  await expect(updateCard).toContainText("tanpa auto-update");

  // Sebelum tombol diklik, status hasil pemeriksaan belum ditampilkan.
  const checkBtn = updateCard.getByRole("button", { name: "Cek Pembaruan" });
  await expect(checkBtn).toBeVisible();
  await expect(updateCard.getByRole("status")).toHaveCount(0);

  // Klik tombol manual memicu pemeriksaan ke server dan menampilkan status aman (online/404/offline).
  await checkBtn.click();
  const statusAlert = updateCard.getByRole("status");
  await expect(statusAlert).toBeVisible({ timeout: 15000 });
  await expect(statusAlert).toContainText(/Pembaruan belum dapat diperiksa|Belum ada rilis tag|Sudah menggunakan versi terbaru|Pembaruan tersedia/i);
});
