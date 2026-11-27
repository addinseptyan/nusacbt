import { createHash, randomBytes, randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
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
  const yearA = `Tahun Siswa A ${suffix}`;
  const yearB = `Tahun Siswa B ${suffix}`;
  const periodA = `Periode Siswa A ${suffix}`;
  const periodB = `Periode Siswa B ${suffix}`;
  const insertedMajor = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
  const classes = await client.query<{ id: string; level: string }>(
    "INSERT INTO school_classes (level, major_id) VALUES ('X', $1), ('XI', $1), ('XII', $1) RETURNING id::text AS id, level",
    [insertedMajor.rows[0].id],
  );
  const years = await client.query<{ id: string; name: string }>(
    "INSERT INTO academic_years (name) VALUES ($1), ($2) RETURNING id::text AS id, name",
    [yearA, yearB],
  );
  const yearId = (name: string) => years.rows.find((item) => item.name === name)!.id;
  const periods = await client.query<{ id: string; name: string }>(
    "INSERT INTO exam_periods (name, start_date, academic_year_id) VALUES ($1, DATE '2026-01-01', $3), ($2, DATE '2026-07-01', $4) RETURNING id::text AS id, name",
    [periodA, periodB, yearId(yearA), yearId(yearB)],
  );
  const classId = (level: string) => classes.rows.find((item) => item.level === level)!.id;
  const periodId = (name: string) => periods.rows.find((item) => item.name === name)!.id;
  return { major, renamedMajor, yearA, yearB, periodA, periodB, classId, yearId, periodId };
}

async function cleanData(client: pg.Client, nisns: string[], majorNames: string[] = [], periodNames: string[] = [], yearNames: string[] = []) {
  await client.query(
    `DELETE FROM student_class_placements WHERE student_id IN (SELECT id FROM school_students WHERE nisn = ANY($1::text[]))
      OR period_id IN (SELECT id FROM exam_periods WHERE name = ANY($2::text[]))`,
    [nisns, periodNames],
  );
  await client.query(
    `DELETE FROM academic_year_enrollments WHERE student_id IN (SELECT id FROM school_students WHERE nisn = ANY($1::text[]))
      OR academic_year_id IN (SELECT id FROM academic_years WHERE name = ANY($2::text[]))`,
    [nisns, yearNames],
  );
  await client.query("DELETE FROM school_students WHERE nisn = ANY($1::text[])", [nisns]);
  await client.query("DELETE FROM school_classes WHERE major_id IN (SELECT id FROM school_majors WHERE name = ANY($1::text[]))", [majorNames]);
  await client.query("DELETE FROM school_majors WHERE name = ANY($1::text[])", [majorNames]);
  await client.query("DELETE FROM exam_periods WHERE name = ANY($1::text[])", [periodNames]);
  await client.query("DELETE FROM academic_years WHERE name = ANY($1::text[])", [yearNames]);
}

function studentRow(page: Page, nisn: string) {
  return page.getByRole("row").filter({ hasText: nisn });
}

async function openStudents(page: Page, yearId?: string) {
  await page.goto(yearId ? `/data-peserta/siswa?tahun=${yearId}` : "/data-peserta/siswa");
  await expect(page.getByRole("heading", { name: "Data Siswa", exact: true })).toBeVisible();
}

