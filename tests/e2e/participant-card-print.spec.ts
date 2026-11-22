import { randomInt } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type pg from "pg";

import { encryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { loginAsAdmin } from "./helpers";
import { insertLegacyPassword } from "./legacy-password-fixture";
import { cleanupLoginFixture, loginTestDatabase, seedLoginFixture, type LoginFixture } from "./participant-login-helpers";

const endpoint = "/data-peserta/kartu/siapkan";
const headers = { Origin: "http://127.0.0.1:3100", "Content-Type": "application/json", "X-NusaCBT-Cards": "1" };
test.use({ actionTimeout: 15_000 });

type Batch = { students: string[]; identities: string[]; names: string[]; prefix: string };
async function makeBatch(client: pg.Client, f: LoginFixture, count: number, long = false): Promise<Batch> {
  const prefix = `${long ? "KARTU-PDF" : "KARTU-BATCH"}-${f.suffix}-`;
  const names = Array.from({ length: count }, (_, i) => {
    const start = `${prefix}${String(i + 1).padStart(3, "0")}`;
    if (long && i === 0) return `${start}${"N".repeat(100 - start.length)}`;
    return long && i === 1 ? `${start} أحمد نور` : start;
  });
  const base = randomInt(1_000_000, 999_000_000 - count);
  const nisns = names.map((_, i) => String(base + i).padStart(10, "0"));
  await client.query("BEGIN");
  try {
    const studentRows = (await client.query<{ id: string; name: string }>(
      "INSERT INTO school_students(name,nisn) SELECT * FROM unnest($1::text[],$2::text[]) RETURNING id::text AS id,name", [names, nisns],
    )).rows;
    const byName = new Map(studentRows.map((row) => [row.name, row.id]));
    const students = names.map((name) => byName.get(name)!);
    await client.query(`INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
      SELECT id,$2,$3,$4 FROM unnest($1::bigint[]) AS u(id)`, [students, f.periodA, f.classId, `X ${f.majorName}`]);
    const numbers = names.map((_, i) => long && i === 0 ? "Z".repeat(64) : `NO-${f.suffix}-${i}`);
    const usernames = names.map((_, i) => long && i === 0 ? "U".repeat(64) : `user-${f.suffix}-${i}`);
    const identityRows = (await client.query<{ id: string; student: string }>(
      `INSERT INTO participant_identities(student_id,period_id,participant_number,username)
       SELECT student,$2,number,username FROM unnest($1::bigint[],$3::text[],$4::text[]) AS u(student,number,username)
       RETURNING id::text AS id,student_id::text AS student`, [students, f.periodA, numbers, usernames],
    )).rows;
    const byStudent = new Map(identityRows.map((row) => [row.student, row.id]));
    const identities = students.map((id) => byStudent.get(id)!);
    await client.query("COMMIT");
    return { students, identities, names, prefix };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}
async function deleteBatch(client: pg.Client, batch: Batch) {
  await client.query("DELETE FROM participant_password_audit WHERE participant_identity_id=ANY($1::bigint[])", [batch.identities]);
  await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])", [batch.identities]);
  await client.query("DELETE FROM participant_identities WHERE id=ANY($1::bigint[])", [batch.identities]);
  await client.query("DELETE FROM student_class_placements WHERE student_id=ANY($1::bigint[])", [batch.students]);
  await client.query("DELETE FROM school_students WHERE id=ANY($1::bigint[])", [batch.students]);
}

