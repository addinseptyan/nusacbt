import { spawn } from "node:child_process";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { createParticipantKeyFile, decryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { verifyPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";
import { insertLegacyPassword } from "./legacy-password-fixture";

type Student = { id: string; name: string; nisn: string; identityId: string };
type Fixture = { majorId: string; classId: string; major: string; periodA: string; periodAId: string; periodB: string; periodBId: string; students: Student[] };
type Stored = { identityId: string; hash: string; nonce: Buffer; ciphertext: Buffer; authenticationTag: Buffer; version: string };

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes sandi hanya boleh memakai PGDATABASE=nusacbt_test.");
  if (!process.env.NUSACBT_PARTICIPANT_KEY_FILE) throw new Error("Kunci fiktif khusus tes harus dikonfigurasi di luar proyek.");
  return new pg.Client(postgresConfig());
}

async function seedSchool(client: pg.Client, count: number): Promise<Fixture> {
  const suffix = randomBytes(5).toString("hex");
  const major = `SD${suffix}`;
  const periodA = `Periode Sandi A ${suffix}`;
  const periodB = `Periode Sandi B ${suffix}`;
  const base = randomInt(10_000_000, 998_000_000);
  const names = Array.from({ length: count }, (_, index) => `Siswa Sandi ${suffix} ${String(index).padStart(4, "0")}`);
  const nisns = Array.from({ length: count }, (_, index) => `0${String(base + index).padStart(9, "0")}`);
  try {
    await client.query("BEGIN");
    const majorId = (await client.query<{ id: string }>("INSERT INTO school_majors(name) VALUES($1) RETURNING id::text AS id", [major])).rows[0].id;
    const classId = (await client.query<{ id: string }>("INSERT INTO school_classes(level,major_id) VALUES('X',$1) RETURNING id::text AS id", [majorId])).rows[0].id;
    const periods = await client.query<{ id: string; name: string }>("INSERT INTO exam_periods(name,start_date) VALUES($1,DATE '2026-07-01'),($2,DATE '2027-02-01') RETURNING id::text AS id,name", [periodA, periodB]);
    const periodAId = periods.rows.find((row) => row.name === periodA)!.id;
    const periodBId = periods.rows.find((row) => row.name === periodB)!.id;
    const students = await client.query<{ id: string; name: string; nisn: string }>(
      "INSERT INTO school_students(name,nisn) SELECT name,nisn FROM unnest($1::text[],$2::text[]) AS i(name,nisn) RETURNING id::text AS id,name,nisn", [names, nisns],
    );
    await client.query(
      `INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
       SELECT id::bigint,$2::bigint,$3::bigint,$4 FROM unnest($1::text[]) AS i(id)`,
      [students.rows.map((row) => row.id), periodAId, classId, `X ${major}`],
    );
    const identities = await client.query<{ id: string; studentId: string }>(
      `INSERT INTO participant_identities(student_id,period_id,participant_number,username)
       SELECT id::bigint,$2::bigint,'N' || id,'USR' || id FROM unnest($1::text[]) AS i(id)
       RETURNING id::text AS id,student_id::text AS "studentId"`,
      [students.rows.map((row) => row.id), periodAId],
    );
    await client.query("COMMIT");
    return { majorId, classId, major, periodA, periodAId, periodB, periodBId, students: students.rows.map((row) => ({ ...row, identityId: identities.rows.find((item) => item.studentId === row.id)!.id })) };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

async function placeSecondPeriod(client: pg.Client, fixture: Fixture, student: Student) {
  await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)", [student.id, fixture.periodBId, fixture.classId, `X ${fixture.major}`]);
  return (await client.query<{ id: string }>("INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES($1,$2,$3,$4) RETURNING id::text AS id", [student.id, fixture.periodBId, "SAME-NUMBER", "same-user"])).rows[0].id;
}

async function cleanup(client: pg.Client, fixture: Fixture) {
  const periods = [fixture.periodAId, fixture.periodBId];
  await client.query("DELETE FROM participant_password_audit WHERE participant_identity_id IN (SELECT id FROM participant_identities WHERE period_id=ANY($1::bigint[]))", [periods]);
  await client.query("DELETE FROM participant_passwords WHERE participant_identity_id IN (SELECT id FROM participant_identities WHERE period_id=ANY($1::bigint[]))", [periods]);
  await client.query("DELETE FROM participant_identities WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM student_class_placements WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM school_students WHERE id=ANY($1::bigint[])", [fixture.students.map((row) => row.id)]);
  await client.query("DELETE FROM school_classes WHERE major_id=$1::bigint", [fixture.majorId]);
  await client.query("DELETE FROM school_majors WHERE id=$1::bigint", [fixture.majorId]);
  await client.query("DELETE FROM exam_periods WHERE id=ANY($1::bigint[])", [periods]);
}

async function storedPassword(client: pg.Client, identityId: string): Promise<Stored | null> {
  const result = await client.query<Stored>(
    `SELECT participant_identity_id::text AS "identityId",password_hash AS hash,nonce,ciphertext,authentication_tag AS "authenticationTag",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM participant_passwords WHERE participant_identity_id=$1`, [identityId],
  );
  return result.rows[0] ?? null;
}

async function decrypted(stored: Stored, periodId: string) {
  const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
  try { return decryptParticipantPassword(stored, key, { identityId: stored.identityId, periodId }); }
  finally { key.fill(0); }
}

async function audit(client: pg.Client, identityId: string) {
  return (await client.query<{ event: string; admin_id: string; occurred_at: Date }>(
    "SELECT event,admin_id::text,occurred_at FROM participant_password_audit WHERE participant_identity_id=$1 ORDER BY id", [identityId],
  )).rows;
}

function passwordRow(page: Page, student: Student) {
  return page.getByRole("list", { name: "Daftar sandi peserta" }).getByRole("listitem").filter({ hasText: student.nisn });
}

async function openPasswords(page: Page, periodId: string) {
  await page.goto(`/data-peserta/sandi?periode=${periodId}`);
  await expect(page.getByRole("heading", { name: "Sandi Peserta", exact: true })).toBeVisible();
}

async function editor(page: Page, student: Student, reset = false) {
  await passwordRow(page, student).getByRole("button", { name: `${reset ? "Reset" : "Buat"} sandi ${student.name} ${student.nisn}` }).click();
  const dialog = page.getByRole("dialog", { name: reset ? "Reset sandi peserta" : "Buat sandi peserta" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function submitManual(page: Page, student: Student, password: string, reset = false) {
  const dialog = await editor(page, student, reset);
  await dialog.getByRole("radio", { name: /Manual/ }).check();
  await dialog.getByLabel("Sandi baru", { exact: true }).fill(password);
  await dialog.getByLabel("Ulangi sandi baru").fill(password);
  await dialog.getByRole("button", { name: reset ? "Ya, reset sandi" : "Buat sandi", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(passwordRow(page, student)).toContainText("Sudah bersandi");
}

async function showDialog(page: Page, student: Student) {
  await passwordRow(page, student).getByRole("button", { name: `Lihat sandi ${student.name} ${student.nisn}` }).click();
  const dialog = page.getByRole("dialog", { name: "Lihat sandi peserta" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("manual, tampilan tercatat, dan reset berlaku per periode tanpa membocorkan sandi ke daftar", async ({ page }) => {
  test.setTimeout(100_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 2);
  const student = fixture.students[0];
  const firstPassword = "ABCDEFGH";
  const secondPassword = "IJKLMNOP";
  try {
    const otherIdentity = await placeSecondPeriod(client, fixture, student);
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Peserta", exact: true }).click();
    await page.getByRole("link", { name: "Sandi Peserta", exact: true }).click();
    await page.getByRole("combobox", { name: "Periode" }).click();
    await page.getByRole("option", { name: fixture.periodA }).click();
    await expect(page).toHaveURL(new RegExp(`/data-peserta/sandi\\?periode=${fixture.periodAId}$`));
    const dialog = await editor(page, student);
    await dialog.getByRole("radio", { name: /Manual/ }).check();
    expect(await dialog.getByLabel("Sandi baru", { exact: true }).getAttribute("type")).toBe("password");
    expect(await dialog.getByLabel("Ulangi sandi baru").getAttribute("type")).toBe("password");
    await dialog.getByLabel("Sandi baru", { exact: true }).fill(firstPassword);
    await dialog.getByLabel("Ulangi sandi baru").fill("HGFEDCBA");
    await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Konfirmasi sandi tidak sama");
    expect(await storedPassword(client, student.identityId)).toBeNull();
    await dialog.getByLabel("Ulangi sandi baru").fill(firstPassword);
    await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(passwordRow(page, student)).toContainText("Sudah bersandi");
    await expect(passwordRow(page, student).getByLabel("Tersamarkan")).toBeVisible();
    expect(await page.content()).not.toContain(firstPassword);
    const first = await storedPassword(client, student.identityId);
    expect(first).not.toBeNull();
    if (!first) throw new Error("Sandi uji tidak tersimpan.");
    expect(await verifyPassword(firstPassword, first.hash)).toBe(true);
    expect(await verifyPassword(firstPassword.toLowerCase(), first.hash)).toBe(false);
    expect(await decrypted(first, fixture.periodAId)).toBe(firstPassword);
    expect(first.hash).not.toContain(firstPassword);
    expect(first.ciphertext.includes(Buffer.from(firstPassword))).toBe(false);
    expect((await audit(client, student.identityId)).map((row) => row.event)).toEqual(["create_manual"]);
    expect(JSON.stringify(await audit(client, student.identityId))).not.toContain(firstPassword);
    const html = await page.request.get(`/data-peserta/sandi?periode=${fixture.periodAId}`);
    expect(html.headers()["cache-control"]).toContain("no-store");
    expect(await html.text()).not.toContain(firstPassword);

    const reveal = await showDialog(page, student);
    await expect(reveal.getByLabel("Sandi tersamarkan")).toBeVisible();
    await expect(reveal.locator("output")).toHaveCount(0);
    const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-peserta/sandi");
    await reveal.getByRole("button", { name: "Tampilkan sandi" }).click();
    const displayed = await response;
    expect(displayed.headers()["cache-control"]).toContain("no-store");
    await expect(reveal.locator('output[aria-label="Sandi peserta"]')).toBeVisible();
    expect(await reveal.locator('output[aria-label="Sandi peserta"]').textContent()).toBe(firstPassword);
    expect((await audit(client, student.identityId)).map((row) => row.event)).toEqual(["create_manual", "reveal"]);
    await reveal.getByRole("button", { name: "Tutup" }).click();
    await expect(reveal).toBeHidden();
    expect(await page.content()).not.toContain(firstPassword);
    await expect(page.getByRole("list", { name: "Riwayat tindakan sandi" })).toContainText("Sandi ditampilkan");

    await openPasswords(page, fixture.periodBId);
    expect(await storedPassword(client, otherIdentity)).toBeNull();
    await submitManual(page, student, "QRSTUVWX");
    const other = await storedPassword(client, otherIdentity);
    expect(other && await decrypted(other, fixture.periodBId)).toBe("QRSTUVWX");
    await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, secondPassword, true);
    const updated = await storedPassword(client, student.identityId);
    if (!updated) throw new Error("Sandi reset uji tidak tersimpan.");
    expect(await verifyPassword(secondPassword, updated.hash)).toBe(true);
    expect(await verifyPassword(firstPassword, updated.hash)).toBe(false);
    expect(await decrypted(updated, fixture.periodAId)).toBe(secondPassword);
    expect(await storedPassword(client, otherIdentity)).toEqual(other);
    expect((await audit(client, student.identityId)).map((row) => row.event)).toEqual(["create_manual", "reveal", "reset_manual"]);
    expect(await page.content()).not.toContain(secondPassword);
    const revealUpdated = await showDialog(page, student);
    await revealUpdated.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(revealUpdated.locator("output")).toHaveText(secondPassword);
    await revealUpdated.getByRole("button", { name: "Tutup" }).click();
  } finally { await cleanup(client, fixture); await client.end(); }
});

test("batch otomatis maksimal 25, tidak dipengaruhi pencarian dan tidak menimpa sandi lama", async ({ page }) => {
  test.setTimeout(120_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 27);
  try {
    await loginAsAdmin(page);
    await openPasswords(page, fixture.periodAId);
    await submitManual(page, fixture.students[0], "SANDILAM");
    const old = await storedPassword(client, fixture.students[0].identityId);
    await page.getByLabel("Cari peserta").fill("pencarian-tidak-cocok");
    await expect(page.getByText("Peserta tidak ditemukan")).toBeVisible();
    await page.getByRole("button", { name: "Buat otomatis", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Buat sandi otomatis?" });
    await expect(dialog).toContainText("25 dari 26 peserta");
    await dialog.getByRole("button", { name: "Ya, buat sandi" }).click();
    await expect(dialog).toBeHidden({ timeout: 45_000 });
    expect(await storedPassword(client, fixture.students[0].identityId)).toEqual(old);
    const result = await client.query<{ identityId: string }>("SELECT participant_identity_id::text AS \"identityId\" FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])", [fixture.students.map((row) => row.identityId)]);
    expect(result.rowCount).toBe(26);
    const autoIds = result.rows.filter((row) => row.identityId !== fixture.students[0].identityId);
    const values: string[] = [];
    for (const entry of autoIds) values.push(await decrypted((await storedPassword(client, entry.identityId))!, fixture.periodAId));
    expect(values.every((value) => /^[A-Z]{8}$/.test(value))).toBe(true);
    expect(new Set(values).size).toBe(25);
    expect(await page.content()).not.toContain(values[0]);
    await page.getByRole("button", { name: "Buat otomatis", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Buat sandi otomatis?" });
    await expect(dialog).toContainText("1 peserta");
    await dialog.getByRole("button", { name: "Ya, buat sandi" }).click();
    await expect(dialog).toBeHidden();
    expect((await client.query("SELECT 1 FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])", [fixture.students.map((row) => row.identityId)])).rowCount).toBe(27);
    expect(await storedPassword(client, fixture.students[0].identityId)).toEqual(old);
    await expect(page.getByRole("button", { name: "Buat otomatis", exact: true })).toBeDisabled();
  } finally { await cleanup(client, fixture); await client.end(); }
});

test("pembuatan manual dan batch bersamaan tidak saling menimpa", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 2);
  const otherContext = await browser.newContext(); const other = await otherContext.newPage();
  try {
    await loginAsAdmin(page); await loginAsAdmin(other);
    await openPasswords(page, fixture.periodAId); await openPasswords(other, fixture.periodAId);
    const manual = await editor(page, fixture.students[0]);
    await manual.getByRole("radio", { name: /Manual/ }).check();
    await manual.getByLabel("Sandi baru", { exact: true }).fill("BALAPANX");
    await manual.getByLabel("Ulangi sandi baru").fill("BALAPANX");
    await other.getByRole("button", { name: "Buat otomatis", exact: true }).click();
    const batch = other.getByRole("dialog", { name: "Buat sandi otomatis?" });
    await Promise.all([manual.getByRole("button", { name: "Buat sandi", exact: true }).click(), batch.getByRole("button", { name: "Ya, buat sandi" }).click()]);
    await expect.poll(async () => Number(await manual.isVisible()) + Number(await batch.isVisible()), { timeout: 20_000 }).toBe(1);
    const loser = await manual.isVisible() ? manual : batch;
    await expect(loser.getByRole("alert").filter({ hasText: "berubah" })).toBeVisible();
    const result = await client.query<{ identityId: string }>("SELECT participant_identity_id::text AS \"identityId\" FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])", [fixture.students.map((row) => row.identityId)]);
    const manualLost = await manual.isVisible();
    expect(result.rowCount).toBe(manualLost ? 2 : 1);
    const first = await storedPassword(client, fixture.students[0].identityId);
    if (!first) throw new Error("Sandi pertama tidak tersedia.");
    const password = await decrypted(first, fixture.periodAId);
    expect(manualLost ? /^[A-Z]{8}$/.test(password) : password === "BALAPANX").toBe(true);
    expect((await audit(client, fixture.students[0].identityId)).map((row) => row.event)).toEqual([manualLost ? "create_auto" : "create_manual"]);
  } finally { await otherContext.close(); await cleanup(client, fixture); await client.end(); }
});

test("dua reset bersamaan mempertahankan satu hasil dan satu audit", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  const context = await browser.newContext(); const other = await context.newPage();
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, "AWALTEST");
    await loginAsAdmin(other); await openPasswords(other, fixture.periodAId);
    const first = await editor(page, student, true); const second = await editor(other, student, true);
    for (const [dialog, value] of [[first, "PERTAMAA"], [second, "KEDUAAAA"]] as const) {
      await dialog.getByRole("radio", { name: /Manual/ }).check();
      await dialog.getByLabel("Sandi baru", { exact: true }).fill(value);
      await dialog.getByLabel("Ulangi sandi baru").fill(value);
    }
    await Promise.all([first.getByRole("button", { name: "Ya, reset sandi" }).click(), second.getByRole("button", { name: "Ya, reset sandi" }).click()]);
    await expect.poll(async () => Number(await first.isVisible()) + Number(await second.isVisible()), { timeout: 20_000 }).toBe(1);
    const loser = await first.isVisible() ? first : second;
    await expect(loser.getByRole("alert").filter({ hasText: "berubah" })).toBeVisible();
    const stored = await storedPassword(client, student.identityId);
    if (!stored) throw new Error("Sandi tidak tersedia.");
    const value = await decrypted(stored, fixture.periodAId);
    expect(value).toBe(await first.isVisible() ? "KEDUAAAA" : "PERTAMAA");
    expect(await verifyPassword(value, stored.hash)).toBe(true);
    expect((await audit(client, student.identityId)).map((row) => row.event)).toEqual(["create_manual", "reset_manual"]);
  } finally { await context.close(); await cleanup(client, fixture); await client.end(); }
});

test("perubahan identitas tanpa memperbarui timestamp ditolak sebagai data usang", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    const dialog = await editor(page, student);
    await client.query("UPDATE participant_identities SET username='changed-without-timestamp' WHERE id=$1", [student.identityId]);
    await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "berubah" })).toBeVisible();
    expect(await storedPassword(client, student.identityId)).toBeNull();
    expect(await audit(client, student.identityId)).toHaveLength(0);
  } finally { await cleanup(client, fixture); await client.end(); }
});

for (const change of ["siswa", "periode", "kelas", "penempatan"] as const) {
  test(`perubahan ${change} sejak daftar dimuat membatalkan seluruh batch`, async ({ page }) => {
    test.setTimeout(70_000);
    const client = testDatabase(); await client.connect();
    const fixture = await seedSchool(client, 3);
    try {
      await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
      await page.getByRole("button", { name: "Buat otomatis", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Buat sandi otomatis?" });
      if (change === "siswa") await client.query("UPDATE school_students SET name=name || ' B' WHERE id=$1", [fixture.students[1].id]);
      if (change === "periode") await client.query("UPDATE exam_periods SET name=name || ' B' WHERE id=$1", [fixture.periodAId]);
      if (change === "kelas") await client.query("UPDATE school_majors SET name=name || 'B' WHERE id=$1", [fixture.majorId]);
      if (change === "penempatan") await client.query("UPDATE student_class_placements SET ended_at=clock_timestamp() WHERE student_id=$1 AND period_id=$2", [fixture.students[1].id, fixture.periodAId]);
      await dialog.getByRole("button", { name: "Ya, buat sandi" }).click();
      await expect(dialog.getByRole("alert").filter({ hasText: "berubah" })).toBeVisible();
      expect((await client.query("SELECT 1 FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])", [fixture.students.map((row) => row.identityId)])).rowCount).toBe(0);
      expect((await client.query("SELECT 1 FROM participant_password_audit WHERE participant_identity_id=ANY($1::bigint[])", [fixture.students.map((row) => row.identityId)])).rowCount).toBe(0);
    } finally { await cleanup(client, fixture); await client.end(); }
  });
}

test("sandi tetap disimpan tetapi tidak dapat dikelola saat kelas tidak aktif", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, "TIDAKAKT");
    const before = await storedPassword(client, student.identityId);
    await client.query("UPDATE student_class_placements SET ended_at=clock_timestamp() WHERE student_id=$1 AND period_id=$2", [student.id, fixture.periodAId]);
    await page.reload();
    const row = passwordRow(page, student);
    await expect(row).toContainText("Kelas tidak aktif");
    await expect(row.getByRole("button", { name: `Lihat sandi ${student.name} ${student.nisn}` })).toBeDisabled();
    await expect(row.getByRole("button", { name: `Reset sandi ${student.name} ${student.nisn}` })).toBeDisabled();
    expect(await storedPassword(client, student.identityId)).toEqual(before);
    expect((await audit(client, student.identityId)).map((item) => item.event)).toEqual(["create_manual"]);
  } finally { await cleanup(client, fixture); await client.end(); }
});

test("pengikat kunci yang salah atau hilang ditolak tanpa mengubah sandi maupun mencatat tampilan", async ({ page }) => {
  test.setTimeout(70_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  let original: { verifier: Buffer; created_at: string } | undefined;
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, "PENGIKAT");
    const passwordBefore = await storedPassword(client, student.identityId);
    original = (await client.query<{ verifier: Buffer; created_at: string }>("SELECT verifier,created_at::text FROM participant_password_key_binding WHERE id=1")).rows[0];
    if (!original) throw new Error("Pengikat uji tidak tersedia.");
    let dialog = await showDialog(page, student);
    await client.query("UPDATE participant_password_key_binding SET verifier=$1 WHERE id=1", [randomBytes(32)]);
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Kunci tidak cocok" })).toBeVisible();
    await expect(dialog.locator("output")).toHaveCount(0);
    expect(await storedPassword(client, student.identityId)).toEqual(passwordBefore);
    expect((await audit(client, student.identityId)).map((item) => item.event)).toEqual(["create_manual"]);
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Kunci tidak cocok dengan database" })).toBeVisible();
    await expect(passwordRow(page, student).getByRole("button", { name: `Reset sandi ${student.name} ${student.nisn}` })).toBeDisabled();
    await client.query("UPDATE participant_password_key_binding SET verifier=$1 WHERE id=1", [original.verifier]);
    await page.reload();
    dialog = await showDialog(page, student);
    await client.query("DELETE FROM participant_password_key_binding WHERE id=1");
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Pengikat kunci database tidak tersedia" })).toBeVisible();
    await expect(dialog.locator("output")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Pengikat kunci tidak tersedia" })).toBeVisible();
    expect(await storedPassword(client, student.identityId)).toEqual(passwordBefore);
    expect((await audit(client, student.identityId)).map((item) => item.event)).toEqual(["create_manual"]);
  } finally {
    if (original) await client.query("INSERT INTO participant_password_key_binding(id,verifier,created_at) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET verifier=EXCLUDED.verifier,created_at=EXCLUDED.created_at", [original.verifier, original.created_at]);
    await cleanup(client, fixture); await client.end();
  }
});

test("ciphertext yang rusak tidak ditampilkan dan tidak menghasilkan audit tampilan berhasil", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, "INTEGRIT");
    const before = await storedPassword(client, student.identityId);
    if (!before) throw new Error("Sandi uji tidak tersedia.");
    const changed = Buffer.from(before.ciphertext); changed[0] ^= 1;
    await client.query("UPDATE participant_passwords SET ciphertext=$2 WHERE participant_identity_id=$1", [student.identityId, changed]);
    await page.reload();
    let dialog = await showDialog(page, student);
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "integritas data" })).toBeVisible();
    await expect(dialog.locator("output")).toHaveCount(0);
    expect((await audit(client, student.identityId)).map((item) => item.event)).toEqual(["create_manual"]);
    await client.query("UPDATE participant_passwords SET ciphertext=$2 WHERE participant_identity_id=$1", [student.identityId, before.ciphertext]);
    await dialog.getByRole("button", { name: "Tutup" }).click();
    await page.reload();
    dialog = await showDialog(page, student);
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(dialog.locator("output")).toHaveText("INTEGRIT");
    expect((await audit(client, student.identityId)).map((item) => item.event)).toEqual(["create_manual", "reveal"]);
  } finally { await cleanup(client, fixture); await client.end(); }
});