test("admin dapat menambah, mencari, memfilter, dan mengubah siswa serta kelas/status per tahun", async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = randomBytes(5).toString("hex");
  const name = `Siswa Uji ${suffix}`;
  const renamed = `Siswa Revisi ${suffix}`;
  const nisn = newNisn();
  let newNumber = newNisn();
  while (newNumber === nisn) newNumber = newNisn();
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Peserta", exact: true }).click();
    await page.getByRole("link", { name: "Data Siswa", exact: true }).click();
    await expect(page).toHaveURL(/\/data-peserta\/siswa$/);
    await page.getByLabel("Tahun ajaran").selectOption(fixture.yearId(fixture.yearA));
    await expect(page).toHaveURL(new RegExp(`/data-peserta/siswa\\?tahun=${fixture.yearId(fixture.yearA)}$`));

    await page.getByRole("button", { name: "Tambah siswa baru" }).click();
    let dialog = page.getByRole("dialog", { name: "Tambah siswa baru" });
    await dialog.getByLabel("Nama siswa").fill(`  ${name}  `);
    await dialog.getByLabel("NISN").fill(nisn);
    await dialog.getByLabel("Kelas / rombel").selectOption(fixture.classId("X"));
    const actionRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/siswa");
    await dialog.getByRole("button", { name: "Simpan", exact: true }).click();
    const request = await actionRequest;
    await expect(dialog).toBeHidden();
    await expect(studentRow(page, nisn)).toContainText(name.toUpperCase());
    await expect(studentRow(page, nisn)).toContainText(`X ${fixture.major}`);
    await expect(studentRow(page, nisn)).toContainText("Aktif");
    expect((await client.query("SELECT name, nisn FROM school_students WHERE nisn = $1", [nisn])).rows).toEqual([{ name: name.toUpperCase(), nisn }]);

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

    // Duplikasi NISN ditolak saat tambah baru.
    await page.getByRole("button", { name: "Tambah siswa baru" }).click();
    dialog = page.getByRole("dialog", { name: "Tambah siswa baru" });
    await dialog.getByLabel("Nama siswa").fill(`Duplikat ${suffix}`);
    await dialog.getByLabel("NISN").fill(nisn);
    await dialog.getByLabel("Kelas / rombel").selectOption(fixture.classId("X"));
    await dialog.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("NISN sudah digunakan");
    await dialog.getByRole("button", { name: "Batal" }).click();

    await page.getByLabel("Nama / NISN").fill(nisn);
    await expect(studentRow(page, nisn)).toBeVisible();
    await page.getByLabel("Nama / NISN").fill(`tidak-ada-${suffix}`);
    await expect(page.getByText("Tidak ada siswa pada pilihan ini.")).toBeVisible();
    await page.getByLabel("Nama / NISN").fill("");
    await page.getByLabel("Kelas / rombel").selectOption(fixture.classId("XI"));
    await expect(page.getByText("Tidak ada siswa pada pilihan ini.")).toBeVisible();
    await page.getByLabel("Kelas / rombel").selectOption("");

    // Ubah identitas (nama + NISN) dan kelas sekaligus melalui dialog terpadu Kelola (tanpa window.confirm).
    await studentRow(page, nisn).getByRole("button", { name: "Kelola" }).click();
    dialog = page.getByRole("dialog", { name: new RegExp(`^Kelola siswa ·`) });
    await dialog.getByLabel("Nama siswa").fill(renamed);
    await dialog.getByLabel("NISN").fill(newNumber);
    await dialog.getByLabel("Kelas / rombel").selectOption(fixture.classId("XI"));
    await dialog.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(studentRow(page, newNumber)).toContainText(renamed.toUpperCase());
    await expect(studentRow(page, newNumber)).toContainText(`XI ${fixture.major}`);
    expect((await client.query("SELECT name, nisn FROM school_students WHERE nisn = $1", [newNumber])).rows).toEqual([{ name: renamed.toUpperCase(), nisn: newNumber }]);

    const studentId = (await client.query<{ id: string }>("SELECT id::text AS id FROM school_students WHERE nisn = $1", [newNumber])).rows[0].id;
    let placements = await client.query(
      "SELECT class_name_snapshot, ended_at IS NULL AS active FROM student_class_placements WHERE student_id = $1 ORDER BY id",
      [studentId],
    );
    expect(placements.rows).toEqual([
      { class_name_snapshot: `X ${fixture.major}`, active: false },
      { class_name_snapshot: `XI ${fixture.major}`, active: true },
    ]);

    await page.goto("/data-peserta/kelas");
    const majorRow = page.getByRole("list", { name: "Daftar jurusan" }).getByRole("listitem").filter({ hasText: fixture.major });
    await majorRow.getByRole("button", { name: `Ubah jurusan ${fixture.major}` }).click();
    const majorEditor = page.getByRole("dialog", { name: "Ubah jurusan" });
    await majorEditor.getByLabel("Nama / kode jurusan").fill(fixture.renamedMajor);
    await majorEditor.getByRole("button", { name: "Simpan jurusan" }).click();
    await expect(majorEditor).toBeHidden();

    // Ubah status menjadi Lulus mengakhiri penempatan periode aktif sambil menyimpan kelas terakhir.
    await openStudents(page, fixture.yearId(fixture.yearA));
    await studentRow(page, newNumber).getByRole("button", { name: "Kelola" }).click();
    dialog = page.getByRole("dialog", { name: `Kelola siswa · ${renamed.toUpperCase()}` });
    await dialog.getByLabel("Status siswa").selectOption("graduated");
    await dialog.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(studentRow(page, newNumber)).toContainText("Lulus");
    placements = await client.query(
      "SELECT class_name_snapshot, ended_at IS NULL AS active FROM student_class_placements WHERE student_id = $1 ORDER BY id",
      [studentId],
    );
    expect(placements.rows).toEqual([
      { class_name_snapshot: `X ${fixture.major}`, active: false },
      { class_name_snapshot: `XI ${fixture.major}`, active: false },
    ]);

    // Siswa yang sudah ada dapat ditambahkan ke tahun ajaran lain.
    await page.getByLabel("Tahun ajaran").selectOption(fixture.yearId(fixture.yearB));
    await expect(page).toHaveURL(new RegExp(`/data-peserta/siswa\\?tahun=${fixture.yearId(fixture.yearB)}$`));
    await page.getByRole("button", { name: "Tambahkan siswa yang sudah ada" }).click();
    dialog = page.getByRole("dialog", { name: "Tambahkan siswa yang sudah ada" });
    await dialog.getByLabel("Siswa").selectOption(studentId);
    await dialog.getByLabel("Kelas / rombel").selectOption(fixture.classId("XII"));
    await dialog.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(studentRow(page, newNumber)).toContainText(`XII ${fixture.renamedMajor}`);
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE student_id = $1 AND period_id = $2 AND ended_at IS NULL", [studentId, fixture.periodId(fixture.periodB)])).rowCount).toBe(1);

    // Siswa, kelas, periode, dan tahun dengan riwayat dilindungi.
    await page.goto("/data-peserta/kelas");
    const classRow = page.getByRole("list", { name: "Daftar kelas" }).getByRole("listitem").filter({ hasText: `XI ${fixture.renamedMajor}` });
    await classRow.getByRole("button", { name: `Hapus kelas XI ${fixture.renamedMajor}` }).click();
    const classConfirm = page.getByRole("dialog", { name: "Hapus kelas?" });
    await classConfirm.getByRole("button", { name: "Ya, hapus kelas" }).click();
    await expect(classConfirm.getByRole("alert")).toContainText("Kelas masih digunakan oleh data lain");
    await classConfirm.getByRole("button", { name: "Batal" }).click();

    await page.goto("/data-peserta/periode");
    const periodRow = page.getByRole("list", { name: "Daftar periode ujian" }).getByRole("listitem").filter({ hasText: fixture.periodA });
    await periodRow.getByRole("button", { name: `Hapus periode ${fixture.periodA}` }).click();
    const periodConfirm = page.getByRole("dialog", { name: "Hapus periode?" });
    await periodConfirm.getByRole("button", { name: "Ya, hapus periode" }).click();
    await expect(periodConfirm.getByRole("alert")).toContainText("Periode masih digunakan oleh data lain");
  } finally {
    await cleanData(client, [nisn, newNumber], [fixture.major, fixture.renamedMajor], [fixture.periodA, fixture.periodB], [fixture.yearA, fixture.yearB]);
    await client.end();
  }
});

