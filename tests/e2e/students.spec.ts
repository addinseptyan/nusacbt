import { createHash, randomBytes, randomInt } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";

import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes siswa hanya boleh memakai PGDATABASE=nusacbt_test.");
  return new pg.Client(postgresConfig());
}

function newNisn() {
  return `0${randomInt(0, 1_000_000_000).toString().padStart(9, "0")}`;
}

async function revokeCurrentSession(page: Page, client: pg.Client) {
  const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
  if (!cookie) throw new Error("Cookie sesi tes tidak ditemukan.");
  const digest = createHash("sha256").update(cookie.value).digest("hex");
  await client.query("DELETE FROM admin_sessions WHERE token_hash = $1", [digest]);
}

async function seedSchool(client: pg.Client, suffix: string) {
  const major = `AK${suffix}`;
  const renamedMajor = `AKbaru${suffix}`;
  const periodA = `Periode A ${suffix}`;
  const periodB = `Periode B ${suffix}`;
  const insertedMajor = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
  const classes = await client.query<{ id: string; level: string }>(
    "INSERT INTO school_classes (level, major_id) VALUES ('X', $1), ('XI', $1), ('XII', $1) RETURNING id::text AS id, level",
    [insertedMajor.rows[0].id],
  );
  const periods = await client.query<{ id: string; name: string }>(
    "INSERT INTO exam_periods (name, start_date) VALUES ($1, DATE '2026-01-01'), ($2, DATE '2026-07-01') RETURNING id::text AS id, name",
    [periodA, periodB],
  );
  const classId = (level: string) => classes.rows.find((item) => item.level === level)!.id;
  const periodId = (name: string) => periods.rows.find((item) => item.name === name)!.id;
  return { major, renamedMajor, periodA, periodB, classId, periodId };
}

async function cleanData(client: pg.Client, nisns: string[], majorNames: string[] = [], periodNames: string[] = []) {
  await client.query(
    `DELETE FROM student_class_placements WHERE student_id IN (SELECT id FROM school_students WHERE nisn = ANY($1::text[]))
      OR period_id IN (SELECT id FROM exam_periods WHERE name = ANY($2::text[]))`,
    [nisns, periodNames],
  );
  await client.query("DELETE FROM school_students WHERE nisn = ANY($1::text[])", [nisns]);
  await client.query("DELETE FROM school_classes WHERE major_id IN (SELECT id FROM school_majors WHERE name = ANY($1::text[]))", [majorNames]);
  await client.query("DELETE FROM school_majors WHERE name = ANY($1::text[])", [majorNames]);
  await client.query("DELETE FROM exam_periods WHERE name = ANY($1::text[])", [periodNames]);
}

function studentRow(page: Page, nisn: string) {
  return page.getByRole("list", { name: "Daftar siswa" }).getByRole("listitem").filter({ hasText: nisn });
}

async function openStudents(page: Page) {
  await page.goto("/data-peserta/siswa");
  await expect(page.getByRole("heading", { name: "Data Siswa", exact: true })).toBeVisible();
}

