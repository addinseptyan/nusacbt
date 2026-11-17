import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

import { hashPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes yang mengubah database hanya boleh memakai PGDATABASE=nusacbt_test.");
  return new pg.Client(postgresConfig());
}

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

test("halaman admin mengalihkan pengunjung yang belum login", async ({ page }) => {
  for (const path of ["/", "/data-peserta/siswa", "/data-tes/daftar"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Selamat datang kembali" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
  }
});

test("login salah ditolak, sesi disimpan sebagai hash, dan logout mencabut sesi", async ({ page }) => {
  const username = process.env.TEST_ADMIN_USERNAME!;
  const password = process.env.TEST_ADMIN_PASSWORD!;
  await page.goto("/login");
  await page.getByLabel("Username admin").fill(username);
  await page.getByLabel("Kata sandi").fill("Kata-sandi-yang-salah");
  await page.getByRole("button", { name: "Masuk ke panel admin" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Username atau kata sandi salah" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Username admin").fill(username);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk ke panel admin" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /Selamat datang di NusaCBT/ })).toBeVisible();
  const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
  expect(cookie).toBeDefined();
  if (!cookie) throw new Error("Cookie sesi tidak ditemukan.");
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  expect(await page.evaluate(() => document.cookie)).not.toContain(cookie.value);

  const client = testDatabase();
  await client.connect();
  try {
    const stored = await client.query("SELECT token_hash FROM admin_sessions WHERE token_hash = $1", [digest(cookie.value)]);
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].token_hash).not.toBe(cookie.value);
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM admin_sessions WHERE token_hash = $1", [digest(cookie.value)])).rowCount).toBe(0);
    await page.context().addCookies([cookie]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await client.end();
  }
});

test("Server Action menolak request dari Origin lain", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username admin").fill(process.env.TEST_ADMIN_USERNAME!);
  await page.getByLabel("Kata sandi").fill(process.env.TEST_ADMIN_PASSWORD!);
  const actionRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/login");
  await page.getByRole("button", { name: "Masuk ke panel admin" }).click();
  const request = await actionRequest;
  await expect(page).toHaveURL(/\/$/);
  const headers = request.headers();
  const body = request.postDataBuffer();
  if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");

  const client = testDatabase();
  await client.connect();
  try {
    const before = Number((await client.query("SELECT count(*) FROM admin_sessions")).rows[0].count);
    const response = await page.request.post("/login", {
      headers: {
        origin: "https://attacker.invalid",
        "content-type": headers["content-type"],
        "next-action": headers["next-action"],
      },
      data: body,
      failOnStatusCode: false,
    });
    const after = Number((await client.query("SELECT count(*) FROM admin_sessions")).rows[0].count);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(after).toBe(before);
  } finally {
    await client.end();
  }
});

test("sesi yang melewati batas waktu tidak dapat dipakai", async ({ page }) => {
  await loginAsAdmin(page);
  const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
  if (!cookie) throw new Error("Cookie sesi tidak ditemukan.");
  const client = testDatabase();
  await client.connect();
  try {
    const result = await client.query("UPDATE admin_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [digest(cookie.value)]);
    expect(result.rowCount).toBe(1);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await client.end();
  }
});

test("lima kegagalan mengunci akun sementara dan akun pulih setelah waktunya", async ({ page }) => {
  const username = `lock_${randomBytes(6).toString("hex")}`;
  const password = "Password-fiktif-untuk-tes-42";
  const client = testDatabase();
  await client.connect();
  try {
    await client.query("INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)", [username, await hashPassword(password)]);
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto("/login");
      await page.getByLabel("Username admin").fill(username);
      await page.getByLabel("Kata sandi").fill("Salah-untuk-pengujian");
      await page.getByRole("button", { name: "Masuk ke panel admin" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Username atau kata sandi salah" })).toBeVisible();
    }
    const locked = await client.query("SELECT failed_attempts, locked_until > now() AS locked FROM admin_users WHERE username = $1", [username]);
    expect(locked.rows[0]).toMatchObject({ failed_attempts: 5, locked: true });
    await page.goto("/login");
    await page.getByLabel("Username admin").fill(username);
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Masuk ke panel admin" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Username atau kata sandi salah" })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await client.query("UPDATE admin_users SET locked_until = now() - interval '1 second' WHERE username = $1", [username]);
    await page.getByLabel("Username admin").fill(username);
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Masuk ke panel admin" }).click();
    await expect(page).toHaveURL(/\/$/);
    const unlocked = await client.query("SELECT failed_attempts, locked_until FROM admin_users WHERE username = $1", [username]);
    expect(unlocked.rows[0]).toMatchObject({ failed_attempts: 0, locked_until: null });
  } finally {
    await client.query("DELETE FROM admin_users WHERE username = $1", [username]);
    await client.end();
  }
});