test("nama lama tidak berubah otomatis, tetapi disimpan kapital ketika diedit", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn(); let otherNisn = newNisn();
  while (otherNisn === nisn) otherNisn = newNisn();
  const legacy = `Nama Lama ${suffix}`; const untouched = `Nama Lain ${suffix}`;
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    const inserted = await client.query<{ id: string; nisn: string }>(
      "INSERT INTO school_students(name,nisn) VALUES($1,$2),($3,$4) RETURNING id::text AS id, nisn",
      [legacy, nisn, untouched, otherNisn],
    );
    const idOf = (value: string) => inserted.rows.find((row) => row.nisn === value)!.id;
    await client.query(
      "INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,$4,'active'),($1,$5,$3,$4,'active')",
      [fixture.yearId(fixture.yearA), idOf(nisn), fixture.classId("X"), `X ${fixture.major}`, idOf(otherNisn)],
    );
    await loginAsAdmin(page); await openStudents(page, fixture.yearId(fixture.yearA));
    await page.getByLabel("Nama / NISN").fill(nisn);
    await expect(studentRow(page, nisn)).toContainText(legacy);
    expect((await client.query("SELECT name FROM school_students WHERE nisn=$1", [nisn])).rows).toEqual([{ name: legacy }]);
    await studentRow(page, nisn).getByRole("button", { name: "Kelola" }).click();
    const editor = page.getByRole("dialog", { name: `Kelola siswa · ${legacy}` });
    await expect(editor.getByLabel("Nama siswa")).toHaveValue(legacy);
    await editor.getByRole("button", { name: "Simpan perubahan" }).click();
    await expect(editor).toBeHidden();
    await expect(studentRow(page, nisn)).toContainText(legacy.toUpperCase());
    expect((await client.query("SELECT name FROM school_students WHERE nisn=$1", [nisn])).rows).toEqual([{ name: legacy.toUpperCase() }]);
    expect((await client.query("SELECT name FROM school_students WHERE nisn=$1", [otherNisn])).rows).toEqual([{ name: untouched }]);
  } finally {
    await cleanData(client, [nisn, otherNisn], [fixture.major], [fixture.periodA, fixture.periodB], [fixture.yearA, fixture.yearB]);
    await client.end();
  }
});