test("kegagalan audit membatalkan penampilan, pembuatan, dan reset secara atomik", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 2); const [first, second] = fixture.students;
  const constraint = `e2e_block_${randomBytes(6).toString("hex")}`;
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, first, "SEBELUMA");
    const before = await storedPassword(client, first.identityId);
    await client.query(`ALTER TABLE participant_password_audit ADD CONSTRAINT ${constraint} CHECK (event NOT IN ('reveal','reset_auto','create_auto')) NOT VALID`);
    let dialog = await showDialog(page, first);
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "belum dapat dipastikan" })).toBeVisible();
    await expect(dialog.locator("output")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Tutup" }).click();
    dialog = await editor(page, first, true);
    await dialog.getByRole("button", { name: "Ya, reset sandi" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "belum dapat dipastikan" })).toBeVisible();
    expect(await storedPassword(client, first.identityId)).toEqual(before);
    await dialog.getByRole("button", { name: "Batal" }).click();
    dialog = await editor(page, second);
    await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "belum dapat dipastikan" })).toBeVisible();
    expect(await storedPassword(client, second.identityId)).toBeNull();
    expect((await audit(client, first.identityId)).map((item) => item.event)).toEqual(["create_manual"]);
    expect(await audit(client, second.identityId)).toHaveLength(0);
  } finally {
    await client.query(`ALTER TABLE participant_password_audit DROP CONSTRAINT IF EXISTS ${constraint}`);
    await cleanup(client, fixture); await client.end();
  }
});