async function openPlacement(page: Page, nisn: string) {
  await studentRow(page, nisn).getByRole("button", { name: "Kelola penempatan" }).click();
  const dialog = page.getByRole("dialog", { name: "Kelola penempatan" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function choosePeriod(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole("combobox", { name: "Periode" }).click();
  await page.getByRole("option", { name }).click();
}

async function chooseClass(page: Page, dialog: Locator, label: string) {
  await dialog.getByRole("combobox", { name: "Kelas" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function assign(page: Page, nisn: string, period: string, schoolClass: string) {
  const dialog = await openPlacement(page, nisn);
  await choosePeriod(page, dialog, period);
  await chooseClass(page, dialog, schoolClass);
  await dialog.getByRole("button", { name: "Simpan penempatan" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
}

test("admin dapat menambah, mencari, mengubah, dan menghapus siswa yang belum ditempatkan", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = randomBytes(5).toString("hex");
  const name = `Siswa Uji ${suffix}`;
  const renamed = `Siswa Revisi ${suffix}`;
  const nisn = newNisn();
  let newNumber = newNisn();
  while (newNumber === nisn) newNumber = newNisn();
  const client = testDatabase();
  await client.connect();
  try {
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Peserta", exact: true }).click();
    await page.getByRole("link", { name: "Data Siswa", exact: true }).click();
    await expect(page).toHaveURL(/\/data-peserta\/siswa$/);
    await page.getByRole("button", { name: "Tambah siswa" }).click();
    let editor = page.getByRole("dialog", { name: "Tambah siswa" });
    await editor.getByLabel("Nama siswa").fill(`  ${name}  `);
    await editor.getByLabel("NISN").fill(nisn);
    const actionRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/siswa");
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    const request = await actionRequest;
    await expect(editor).toBeHidden();
    await expect(studentRow(page, nisn)).toContainText(name);
    expect((await client.query("SELECT name, nisn FROM school_students WHERE nisn = $1", [nisn])).rows).toEqual([{ name, nisn }]);

    const headers = request.headers();
    const body = request.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");
    const replay = await page.request.post("/data-peserta/siswa", {
      headers: { origin: "https://attacker.invalid", "content-type": headers["content-type"], "next-action": headers["next-action"] },
      data: body,
      failOnStatusCode: false,
    });
    expect(replay.status()).toBeGreaterThanOrEqual(400);
    expect((await client.query("SELECT 1 FROM school_students WHERE nisn = $1", [nisn])).rowCount).toBe(1);

    await page.getByRole("button", { name: "Tambah siswa" }).click();
    editor = page.getByRole("dialog", { name: "Tambah siswa" });
    await editor.getByLabel("Nama siswa").fill(`Duplikat ${suffix}`);
    await editor.getByLabel("NISN").fill("123456789");
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    await expect(editor.getByRole("alert")).toContainText("tepat 10 digit");
    await editor.getByLabel("NISN").fill("12345678901");
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    await expect(editor.getByRole("alert")).toContainText("tepat 10 digit");
    await expect(editor.getByLabel("NISN")).toHaveValue("12345678901");
    await editor.getByLabel("NISN").fill(nisn);
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    await expect(editor.getByRole("alert")).toContainText("NISN sudah digunakan");
    await editor.getByRole("button", { name: "Batal" }).click();

    await page.getByLabel("Cari siswa").fill(nisn);
    await expect(studentRow(page, nisn)).toBeVisible();
    await page.getByLabel("Cari siswa").fill(`tidak-ada-${suffix}`);
    await expect(page.getByText("Siswa tidak ditemukan")).toBeVisible();
    await page.getByLabel("Cari siswa").fill("");
    await studentRow(page, nisn).getByRole("button", { name: "Ubah siswa" }).click();
    editor = page.getByRole("dialog", { name: "Ubah siswa" });
    await editor.getByLabel("Nama siswa").fill(renamed);
    await editor.getByLabel("NISN").fill(newNumber);
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    await expect(editor).toBeHidden();
    await expect(studentRow(page, newNumber)).toContainText(renamed);
    expect((await client.query("SELECT name, nisn FROM school_students WHERE nisn = $1", [newNumber])).rows).toEqual([{ name: renamed, nisn: newNumber }]);

    await studentRow(page, newNumber).getByRole("button", { name: "Hapus siswa" }).click();
    let confirmation = page.getByRole("dialog", { name: "Hapus siswa?" });
    await confirmation.getByRole("button", { name: "Batal" }).click();
    await expect(studentRow(page, newNumber)).toBeVisible();
    await studentRow(page, newNumber).getByRole("button", { name: "Hapus siswa" }).click();
    confirmation = page.getByRole("dialog", { name: "Hapus siswa?" });
    await confirmation.getByRole("button", { name: "Ya, hapus siswa" }).click();
    // Daftar tersembunyi dari getByRole saat dialog terbuka; tunggu aksi selesai.
    await expect(confirmation).toBeHidden();
    await expect(studentRow(page, newNumber)).toHaveCount(0);
    expect((await client.query("SELECT 1 FROM school_students WHERE nisn = $1", [newNumber])).rowCount).toBe(0);
  } finally {
    await cleanData(client, [nisn, newNumber]);
    await client.end();
  }
});

test("penempatan lintas periode menyimpan riwayat dan melindungi siswa, kelas, serta periode", async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  const name = `Siswa Riwayat ${suffix}`;
  const major = `AK${suffix}`;
  const renamedMajor = `AKbaru${suffix}`;
  const periodA = `Periode A ${suffix}`;
  const periodB = `Periode B ${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    const fixture = await seedSchool(client, suffix);
    const student = await client.query("INSERT INTO school_students (name, nisn) VALUES ($1, $2) RETURNING id", [name, nisn]);
    const studentId = student.rows[0].id;
    await loginAsAdmin(page);
    await openStudents(page);

    await assign(page, nisn, periodA, `X ${major}`);
    let dialog = await openPlacement(page, nisn);
    await expect(dialog.getByRole("list", { name: "Riwayat penempatan" })).toContainText(`X ${major}`);
    await choosePeriod(page, dialog, periodA);
    await expect(dialog).toContainText(`Kelas aktif periode ini: X ${major}`);
    await chooseClass(page, dialog, `XI ${major}`);
    await dialog.getByRole("button", { name: "Simpan penempatan" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    let rows = await client.query("SELECT class_name_snapshot, ended_at IS NULL AS active FROM student_class_placements WHERE student_id = $1 ORDER BY id", [studentId]);
    expect(rows.rows).toEqual([{ class_name_snapshot: `X ${major}`, active: false }, { class_name_snapshot: `XI ${major}`, active: true }]);

    await page.goto("/data-peserta/kelas");
    const majorRow = page.getByRole("list", { name: "Daftar jurusan" }).getByRole("listitem").filter({ hasText: major });
    await majorRow.getByRole("button", { name: `Ubah jurusan ${major}` }).click();
    const majorEditor = page.getByRole("dialog", { name: "Ubah jurusan" });
    await majorEditor.getByLabel("Nama / kode jurusan").fill(renamedMajor);
    await majorEditor.getByRole("button", { name: "Simpan jurusan" }).click();
    await expect(majorEditor).toBeHidden();
    await openStudents(page);
    dialog = await openPlacement(page, nisn);
    const history = dialog.getByRole("list", { name: "Riwayat penempatan" });
    await expect(history).toContainText(`X ${major}`);
    await expect(history).toContainText(`XI ${major}`);
    await dialog.getByRole("button", { name: "Tutup" }).click();

    // Memilih kelas yang sama setelah jurusan diganti tidak mengubah snapshot lama.
    await assign(page, nisn, periodA, `XI ${renamedMajor}`);
    rows = await client.query("SELECT class_name_snapshot, ended_at IS NULL AS active FROM student_class_placements WHERE student_id = $1 ORDER BY id", [studentId]);
    expect(rows.rows).toEqual([{ class_name_snapshot: `X ${major}`, active: false }, { class_name_snapshot: `XI ${major}`, active: true }]);
    await assign(page, nisn, periodB, `XII ${renamedMajor}`);

    dialog = await openPlacement(page, nisn);
    const activeHistory = dialog.getByRole("list", { name: "Riwayat penempatan" }).getByRole("listitem").filter({ hasText: `XI ${major}` });
    await activeHistory.getByRole("button", { name: "Akhiri penempatan" }).click();
    const endDialog = page.getByRole("dialog", { name: "Akhiri penempatan?" });
    await expect(endDialog).toContainText("Riwayatnya tetap disimpan");
    await endDialog.getByRole("button", { name: "Ya, akhiri penempatan" }).click();
    await expect(endDialog).toBeHidden();
    await page.reload();
    dialog = await openPlacement(page, nisn);
    await expect(dialog.getByRole("listitem").filter({ hasText: `XI ${major}` })).toContainText("Berakhir");
    await dialog.getByRole("button", { name: "Tutup" }).click();
    await assign(page, nisn, periodA, `X ${renamedMajor}`);
    rows = await client.query("SELECT class_name_snapshot, ended_at IS NULL AS active FROM student_class_placements WHERE student_id = $1 ORDER BY id", [studentId]);
    expect(rows.rows).toEqual([
      { class_name_snapshot: `X ${major}`, active: false },
      { class_name_snapshot: `XI ${major}`, active: false },
      { class_name_snapshot: `XII ${renamedMajor}`, active: true },
      { class_name_snapshot: `X ${renamedMajor}`, active: true },
    ]);

    await studentRow(page, nisn).getByRole("button", { name: "Hapus siswa" }).click();
    let confirmation = page.getByRole("dialog", { name: "Hapus siswa?" });
    await confirmation.getByRole("button", { name: "Ya, hapus siswa" }).click();
    await expect(confirmation.getByRole("alert")).toContainText("Siswa memiliki riwayat penempatan");
    expect((await client.query("SELECT 1 FROM school_students WHERE id = $1", [studentId])).rowCount).toBe(1);
    await confirmation.getByRole("button", { name: "Batal" }).click();

    await page.goto("/data-peserta/kelas");
    const classRow = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `XI ${renamedMajor}` });
    await classRow.getByRole("button", { name: `Hapus kelas XI ${renamedMajor}` }).click();
    confirmation = page.getByRole("dialog", { name: "Hapus kelas?" });
    await confirmation.getByRole("button", { name: "Ya, hapus kelas" }).click();
    await expect(confirmation.getByRole("alert")).toContainText("Kelas masih digunakan oleh data lain");
    expect((await client.query("SELECT 1 FROM school_classes WHERE id = $1", [fixture.classId("XI")])).rowCount).toBe(1);
    await confirmation.getByRole("button", { name: "Batal" }).click();

    await page.goto("/data-peserta/periode");
    const periodRow = page.getByRole("list", { name: "Daftar periode ujian" }).getByRole("listitem").filter({ hasText: periodA });
    await periodRow.getByRole("button", { name: `Hapus periode ${periodA}` }).click();
    confirmation = page.getByRole("dialog", { name: "Hapus periode?" });
    await confirmation.getByRole("button", { name: "Ya, hapus periode" }).click();
    await expect(confirmation.getByRole("alert")).toContainText("Periode masih digunakan oleh data lain");
    expect((await client.query("SELECT 1 FROM exam_periods WHERE id = $1", [fixture.periodId(periodA)])).rowCount).toBe(1);
  } finally {
    await cleanData(client, [nisn], [major, renamedMajor], [periodA, periodB]);
    await client.end();
  }
});

test("aksi siswa dan penempatan menolak sesi admin yang dicabut", async ({ page }) => {
  test.setTimeout(75_000);
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  let attemptedNisn = newNisn();
  while (attemptedNisn === nisn) attemptedNisn = newNisn();
  const name = `Siswa Sesi ${suffix}`;
  const major = `AK${suffix}`;
  const renamedMajor = `AKbaru${suffix}`;
  const periodA = `Periode A ${suffix}`;
  const periodB = `Periode B ${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    const fixture = await seedSchool(client, suffix);
    const inserted = await client.query("INSERT INTO school_students (name, nisn) VALUES ($1, $2) RETURNING id", [name, nisn]);
    const studentId = inserted.rows[0].id;
    await loginAsAdmin(page);
    await openStudents(page);
    await page.getByRole("button", { name: "Tambah siswa" }).click();
    const editor = page.getByRole("dialog", { name: "Tambah siswa" });
    await editor.getByLabel("Nama siswa").fill(`Tertolak ${suffix}`);
    await editor.getByLabel("NISN").fill(attemptedNisn);
    await revokeCurrentSession(page, client);
    let response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/siswa");
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    await response;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM school_students WHERE nisn = $1", [attemptedNisn])).rowCount).toBe(0);

    await loginAsAdmin(page);
    await openStudents(page);
    let dialog = await openPlacement(page, nisn);
    await choosePeriod(page, dialog, periodA);
    await chooseClass(page, dialog, `X ${major}`);
    await revokeCurrentSession(page, client);
    response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/siswa");
    await dialog.getByRole("button", { name: "Simpan penempatan" }).click();
    await response;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE student_id = $1", [studentId])).rowCount).toBe(0);

    await loginAsAdmin(page);
    await openStudents(page);
    await studentRow(page, nisn).getByRole("button", { name: "Hapus siswa" }).click();
    let confirmation = page.getByRole("dialog", { name: "Hapus siswa?" });
    await revokeCurrentSession(page, client);
    response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/siswa");
    await confirmation.getByRole("button", { name: "Ya, hapus siswa" }).click();
    await response;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM school_students WHERE id = $1", [studentId])).rowCount).toBe(1);

    await client.query("INSERT INTO student_class_placements (student_id, period_id, class_id, class_name_snapshot) VALUES ($1,$2,$3,$4)", [studentId, fixture.periodId(periodA), fixture.classId("X"), `X ${major}`]);
    await loginAsAdmin(page);
    await openStudents(page);
    dialog = await openPlacement(page, nisn);
    await dialog.getByRole("button", { name: "Akhiri penempatan" }).click();
    confirmation = page.getByRole("dialog", { name: "Akhiri penempatan?" });
    await revokeCurrentSession(page, client);
    response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/siswa");
    await confirmation.getByRole("button", { name: "Ya, akhiri penempatan" }).click();
    await response;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE student_id = $1 AND ended_at IS NULL", [studentId])).rowCount).toBe(1);
  } finally {
    await cleanData(client, [nisn, attemptedNisn], [major, renamedMajor], [periodA, periodB]);
    await client.end();
  }
});

test("penempatan yang berubah di sesi lain tidak ditimpa tanpa disadari", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  const name = `Siswa Bersamaan ${suffix}`;
  const major = `AK${suffix}`;
  const renamedMajor = `AKbaru${suffix}`;
  const periodA = `Periode A ${suffix}`;
  const periodB = `Periode B ${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    const fixture = await seedSchool(client, suffix);
    const student = await client.query("INSERT INTO school_students (name, nisn) VALUES ($1,$2) RETURNING id", [name, nisn]);
    const studentId = student.rows[0].id;
    await loginAsAdmin(page);
    await openStudents(page);
    const dialog = await openPlacement(page, nisn);
    await choosePeriod(page, dialog, periodA);
    await chooseClass(page, dialog, `X ${major}`);
    await client.query("INSERT INTO student_class_placements (student_id, period_id, class_id, class_name_snapshot) VALUES ($1,$2,$3,$4)", [studentId, fixture.periodId(periodA), fixture.classId("XI"), `XI ${major}`]);
    await dialog.getByRole("button", { name: "Simpan penempatan" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Penempatan berubah di sesi lain");
    expect((await client.query("SELECT class_name_snapshot FROM student_class_placements WHERE student_id = $1 AND ended_at IS NULL", [studentId])).rows).toEqual([{ class_name_snapshot: `XI ${major}` }]);
    await dialog.getByRole("button", { name: "Tutup" }).click();
    await page.reload();
    await assign(page, nisn, periodA, `X ${major}`);
    const rows = await client.query("SELECT class_name_snapshot, ended_at IS NULL AS active FROM student_class_placements WHERE student_id = $1 ORDER BY id", [studentId]);
    expect(rows.rows).toEqual([{ class_name_snapshot: `XI ${major}`, active: false }, { class_name_snapshot: `X ${major}`, active: true }]);
  } finally {
    await cleanData(client, [nisn], [major, renamedMajor], [periodA, periodB]);
    await client.end();
  }
});

test("perubahan siswa yang lebih baru tidak ditimpa atau dihapus dari formulir lama", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  const name = `Siswa Lama ${suffix}`;
  const updated = `Siswa Baru ${suffix}`;
  const updatedAgain = `Siswa Terbaru ${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    await client.query("INSERT INTO school_students (name,nisn) VALUES ($1,$2)", [name, nisn]);
    await loginAsAdmin(page);
    await openStudents(page);
    await studentRow(page, nisn).getByRole("button", { name: "Ubah siswa" }).click();
    let editor = page.getByRole("dialog", { name: "Ubah siswa" });
    await client.query("UPDATE school_students SET name=$1, updated_at=clock_timestamp() WHERE nisn=$2", [updated, nisn]);
    await editor.getByLabel("Nama siswa").fill(`Edit Lama ${suffix}`);
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    await expect(editor.getByRole("alert")).toContainText("Data siswa sudah berubah atau sudah dihapus");
    expect((await client.query("SELECT name FROM school_students WHERE nisn=$1", [nisn])).rows).toEqual([{ name: updated }]);
    await editor.getByRole("button", { name: "Batal" }).click();
    await page.reload();
    await studentRow(page, nisn).getByRole("button", { name: "Hapus siswa" }).click();
    const confirmation = page.getByRole("dialog", { name: "Hapus siswa?" });
    await client.query("UPDATE school_students SET name=$1, updated_at=clock_timestamp() WHERE nisn=$2", [updatedAgain, nisn]);
    await confirmation.getByRole("button", { name: "Ya, hapus siswa" }).click();
    await expect(confirmation.getByRole("alert")).toContainText("Data siswa sudah berubah atau sudah dihapus");
    expect((await client.query("SELECT name FROM school_students WHERE nisn=$1", [nisn])).rows).toEqual([{ name: updatedAgain }]);
    await confirmation.getByRole("button", { name: "Batal" }).click();
    await page.reload();
    await studentRow(page, nisn).getByRole("button", { name: "Ubah siswa" }).click();
    editor = page.getByRole("dialog", { name: "Ubah siswa" });
    await editor.getByLabel("Nama siswa").fill(`Siswa Final ${suffix}`);
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    await expect(editor).toBeHidden();
    expect((await client.query("SELECT name FROM school_students WHERE nisn=$1", [nisn])).rows).toEqual([{ name: `Siswa Final ${suffix}` }]);
  } finally {
    await cleanData(client, [nisn]);
    await client.end();
  }
});

test("nama siswa ditampilkan sebagai teks, bukan markup atau perintah SQL", async ({ page }) => {
  const suffix = randomBytes(4).toString("hex");
  const nisn = newNisn();
  const name = `Tes <img src=x onerror=alert(1)> '; -- ${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    await loginAsAdmin(page);
    await openStudents(page);
    await page.getByRole("button", { name: "Tambah siswa" }).click();
    const editor = page.getByRole("dialog", { name: "Tambah siswa" });
    await editor.getByLabel("Nama siswa").fill(name);
    await editor.getByLabel("NISN").fill(nisn);
    await editor.getByRole("button", { name: "Simpan siswa" }).click();
    await expect(editor).toBeHidden();
    await expect(studentRow(page, nisn)).toContainText(name);
    await expect(studentRow(page, nisn).locator("img")).toHaveCount(0);
    expect((await client.query("SELECT name FROM school_students WHERE nisn = $1", [nisn])).rows).toEqual([{ name }]);
  } finally {
    await cleanData(client, [nisn]);
    await client.end();
  }
});

test.describe("data siswa pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 640 } });

  test("daftar dan dialog penempatan dapat digunakan tanpa overflow", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = randomBytes(5).toString("hex");
    const nisn = newNisn();
    const name = `Siswa${suffix}${"N".repeat(70)}`;
    const major = `M${suffix}${"K".repeat(40)}`;
    const period = `Periode ${suffix} ${"P".repeat(65)}`;
    const client = testDatabase();
    await client.connect();
    try {
      const m = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
      await client.query("INSERT INTO school_classes (level, major_id) VALUES ('XII',$1)", [m.rows[0].id]);
      await client.query("INSERT INTO exam_periods (name,start_date) VALUES ($1,DATE '2026-07-01')", [period]);
      await client.query("INSERT INTO school_students (name,nisn) VALUES ($1,$2)", [name, nisn]);
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await page.getByRole("menuitem", { name: "Gelap" }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await openStudents(page);
      await expect(studentRow(page, nisn)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      let dialog = await openPlacement(page, nisn);
      await choosePeriod(page, dialog, period);
      await chooseClass(page, dialog, `XII ${major}`);
      await dialog.getByRole("button", { name: "Simpan penempatan" }).click();
      await expect(dialog).toBeHidden();
      await page.reload();
      await page.setViewportSize({ width: 360, height: 320 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      dialog = await openPlacement(page, nisn);
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error("Dialog tidak terlihat.");
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(320);
      await dialog.getByRole("button", { name: "Tutup" }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Tutup" })).toBeInViewport();
      await dialog.getByRole("button", { name: "Tutup" }).click();
    } finally {
      await cleanData(client, [nisn], [major], [period]);
      await client.end();
    }
  });
});

test("database menjaga NISN, satu kelas aktif per periode, dan riwayat referensi", async () => {
  const client = testDatabase();
  await client.connect();
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  try {
    await client.query("BEGIN");
    const student = await client.query("INSERT INTO school_students (name,nisn) VALUES ($1,$2) RETURNING id", [`DB ${suffix}`, nisn]);
    const major = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [`DB${suffix}`]);
    const schoolClass = await client.query("INSERT INTO school_classes (level,major_id) VALUES ('X',$1) RETURNING id", [major.rows[0].id]);
    const period = await client.query("INSERT INTO exam_periods (name,start_date) VALUES ($1,DATE '2026-01-01') RETURNING id", [`DB Periode ${suffix}`]);
    const ids = [student.rows[0].id, period.rows[0].id, schoolClass.rows[0].id];
    await client.query("INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)", [...ids, `X DB${suffix}`]);
    const checks: Array<{ sql: string; values: unknown[]; code: string | RegExp; constraint?: string }> = [
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["   ", newNisn()], code: "23514", constraint: "school_students_name_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["Nama\nKontrol", newNisn()], code: "23514", constraint: "school_students_name_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["x".repeat(101), newNisn()], code: "23514", constraint: "school_students_name_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["Pendek", "123456789"], code: "23514", constraint: "school_students_nisn_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["Bukan angka", "12345a7890"], code: "23514", constraint: "school_students_nisn_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["Duplikat", nisn], code: "23505", constraint: "school_students_nisn_key" },
      { sql: "INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)", values: [...ids, `X DB${suffix}`], code: "23505", constraint: "student_class_placements_one_active_idx" },
      { sql: "INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot,ended_at) VALUES ($1,$2,$3,$4,now()-interval '1 day')", values: [...ids, `X DB${suffix}`], code: "23514", constraint: "student_class_placements_dates_check" },
      { sql: "DELETE FROM school_students WHERE id=$1", values: [ids[0]], code: /^(23503|23001)$/, constraint: "student_class_placements_student_id_fkey" },
      { sql: "DELETE FROM exam_periods WHERE id=$1", values: [ids[1]], code: /^(23503|23001)$/, constraint: "student_class_placements_period_id_fkey" },
      { sql: "DELETE FROM school_classes WHERE id=$1", values: [ids[2]], code: /^(23503|23001)$/, constraint: "student_class_placements_class_id_fkey" },
    ];
    for (const { sql, values, code, constraint } of checks) {
      await client.query("SAVEPOINT periksa_siswa");
      try {
        await expect(client.query(sql, values)).rejects.toMatchObject({
          code: code instanceof RegExp ? expect.stringMatching(code) : code,
          ...(constraint ? { constraint } : {}),
        });
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT periksa_siswa");
      }
    }
    expect((await client.query("SELECT 1 FROM school_students WHERE id=$1", [ids[0]])).rowCount).toBe(1);
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE student_id=$1 AND ended_at IS NULL", [ids[0]])).rowCount).toBe(1);
    await client.query("UPDATE student_class_placements SET ended_at=now() WHERE student_id=$1", [ids[0]]);
    await client.query("INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)", [...ids, `X DB${suffix}`]);
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE student_id=$1", [ids[0]])).rowCount).toBe(2);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("database menolak dua penempatan aktif yang dibuat bersamaan", async () => {
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  const major = `AK${suffix}`;
  const renamedMajor = `AKbaru${suffix}`;
  const periodA = `Periode A ${suffix}`;
  const periodB = `Periode B ${suffix}`;
  const client = testDatabase();
  const second = testDatabase();
  await Promise.all([client.connect(), second.connect()]);
  try {
    const fixture = await seedSchool(client, suffix);
    const student = await client.query("INSERT INTO school_students (name,nisn) VALUES ($1,$2) RETURNING id", [`Bersamaan ${suffix}`, nisn]);
    const values = [student.rows[0].id, fixture.periodId(periodA), fixture.classId("X"), `X ${major}`];
    const sql = "INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)";
    const outcomes = await Promise.allSettled([client.query(sql, values), second.query(sql, values)]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((item) => item.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "23505", constraint: "student_class_placements_one_active_idx" } });
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE student_id=$1 AND period_id=$2 AND ended_at IS NULL", values.slice(0, 2))).rowCount).toBe(1);
  } finally {
    await cleanData(client, [nisn], [major, renamedMajor], [periodA, periodB]);
    await Promise.all([client.end(), second.end()]);
  }
});