test("aksi roster dan identitas menolak sesi admin yang dicabut", async ({ page }) => {
  test.setTimeout(75_000);
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  let attemptedNisn = newNisn();
  while (attemptedNisn === nisn) attemptedNisn = newNisn();
  const name = `Siswa Sesi ${suffix}`;
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    const inserted = await client.query("INSERT INTO school_students (name, nisn) VALUES ($1, $2) RETURNING id", [name, nisn]);
    const studentId = inserted.rows[0].id;
    await client.query(
      "INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,$4,'active')",
      [fixture.yearId(fixture.yearA), studentId, fixture.classId("X"), `X ${fixture.major}`],
    );
    await loginAsAdmin(page);
    await openStudents(page, fixture.yearId(fixture.yearA));
    await page.getByRole("button", { name: "Tambah siswa baru" }).click();
    let editor = page.getByRole("dialog", { name: "Tambah siswa baru" });
    await editor.getByLabel("Nama siswa").fill(`Tertolak ${suffix}`);
    await editor.getByLabel("NISN").fill(attemptedNisn);
    await editor.getByLabel("Kelas / rombel").selectOption(fixture.classId("X"));
    await revokeCurrentSession(page, client);
    let response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname.startsWith("/data-peserta/siswa"));
    await editor.getByRole("button", { name: "Simpan", exact: true }).click();
    await response;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT 1 FROM school_students WHERE nisn = $1", [attemptedNisn])).rowCount).toBe(0);

    await loginAsAdmin(page);
    await openStudents(page, fixture.yearId(fixture.yearA));
    await studentRow(page, nisn).getByRole("button", { name: "Kelola" }).click();
    editor = page.getByRole("dialog", { name: `Kelola siswa · ${name}` });
    await editor.getByLabel("Kelas / rombel").selectOption(fixture.classId("XI"));
    await editor.getByLabel("Nama siswa").fill(`Identitas Tertolak ${suffix}`);
    await revokeCurrentSession(page, client);
    response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname.startsWith("/data-peserta/siswa"));
    await editor.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
    await response;
    await expect(page).toHaveURL(/\/login$/);
    expect((await client.query("SELECT class_id::text AS id FROM academic_year_enrollments WHERE student_id = $1", [studentId])).rows).toEqual([{ id: fixture.classId("X") }]);
    expect((await client.query("SELECT name FROM school_students WHERE id = $1", [studentId])).rows).toEqual([{ name }]);
  } finally {
    await cleanData(client, [nisn, attemptedNisn], [fixture.major], [fixture.periodA, fixture.periodB], [fixture.yearA, fixture.yearB]);
    await client.end();
  }
});