test("tindakan sandi memerlukan sesi admin dan menolak Origin asing", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  const anonymous = await browser.newContext(); const anonymousPage = await anonymous.newPage();
  const password = "AKSESTES";
  try {
    await anonymousPage.goto(`/data-peserta/sandi?periode=${fixture.periodAId}`);
    await expect(anonymousPage).toHaveURL(/\/login$/);
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, password);
    let dialog = await showDialog(page, student);
    const post = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/sandi");
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    const request = await post;
    await expect(dialog.locator("output")).toHaveText(password);
    const headers = request.headers(); const body = request.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");
    const before = await audit(client, student.identityId);
    const foreign = await page.request.post("/data-peserta/sandi", {
      headers: { origin: "https://attacker.invalid", "content-type": headers["content-type"], "next-action": headers["next-action"] }, data: body, failOnStatusCode: false,
    });
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    expect(await foreign.text()).not.toContain(password);
    const unauth = await anonymous.request.post("http://127.0.0.1:3100/data-peserta/sandi", {
      headers: { origin: "http://127.0.0.1:3100", "content-type": headers["content-type"], "next-action": headers["next-action"] }, data: body, failOnStatusCode: false, maxRedirects: 0,
    });
    expect(await unauth.text()).not.toContain(password);
    expect(await audit(client, student.identityId)).toEqual(before);
    await dialog.getByRole("button", { name: "Tutup" }).click();
    dialog = await showDialog(page, student);
    const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
    if (!cookie) throw new Error("Cookie uji tidak ditemukan.");
    await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [createHash("sha256").update(cookie.value).digest("hex")]);
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.content()).not.toContain(password);
    expect(await audit(client, student.identityId)).toEqual(before);
  } finally { await anonymous.close(); await cleanup(client, fixture); await client.end(); }
});

