import { createHash, randomBytes, randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { makeImportWorkbook } from "../helpers/import-workbook.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

type Student = { id: string; name: string; nisn: string };
type Fixture = {
  suffix: string;
  major: string;
  majorId: string;
  classX: string;
  classXI: string;
  periodA: string;
  periodB: string;
  periodAId: string;
  periodBId: string;
  students: Student[];
};

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes identitas hanya boleh memakai PGDATABASE=nusacbt_test.");
  return new pg.Client(postgresConfig());
}

async function seedSchool(client: pg.Client, count: number): Promise<Fixture> {
  const suffix = randomBytes(5).toString("hex");
  const major = `ID${suffix}`;
  const periodA = `Periode Identitas A ${suffix}`;
  const periodB = `Periode Identitas B ${suffix}`;
  const base = randomInt(1_000_000, 998_000_000);
  const names = Array.from({ length: count }, (_, index) => `Siswa Identitas ${suffix} ${String(index).padStart(4, "0")}`);
  const nisns = Array.from({ length: count }, (_, index) => `0${String(base + index).padStart(9, "0")}`);
  try {
    await client.query("BEGIN");
    const majorId = (await client.query<{ id: string }>("INSERT INTO school_majors(name) VALUES($1) RETURNING id::text AS id", [major])).rows[0].id;
    const classes = await client.query<{ id: string; level: string }>(
      "INSERT INTO school_classes(level,major_id) VALUES ('X',$1),('XI',$1) RETURNING id::text AS id,level", [majorId],
    );
    const periods = await client.query<{ id: string; name: string }>(
      "INSERT INTO exam_periods(name,start_date) VALUES ($1,DATE '2026-07-01'),($2,DATE '2027-02-01') RETURNING id::text AS id,name",
      [periodA, periodB],
    );
    const students = await client.query<Student>(
      `INSERT INTO school_students(name,nisn)
       SELECT name,nisn FROM unnest($1::text[],$2::text[]) AS item(name,nisn)
       RETURNING id::text AS id,name,nisn`, [names, nisns],
    );
    const classX = classes.rows.find((item) => item.level === "X")!.id;
    const classXI = classes.rows.find((item) => item.level === "XI")!.id;
    const periodAId = periods.rows.find((item) => item.name === periodA)!.id;
    const periodBId = periods.rows.find((item) => item.name === periodB)!.id;
    await client.query(
      `INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
       SELECT id::bigint,$2::bigint,$3::bigint,$4 FROM unnest($1::text[]) AS item(id)`,
      [students.rows.map((student) => student.id), periodAId, classX, `X ${major}`],
    );
    await client.query("COMMIT");
    return { suffix, major, majorId, classX, classXI, periodA, periodB, periodAId, periodBId, students: students.rows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanup(client: pg.Client, fixture: Fixture) {
  const periods = [fixture.periodAId, fixture.periodBId];
  await client.query("DELETE FROM participant_identities WHERE period_id = ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM student_class_placements WHERE period_id = ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM school_students WHERE id = ANY($1::bigint[])", [fixture.students.map((student) => student.id)]);
  await client.query("DELETE FROM school_classes WHERE major_id = $1::bigint", [fixture.majorId]);
  await client.query("DELETE FROM school_majors WHERE id = $1::bigint", [fixture.majorId]);
  await client.query("DELETE FROM exam_periods WHERE id = ANY($1::bigint[])", [periods]);
}

async function placeInPeriodB(client: pg.Client, fixture: Fixture, students: Student[]) {
  await client.query(
    `INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
     SELECT id::bigint,$2::bigint,$3::bigint,$4 FROM unnest($1::text[]) AS item(id)`,
    [students.map((student) => student.id), fixture.periodBId, fixture.classX, `X ${fixture.major}`],
  );
}

async function seedIdentity(client: pg.Client, studentId: string, periodId: string, number: string, username: string) {
  await client.query(
    "INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES($1,$2,$3,$4)",
    [studentId, periodId, number, username],
  );
}

function identityRow(page: Page, nisn: string) {
  return page.getByRole("list", { name: "Daftar identitas peserta" }).getByRole("listitem").filter({ hasText: nisn });
}

async function openIdentities(page: Page, periodId: string) {
  await page.goto(`/data-peserta/identitas?periode=${periodId}`);
  await expect(page.getByRole("heading", { name: "Identitas Peserta", exact: true })).toBeVisible();
}

async function editStudent(page: Page, student: Student, existing = false) {
  await identityRow(page, student.nisn).getByRole("button", { name: `${existing ? "Ubah" : "Atur"} identitas ${student.name} ${student.nisn}` }).click();
  const dialog = page.getByRole("dialog", { name: existing ? "Ubah identitas peserta" : "Atur identitas peserta" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openGenerator(page: Page) {
  await page.getByRole("button", { name: "Buat otomatis", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Buat identitas otomatis?" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function identitySnapshot(client: pg.Client, periodId: string) {
  return (await client.query(
    `SELECT i.id::text, i.student_id::text, i.participant_number, i.username, i.created_at::text, i.updated_at::text
     FROM participant_identities i WHERE period_id=$1::bigint ORDER BY i.student_id`, [periodId],
  )).rows;
}

async function revokeCurrentSession(page: Page, client: pg.Client) {
  const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
  if (!cookie) throw new Error("Cookie sesi tes tidak ditemukan.");
  await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [createHash("sha256").update(cookie.value).digest("hex")]);
}

test("admin mengatur identitas manual yang unik per periode dan dapat sama atau berbeda", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 3);
  try {
    const [first, second, third] = fixture.students;
    await placeInPeriodB(client, fixture, [third]);
    const studentsBefore = (await client.query("SELECT id::text,name,nisn,updated_at::text FROM school_students WHERE id=ANY($1::bigint[]) ORDER BY id", [fixture.students.map((s) => s.id)])).rows;
    const placementsBefore = (await client.query("SELECT id::text,student_id::text,period_id::text,class_id::text,ended_at FROM student_class_placements WHERE period_id=ANY($1::bigint[]) ORDER BY id", [[fixture.periodAId, fixture.periodBId]])).rows;

    await loginAsAdmin(page);
    // Tautan lama tetap kompatibel walaupun sidebar sekarang hanya menampilkan Akun Peserta.
    await page.goto("/data-peserta/identitas");
    await page.getByRole("combobox", { name: "Periode" }).click();
    await page.getByRole("option", { name: fixture.periodA }).click();
    await expect(page).toHaveURL(new RegExp(`/data-peserta/identitas\\?periode=${fixture.periodAId}$`));
    let dialog = await editStudent(page, first);
    await dialog.getByLabel("Nomor peserta").fill("  NumA  ");
    await dialog.getByLabel("Username").fill(" UserA ");
    const post = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/identitas");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    const request = await post;
    await expect(dialog).toBeHidden();
    await expect(identityRow(page, first.nisn)).toContainText("NumA");
    await expect(identityRow(page, first.nisn)).toContainText("UserA");
    const headers = request.headers();
    const body = request.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");
    const replay = await page.request.post("/data-peserta/identitas", {
      headers: { origin: "https://attacker.invalid", "content-type": headers["content-type"], "next-action": headers["next-action"] },
      data: body, failOnStatusCode: false,
    });
    expect(replay.status()).toBeGreaterThanOrEqual(400);
    expect(await identitySnapshot(client, fixture.periodAId)).toHaveLength(1);

    dialog = await editStudent(page, second);
    await dialog.getByLabel("Nomor peserta").fill("nUmA");
    await dialog.getByLabel("Username").fill("UserB");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Nomor peserta sudah digunakan");
    await dialog.getByLabel("Nomor peserta").fill("000123");
    await dialog.getByLabel("Username").fill("uSeRa");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Username sudah digunakan");
    await dialog.getByLabel("Nomor peserta").fill("_tidak-valid");
    await dialog.getByLabel("Username").fill("UserB");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Nomor peserta wajib");
    await dialog.getByLabel("Nomor peserta").fill("000123");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog).toBeHidden();
    await expect(identityRow(page, second.nisn)).toContainText("000123");

    // Nilai yang sama boleh menjadi nomor siswa lain dan username siswa pertama.
    dialog = await editStudent(page, third);
    await dialog.getByLabel("Nomor peserta").fill("usera");
    await dialog.getByLabel("Username").fill("numa");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog).toBeHidden();

    await openIdentities(page, fixture.periodBId);
    dialog = await editStudent(page, third);
    await dialog.getByLabel("Nomor peserta").fill("NUMA");
    await dialog.getByLabel("Username").fill("usera");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog).toBeHidden();
    expect((await client.query("SELECT participant_number,username FROM participant_identities WHERE student_id=$1 AND period_id=$2", [third.id, fixture.periodBId])).rows).toEqual([{ participant_number: "NUMA", username: "usera" }]);

    await openIdentities(page, fixture.periodAId);
    dialog = await editStudent(page, first, true);
    await dialog.getByLabel("Nomor peserta").fill("Same2026");
    await dialog.getByLabel("Username").fill("Same2026");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog).toBeHidden();
    expect((await client.query("SELECT participant_number,username FROM participant_identities WHERE student_id=$1 AND period_id=$2", [first.id, fixture.periodAId])).rows).toEqual([{ participant_number: "Same2026", username: "Same2026" }]);
    const beforeNoOp = await identitySnapshot(client, fixture.periodAId);
    await page.reload();
    dialog = await editStudent(page, first, true);
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog).toBeHidden();
    expect(await identitySnapshot(client, fixture.periodAId)).toEqual(beforeNoOp);
    expect((await client.query("SELECT id::text,name,nisn,updated_at::text FROM school_students WHERE id=ANY($1::bigint[]) ORDER BY id", [fixture.students.map((s) => s.id)])).rows).toEqual(studentsBefore);
    expect((await client.query("SELECT id::text,student_id::text,period_id::text,class_id::text,ended_at FROM student_class_placements WHERE period_id=ANY($1::bigint[]) ORDER BY id", [[fixture.periodAId, fixture.periodBId]])).rows).toEqual(placementsBefore);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("otomatis hanya untuk siswa aktif tanpa identitas, menghindari tabrakan dan mengabaikan pencarian", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 5);
  try {
    const [existing, inactive, targetA, targetB, inactiveWithoutIdentity] = fixture.students;
    await seedIdentity(client, existing.id, fixture.periodAId, "CBT202607001", "manual-existing");
    await seedIdentity(client, inactive.id, fixture.periodAId, "CBT202607002", "CBT202607002");
    await client.query("UPDATE student_class_placements SET ended_at=GREATEST(clock_timestamp(),started_at) WHERE student_id=ANY($1::bigint[]) AND period_id=$2", [[inactive.id, inactiveWithoutIdentity.id], fixture.periodAId]);
    const before = await identitySnapshot(client, fixture.periodAId);
    await loginAsAdmin(page);
    await openIdentities(page, fixture.periodAId);
    await expect(identityRow(page, inactive.nisn)).toContainText("Kelas tidak aktif");
    await expect(identityRow(page, inactive.nisn).getByRole("button", { name: /Ubah identitas/ })).toBeDisabled();
    await expect(identityRow(page, inactiveWithoutIdentity.nisn)).toHaveCount(0);
    await page.getByLabel("Cari identitas").fill(targetA.nisn);
    await expect(identityRow(page, targetA.nisn)).toBeVisible();
    await expect(identityRow(page, targetB.nisn)).toHaveCount(0);
    const dialog = await openGenerator(page);
    await expect(dialog).toContainText("2 siswa");
    await expect(dialog).toContainText("bukan hasil pencarian");
    await dialog.getByLabel(/Prefix/).fill("CBT");
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog).toBeHidden();
    const after = await identitySnapshot(client, fixture.periodAId);
    expect(after.filter((row) => [existing.id, inactive.id].includes(row.student_id))).toEqual(before);
    const made = after.filter((row) => [targetA.id, targetB.id].includes(row.student_id));
    expect(made).toHaveLength(2);
    expect(made.every((row) => /^CBT202607\d{3}$/.test(row.participant_number) && row.participant_number === row.username)).toBe(true);
    expect(made.every((row) => !["CBT202607001", "CBT202607002"].includes(row.participant_number))).toBe(true);
    expect(after.some((row) => row.student_id === inactiveWithoutIdentity.id)).toBe(false);
    await page.reload();
    await expect(page.getByRole("button", { name: "Buat otomatis", exact: true })).toBeDisabled();
    await expect(identityRow(page, inactive.nisn)).toContainText("Identitas tetap disimpan");
    // Mengaktifkan kembali penempatan menampilkan identitas lama, bukan membuat yang baru.
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)", [inactive.id, fixture.periodAId, fixture.classXI, `XI ${fixture.major}`]);
    await page.reload();
    await expect(identityRow(page, inactive.nisn)).toContainText("CBT202607002");
    await expect(identityRow(page, inactive.nisn).getByRole("button", { name: /Ubah identitas/ })).toBeEnabled();
    expect((await identitySnapshot(client, fixture.periodAId)).find((row) => row.student_id === inactive.id)).toEqual(before.find((row) => row.student_id === inactive.id));
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("pola nomor dan username terpisah dapat diubah dan memakai bulan mulai periode yang dipilih", async ({ page }) => {
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 2);
  try {
    await placeInPeriodB(client, fixture, fixture.students);
    await loginAsAdmin(page);
    await openIdentities(page, fixture.periodBId);
    const dialog = await openGenerator(page);
    await dialog.getByLabel(/Prefix/).fill("AK");
    await dialog.getByLabel("Pola nomor peserta").fill("N-{prefix}{YYYYMM}-{acak3}");
    await dialog.getByLabel("Pola username").fill("U-{prefix}{YYYYMM}-{acak3}");
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog).toBeHidden();
    const created = await identitySnapshot(client, fixture.periodBId);
    expect(created).toHaveLength(2);
    expect(created.every((row) => /^N-AK202702-\d{3}$/.test(row.participant_number))).toBe(true);
    expect(created.every((row) => /^U-AK202702-\d{3}$/.test(row.username))).toBe(true);
    expect(new Set(created.map((row) => row.participant_number.toLowerCase())).size).toBe(2);
    expect(new Set(created.map((row) => row.username.toLowerCase())).size).toBe(2);
    expect(await identitySnapshot(client, fixture.periodAId)).toHaveLength(0);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("formulir lama tidak menimpa perubahan identitas, kelas, atau periode", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 1);
  try {
    const [student] = fixture.students;
    await seedIdentity(client, student.id, fixture.periodAId, "LAMA001", "LAMAUSER");
    await loginAsAdmin(page);
    await openIdentities(page, fixture.periodAId);
    let dialog = await editStudent(page, student, true);
    // Simulasi perubahan langsung tanpa memperbarui timestamp pun harus terdeteksi.
    await client.query("UPDATE participant_identities SET participant_number='BARU001',username='BARUUSER' WHERE student_id=$1 AND period_id=$2", [student.id, fixture.periodAId]);
    await dialog.getByLabel("Nomor peserta").fill("EDITLAMA");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Identitas peserta berubah di sesi lain");
    expect((await identitySnapshot(client, fixture.periodAId))[0]).toMatchObject({ participant_number: "BARU001", username: "BARUUSER" });
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();

    dialog = await editStudent(page, student, true);
    await client.query("UPDATE school_students SET name=name||' revisi' WHERE id=$1", [student.id]);
    student.name += " revisi"; // Simulasi perubahan langsung tanpa memperbarui timestamp.
    await dialog.getByLabel("Nomor peserta").fill("EDITLAMA");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Data siswa berubah");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();

    dialog = await editStudent(page, student, true);
    await client.query("UPDATE student_class_placements SET ended_at=GREATEST(clock_timestamp(),started_at) WHERE student_id=$1 AND period_id=$2 AND ended_at IS NULL", [student.id, fixture.periodAId]);
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)", [student.id, fixture.periodAId, fixture.classXI, `XI ${fixture.major}`]);
    await dialog.getByLabel("Nomor peserta").fill("EDITLAMA");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Kelas aktif siswa berubah");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();

    dialog = await editStudent(page, student, true);
    await client.query("UPDATE school_majors SET name=name||'X',updated_at=updated_at+interval '1 second' WHERE id=$1", [fixture.majorId]);
    await dialog.getByLabel("Nomor peserta").fill("EDITLAMA");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Kelas aktif siswa berubah");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();

    dialog = await editStudent(page, student, true);
    await client.query("UPDATE exam_periods SET start_date=DATE '2026-08-01' WHERE id=$1", [fixture.periodAId]);
    await dialog.getByLabel("Nomor peserta").fill("EDITLAMA");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Periode berubah");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();

    dialog = await editStudent(page, student, true);
    await client.query("UPDATE exam_periods SET name=name||' revisi',updated_at=updated_at+interval '1 second' WHERE id=$1", [fixture.periodAId]);
    await dialog.getByLabel("Nomor peserta").fill("EDITLAMA");
    await dialog.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Periode berubah");
    expect((await identitySnapshot(client, fixture.periodAId))[0]).toMatchObject({ participant_number: "BARU001", username: "BARUUSER" });
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("batch usang dibatalkan seluruhnya jika identitas atau data siswa berubah", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 3);
  try {
    await loginAsAdmin(page);
    await openIdentities(page, fixture.periodAId);
    let dialog = await openGenerator(page);
    await seedIdentity(client, fixture.students[0].id, fixture.periodAId, "MANUAL01", "MANUALUSER");
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("berubah sejak daftar dimuat");
    let current = await identitySnapshot(client, fixture.periodAId);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ student_id: fixture.students[0].id, participant_number: "MANUAL01", username: "MANUALUSER" });
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();
    dialog = await openGenerator(page);
    await client.query("UPDATE school_students SET name=name||' revisi',updated_at=updated_at+interval '1 second' WHERE id=$1", [fixture.students[1].id]);
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Data berubah sejak daftar dimuat");
    current = await identitySnapshot(client, fixture.periodAId);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ student_id: fixture.students[0].id, participant_number: "MANUAL01", username: "MANUALUSER" });
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();
    dialog = await openGenerator(page);
    await client.query("UPDATE exam_periods SET start_date=DATE '2026-08-01',updated_at=updated_at+interval '1 second' WHERE id=$1", [fixture.periodAId]);
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Data berubah sejak daftar dimuat");
    expect(await identitySnapshot(client, fixture.periodAId)).toEqual(current);
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();
    dialog = await openGenerator(page);
    await client.query("UPDATE school_majors SET name=name||'X',updated_at=updated_at+interval '1 second' WHERE id=$1", [fixture.majorId]);
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Data berubah sejak daftar dimuat");
    expect(await identitySnapshot(client, fixture.periodAId)).toEqual(current);
    await dialog.getByRole("button", { name: "Batal" }).click();
    await page.reload();
    dialog = await openGenerator(page);
    await client.query("UPDATE student_class_placements SET ended_at=GREATEST(clock_timestamp(),started_at) WHERE student_id=$1 AND period_id=$2 AND ended_at IS NULL", [fixture.students[2].id, fixture.periodAId]);
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Penempatan atau identitas berubah");
    expect(await identitySnapshot(client, fixture.periodAId)).toEqual(current);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("dua batch bersamaan menghasilkan satu penyimpanan dan satu penolakan tanpa duplikasi", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 3);
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await loginAsAdmin(page);
    await loginAsAdmin(other);
    await openIdentities(page, fixture.periodAId);
    await openIdentities(other, fixture.periodAId);
    const first = await openGenerator(page);
    const second = await openGenerator(other);
    await first.getByLabel(/Prefix/).fill("RACE");
    await second.getByLabel(/Prefix/).fill("RACE");
    await Promise.all([
      first.getByRole("button", { name: "Ya, buat identitas" }).click(),
      second.getByRole("button", { name: "Ya, buat identitas" }).click(),
    ]);
    await expect.poll(async () => Number(await first.isVisible()) + Number(await second.isVisible())).toBe(1);
    const loser = await first.isVisible() ? first : second;
    await expect(loser.getByRole("alert")).toContainText("berubah sejak daftar dimuat");
    const result = await identitySnapshot(client, fixture.periodAId);
    expect(result).toHaveLength(3);
    expect(new Set(result.map((row) => row.student_id)).size).toBe(3);
    expect(new Set(result.map((row) => row.participant_number.toLowerCase())).size).toBe(3);
    expect(new Set(result.map((row) => row.username.toLowerCase())).size).toBe(3);
    expect(result.every((row) => /^RACE202607\d{3}$/.test(row.participant_number))).toBe(true);
  } finally {
    await context.close();
    await cleanup(client, fixture);
    await client.end();
  }
});

