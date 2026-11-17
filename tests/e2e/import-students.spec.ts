import { createHash, randomBytes, randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { makeImportWorkbook } from "../helpers/import-workbook.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes impor hanya boleh menggunakan PGDATABASE=nusacbt_test.");
  return new pg.Client(postgresConfig());
}
function newNisn() {
  return `0${randomInt(0, 1_000_000_000).toString().padStart(9, "0")}`;
}
async function seedSchool(client: pg.Client, suffix: string) {
  const major = `IM${suffix}`;
  const periodA = `Periode Impor A ${suffix}`;
  const periodB = `Periode Impor B ${suffix}`;
  const majorId = (await client.query("INSERT INTO school_majors(name) VALUES($1) RETURNING id", [major])).rows[0].id;
  const classes = await client.query<{ id: string; level: string }>(
    "INSERT INTO school_classes(level, major_id) VALUES ('X', $1), ('XI', $1) RETURNING id::text AS id, level", [majorId],
  );
  const periods = await client.query<{ id: string; name: string }>(
    "INSERT INTO exam_periods(name, start_date) VALUES ($1, DATE '2026-01-01'),($2, DATE '2026-07-01') RETURNING id::text AS id, name", [periodA, periodB],
  );
  return {
    major, periodA, periodB,
    classId: (level: string) => classes.rows.find((item) => item.level === level)!.id,
    periodId: (name: string) => periods.rows.find((item) => item.name === name)!.id,
  };
}
async function cleanup(client: pg.Client, nisns: string[], major: string, periods: string[]) {
  await client.query(
    `DELETE FROM student_class_placements WHERE student_id IN (SELECT id FROM school_students WHERE nisn = ANY($1::text[]))
     OR period_id IN (SELECT id FROM exam_periods WHERE name = ANY($2::text[]))`, [nisns, periods],
  );
  await client.query("DELETE FROM school_students WHERE nisn = ANY($1::text[])", [nisns]);
  await client.query("DELETE FROM school_classes WHERE major_id IN (SELECT id FROM school_majors WHERE name=$1)", [major]);
  await client.query("DELETE FROM school_majors WHERE name=$1", [major]);
  await client.query("DELETE FROM exam_periods WHERE name=ANY($1::text[])", [periods]);
}
async function prepareImport(page: Page, period: string, buffer: Buffer) {
  await page.goto("/data-peserta/import");
  await page.getByRole("combobox", { name: "Periode" }).click();
  await page.getByRole("option", { name: period }).click();
  await page.getByLabel("File Excel").setInputFiles({ name: "peserta-fiktif.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await page.getByRole("button", { name: "Periksa pratinjau" }).click();
  await expect(page.getByRole("heading", { name: "Hasil pratinjau" })).toBeVisible();
}
async function confirmSave(page: Page) {
  await page.getByRole("button", { name: "Simpan hasil impor" }).click();
  const dialog = page.getByRole("dialog", { name: "Simpan hasil impor?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Ya, simpan impor" }).click();
}

test("impor memperlihatkan rencana, mempertahankan siswa dan riwayat lama, serta aman diulang", async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = randomBytes(5).toString("hex");
  const nisns = [newNisn(), newNisn(), newNisn()];
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    const existing = await client.query<{ id: string; nisn: string }>(
      "INSERT INTO school_students(name,nisn) VALUES ($1,$2),($3,$4) RETURNING id::text AS id, nisn",
      [`Lama Lintas ${suffix}`, nisns[1], `Lama Sama ${suffix}`, nisns[2]],
    );
    const existingId = (nisn: string) => existing.rows.find((row) => row.nisn === nisn)!.id;
    await client.query(
      `INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
       VALUES ($1,$2,$3,$4),($5,$6,$3,$4)`,
      [existingId(nisns[1]), fixture.periodId(fixture.periodB), fixture.classId("X"), `X ${fixture.major}`, existingId(nisns[2]), fixture.periodId(fixture.periodA)],
    );
    const before = await client.query("SELECT id::text,name,nisn,updated_at::text FROM school_students WHERE nisn=ANY($1::text[]) ORDER BY nisn", [[nisns[1], nisns[2]]]);
    const workbook = makeImportWorkbook({ shared: true, rows: [
      { cells: [1, `Baru ${suffix}`, nisns[0], `x ${fixture.major.toLowerCase()}`] },
      { cells: [2, `Lama Lintas ${suffix}`, nisns[1], `XI ${fixture.major}`] },
      { cells: [3, `Lama Sama ${suffix}`, nisns[2], `X ${fixture.major}`] },
    ] });
    await loginAsAdmin(page);
    await prepareImport(page, fixture.periodA, workbook);
    await expect(page.getByRole("list", { name: "Hasil pratinjau impor" })).toContainText("Siswa baru");
    await expect(page.getByRole("list", { name: "Hasil pratinjau impor" })).toContainText("Penempatan baru");
    await expect(page.getByRole("list", { name: "Hasil pratinjau impor" })).toContainText("Sudah sesuai");
    expect((await client.query("SELECT 1 FROM school_students WHERE nisn=$1", [nisns[0]])).rowCount).toBe(0);
    await confirmSave(page);
    await expect(page.getByRole("status")).toContainText("1 siswa baru dan 2 penempatan baru disimpan; 1 baris sudah sesuai");
    expect((await client.query("SELECT name,nisn FROM school_students WHERE nisn=$1", [nisns[0]])).rows).toEqual([{ name: `Baru ${suffix}`, nisn: nisns[0] }]);
    const after = await client.query("SELECT id::text,name,nisn,updated_at::text FROM school_students WHERE nisn=ANY($1::text[]) ORDER BY nisn", [[nisns[1], nisns[2]]]);
    expect(after.rows).toEqual(before.rows);
    const placements = await client.query(
      `SELECT s.nisn, p.period_id::text, p.class_name_snapshot, p.ended_at IS NULL AS active
       FROM student_class_placements p JOIN school_students s ON s.id=p.student_id
       WHERE s.nisn=ANY($1::text[]) ORDER BY s.nisn,p.id`, [nisns],
    );
    expect(placements.rows).toHaveLength(4);
    expect(placements.rows.filter((row) => row.nisn === nisns[1])).toEqual([
      { nisn: nisns[1], period_id: fixture.periodId(fixture.periodB), class_name_snapshot: `X ${fixture.major}`, active: true },
      { nisn: nisns[1], period_id: fixture.periodId(fixture.periodA), class_name_snapshot: `XI ${fixture.major}`, active: true },
    ]);
    await page.getByLabel("File Excel").setInputFiles({ name: "peserta-fiktif.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook });
    await page.getByRole("button", { name: "Periksa pratinjau" }).click();
    await expect(page.getByRole("list", { name: "Hasil pratinjau impor" })).toContainText("Sudah sesuai");
    await confirmSave(page);
    await expect(page.getByRole("status")).toContainText("0 siswa baru dan 0 penempatan baru disimpan; 3 baris sudah sesuai");
    expect((await client.query("SELECT count(*)::int AS n FROM student_class_placements p JOIN school_students s ON s.id=p.student_id WHERE s.nisn=ANY($1::text[])", [nisns])).rows[0].n).toBe(4);
  } finally {
    await cleanup(client, nisns, fixture.major, [fixture.periodA, fixture.periodB]);
    await client.end();
  }
});

test("kesalahan dan konflik ditampilkan bersama tanpa menyimpan satu pun baris", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = randomBytes(5).toString("hex");
  const nisns = [newNisn(), newNisn(), newNisn(), newNisn()];
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    const studentId = (await client.query("INSERT INTO school_students(name,nisn) VALUES ($1,$2) RETURNING id", [`Nama Lama ${suffix}`, nisns[3]])).rows[0].id;
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)", [studentId, fixture.periodId(fixture.periodA), fixture.classId("X"), `X ${fixture.major}`]);
    const workbook = makeImportWorkbook({ rows: [
      { cells: [1, `Valid ${suffix}`, nisns[0], `X ${fixture.major}`] },
      { cells: [2, `Duplikat A ${suffix}`, nisns[1], `X ${fixture.major}`] },
      { cells: [3, `Duplikat B ${suffix}`, nisns[1], `X ${fixture.major}`] },
      { cells: [4, `Angka ${suffix}`, 1234567890, `X ${fixture.major}`] },
      { cells: [5, `Nama Beda ${suffix}`, nisns[3], `XI ${fixture.major}`] },
      { cells: [6, `Kelas Salah ${suffix}`, nisns[2], "X TIDAKADA"] },
    ] });
    await loginAsAdmin(page);
    await prepareImport(page, fixture.periodA, workbook);
    const list = page.getByRole("list", { name: "Hasil pratinjau impor" });
    await expect(list).toContainText("NISN muncul lebih dari sekali");
    await expect(list).toContainText("NISN harus disimpan sebagai teks");
    await expect(list).toContainText("Nama berbeda dengan data siswa");
    await expect(list).toContainText("Kelas aktif di periode ini");
    await expect(list).toContainText("Kelas tidak ditemukan");
    await expect(page.getByRole("button", { name: "Simpan hasil impor" })).toBeDisabled();
    expect((await client.query("SELECT nisn,name FROM school_students WHERE nisn=ANY($1::text[])", [nisns])).rows).toEqual([{ nisn: nisns[3], name: `Nama Lama ${suffix}` }]);
    expect((await client.query("SELECT count(*)::int AS n FROM student_class_placements WHERE student_id=$1", [studentId])).rows[0].n).toBe(1);
  } finally {
    await cleanup(client, nisns, fixture.major, [fixture.periodA, fixture.periodB]);
    await client.end();
  }
});