test.describe("sandi peserta pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 640 } });
  test("nama panjang, mode gelap, dan dialog tetap dapat digunakan", async ({ page }) => {
    test.setTimeout(75_000);
    const client = testDatabase(); await client.connect();
    const fixture = await seedSchool(client, 1); const student = fixture.students[0];
    try {
      student.name = `S${"N".repeat(90)}`;
      await client.query("UPDATE school_students SET name=$1 WHERE id=$2", [student.name, student.id]);
      await client.query("UPDATE school_majors SET name=$1 WHERE id=$2", [`M${"K".repeat(45)}`, fixture.majorId]);
      await client.query("UPDATE exam_periods SET name=$1 WHERE id=$2", [`P${"E".repeat(90)}`, fixture.periodAId]);
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await page.getByRole("menuitem", { name: "Gelap" }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await openPasswords(page, fixture.periodAId);
      await expect(passwordRow(page, student)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 360, height: 320 });
      let dialog = await editor(page, student);
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error("Dialog tidak terlihat.");
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await dialog.getByRole("button", { name: "Buat sandi", exact: true }).scrollIntoViewIfNeeded();
      await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click();
      await expect(dialog).toBeHidden();
      dialog = await showDialog(page, student);
      await dialog.getByRole("button", { name: "Tampilkan sandi" }).scrollIntoViewIfNeeded();
      await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
      await expect(dialog.locator("output")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await dialog.getByRole("button", { name: "Tutup" }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Tutup" })).toBeInViewport();
    } finally { await cleanup(client, fixture); await client.end(); }
  });
});

test("tampilan sandi otomatis tersamarkan setelah 60 detik atau halaman tidak aktif", async ({ page }) => {
  test.setTimeout(75_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, "WAKTUTES");
    await page.clock.install();
    const dialog = await showDialog(page, student);
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(dialog.locator("output")).toHaveText("WAKTUTES");
    await page.clock.fastForward(60_100);
    await expect(dialog.locator("output")).toHaveCount(0);
    await expect(dialog.getByLabel("Sandi tersamarkan")).toBeVisible();
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(dialog.locator("output")).toHaveText("WAKTUTES");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(dialog.locator("output")).toHaveCount(0);
    await expect(dialog.getByLabel("Sandi tersamarkan")).toBeVisible();
    await page.evaluate(() => { Reflect.deleteProperty(document, "visibilityState"); });
    expect((await audit(client, student.identityId)).map((item) => item.event)).toEqual(["create_manual", "reveal", "reveal"]);
  } finally { await cleanup(client, fixture); await client.end(); }
});