test("kegagalan database di tengah pembuatan otomatis membatalkan seluruh batch", async ({ page }) => {
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 4);
  const functionName = `e2e_identity_fail_${fixture.suffix}`;
  try {
    await seedIdentity(client, fixture.students[0].id, fixture.periodAId, "EXIST001", "EXISTUSER");
    const before = await identitySnapshot(client, fixture.periodAId);
    // Trigger hanya pada database fiktif; sengaja gagal untuk siswa kedua dalam batch.
    await client.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.student_id = ${fixture.students[2].id} THEN RAISE EXCEPTION 'fictional identity failure'; END IF; RETURN NEW; END; $$`);
    await client.query(`CREATE TRIGGER ${functionName} BEFORE INSERT ON participant_identities FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    await loginAsAdmin(page);
    await openIdentities(page, fixture.periodAId);
    const dialog = await openGenerator(page);
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("belum dapat dipastikan");
    expect(await identitySnapshot(client, fixture.periodAId)).toEqual(before);
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS ${functionName} ON participant_identities`);
    await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    await cleanup(client, fixture);
    await client.end();
  }
});

test("batas 1.000 siswa dan kombinasi habis tidak menyebabkan penyimpanan sebagian", async ({ page }) => {
  test.setTimeout(120_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 1001);
  try {
    await loginAsAdmin(page);
    await openIdentities(page, fixture.periodAId);
    let dialog = await openGenerator(page);
    await expect(dialog).toContainText("1000 dari 1001 siswa");
    await dialog.getByLabel(/Prefix/).fill("CAP");
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog).toBeHidden();
    const afterFirstBatch = await identitySnapshot(client, fixture.periodAId);
    expect(afterFirstBatch).toHaveLength(1000);
    expect(afterFirstBatch.some((row) => row.student_id === fixture.students[1000].id)).toBe(false);
    expect(new Set(afterFirstBatch.map((row) => row.participant_number.toLowerCase())).size).toBe(1000);
    expect(afterFirstBatch.every((row) => /^CAP202607\d{3}$/.test(row.participant_number) && row.participant_number === row.username)).toBe(true);

    await page.reload();
    dialog = await openGenerator(page);
    await expect(dialog).toContainText("1 siswa");
    await dialog.getByLabel(/Prefix/).fill("CAP");
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog.getByRole("alert")).toContainText("tidak cukup");
    expect(await identitySnapshot(client, fixture.periodAId)).toEqual(afterFirstBatch);
    await dialog.getByLabel(/Prefix/).fill("NEXT");
    await dialog.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(dialog).toBeHidden();
    const finished = await identitySnapshot(client, fixture.periodAId);
    expect(finished).toHaveLength(1001);
    expect(finished.find((row) => row.student_id === fixture.students[1000].id)).toMatchObject({ participant_number: expect.stringMatching(/^NEXT202607\d{3}$/) });
    expect(new Set(finished.map((row) => row.participant_number.toLowerCase())).size).toBe(1001);
    expect(new Set(finished.map((row) => row.username.toLowerCase())).size).toBe(1001);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("halaman dan kedua aksi menolak sesi admin yang tidak ada atau telah dicabut", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 2);
  try {
    await page.goto(`/data-peserta/identitas?periode=${fixture.periodAId}`);
    await expect(page).toHaveURL(/\/login/);
    await loginAsAdmin(page);
    await page.goto("/data-peserta/identitas?periode=bukan-id");
    await expect(page.getByRole("alert").filter({ hasText: "Periode tidak ditemukan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Buat otomatis", exact: true })).toBeDisabled();
    await page.goto("/data-peserta/identitas?periode=9999999999999999999");
    await expect(page.getByRole("alert").filter({ hasText: "Periode tidak ditemukan" })).toBeVisible();
    await openIdentities(page, fixture.periodAId);
    const editor = await editStudent(page, fixture.students[0]);
    await editor.getByLabel("Nomor peserta").fill("SECRET001");
    await editor.getByLabel("Username").fill("SECRETUSER");
    await revokeCurrentSession(page, client);
    await editor.getByRole("button", { name: "Simpan identitas" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await identitySnapshot(client, fixture.periodAId)).toHaveLength(0);

    await loginAsAdmin(page);
    await openIdentities(page, fixture.periodAId);
    const generator = await openGenerator(page);
    await revokeCurrentSession(page, client);
    await generator.getByRole("button", { name: "Ya, buat identitas" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await identitySnapshot(client, fixture.periodAId)).toHaveLength(0);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("database menegakkan keunikan dan validasi, serta melindungi referensi identitas", async () => {
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 3);
  try {
    const [first, second, third] = fixture.students;
    await seedIdentity(client, first.id, fixture.periodAId, "NumA", "UserA");
    await expect(seedIdentity(client, second.id, fixture.periodAId, "nUMa", "UserB")).rejects.toMatchObject({ code: "23505", constraint: "participant_identities_number_period_ci_idx" });
    await expect(seedIdentity(client, second.id, fixture.periodAId, "NumB", "uSEra")).rejects.toMatchObject({ code: "23505", constraint: "participant_identities_username_period_ci_idx" });
    await expect(seedIdentity(client, second.id, fixture.periodAId, "NumB", "ab")).rejects.toMatchObject({ code: "23514", constraint: "participant_identities_username_check" });
    await expect(seedIdentity(client, second.id, fixture.periodAId, "_bad", "UserB")).rejects.toMatchObject({ code: "23514", constraint: "participant_identities_number_check" });
    await expect(seedIdentity(client, second.id, fixture.periodAId, "NumB\n", "UserB")).rejects.toMatchObject({ code: "23514", constraint: "participant_identities_number_check" });
    await seedIdentity(client, second.id, fixture.periodAId, "UserA", "NumA");
    await expect(seedIdentity(client, first.id, fixture.periodAId, "Different", "Different")).rejects.toMatchObject({ code: "23505", constraint: "participant_identities_student_period_key" });
    await placeInPeriodB(client, fixture, [first, third]);
    await seedIdentity(client, first.id, fixture.periodBId, "numa", "usera");
    expect((await identitySnapshot(client, fixture.periodAId))).toHaveLength(2);
    expect((await identitySnapshot(client, fixture.periodBId))).toHaveLength(1);

    // Bahkan tanpa riwayat kelas fiktif, FK identitas sendiri melindungi siswa dan periode.
    await client.query("DELETE FROM student_class_placements WHERE student_id=$1", [first.id]);
    await client.query("DELETE FROM student_class_placements WHERE period_id=$1", [fixture.periodBId]);
    const studentError = await client.query("DELETE FROM school_students WHERE id=$1", [first.id]).then(() => null, (error) => error);
    expect(["23503", "23001"]).toContain(studentError?.code);
    expect(studentError?.constraint).toBe("participant_identities_student_id_fkey");
    const periodError = await client.query("DELETE FROM exam_periods WHERE id=$1", [fixture.periodBId]).then(() => null, (error) => error);
    expect(["23503", "23001"]).toContain(periodError?.code);
    expect(periodError?.constraint).toBe("participant_identities_period_id_fkey");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("impor Excel dengan Nomor sebagai urutan tidak mengubah atau membuat identitas", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 2);
  try {
    const [first, second] = fixture.students;
    await seedIdentity(client, first.id, fixture.periodAId, "MANUAL-01", "manual-user");
    const before = await identitySnapshot(client, fixture.periodAId);
    const workbook = makeImportWorkbook({ rows: [
      { cells: [999, first.name, first.nisn, `X ${fixture.major}`] },
      { cells: [1, second.name, second.nisn, `X ${fixture.major}`] },
    ] });
    await loginAsAdmin(page);
    await page.goto("/data-peserta/import");
    await page.getByRole("combobox", { name: "Periode" }).click();
    await page.getByRole("option", { name: fixture.periodA }).click();
    await page.getByLabel("File Excel").setInputFiles({ name: "siswa-fiktif.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook });
    await page.getByRole("button", { name: "Periksa pratinjau" }).click();
    await expect(page.getByRole("list", { name: "Hasil pratinjau impor" })).toContainText("Sudah sesuai");
    await page.getByRole("button", { name: "Simpan hasil impor" }).click();
    const dialog = page.getByRole("dialog", { name: "Simpan hasil impor?" });
    await dialog.getByRole("button", { name: "Ya, simpan impor" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status")).toContainText("0 siswa baru dan 0 penempatan baru disimpan; 2 baris sudah sesuai");
    expect(await identitySnapshot(client, fixture.periodAId)).toEqual(before);
    expect((await identitySnapshot(client, fixture.periodAId)).some((row) => row.student_id === second.id)).toBe(false);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test.describe("identitas pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 640 } });

  test("nama panjang, daftar dan dialog tetap dapat digunakan dalam mode gelap", async ({ page }) => {
    test.setTimeout(60_000);
    const client = testDatabase();
    await client.connect();
    const fixture = await seedSchool(client, 2);
    try {
      const [student] = fixture.students;
      student.name = `S${fixture.suffix}${"N".repeat(80)}`;
      const longMajor = `M${fixture.suffix}${"K".repeat(40)}`;
      const longPeriod = `Periode ${fixture.suffix} ${"P".repeat(65)}`;
      await client.query("UPDATE school_students SET name=$1,updated_at=clock_timestamp() WHERE id=$2", [student.name, student.id]);
      await client.query("UPDATE school_majors SET name=$1,updated_at=clock_timestamp() WHERE id=$2", [longMajor, fixture.majorId]);
      await client.query("UPDATE exam_periods SET name=$1,updated_at=clock_timestamp() WHERE id=$2", [longPeriod, fixture.periodAId]);
      await seedIdentity(client, student.id, fixture.periodAId, `N${"1".repeat(63)}`, `U${"2".repeat(63)}`);
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await page.getByRole("menuitem", { name: "Gelap" }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await openIdentities(page, fixture.periodAId);
      await expect(identityRow(page, student.nisn)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 360, height: 320 });
      let dialog = await editStudent(page, student, true);
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error("Dialog tidak terlihat.");
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await dialog.getByRole("button", { name: "Batal" }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Batal" })).toBeInViewport();
      await dialog.getByRole("button", { name: "Batal" }).click();
      dialog = await openGenerator(page);
      const generationBox = await dialog.boundingBox();
      expect(generationBox).not.toBeNull();
      if (!generationBox) throw new Error("Dialog generator tidak terlihat.");
      expect(generationBox.y).toBeGreaterThanOrEqual(0);
      expect(generationBox.y + generationBox.height).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await dialog.getByRole("button", { name: "Batal" }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Batal" })).toBeInViewport();
    } finally {
      await cleanup(client, fixture);
      await client.end();
    }
  });
});

test("dua siswa yang disimpan bersamaan tidak dapat memperoleh nomor yang sama dalam satu periode", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 2);
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await loginAsAdmin(page);
    await loginAsAdmin(other);
    await openIdentities(page, fixture.periodAId);
    await openIdentities(other, fixture.periodAId);
    const first = await editStudent(page, fixture.students[0]);
    const second = await editStudent(other, fixture.students[1]);
    await first.getByLabel("Nomor peserta").fill("RACE-0001");
    await first.getByLabel("Username").fill("USER-FIRST");
    await second.getByLabel("Nomor peserta").fill("race-0001");
    await second.getByLabel("Username").fill("USER-SECOND");
    await Promise.all([
      first.getByRole("button", { name: "Simpan identitas" }).click(),
      second.getByRole("button", { name: "Simpan identitas" }).click(),
    ]);
    await expect.poll(async () => Number(await first.isVisible()) + Number(await second.isVisible())).toBe(1);
    const loser = await first.isVisible() ? first : second;
    await expect(loser.getByRole("alert")).toContainText("Nomor peserta sudah digunakan");
    const result = await identitySnapshot(client, fixture.periodAId);
    expect(result).toHaveLength(1);
    expect(result[0].participant_number.toLowerCase()).toBe("race-0001");
    expect(["USER-FIRST", "USER-SECOND"]).toContain(result[0].username);
  } finally {
    await context.close();
    await cleanup(client, fixture);
    await client.end();
  }
});

test("pembuatan manual dan otomatis bersamaan tidak saling menimpa", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = testDatabase();
  await client.connect();
  const fixture = await seedSchool(client, 2);
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await loginAsAdmin(page);
    await loginAsAdmin(other);
    await openIdentities(page, fixture.periodAId);
    await openIdentities(other, fixture.periodAId);
    const editor = await editStudent(page, fixture.students[0]);
    await editor.getByLabel("Nomor peserta").fill("MANUAL-RACE");
    await editor.getByLabel("Username").fill("manual-race");
    const generator = await openGenerator(other);
    await generator.getByLabel(/Prefix/).fill("BATCH");
    await Promise.all([
      editor.getByRole("button", { name: "Simpan identitas" }).click(),
      generator.getByRole("button", { name: "Ya, buat identitas" }).click(),
    ]);
    await expect.poll(async () => Number(await editor.isVisible()) + Number(await generator.isVisible())).toBe(1);
    const manualLost = await editor.isVisible();
    const loser = manualLost ? editor : generator;
    await expect(loser.getByRole("alert")).toContainText("berubah");
    const result = await identitySnapshot(client, fixture.periodAId);
    if (manualLost) {
      expect(result).toHaveLength(2);
      expect(result.every((row) => /^BATCH202607\d{3}$/.test(row.participant_number) && row.participant_number === row.username)).toBe(true);
    } else {
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ student_id: fixture.students[0].id, participant_number: "MANUAL-RACE", username: "manual-race" });
    }
  } finally {
    await context.close();
    await cleanup(client, fixture);
    await client.end();
  }
});