test("pratinjau kedaluwarsa dibatalkan seluruhnya bila data siswa berubah", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const nisns = [newNisn(), newNisn()];
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    await client.query("INSERT INTO school_students(name,nisn) VALUES ($1,$2)", [`Lama ${suffix}`, nisns[1]]);
    const workbook = makeImportWorkbook({ rows: [
      { cells: [1, `Baru ${suffix}`, nisns[0], `X ${fixture.major}`] },
      { cells: [2, `Lama ${suffix}`, nisns[1], `X ${fixture.major}`] },
    ] });
    await loginAsAdmin(page);
    await prepareImport(page, fixture.periodA, workbook);
    await client.query("UPDATE school_students SET name=$1, updated_at=updated_at+interval '1 second' WHERE nisn=$2", [`Perubahan lain ${suffix}`, nisns[1]]);
    await confirmSave(page);
    await expect(page.getByRole("alert").filter({ hasText: "Perlu diperiksa" })).toContainText("berubah sejak pratinjau");
    expect((await client.query("SELECT nisn,name FROM school_students WHERE nisn=ANY($1::text[])", [nisns])).rows).toEqual([{ nisn: nisns[1], name: `Perubahan lain ${suffix}` }]);
    expect((await client.query("SELECT count(*)::int AS n FROM student_class_placements WHERE period_id=$1", [fixture.periodId(fixture.periodA)])).rows[0].n).toBe(0);
  } finally {
    await cleanup(client, nisns, fixture.major, [fixture.periodA, fixture.periodB]);
    await client.end();
  }
});