test("sesi yang kedaluwarsa selama transaksi menggagalkan sandi dan audit sebelum commit", async ({ page }) => {
  test.setTimeout(70_000);
  const client = testDatabase(); await client.connect();
  const blocker = testDatabase(); await blocker.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    const dialog = await editor(page, student);
    const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
    if (!cookie) throw new Error("Cookie uji tidak ditemukan.");
    const digest = createHash("sha256").update(cookie.value).digest("hex");
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp() + interval '8 seconds' WHERE token_hash=$1", [digest]);
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM school_students WHERE id=$1 FOR UPDATE", [student.id]);
    await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid <> pg_backend_pid()
       AND wait_event_type='Lock' AND query LIKE '%FROM school_students WHERE id = ANY%') AS waiting`,
    )).rows[0].waiting, { timeout: 6_000 }).toBe(true);
    await expect.poll(async () => (await client.query<{ expired: boolean }>(
      "SELECT expires_at <= clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest],
    )).rows[0]?.expired, { timeout: 10_000 }).toBe(true);
    await blocker.query("COMMIT");
    await expect(dialog.getByRole("alert").filter({ hasText: "Sesi admin sudah berakhir" })).toBeVisible();
    expect(await storedPassword(client, student.identityId)).toBeNull();
    expect(await audit(client, student.identityId)).toHaveLength(0);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await blocker.end();
    await cleanup(client, fixture); await client.end();
  }
});

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port uji tidak tersedia.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startIsolatedKeyServer(keyPath: string, workingDirectory = process.cwd()) {
  const port = await unusedLoopbackPort();
  const projectRoot = process.cwd();
  const child = spawn(process.execPath, [join(projectRoot, "node_modules/next/dist/bin/next"), "start", projectRoot, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workingDirectory, env: { ...process.env, NUSACBT_PARTICIPANT_KEY_FILE: keyPath, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server uji kunci tidak siap.")), 30_000);
      const onOutput = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("Ready in")) { clearTimeout(timer); resolve(); }
      };
      child.stdout?.on("data", onOutput);
      child.stderr?.on("data", onOutput);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server uji berhenti (${code}).`)); });
    });
    return {
      port,
      close: async () => {
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
        await exited;
        clearTimeout(timer);
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await exited;
    throw error;
  }
}

