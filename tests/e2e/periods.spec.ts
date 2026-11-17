import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes periode hanya boleh memakai PGDATABASE=nusacbt_test.");
  return new pg.Client(postgresConfig());
}

async function revokeCurrentSession(page: import("@playwright/test").Page, client: pg.Client) {
  const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
  if (!cookie) throw new Error("Cookie sesi tes tidak ditemukan.");
  const digest = createHash("sha256").update(cookie.value).digest("hex");
  await client.query("DELETE FROM admin_sessions WHERE token_hash = $1", [digest]);
}

test("admin dapat menambah, mengubah, dan menghapus periode dengan konfirmasi", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const name = `Periode Uji ${suffix}`;
  const changedName = `Periode Revisi ${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Peserta", exact: true }).click();
    await page.getByRole("link", { name: "Periode Ujian", exact: true }).click();
    await expect(page).toHaveURL(/\/data-peserta\/periode$/);
    await expect(page.getByRole("heading", { name: "Periode Ujian" })).toBeVisible();
    await page.getByRole("button", { name: "Tambah periode" }).click();
    const editor = page.getByRole("dialog", { name: "Tambah periode" });
    await editor.getByLabel("Nama periode").fill(name);
    await editor.getByLabel("Tanggal mulai").fill("2026-07-01");
    await editor.getByLabel("Tanggal akhir").fill("2026-06-30");
    await editor.getByRole("button", { name: "Simpan periode" }).click();
    await expect(editor.getByRole("alert")).toContainText("Tanggal akhir tidak boleh lebih awal");
    expect((await client.query("SELECT 1 FROM exam_periods WHERE name = $1", [name])).rowCount).toBe(0);

    await editor.getByLabel("Tanggal akhir").fill("2026-12-31");
    const saveRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/periode");
    await editor.getByRole("button", { name: "Simpan periode" }).click();
    const request = await saveRequest;
    await expect(editor).toBeHidden();
    let row = page.getByRole("list", { name: "Daftar periode ujian" }).getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1 Jul 2026");
    await expect(row).toContainText("31 Des 2026");

    // Replay dengan Origin lain harus ditolak meskipun browser memiliki sesi admin.
    const headers = request.headers();
    const body = request.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");
    const replay = await page.request.post("/data-peserta/periode", {
      headers: { origin: "https://attacker.invalid", "content-type": headers["content-type"], "next-action": headers["next-action"] },
      data: body,
      failOnStatusCode: false,
    });
    expect(replay.status()).toBeGreaterThanOrEqual(400);
    expect((await client.query("SELECT 1 FROM exam_periods WHERE name = $1", [name])).rowCount).toBe(1);
    const created = await client.query("SELECT to_char(start_date, 'YYYY-MM-DD') AS start, to_char(end_date, 'YYYY-MM-DD') AS finish FROM exam_periods WHERE name = $1", [name]);
    expect(created.rows).toEqual([{ start: "2026-07-01", finish: "2026-12-31" }]);
    await page.reload();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: `Ubah periode ${name}` }).click();
    const edit = page.getByRole("dialog", { name: "Ubah periode" });
    await edit.getByLabel("Nama periode").fill(changedName);
    await edit.getByLabel("Tanggal akhir").fill("");
    await edit.getByRole("button", { name: "Simpan periode" }).click();
    await expect(edit).toBeHidden();
    row = page.getByRole("list", { name: "Daftar periode ujian" }).getByRole("listitem").filter({ hasText: changedName });
    await expect(row).toContainText("Tidak ditentukan");
    const updated = await client.query("SELECT end_date FROM exam_periods WHERE name = $1", [changedName]);
    expect(updated.rows).toEqual([{ end_date: null }]);

    await row.getByRole("button", { name: `Hapus periode ${changedName}` }).click();
    let confirm = page.getByRole("dialog", { name: "Hapus periode?" });
    await expect(confirm).toContainText(changedName);
    await confirm.getByRole("button", { name: "Batal" }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Hapus periode ${changedName}` }).click();
    confirm = page.getByRole("dialog", { name: "Hapus periode?" });
    await confirm.getByRole("button", { name: "Ya, hapus periode" }).click();
    await expect(confirm).toBeHidden();
    await expect(row).toHaveCount(0);
    expect((await client.query("SELECT 1 FROM exam_periods WHERE name = $1", [changedName])).rowCount).toBe(0);
  } finally {
    await client.query("DELETE FROM exam_periods WHERE name = ANY($1::text[])", [[name, changedName]]);
    await client.end();
  }
});

test("aksi menyimpan menolak sesi yang sudah dicabut", async ({ page }) => {
  const name = `Sesi Dicabut ${randomBytes(5).toString("hex")}`;
  const client = testDatabase();
  await client.connect();
  try {
    await loginAsAdmin(page);
    await page.goto("/data-peserta/periode");
    await page.getByRole("button", { name: "Tambah periode" }).click();
    const editor = page.getByRole("dialog", { name: "Tambah periode" });
    await editor.getByLabel("Nama periode").fill(name);
    await editor.getByLabel("Tanggal mulai").fill("2026-07-01");
    await revokeCurrentSession(page, client);
    const actionResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-peserta/periode");
    await editor.getByRole("button", { name: "Simpan periode" }).click();
    await actionResponse;
    expect((await client.query("SELECT 1 FROM exam_periods WHERE name = $1", [name])).rowCount).toBe(0);
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await client.query("DELETE FROM exam_periods WHERE name = $1", [name]);
    await client.end();
  }
});