test("perubahan roster dan identitas yang lebih baru tidak ditimpa atau bertabrakan bersamaan", async ({ page, browser }) => {
  test.setTimeout(75_000);
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  const otherNisn = newNisn();
  const name = `Siswa Lama ${suffix}`;
  const updated = `Siswa Baru ${suffix}`;
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  try {
    const inserted = await client.query<{ id: string }>("INSERT INTO school_students (name,nisn) VALUES ($1,$2) RETURNING id::text AS id", [name, nisn]);
    const studentId = inserted.rows[0].id;
    const raceStudentId = (await client.query<{ id: string }>("INSERT INTO school_students (name,nisn) VALUES ($1,$2) RETURNING id::text AS id", [`Siswa Race ${suffix}`, otherNisn])).rows[0].id;
    await client.query(
      "INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,$4,'active')",
      [fixture.yearId(fixture.yearA), studentId, fixture.classId("X"), `X ${fixture.major}`],
    );

    await loginAsAdmin(page);
    await openStudents(page, fixture.yearId(fixture.yearA));
    await studentRow(page, nisn).getByRole("button", { name: "Kelola" }).click();
    const rosterDialog = page.getByRole("dialog", { name: `Kelola siswa · ${name}` });
    await rosterDialog.getByLabel("Kelas / rombel").selectOption(fixture.classId("XII"));
    await client.query("UPDATE academic_year_enrollments SET class_id=$1, class_name_snapshot=$2 WHERE academic_year_id=$3 AND student_id=$4", [fixture.classId("XI"), `XI ${fixture.major}`, fixture.yearId(fixture.yearA), studentId]);
    await rosterDialog.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
    await expect(rosterDialog.getByRole("alert")).toContainText("Data siswa pada tahun ini berubah");
    expect((await client.query("SELECT class_name_snapshot FROM academic_year_enrollments WHERE student_id=$1", [studentId])).rows).toEqual([{ class_name_snapshot: `XI ${fixture.major}` }]);
    await rosterDialog.getByRole("button", { name: "Batal" }).click();

    await page.reload();
    await studentRow(page, nisn).getByRole("button", { name: "Kelola" }).click();
    const identityDialog = page.getByRole("dialog", { name: `Kelola siswa · ${name}` });
    await client.query("UPDATE school_students SET name=$1, updated_at=clock_timestamp() WHERE nisn=$2", [updated, nisn]);
    await identityDialog.getByLabel("Nama siswa").fill(`Edit Lama ${suffix}`);
    await identityDialog.getByRole("button", { name: "Simpan perubahan" }).click();
    await expect(identityDialog.getByRole("alert")).toContainText("Data identitas siswa berubah atau sudah dihapus");
    expect((await client.query("SELECT name FROM school_students WHERE nisn=$1", [nisn])).rows).toEqual([{ name: updated }]);
    await identityDialog.getByRole("button", { name: "Batal" }).click();

    // Penambahan siswa yang sudah ada dari dua tab bersamaan tidak boleh membuat duplikat.
    await loginAsAdmin(otherPage);
    await openStudents(page, fixture.yearId(fixture.yearA));
    await openStudents(otherPage, fixture.yearId(fixture.yearA));
    await page.getByRole("button", { name: "Tambahkan siswa yang sudah ada" }).click();
    await otherPage.getByRole("button", { name: "Tambahkan siswa yang sudah ada" }).click();
    const d1 = page.getByRole("dialog", { name: "Tambahkan siswa yang sudah ada" });
    const d2 = otherPage.getByRole("dialog", { name: "Tambahkan siswa yang sudah ada" });
    await d1.getByLabel("Siswa").selectOption(raceStudentId);
    await d1.getByLabel("Kelas / rombel").selectOption(fixture.classId("X"));
    await d2.getByLabel("Siswa").selectOption(raceStudentId);
    await d2.getByLabel("Kelas / rombel").selectOption(fixture.classId("XI"));
    await Promise.all([
      d1.getByRole("button", { name: "Simpan", exact: true }).click(),
      d2.getByRole("button", { name: "Simpan", exact: true }).click(),
    ]);
    await expect.poll(async () => Number(await d1.isVisible()) + Number(await d2.isVisible())).toBe(1);
    const loser = await d1.isVisible() ? d1 : d2;
    await expect(loser.getByRole("alert")).toContainText("sudah tercatat");
    expect((await client.query("SELECT count(*)::int AS n FROM academic_year_enrollments WHERE academic_year_id=$1 AND student_id=$2", [fixture.yearId(fixture.yearA), raceStudentId])).rows[0].n).toBe(1);
  } finally {
    await otherContext.close();
    await cleanData(client, [nisn, otherNisn], [fixture.major], [fixture.periodA, fixture.periodB], [fixture.yearA, fixture.yearB]);
    await client.end();
  }
});