test("server menolak kunci yang belum diatur, hilang, berbeda, atau berada di repository", async ({ page }) => {
  test.setTimeout(100_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  const temp = await mkdtemp(join(tmpdir(), "nusacbt-key-e2e-"));
  const wrongKey = join(temp, "wrong-test.key");
  const fakeRepo = join(temp, "repo-fiktif");
  const keyInRepo = join(fakeRepo, "key-untuk-tes.key");
  const outsideCwd = join(temp, "cwd-di-luar");
  const password = "KUNCITES";
  const configuredKey = process.env.NUSACBT_PARTICIPANT_KEY_FILE;
  if (!configuredKey) throw new Error("Kunci fiktif khusus tes harus dikonfigurasi.");
  let inProjectDir: string | undefined;
  try {
    await createParticipantKeyFile(wrongKey, process.cwd());
    await mkdir(fakeRepo);
    await createParticipantKeyFile(keyInRepo, process.cwd());
    await mkdir(join(fakeRepo, ".git"));
    await mkdir(outsideCwd);
    inProjectDir = await mkdtemp(join(process.cwd(), ".next", "kunci-e2e-"));
    const keyInProject = join(inProjectDir, "kunci-fiktif.key");
    await copyFile(configuredKey, keyInProject);
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, password);
    const before = await storedPassword(client, student.identityId);
    const dialog = await showDialog(page, student);
    const post = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/sandi");
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    const request = await post;
    await expect(dialog.locator("output")).toHaveText(password);
    const headers = request.headers(); const body = request.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");
    await dialog.getByRole("button", { name: "Tutup" }).click();
    const auditBefore = await audit(client, student.identityId);
    for (const scenario of [
      { path: "", title: "Kunci belum dikonfigurasi", actionError: "Kunci sandi peserta belum dikonfigurasi" },
      { path: join(temp, "missing.key"), title: "File kunci tidak dapat digunakan", actionError: "File kunci tidak dapat dibaca atau tidak valid" },
      { path: wrongKey, title: "Kunci tidak cocok dengan database", actionError: "Kunci tidak cocok dengan database" },
      { path: keyInRepo, title: "File kunci tidak dapat digunakan", actionError: "File kunci tidak dapat dibaca atau tidak valid", cwd: outsideCwd },
      { path: keyInProject, title: "File kunci tidak dapat digunakan", actionError: "File kunci tidak dapat dibaca atau tidak valid", cwd: outsideCwd },
    ]) {
      const server = await startIsolatedKeyServer(scenario.path, scenario.cwd);
      const other = await page.context().newPage();
      try {
        const origin = `http://127.0.0.1:${server.port}`;
        await other.goto(`${origin}/data-peserta/sandi?periode=${fixture.periodAId}`);
        await expect(other.getByRole("alert").filter({ hasText: scenario.title })).toBeVisible();
        await expect(passwordRow(other, student).getByRole("button", { name: `Lihat sandi ${student.name} ${student.nisn}` })).toBeDisabled();
        await expect(passwordRow(other, student).getByRole("button", { name: `Reset sandi ${student.name} ${student.nisn}` })).toBeDisabled();
        expect(await other.content()).not.toContain(password);
        const response = await page.request.post(`${origin}/data-peserta/sandi`, {
          headers: { origin, "content-type": headers["content-type"], "next-action": headers["next-action"] }, data: body, failOnStatusCode: false,
        });
        const text = await response.text();
        expect(text).toContain(scenario.actionError);
        expect(text).not.toContain(password);
        expect(await storedPassword(client, student.identityId)).toEqual(before);
        expect(await audit(client, student.identityId)).toEqual(auditBefore);
      } finally { await other.close(); await server.close(); }
    }
    // cwd boleh merupakan induk kunci dan proyek; yang ditolak hanya lokasi
    // di dalam proyek/repository, bukan kunci eksternal yang sah.
    const server = await startIsolatedKeyServer(configuredKey, parse(process.cwd()).root);
    const other = await page.context().newPage();
    try {
      await other.goto(`http://127.0.0.1:${server.port}/data-peserta/sandi?periode=${fixture.periodAId}`);
      await expect(passwordRow(other, student).getByRole("button", { name: `Lihat sandi ${student.name} ${student.nisn}` })).toBeEnabled();
    } finally { await other.close(); await server.close(); }
  } finally {
    if (inProjectDir) await rm(inProjectDir, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true }); await cleanup(client, fixture); await client.end();
  }
});

