import { expect, type Page } from "@playwright/test";

export async function loginAsAdmin(page: Page) {
  const username = process.env.TEST_ADMIN_USERNAME;
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!username || !password) throw new Error("TEST_ADMIN_USERNAME dan TEST_ADMIN_PASSWORD wajib diisi untuk tes pada database khusus pengujian.");
  await page.goto("/login");
  await page.getByLabel("Username admin").fill(username);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk ke panel admin" }).click();
  await expect(page).toHaveURL(/\/$/);
}
