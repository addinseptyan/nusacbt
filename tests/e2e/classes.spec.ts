import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";

import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes kelas hanya boleh memakai PGDATABASE=nusacbt_test.");
  return new pg.Client(postgresConfig());
}

async function revokeCurrentSession(page: Page, client: pg.Client) {
  const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
  if (!cookie) throw new Error("Cookie sesi tes tidak ditemukan.");
  const digest = createHash("sha256").update(cookie.value).digest("hex");
  await client.query("DELETE FROM admin_sessions WHERE token_hash = $1", [digest]);
}

async function chooseMajor(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole("combobox", { name: "Jurusan" }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function cleanMajors(client: pg.Client, names: string[]) {
  await client.query("DELETE FROM school_classes WHERE major_id IN (SELECT id FROM school_majors WHERE name = ANY($1::text[]))", [names]);
  await client.query("DELETE FROM school_majors WHERE name = ANY($1::text[])", [names]);
}

test("admin mengelola jurusan dan kelas, mencegah duplikat serta penghapusan jurusan yang dipakai", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const major = `AK${suffix}`;
  const renamed = `AKbaru${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Peserta", exact: true }).click();
    await page.getByRole("link", { name: "Kelas / Jurusan", exact: true }).click();
    await expect(page).toHaveURL(/\/data-peserta\/kelas$/);
    await expect(page.getByRole("heading", { name: "Kelas / Jurusan" })).toBeVisible();

    await page.getByRole("button", { name: "Tambah jurusan" }).click();
    let majorEditor = page.getByRole("dialog", { name: "Tambah jurusan" });
    await majorEditor.getByLabel("Nama / kode jurusan").fill(`  ${major}  `);
    const saveRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/kelas");
    await majorEditor.getByRole("button", { name: "Simpan jurusan" }).click();
    const request = await saveRequest;
    await expect(majorEditor).toBeHidden();
    let majorRow = page.getByRole("list", { name: "Daftar jurusan" }).getByRole("listitem").filter({ hasText: major });
    await expect(majorRow).toBeVisible();
    const inserted = await client.query("SELECT id, name FROM school_majors WHERE name = $1", [major]);
    expect(inserted.rows).toHaveLength(1);
    expect(inserted.rows[0].name).toBe(major);
    const majorId = inserted.rows[0].id;

    const headers = request.headers();
    const body = request.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");
    const replay = await page.request.post("/data-peserta/kelas", {
      headers: { origin: "https://attacker.invalid", "content-type": headers["content-type"], "next-action": headers["next-action"] },
      data: body,
      failOnStatusCode: false,
    });
    expect(replay.status()).toBeGreaterThanOrEqual(400);
    expect((await client.query("SELECT 1 FROM school_majors WHERE name = $1", [major])).rowCount).toBe(1);

    await page.reload();
    await expect(majorRow).toBeVisible();
    await page.getByRole("button", { name: "Tambah jurusan" }).click();
    majorEditor = page.getByRole("dialog", { name: "Tambah jurusan" });
    await majorEditor.getByLabel("Nama / kode jurusan").fill(major.toLowerCase());
    await majorEditor.getByRole("button", { name: "Simpan jurusan" }).click();
    await expect(majorEditor.getByRole("alert")).toContainText("jurusan sudah digunakan");
    await majorEditor.getByRole("button", { name: "Batal" }).click();

    await page.getByRole("button", { name: "Tambah kelas" }).click();
    let classEditor = page.getByRole("dialog", { name: "Tambah kelas" });
    await classEditor.getByLabel("Tingkat").fill("xi");
    await classEditor.getByRole("button", { name: "Simpan kelas" }).click();
    await expect(classEditor.getByRole("alert")).toContainText("Pilih jurusan");
    await chooseMajor(page, classEditor, major);
    await classEditor.getByRole("button", { name: "Simpan kelas" }).click();
    await expect(classEditor).toBeHidden();
    let classRow = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `XI ${major}` });
    await expect(classRow).toBeVisible();
    expect((await client.query("SELECT level FROM school_classes WHERE major_id = $1", [majorId])).rows).toEqual([{ level: "XI" }]);

    await page.getByRole("button", { name: "Tambah kelas" }).click();
    classEditor = page.getByRole("dialog", { name: "Tambah kelas" });
    await classEditor.getByLabel("Tingkat").fill("XI");
    await chooseMajor(page, classEditor, major);
    await classEditor.getByRole("button", { name: "Simpan kelas" }).click();
    await expect(classEditor.getByRole("alert")).toContainText("tingkat dan jurusan ini sudah ada");
    await classEditor.getByRole("button", { name: "Batal" }).click();

    await client.query("INSERT INTO school_classes (level, major_id) VALUES ('XII', $1)", [majorId]);
    await page.reload();
    await classRow.getByRole("button", { name: `Ubah kelas XI ${major}` }).click();
    classEditor = page.getByRole("dialog", { name: "Ubah kelas" });
    await classEditor.getByLabel("Tingkat").fill("XII");
    await classEditor.getByRole("button", { name: "Simpan kelas" }).click();
    await expect(classEditor.getByRole("alert")).toContainText("tingkat dan jurusan ini sudah ada");
    await classEditor.getByLabel("Tingkat").fill("X");
    await classEditor.getByRole("button", { name: "Simpan kelas" }).click();
    await expect(classEditor).toBeHidden();
    classRow = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `X ${major}` });
    await expect(classRow).toBeVisible();

    await majorRow.getByRole("button", { name: `Hapus jurusan ${major}` }).click();
    let confirmation = page.getByRole("dialog", { name: "Hapus jurusan?" });
    await confirmation.getByRole("button", { name: "Ya, hapus jurusan" }).click();
    await expect(confirmation.getByRole("alert")).toContainText("Jurusan masih digunakan oleh kelas");
    expect((await client.query("SELECT 1 FROM school_majors WHERE id = $1", [majorId])).rowCount).toBe(1);
    expect((await client.query("SELECT 1 FROM school_classes WHERE major_id = $1", [majorId])).rowCount).toBe(2);
    await confirmation.getByRole("button", { name: "Batal" }).click();
    await expect(classRow).toBeVisible();

    await majorRow.getByRole("button", { name: `Ubah jurusan ${major}` }).click();
    majorEditor = page.getByRole("dialog", { name: "Ubah jurusan" });
    await expect(majorEditor).toContainText("mengubah tampilan nama kelas");
    await majorEditor.getByLabel("Nama / kode jurusan").fill(renamed);
    await majorEditor.getByRole("button", { name: "Simpan jurusan" }).click();
    await expect(majorEditor).toBeHidden();
    majorRow = page.getByRole("list", { name: "Daftar jurusan" }).getByRole("listitem").filter({ hasText: renamed });
    classRow = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `X ${renamed}` });
    await expect(classRow).toBeVisible();
    await page.reload();
    await expect(classRow).toBeVisible();

    await classRow.getByRole("button", { name: `Hapus kelas X ${renamed}` }).click();
    confirmation = page.getByRole("dialog", { name: "Hapus kelas?" });
    await confirmation.getByRole("button", { name: "Batal" }).click();
    await expect(classRow).toBeVisible();
    await classRow.getByRole("button", { name: `Hapus kelas X ${renamed}` }).click();
    confirmation = page.getByRole("dialog", { name: "Hapus kelas?" });
    await confirmation.getByRole("button", { name: "Ya, hapus kelas" }).click();
    await expect(classRow).toHaveCount(0);
    const second = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `XII ${renamed}` });
    await second.getByRole("button", { name: `Hapus kelas XII ${renamed}` }).click();
    await page.getByRole("dialog", { name: "Hapus kelas?" }).getByRole("button", { name: "Ya, hapus kelas" }).click();
    await expect(second).toHaveCount(0);
    await majorRow.getByRole("button", { name: `Hapus jurusan ${renamed}` }).click();
    await page.getByRole("dialog", { name: "Hapus jurusan?" }).getByRole("button", { name: "Ya, hapus jurusan" }).click();
    await expect(majorRow).toHaveCount(0);
    expect((await client.query("SELECT 1 FROM school_majors WHERE id = $1", [majorId])).rowCount).toBe(0);
  } finally {
    await cleanMajors(client, [major, renamed]);
    await client.end();
  }
});

test("kelas yang masih direferensikan tidak dapat dihapus", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const major = `Referensi${suffix}`;
  // Nama tabel dibuat dari karakter hex acak dan hanya ada dalam database tes.
  const referenceTable = `e2e_class_reference_${suffix}`;
  const client = testDatabase();
  await client.connect();
  let referenceTableCreated = false;
  try {
    const insertedMajor = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
    const insertedClass = await client.query("INSERT INTO school_classes (level, major_id) VALUES ('X', $1) RETURNING id", [insertedMajor.rows[0].id]);
    const classId = insertedClass.rows[0].id;
    await client.query(`CREATE TABLE "${referenceTable}" (class_id bigint NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT)`);
    referenceTableCreated = true;
    await client.query(`INSERT INTO "${referenceTable}" (class_id) VALUES ($1)`, [classId]);
    await expect(client.query("DELETE FROM school_classes WHERE id = $1", [classId])).rejects.toMatchObject({
      code: expect.stringMatching(/^(23503|23001)$/),
      constraint: `${referenceTable}_class_id_fkey`,
    });

    await loginAsAdmin(page);
    await page.goto("/data-peserta/kelas");
    const classRow = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `X ${major}` });
    await classRow.getByRole("button", { name: `Hapus kelas X ${major}` }).click();
    let confirmation = page.getByRole("dialog", { name: "Hapus kelas?" });
    await confirmation.getByRole("button", { name: "Ya, hapus kelas" }).click();
    await expect(confirmation.getByRole("alert")).toContainText("Kelas masih digunakan oleh data lain");
    expect((await client.query("SELECT 1 FROM school_classes WHERE id = $1", [classId])).rowCount).toBe(1);
    expect((await client.query(`SELECT 1 FROM "${referenceTable}" WHERE class_id = $1`, [classId])).rowCount).toBe(1);
    await confirmation.getByRole("button", { name: "Batal" }).click();
    await expect(classRow).toBeVisible();

    await client.query(`DELETE FROM "${referenceTable}" WHERE class_id = $1`, [classId]);
    await classRow.getByRole("button", { name: `Hapus kelas X ${major}` }).click();
    confirmation = page.getByRole("dialog", { name: "Hapus kelas?" });
    await confirmation.getByRole("button", { name: "Ya, hapus kelas" }).click();
    await expect(classRow).toHaveCount(0);
    expect((await client.query("SELECT 1 FROM school_classes WHERE id = $1", [classId])).rowCount).toBe(0);
  } finally {
    try {
      if (referenceTableCreated) await client.query(`DROP TABLE "${referenceTable}"`);
      await cleanMajors(client, [major]);
    } finally {
      await client.end();
    }
  }
});

test("aksi tambah jurusan dan kelas menolak sesi admin yang sudah dicabut", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const seed = `Benih${suffix}`;
  const attempted = `Tertolak${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    const inserted = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [seed]);
    await loginAsAdmin(page);
    await page.goto("/data-peserta/kelas");
    await page.getByRole("button", { name: "Tambah jurusan" }).click();
    const majorEditor = page.getByRole("dialog", { name: "Tambah jurusan" });
    await majorEditor.getByLabel("Nama / kode jurusan").fill(attempted);
    await revokeCurrentSession(page, client);
    const majorResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-peserta/kelas");
    await majorEditor.getByRole("button", { name: "Simpan jurusan" }).click();
    await majorResponse;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM school_majors WHERE name = $1", [attempted])).rowCount).toBe(0);

    await loginAsAdmin(page);
    await page.goto("/data-peserta/kelas");
    await page.getByRole("button", { name: "Tambah kelas" }).click();
    const classEditor = page.getByRole("dialog", { name: "Tambah kelas" });
    await classEditor.getByLabel("Tingkat").fill("X");
    await chooseMajor(page, classEditor, seed);
    await revokeCurrentSession(page, client);
    const classResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-peserta/kelas");
    await classEditor.getByRole("button", { name: "Simpan kelas" }).click();
    await classResponse;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM school_classes WHERE major_id = $1", [inserted.rows[0].id])).rowCount).toBe(0);
  } finally {
    await cleanMajors(client, [seed, attempted]);
    await client.end();
  }
});