test("kegagalan penempatan membatalkan siswa baru dalam transaksi yang sama", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const nisns = [newNisn(), newNisn()];
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  // Objek uji hanya ada di database nusacbt_test dan dibersihkan pada finally.
  const fn = `e2e_import_fail_${suffix}`;
  try {
    await client.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional import failure'; END; $$`);
    await client.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON student_class_placements FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    const workbook = makeImportWorkbook({ rows: [
      { cells: [1, `Rollback A ${suffix}`, nisns[0], `X ${fixture.major}`] },
      { cells: [2, `Rollback B ${suffix}`, nisns[1], `X ${fixture.major}`] },
    ] });
    await loginAsAdmin(page);
    await prepareImport(page, fixture.periodA, workbook);
    await confirmSave(page);
    await expect(page.getByRole("alert").filter({ hasText: "Perlu diperiksa" })).toContainText("belum dapat dipastikan");
    expect((await client.query("SELECT 1 FROM school_students WHERE nisn=ANY($1::text[])", [nisns])).rowCount).toBe(0);
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE period_id=$1", [fixture.periodId(fixture.periodA)])).rowCount).toBe(0);
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS ${fn} ON student_class_placements`);
    await client.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    await cleanup(client, nisns, fixture.major, [fixture.periodA, fixture.periodB]);
    await client.end();
  }
});

test("perubahan penempatan setelah pratinjau tidak ditimpa oleh impor", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const nisns = [newNisn(), newNisn()];
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    const studentId = (await client.query("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id", [`Lama ${suffix}`, nisns[1]])).rows[0].id;
    const workbook = makeImportWorkbook({ rows: [
      { cells: [1, `Baru ${suffix}`, nisns[0], `X ${fixture.major}`] },
      { cells: [2, `Lama ${suffix}`, nisns[1], `X ${fixture.major}`] },
    ] });
    await loginAsAdmin(page);
    await prepareImport(page, fixture.periodA, workbook);
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)", [studentId, fixture.periodId(fixture.periodA), fixture.classId("XI"), `XI ${fixture.major}`]);
    await confirmSave(page);
    await expect(page.getByRole("alert").filter({ hasText: "Perlu diperiksa" })).toContainText("berubah sejak pratinjau");
    expect((await client.query("SELECT 1 FROM school_students WHERE nisn=$1", [nisns[0]])).rowCount).toBe(0);
    const placements = await client.query("SELECT class_id::text,ended_at FROM student_class_placements WHERE student_id=$1", [studentId]);
    expect(placements.rows).toEqual([{ class_id: fixture.classId("XI"), ended_at: null }]);
  } finally {
    await cleanup(client, nisns, fixture.major, [fixture.periodA, fixture.periodB]);
    await client.end();
  }
});

test("dua impor bersamaan tidak membuat duplikat atau penyimpanan sebagian", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const suffix = randomBytes(5).toString("hex");
  const nisns = [newNisn(), newNisn()];
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    const workbook = makeImportWorkbook({ rows: [
      { cells: [1, `Serentak A ${suffix}`, nisns[0], `X ${fixture.major}`] },
      { cells: [2, `Serentak B ${suffix}`, nisns[1], `X ${fixture.major}`] },
    ] });
    await loginAsAdmin(page);
    await loginAsAdmin(other);
    await prepareImport(page, fixture.periodA, workbook);
    await prepareImport(other, fixture.periodA, workbook);
    await page.getByRole("button", { name: "Simpan hasil impor" }).click();
    await other.getByRole("button", { name: "Simpan hasil impor" }).click();
    await Promise.all([
      page.getByRole("button", { name: "Ya, simpan impor" }).click(),
      other.getByRole("button", { name: "Ya, simpan impor" }).click(),
    ]);
    await expect.poll(async () => [await page.getByRole("status").count(), await other.getByRole("status").count()].reduce((a, b) => a + b, 0)).toBe(1);
    await expect.poll(async () => [await page.getByRole("alert").filter({ hasText: "Perlu diperiksa" }).count(), await other.getByRole("alert").filter({ hasText: "Perlu diperiksa" }).count()].reduce((a, b) => a + b, 0)).toBe(1);
    const result = await client.query("SELECT s.nisn, count(p.id)::int AS n FROM school_students s LEFT JOIN student_class_placements p ON p.student_id=s.id AND p.ended_at IS NULL WHERE s.nisn=ANY($1::text[]) GROUP BY s.id ORDER BY s.nisn", [nisns]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.n)).toEqual([1, 1]);
  } finally {
    await otherContext.close();
    await cleanup(client, nisns, fixture.major, [fixture.periodA, fixture.periodB]);
    await client.end();
  }
});

test("impor memerlukan sesi aktif dan menolak Origin lain", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    await page.goto("/data-peserta/import");
    await expect(page).toHaveURL(/\/login/);
    await loginAsAdmin(page);
    await page.goto("/data-peserta/import");
    await page.getByRole("combobox", { name: "Periode" }).click();
    await page.getByRole("option", { name: fixture.periodA }).click();
    const buffer = makeImportWorkbook({ rows: [{ cells: [1, `Otentikasi ${suffix}`, nisn, `X ${fixture.major}`] }] });
    await page.getByLabel("File Excel").setInputFiles({ name: "peserta.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
    // Chromium tidak menyediakan postDataBuffer untuk multipart berkas. Salin bentuk FormData
    // dari fetch agar replay sah terlebih dahulu, baru ganti Origin untuk pengujian CSRF.
    await page.evaluate(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (init?.method === "POST" && init.body instanceof FormData) {
          (window as Window & { importFields?: unknown }).importFields = Array.from(init.body.entries(), ([key, value]) =>
            typeof value === "string" ? { key, value } : { key, filename: value.name, mime: value.type },
          );
        }
        return original(input, init);
      };
    });
    const requestPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/import");
    await page.getByRole("button", { name: "Periksa pratinjau" }).click();
    const request = await requestPromise;
    await expect(page.getByRole("heading", { name: "Hasil pratinjau" })).toBeVisible();
    const action = request.headers()["next-action"];
    const fields = await page.evaluate(() => (window as Window & { importFields?: Array<{ key: string; value?: string; filename?: string; mime?: string }> }).importFields);
    if (!action || !fields?.length) throw new Error("Bentuk request aksi impor tidak tersedia.");
    const multipart = new FormData();
    for (const field of fields) {
      if (field.filename) multipart.append(field.key, new Blob([new Uint8Array(buffer)], { type: field.mime }), field.filename);
      else multipart.append(field.key, field.value ?? "");
    }
    const validReplay = await page.request.post("/data-peserta/import", { headers: { origin: "http://127.0.0.1:3100", "next-action": action }, multipart, failOnStatusCode: false });
    expect(validReplay.status()).toBe(200);
    expect(await validReplay.text()).toContain(nisn);
    const crossOrigin = await page.request.post("/data-peserta/import", { headers: { origin: "https://attacker.invalid", "next-action": action }, multipart, failOnStatusCode: false });
    expect(crossOrigin.status()).toBeGreaterThanOrEqual(400);
    const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
    if (!cookie) throw new Error("Sesi pengujian tidak ditemukan.");
    await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [createHash("sha256").update(cookie.value).digest("hex")]);
    await confirmSave(page);
    await expect.poll(async () => (await client.query("SELECT 1 FROM school_students WHERE nisn=$1", [nisn])).rowCount).toBe(0);
    await page.goto("/data-peserta/import");
    await expect(page).toHaveURL(/\/login/);
  } finally {
    await cleanup(client, [nisn], fixture.major, [fixture.periodA, fixture.periodB]);
    await client.end();
  }
});

test("batas 1.000 siswa dapat diperiksa dan disimpan dalam satu transaksi", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomBytes(5).toString("hex");
  const prefix = randomInt(100_000, 999_999).toString();
  const nisns = Array.from({ length: 1000 }, (_, index) => `${prefix}${index.toString().padStart(4, "0")}`);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    const workbook = makeImportWorkbook({ rows: nisns.map((nisn, index) => ({ cells: [index + 1, `Siswa Fiktif ${index + 1}`, nisn, `X ${fixture.major}`] })) });
    expect(workbook.length).toBeLessThan(512 * 1024);
    await loginAsAdmin(page);
    await prepareImport(page, fixture.periodA, workbook);
    await expect(page.getByText("Menampilkan 1–25 dari 1000 baris")).toBeVisible();
    await page.getByRole("button", { name: "Berikutnya" }).click();
    await expect(page.getByText("Menampilkan 26–50 dari 1000 baris")).toBeVisible();
    await confirmSave(page);
    await expect(page.getByRole("status")).toContainText("1000 siswa baru dan 1000 penempatan baru disimpan");
    const result = await client.query("SELECT count(*)::int AS n FROM school_students s JOIN student_class_placements p ON p.student_id=s.id AND p.ended_at IS NULL WHERE s.nisn=ANY($1::text[])", [nisns]);
    expect(result.rows[0].n).toBe(1000);
  } finally {
    await cleanup(client, nisns, fixture.major, [fixture.periodA, fixture.periodB]);
    await client.end();
  }
});

test.describe("impor pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("pratinjau tetap dapat dibaca tanpa overflow horizontal", async ({ page }) => {
    const suffix = randomBytes(5).toString("hex");
    const nisn = newNisn();
    const client = testDatabase();
    await client.connect();
    const fixture = await seedSchool(client, suffix);
    try {
      await loginAsAdmin(page);
      await prepareImport(page, fixture.periodA, makeImportWorkbook({ rows: [{ cells: [1, `Siswa Mobile ${suffix}`, nisn, `X ${fixture.major}`] }] }));
      await expect(page.getByRole("list", { name: "Hasil pratinjau impor" })).toContainText(nisn);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.getByRole("button", { name: "Simpan hasil impor" }).click();
      await expect(page.getByRole("dialog", { name: "Simpan hasil impor?" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.getByRole("dialog").getByRole("button", { name: "Batal" }).click();
    } finally {
      await cleanup(client, [nisn], fixture.major, [fixture.periodA, fixture.periodB]);
      await client.end();
    }
  });
});