test("nama siswa ditampilkan sebagai teks, bukan markup atau perintah SQL", async ({ page }) => {
  const suffix = randomBytes(4).toString("hex");
  const nisn = newNisn();
  const name = `Tes <img src=x onerror=alert(1)> '; -- ${suffix}`;
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, suffix);
  try {
    await loginAsAdmin(page);
    await openStudents(page, fixture.yearId(fixture.yearA));
    await page.getByRole("button", { name: "Tambah siswa baru" }).click();
    const editor = page.getByRole("dialog", { name: "Tambah siswa baru" });
    await editor.getByLabel("Nama siswa").fill(name);
    await editor.getByLabel("NISN").fill(nisn);
    await editor.getByLabel("Kelas / rombel").selectOption(fixture.classId("X"));
    await editor.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(studentRow(page, nisn)).toContainText(name.toUpperCase());
    await expect(studentRow(page, nisn).locator("img")).toHaveCount(0);
    expect((await client.query("SELECT name FROM school_students WHERE nisn = $1", [nisn])).rows).toEqual([{ name: name.toUpperCase() }]);
  } finally {
    await cleanData(client, [nisn], [fixture.major], [fixture.periodA, fixture.periodB], [fixture.yearA, fixture.yearB]);
    await client.end();
  }
});

test.describe("data siswa pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 640 } });

  test("daftar dan dialog kelas/status dapat digunakan tanpa overflow", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = randomBytes(5).toString("hex");
    const nisn = newNisn();
    const name = `Siswa${suffix}${"N".repeat(70)}`;
    const major = `M${suffix}${"K".repeat(40)}`;
    const yearName = `Tahun ${suffix}`;
    const client = testDatabase();
    await client.connect();
    try {
      const m = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [major]);
      const c = await client.query("INSERT INTO school_classes (level, major_id) VALUES ('XII',$1) RETURNING id", [m.rows[0].id]);
      const y = await client.query<{ id: string }>("INSERT INTO academic_years (name) VALUES ($1) RETURNING id::text AS id", [yearName]);
      const s = await client.query("INSERT INTO school_students (name,nisn) VALUES ($1,$2) RETURNING id", [name, nisn]);
      await client.query(
        "INSERT INTO academic_year_enrollments (academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,$4,'active')",
        [y.rows[0].id, s.rows[0].id, c.rows[0].id, `XII ${major}`],
      );
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await openStudents(page, y.rows[0].id);
      await expect(studentRow(page, nisn)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 360, height: 320 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await studentRow(page, nisn).getByRole("button", { name: "Kelola" }).click();
      const dialog = page.getByRole("dialog", { name: `Kelola siswa · ${name}` });
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error("Dialog tidak terlihat.");
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(320);
      await dialog.getByRole("button", { name: "Batal" }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Batal" })).toBeInViewport();
      await dialog.getByRole("button", { name: "Batal" }).click();
    } finally {
      await cleanData(client, [nisn], [major], [], [yearName]);
      await client.end();
    }
  });
});