test("aksi hapus jurusan dan kelas menolak sesi admin yang sudah dicabut", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const major = `Terpakai${suffix}`;
  const unused = `Kosong${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    const inserted = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
    await client.query("INSERT INTO school_majors (name) VALUES ($1)", [unused]);
    await client.query("INSERT INTO school_classes (level, major_id) VALUES ('X', $1)", [inserted.rows[0].id]);
    await loginAsAdmin(page);
    await page.goto("/data-peserta/kelas");
    const classRow = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `X ${major}` });
    await classRow.getByRole("button", { name: `Hapus kelas X ${major}` }).click();
    let confirmation = page.getByRole("dialog", { name: "Hapus kelas?" });
    await revokeCurrentSession(page, client);
    const classResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-peserta/kelas");
    await confirmation.getByRole("button", { name: "Ya, hapus kelas" }).click();
    await classResponse;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM school_classes WHERE major_id = $1", [inserted.rows[0].id])).rowCount).toBe(1);

    await loginAsAdmin(page);
    await page.goto("/data-peserta/kelas");
    const majorRow = page.getByRole("list", { name: "Daftar jurusan" }).getByRole("listitem").filter({ hasText: unused });
    await majorRow.getByRole("button", { name: `Hapus jurusan ${unused}` }).click();
    confirmation = page.getByRole("dialog", { name: "Hapus jurusan?" });
    await revokeCurrentSession(page, client);
    const majorResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-peserta/kelas");
    await confirmation.getByRole("button", { name: "Ya, hapus jurusan" }).click();
    await majorResponse;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM school_majors WHERE name = $1", [unused])).rowCount).toBe(1);
  } finally {
    await cleanMajors(client, [major, unused]);
    await client.end();
  }
});

test("perubahan memberi pesan jika kelas atau jurusan sudah dihapus sesi lain", async ({ page }) => {
  const major = `Bersamaan${randomBytes(5).toString("hex")}`;
  const client = testDatabase();
  await client.connect();
  try {
    const inserted = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
    const classResult = await client.query("INSERT INTO school_classes (level, major_id) VALUES ('X', $1) RETURNING id", [inserted.rows[0].id]);
    await loginAsAdmin(page);
    await page.goto("/data-peserta/kelas");
    const classRow = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `X ${major}` });
    await classRow.getByRole("button", { name: `Ubah kelas X ${major}` }).click();
    const classEditor = page.getByRole("dialog", { name: "Ubah kelas" });
    await client.query("DELETE FROM school_classes WHERE id = $1", [classResult.rows[0].id]);
    await classEditor.getByRole("button", { name: "Simpan kelas" }).click();
    await expect(classEditor.getByRole("alert")).toContainText("Kelas tidak ditemukan atau sudah dihapus");
    await classEditor.getByRole("button", { name: "Batal" }).click();
    await page.reload();
    const majorRow = page.getByRole("list", { name: "Daftar jurusan" }).getByRole("listitem").filter({ hasText: major });
    await majorRow.getByRole("button", { name: `Ubah jurusan ${major}` }).click();
    const majorEditor = page.getByRole("dialog", { name: "Ubah jurusan" });
    await client.query("DELETE FROM school_majors WHERE id = $1", [inserted.rows[0].id]);
    await majorEditor.getByRole("button", { name: "Simpan jurusan" }).click();
    await expect(majorEditor.getByRole("alert")).toContainText("Jurusan tidak ditemukan atau sudah dihapus");
  } finally {
    await cleanMajors(client, [major]);
    await client.end();
  }
});

test.describe("kelas dan jurusan pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 640 } });

  test("menu, mode gelap, dan dialog tetap dapat digunakan tanpa overflow", async ({ page }) => {
    const major = `Uji${randomBytes(5).toString("hex")}${"K".repeat(40)}`;
    const client = testDatabase();
    await client.connect();
    try {
      const inserted = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
      await client.query("INSERT INTO school_classes (level, major_id) VALUES ('XII', $1)", [inserted.rows[0].id]);
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await page.getByRole("menuitem", { name: "Gelap" }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await page.getByRole("button", { name: "Buka atau tutup sidebar" }).click();
      const sidebar = page.getByRole("dialog");
      await sidebar.getByRole("button", { name: "Data Peserta", exact: true }).click();
      await sidebar.getByRole("link", { name: "Kelas / Jurusan", exact: true }).click();
      await expect(page).toHaveURL(/\/data-peserta\/kelas$/);
      await expect(sidebar).toBeHidden();
      await expect(page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `XII ${major}` })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.getByRole("button", { name: "Tambah kelas" }).click();
      let editor = page.getByRole("dialog", { name: "Tambah kelas" });
      await chooseMajor(page, editor, major);
      await editor.getByRole("button", { name: "Batal" }).click();
      await expect(editor).toBeHidden();
      await page.setViewportSize({ width: 360, height: 320 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await page.getByRole("button", { name: "Tambah kelas" }).click();
      editor = page.getByRole("dialog", { name: "Tambah kelas" });
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
      await cleanMajors(client, [major]);
      await client.end();
    }
  });
});

test("database menjaga keunikan jurusan, satu kelas per tingkat-jurusan, dan referensi jurusan", async () => {
  const client = testDatabase();
  await client.connect();
  const major = `Db${randomBytes(5).toString("hex")}`;
  try {
    await client.query("BEGIN");
    const inserted = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
    const id = inserted.rows[0].id;
    await client.query("INSERT INTO school_classes (level, major_id) VALUES ('X', $1)", [id]);
    const removedMajor = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [`${major}Hilang`]);
    await client.query("DELETE FROM school_majors WHERE id = $1", [removedMajor.rows[0].id]);
    const checks: Array<{ sql: string; values: unknown[]; code: string | RegExp; constraint?: string }> = [
      { sql: "INSERT INTO school_majors (name) VALUES ($1)", values: [` ${major.toLowerCase()} `], code: "23505" },
      { sql: "INSERT INTO school_majors (name) VALUES ($1)", values: ["   "], code: "23514" },
      { sql: "INSERT INTO school_majors (name) VALUES ($1)", values: ["x".repeat(61)], code: "23514" },
      { sql: "INSERT INTO school_classes (level, major_id) VALUES ($1, $2)", values: ["xi", id], code: "23514" },
      { sql: "INSERT INTO school_classes (level, major_id) VALUES ($1, $2)", values: ["X AK", id], code: "23514" },
      { sql: "INSERT INTO school_classes (level, major_id) VALUES ($1, $2)", values: ["X", id], code: "23505" },
      { sql: "INSERT INTO school_classes (level, major_id) VALUES ($1, $2)", values: ["XI", removedMajor.rows[0].id], code: "23503", constraint: "school_classes_major_id_fkey" },
      // RESTRICT adalah 23503 di PostgreSQL 17 dan 23001 di PostgreSQL 18.
      { sql: "DELETE FROM school_majors WHERE id = $1", values: [id], code: /^(23503|23001)$/, constraint: "school_classes_major_id_fkey" },
    ];
    for (const { sql, values, code, constraint } of checks) {
      await client.query("SAVEPOINT periksa_kelas");
      try {
        const expectedCode = code instanceof RegExp ? expect.stringMatching(code) : code;
        await expect(client.query(sql, values)).rejects.toMatchObject({ code: expectedCode, ...(constraint ? { constraint } : {}) });
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT periksa_kelas");
      }
    }
    expect((await client.query("SELECT 1 FROM school_majors WHERE id = $1", [id])).rowCount).toBe(1);
    expect((await client.query("SELECT 1 FROM school_classes WHERE major_id = $1 AND level = 'X'", [id])).rowCount).toBe(1);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