test("sandi lama yang menyerupai HTML tetap dapat dibuka sebagai teks biasa", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  const password = '<img src=x onerror="window.__sandiTes=1">RahasiaFiktif2026';
  try {
    await insertLegacyPassword(client, student.identityId, fixture.periodAId, password);
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    const dialog = await showDialog(page, student);
    await dialog.getByRole("button", { name: "Tampilkan sandi" }).click();
    const output = dialog.locator('output[aria-label="Sandi peserta"]');
    await expect(output).toBeVisible();
    expect(await output.textContent()).toBe(password);
    await expect(output.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { __sandiTes?: number }).__sandiTes)).toBeUndefined();
    expect(JSON.stringify(await audit(client, student.identityId))).not.toContain(password);
  } finally { await cleanup(client, fixture); await client.end(); }
});

test("perubahan sandi tanpa timestamp tetap menolak reset dari halaman usang", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    await submitManual(page, student, "USANGTES");
    const before = await storedPassword(client, student.identityId);
    if (!before) throw new Error("Sandi uji tidak tersedia.");
    const dialog = await editor(page, student, true);
    const changed = Buffer.from(before.ciphertext); changed[0] ^= 1;
    await client.query("UPDATE participant_passwords SET ciphertext=$2 WHERE participant_identity_id=$1", [student.identityId, changed]);
    await dialog.getByRole("button", { name: "Ya, reset sandi" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "berubah" })).toBeVisible();
    const after = await storedPassword(client, student.identityId);
    expect(after?.version).toBe(before.version);
    expect(after?.ciphertext).toEqual(changed);
    expect(after?.hash).toBe(before.hash);
    expect((await audit(client, student.identityId)).map((item) => item.event)).toEqual(["create_manual"]);
  } finally { await cleanup(client, fixture); await client.end(); }
});