test("database menjaga NISN, satu baris per siswa-tahun, satu kelas aktif per periode, dan riwayat referensi", async () => {
  const client = testDatabase();
  await client.connect();
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  try {
    await client.query("BEGIN");
    const student = await client.query("INSERT INTO school_students (name,nisn) VALUES ($1,$2) RETURNING id", [`DB ${suffix}`, nisn]);
    const major = await client.query("INSERT INTO school_majors (name) VALUES ($1) RETURNING id", [`DB${suffix}`]);
    const schoolClass = await client.query("INSERT INTO school_classes (level,major_id) VALUES ('X',$1) RETURNING id", [major.rows[0].id]);
    const year = await client.query("INSERT INTO academic_years (name) VALUES ($1) RETURNING id", [`DB Tahun ${suffix}`]);
    const period = await client.query("INSERT INTO exam_periods (name,start_date,academic_year_id) VALUES ($1,DATE '2026-01-01',$2) RETURNING id", [`DB Periode ${suffix}`, year.rows[0].id]);
    const ids = [student.rows[0].id, period.rows[0].id, schoolClass.rows[0].id, year.rows[0].id];
    await client.query("INSERT INTO academic_year_enrollments (academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES ($1,$2,$3,$4,'active')", [ids[3], ids[0], ids[2], `X DB${suffix}`]);
    await client.query("INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)", [ids[0], ids[1], ids[2], `X DB${suffix}`]);
    const checks: Array<{ sql: string; values: unknown[]; code: string | RegExp; constraint?: string }> = [
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["   ", newNisn()], code: "23514", constraint: "school_students_name_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["Nama\nKontrol", newNisn()], code: "23514", constraint: "school_students_name_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["x".repeat(101), newNisn()], code: "23514", constraint: "school_students_name_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["Pendek", "123456789"], code: "23514", constraint: "school_students_nisn_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["Bukan angka", "12345a7890"], code: "23514", constraint: "school_students_nisn_check" },
      { sql: "INSERT INTO school_students (name,nisn) VALUES ($1,$2)", values: ["Duplikat", nisn], code: "23505", constraint: "school_students_nisn_key" },
      { sql: "INSERT INTO academic_year_enrollments (academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES ($1,$2,$3,$4,'active')", values: [ids[3], ids[0], ids[2], `X DB${suffix}`], code: "23505", constraint: "academic_year_enrollments_academic_year_id_student_id_key" },
      { sql: "INSERT INTO academic_year_enrollments (academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES ($1,$2,$3,$4,'invalid')", values: [ids[3], ids[0], ids[2], `X DB${suffix}`], code: "23514" },
      { sql: "INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)", values: [ids[0], ids[1], ids[2], `X DB${suffix}`], code: "23505", constraint: "student_class_placements_one_active_idx" },
      { sql: "INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot,ended_at) VALUES ($1,$2,$3,$4,now()-interval '1 day')", values: [ids[0], ids[1], ids[2], `X DB${suffix}`], code: "23514", constraint: "student_class_placements_dates_check" },
      { sql: "DELETE FROM academic_years WHERE id=$1", values: [ids[3]], code: /^(23503|23001)$/ },
      { sql: "DELETE FROM school_students WHERE id=$1", values: [ids[0]], code: /^(23503|23001)$/ },
      { sql: "DELETE FROM exam_periods WHERE id=$1", values: [ids[1]], code: /^(23503|23001)$/, constraint: "student_class_placements_period_id_fkey" },
      { sql: "DELETE FROM school_classes WHERE id=$1", values: [ids[2]], code: /^(23503|23001)$/ },
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
    await client.query("INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)", [ids[0], ids[1], ids[2], `X DB${suffix}`]);
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE student_id=$1", [ids[0]])).rowCount).toBe(2);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("database menolak dua penempatan aktif yang dibuat bersamaan", async () => {
  const suffix = randomBytes(5).toString("hex");
  const nisn = newNisn();
  const client = testDatabase();
  const second = testDatabase();
  await Promise.all([client.connect(), second.connect()]);
  const fixture = await seedSchool(client, suffix);
  try {
    const student = await client.query("INSERT INTO school_students (name,nisn) VALUES ($1,$2) RETURNING id", [`Bersamaan ${suffix}`, nisn]);
    const values = [student.rows[0].id, fixture.periodId(fixture.periodA), fixture.classId("X"), `X ${fixture.major}`];
    const sql = "INSERT INTO student_class_placements (student_id,period_id,class_id,class_name_snapshot) VALUES ($1,$2,$3,$4)";
    const outcomes = await Promise.allSettled([client.query(sql, values), second.query(sql, values)]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((item) => item.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "23505", constraint: "student_class_placements_one_active_idx" } });
    expect((await client.query("SELECT 1 FROM student_class_placements WHERE student_id=$1 AND period_id=$2 AND ended_at IS NULL", values.slice(0, 2))).rowCount).toBe(1);
  } finally {
    await cleanData(client, [nisn], [fixture.major], [fixture.periodA, fixture.periodB], [fixture.yearA, fixture.yearB]);
    await Promise.all([client.end(), second.end()]);
  }
});