test("aksi menghapus menolak sesi yang sudah dicabut", async ({ page }) => {
  const name = `Hapus Tertolak ${randomBytes(5).toString("hex")}`;
  const client = testDatabase();
  await client.connect();
  try {
    await client.query("INSERT INTO exam_periods (name, start_date) VALUES ($1, DATE '2026-07-01')", [name]);
    await loginAsAdmin(page);
    await page.goto("/data-peserta/periode");
    const row = page.getByRole("list", { name: "Daftar periode ujian" }).getByRole("listitem").filter({ hasText: name });
    await row.getByRole("button", { name: `Hapus periode ${name}` }).click();
    const confirm = page.getByRole("dialog", { name: "Hapus periode?" });
    await revokeCurrentSession(page, client);
    const actionResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-peserta/periode");
    await confirm.getByRole("button", { name: "Ya, hapus periode" }).click();
    await actionResponse;
    expect((await client.query("SELECT 1 FROM exam_periods WHERE name = $1", [name])).rowCount).toBe(1);
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await client.query("DELETE FROM exam_periods WHERE name = $1", [name]);
    await client.end();
  }
});

test("perubahan dan penghapusan memberi pesan jika periode sudah dihapus oleh sesi lain", async ({ page }) => {
  const name = `Periode Bersamaan ${randomBytes(5).toString("hex")}`;
  const client = testDatabase();
  await client.connect();
  try {
    let inserted = await client.query("INSERT INTO exam_periods (name, start_date) VALUES ($1, DATE '2026-07-01') RETURNING id", [name]);
    await loginAsAdmin(page);
    await page.goto("/data-peserta/periode");
    let row = page.getByRole("list", { name: "Daftar periode ujian" }).getByRole("listitem").filter({ hasText: name });
    await row.getByRole("button", { name: `Ubah periode ${name}` }).click();
    const editor = page.getByRole("dialog", { name: "Ubah periode" });
    await client.query("DELETE FROM exam_periods WHERE id = $1", [inserted.rows[0].id]);
    await editor.getByRole("button", { name: "Simpan periode" }).click();
    await expect(editor.getByRole("alert")).toContainText("Periode tidak ditemukan atau sudah dihapus");
    await editor.getByRole("button", { name: "Batal" }).click();

    inserted = await client.query("INSERT INTO exam_periods (name, start_date) VALUES ($1, DATE '2026-07-01') RETURNING id", [name]);
    await page.reload();
    row = page.getByRole("list", { name: "Daftar periode ujian" }).getByRole("listitem").filter({ hasText: name });
    await row.getByRole("button", { name: `Hapus periode ${name}` }).click();
    const confirmation = page.getByRole("dialog", { name: "Hapus periode?" });
    await client.query("DELETE FROM exam_periods WHERE id = $1", [inserted.rows[0].id]);
    await confirmation.getByRole("button", { name: "Ya, hapus periode" }).click();
    await expect(confirmation.getByRole("alert")).toContainText("Periode tidak ditemukan atau sudah dihapus");
    expect((await client.query("SELECT 1 FROM exam_periods WHERE name = $1", [name])).rowCount).toBe(0);
  } finally {
    await client.query("DELETE FROM exam_periods WHERE name = $1", [name]);
    await client.end();
  }
});

test.describe("periode pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 640 } });

  test("menu, mode gelap, dan dialog tetap bisa digunakan tanpa overflow", async ({ page }) => {
    const name = `Uji ${randomBytes(5).toString("hex")} ${"P".repeat(75)}`;
    const client = testDatabase();
    await client.connect();
    try {
      await client.query("INSERT INTO exam_periods (name, start_date) VALUES ($1, DATE '2026-07-01')", [name]);
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await page.getByRole("menuitem", { name: "Gelap" }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await page.getByRole("button", { name: "Buka atau tutup sidebar" }).click();
      const sidebar = page.getByRole("dialog");
      await sidebar.getByRole("button", { name: "Data Peserta", exact: true }).click();
      await sidebar.getByRole("link", { name: "Periode Ujian", exact: true }).click();
      await expect(page).toHaveURL(/\/data-peserta\/periode$/);
      await expect(sidebar).toBeHidden();
      await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

      // Bahkan saat layar sangat pendek, dialog dapat digulir hingga tombolnya.
      await page.setViewportSize({ width: 360, height: 320 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await page.getByRole("button", { name: "Tambah periode" }).click();
      const editor = page.getByRole("dialog", { name: "Tambah periode" });
      const box = await editor.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error("Dialog tidak terlihat.");
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(320);
      await editor.getByRole("button", { name: "Batal" }).scrollIntoViewIfNeeded();
      await expect(editor.getByRole("button", { name: "Batal" })).toBeInViewport();
      await editor.getByRole("button", { name: "Batal" }).click();
      await expect(editor).toBeHidden();
    } finally {
      await client.query("DELETE FROM exam_periods WHERE name = $1", [name]);
      await client.end();
    }
  });
});

test("database menolak nama kosong dan rentang tanggal yang tidak valid", async () => {
  const client = testDatabase();
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const [name, start, end] of [
      ["   ", "2026-07-01", null],
      ["Tanggal tak berhingga", "infinity", null],
      ["Akhir sebelum mulai", "2026-07-01", "2026-06-30"],
      ["Akhir tak berhingga", "2026-07-01", "infinity"],
    ]) {
      await client.query("SAVEPOINT periksa_periode");
      try {
        await expect(client.query("INSERT INTO exam_periods (name, start_date, end_date) VALUES ($1, $2::date, $3::date)", [name, start, end])).rejects.toMatchObject({ code: "23514" });
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT periksa_periode");
      }
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