// PDF ini sepenuhnya berisi data fiktif dan dapat diperiksa oleh pembaca PDF independen.
test("A4 beberapa halaman mempertahankan teks panjang dan sandi lama sebagai teks biasa", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); const f = await seedLoginFixture(client);
  let batch: Batch | undefined;
  const prefix = '<img src=x onerror="window.__cardXss=1">';
  const legacy = prefix + "W".repeat(128 - prefix.length);
  try {
    const periodName = `PERIODE-${f.suffix}-` + "P".repeat(100 - `PERIODE-${f.suffix}-`.length);
    const majorName = `M${f.suffix}` + "M".repeat(60 - `M${f.suffix}`.length);
    await client.query("UPDATE exam_periods SET name=$2,updated_at=clock_timestamp() WHERE id=$1", [f.periodA, periodName]);
    await client.query("UPDATE school_majors SET name=$2,updated_at=clock_timestamp() WHERE id=$1", [f.majorId, majorName]);
    batch = await makeBatch(client, f, 13, true);
    await insertLegacyPassword(client, batch.identities[0], f.periodA, legacy);
    const hash = (await client.query<{ hash: string }>("SELECT password_hash AS hash FROM participant_passwords WHERE participant_identity_id=$1", [f.identityA])).rows[0].hash;
    const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
    try {
      for (const id of batch.identities.slice(1)) {
        const encrypted = encryptParticipantPassword(f.passwordA, key, { identityId: id, periodId: f.periodA });
        await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES($1,$2,$3,$4,$5)",
          [id, hash, encrypted.nonce, encrypted.ciphertext, encrypted.authenticationTag]);
      }
    } finally { key.fill(0); }
    await loginAsAdmin(page);
    await page.goto(`/data-peserta/kartu?${new URLSearchParams({ periode: f.periodA, siswa: batch.prefix })}`);
    await page.getByRole("checkbox", { name: "Pilih semua yang beridentitas pada halaman ini" }).check();
    await page.getByRole("checkbox", { name: /Sertakan sandi pada kartu/ }).check();
    await page.getByRole("button", { name: "Pratinjau kartu" }).click();
    await page.getByRole("dialog", { name: "Tampilkan sandi pada kartu?" }).getByRole("button", { name: "Ya, tampilkan sandi" }).click();
    const dialog = page.getByRole("dialog", { name: /Pratinjau/ });
    await expect(dialog.getByTestId("participant-card")).toHaveCount(13);
    await expect(dialog.locator("[data-participant-card-secret]").first()).toHaveText(legacy);
    await expect(dialog.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { __cardXss?: number }).__cardXss)).toBeUndefined();
    await page.evaluate(() => { window.print = () => { document.documentElement.setAttribute("data-verified-print", "yes"); }; });
    const verified = page.waitForResponse((response) => response.url().includes(endpoint) && response.request().postDataJSON()?.mode === "verify");
    await dialog.getByRole("button", { name: "Cetak / Simpan PDF" }).click();
    expect((await verified).status()).toBe(200); await expect(page.locator("html")).toHaveAttribute("data-verified-print", "yes");
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
    await writeFile(testInfo.outputPath("kartu-a4-fiktif.pdf"), pdf);
    if (process.env.CARD_PDF_ARTIFACT) await writeFile(process.env.CARD_PDF_ARTIFACT, pdf);
    const audit = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM participant_password_audit WHERE participant_identity_id=ANY($1::bigint[]) AND event='reveal'", [batch.identities]);
    expect(audit.rows[0].n).toBe(13);
  } finally { if (batch) await deleteBatch(client, batch); await cleanupLoginFixture(client, f); await client.end(); }
});

test("100 peserta per batch, halaman berikutnya terpisah, dan permintaan 101 ditolak", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); const f = await seedLoginFixture(client); let batch: Batch | undefined;
  try {
    batch = await makeBatch(client, f, 101); await loginAsAdmin(page);
    await page.goto(`/data-peserta/kartu?${new URLSearchParams({ periode: f.periodA, siswa: batch.prefix })}`);
    await expect(page.getByRole("list", { name: "Daftar peserta untuk kartu" }).getByRole("listitem")).toHaveCount(100);
    await page.getByRole("checkbox", { name: "Pilih semua yang beridentitas pada halaman ini" }).check();
    await expect(page.getByText("100 peserta dipilih", { exact: false })).toBeVisible();
    const waiting = page.waitForResponse((response) => response.url().includes(endpoint) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Pratinjau kartu" }).click();
    const prepared = await waiting; expect(prepared.status()).toBe(200);
    const payload = prepared.request().postDataJSON(); expect(payload.candidates).toHaveLength(100);
    await expect(page.getByRole("dialog", { name: /Pratinjau/ }).getByTestId("participant-card")).toHaveCount(100);
    await page.getByRole("dialog", { name: /Pratinjau/ }).getByRole("button", { name: "Tutup" }).click();
    const tooMany = await page.request.post(endpoint, { headers, data: { ...payload, candidates: [...payload.candidates, payload.candidates[0]] } });
    expect(tooMany.status()).toBe(409);
    await page.getByRole("link", { name: "Berikutnya" }).click();
    await expect(page.getByRole("list", { name: "Daftar peserta untuk kartu" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("0 peserta dipilih", { exact: false })).toBeVisible();
    expect((await client.query<{ n: number }>("SELECT count(*)::int AS n FROM participant_password_audit WHERE participant_identity_id=ANY($1::bigint[])", [batch.identities])).rows[0].n).toBe(0);
  } finally { if (batch) await deleteBatch(client, batch); await cleanupLoginFixture(client, f); await client.end(); }
});