test("validasi manual di UI dan server, batas ciphertext, serta reset otomatis", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect();
  const fixture = await seedSchool(client, 1); const student = fixture.students[0];
  try {
    await loginAsAdmin(page); await openPasswords(page, fixture.periodAId);
    let dialog = await editor(page, student);
    await dialog.getByRole("radio", { name: /Manual/ }).check();
    for (const invalid of ["ABCDEFG", "ABCDEFGHI", "abcDEFGH", "ABCD1234", "ABC DEFH", "ABCD!FGH"]) {
      await dialog.getByLabel("Sandi baru", { exact: true }).fill(invalid);
      await dialog.getByLabel("Ulangi sandi baru").fill(invalid);
      await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("tepat 8 huruf kapital");
      expect(await storedPassword(client, student.identityId)).toBeNull();
    }
    const valid = "QAZWSXED";
    await dialog.getByLabel("Sandi baru", { exact: true }).fill(valid); await dialog.getByLabel("Ulangi sandi baru").fill(valid);
    const createPost = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/sandi");
    await dialog.getByRole("button", { name: "Buat sandi", exact: true }).click();
    const createRequest = await createPost; await expect(dialog).toBeHidden();
    const created = await storedPassword(client, student.identityId);
    if (!created) throw new Error("Sandi baru tidak tersedia.");
    expect(created.ciphertext.length).toBe(8);
    for (const length of [7, 513]) {
      await expect(client.query("UPDATE participant_passwords SET ciphertext=$2 WHERE participant_identity_id=$1", [student.identityId, Buffer.alloc(length)])).rejects.toMatchObject({ code: "23514" });
    }
    expect(await storedPassword(client, student.identityId)).toEqual(created);

    // Abaikan validasi browser: replay aksi admin dengan kedua field sandi dimodifikasi.
    async function replayInvalid(request: import("@playwright/test").Request, good: string, bad: string) {
      const headers = request.headers(); const body = request.postDataBuffer();
      if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Aksi sandi tidak dapat diperiksa.");
      const serialized = body.toString("utf8");
      if (serialized.split(good).length - 1 !== 2) throw new Error("Dua field sandi tidak ditemukan dalam aksi.");
      const response = await page.request.post("/data-peserta/sandi", {
        headers: { origin: "http://127.0.0.1:3100", "content-type": headers["content-type"], "next-action": headers["next-action"] },
        data: Buffer.from(serialized.split(good).join(bad)), failOnStatusCode: false,
      });
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain("Sandi baru harus tepat 8 huruf kapital");
    }
    const auditBefore = await audit(client, student.identityId);
    for (const bad of ["abcdefGH", "ABCDEFG1", "ABCDEFG", "ABCDEFGHI", "ABCDEFGH\n"]) await replayInvalid(createRequest, valid, bad);
    expect(await storedPassword(client, student.identityId)).toEqual(created);
    expect(await audit(client, student.identityId)).toEqual(auditBefore);

    dialog = await editor(page, student, true); await dialog.getByRole("radio", { name: /Manual/ }).check();
    const resetValue = "PLMOKNIJ";
    await dialog.getByLabel("Sandi baru", { exact: true }).fill(resetValue); await dialog.getByLabel("Ulangi sandi baru").fill(resetValue);
    const resetPost = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-peserta/sandi");
    await dialog.getByRole("button", { name: "Ya, reset sandi" }).click();
    const resetRequest = await resetPost; await expect(dialog).toBeHidden();
    const reset = await storedPassword(client, student.identityId);
    if (!reset) throw new Error("Sandi reset tidak tersedia.");
    expect(await decrypted(reset, fixture.periodAId)).toBe(resetValue);
    const auditAfterReset = await audit(client, student.identityId);
    await replayInvalid(resetRequest, resetValue, "ABC12345");
    expect(await storedPassword(client, student.identityId)).toEqual(reset);
    expect(await audit(client, student.identityId)).toEqual(auditAfterReset);

    dialog = await editor(page, student, true); // Otomatis adalah pilihan default.
    await dialog.getByRole("button", { name: "Ya, reset sandi" }).click(); await expect(dialog).toBeHidden();
    const automatic = await storedPassword(client, student.identityId);
    if (!automatic) throw new Error("Reset otomatis tidak tersedia.");
    const autoPassword = await decrypted(automatic, fixture.periodAId);
    expect(autoPassword).toMatch(/^[A-Z]{8}$/); expect(automatic.ciphertext.length).toBe(8);
    expect(await verifyPassword(autoPassword, automatic.hash)).toBe(true);
    expect((await audit(client, student.identityId)).map((entry) => entry.event)).toEqual(["create_manual", "reset_manual", "reset_auto"]);
  } finally { await cleanup(client, fixture); await client.end(); }
});
