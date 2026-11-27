import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

import { parseMathML } from "../../src/lib/question-math.mjs";
import { loginAsAdmin } from "./helpers";
import { cleanupTopics, createQuestion, createTopic, deletion, selectComboboxOption, sessionDigest, suffix, testDatabase } from "./question-helpers";

async function createPeriod(client: pg.Client, tag: string) {
  return (await client.query<{ id: string }>("INSERT INTO exam_periods(name,start_date,end_date) VALUES($1,'2026-01-01','2026-12-31') RETURNING id::text AS id", [`Periode Tes ${tag}`])).rows[0].id;
}
async function createDraft(client: pg.Client, periodId: string, name: string, questionIds: string[] = []) {
  const id = (await client.query<{ id: string }>(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes,shuffle_questions,shuffle_options)
    VALUES($1,$2,'2026-11-17T01:30:00Z','WIB',90,false,false) RETURNING id::text AS id`, [periodId, name])).rows[0].id;
  if (questionIds.length) await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) SELECT $1, q, n::int FROM unnest($2::bigint[]) WITH ORDINALITY AS t(q,n)", [id, questionIds]);
  return id;
}
async function cleanup(client: pg.Client, periodId: string | undefined, topicIds: string[]) {
  if (periodId) await client.query("DELETE FROM exam_tests WHERE period_id=$1", [periodId]);
  await cleanupTopics(client, topicIds);
  if (periodId) await client.query("DELETE FROM exam_periods WHERE id=$1", [periodId]);
}
function row(page: Page, id: string) {
  return page.getByRole("list", { name: "Daftar rancangan tes" }).getByRole("listitem").filter({ has: page.getByRole("button", { name: `Ubah tes ${id}` }) });
}
async function openForm(page: Page, id?: string) {
  if (id) await row(page, id).getByRole("button", { name: `Ubah tes ${id}` }).click();
  else await page.getByRole("button", { name: "Tambah tes", exact: true }).click();
  const form = page.getByRole("dialog", { name: id ? "Ubah rancangan tes" : "Tambah rancangan tes", exact: true });
  await expect(form).toBeVisible(); return form;
}
async function fillForm(form: Locator, periodId: string, name: string) {
  await form.getByLabel("Nama tes").fill(name);
  await form.getByLabel("Periode ujian").selectOption(periodId);
  await form.getByLabel("Tanggal dan waktu mulai").fill("2026-11-17T23:30");
  await form.getByLabel("Durasi (menit)").fill("90");
}

// Semua tes memakai data fiktif dan testDatabase() menolak DB lain.
test("admin menyusun, melihat, mengubah, dan menghapus rancangan dengan soal dan zona waktu", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect(); const tag = suffix(); let periodId: string | undefined; const topics: string[] = [];
  try {
    periodId = await createPeriod(client, tag);
    topics.push(await createTopic(client, `Matematika Tes ${tag}`), await createTopic(client, `Arab Tes ${tag}`));
    const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
    const q1 = await createQuestion(client, topics[0], `Satu ${tag}`);
    const formula = parseMathML('<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>');
    const rich = { type: "doc", content: [
      { type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: `سُؤَالٌ ${tag}` }, { type: "mathFormula", attrs: { formula } }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Kolom" }] }] }] }] },
    ] };
    await client.query("UPDATE question_bank SET prompt_rich=$1::jsonb WHERE id=$2", [JSON.stringify(rich), q1.id]);
    const q2 = await createQuestion(client, topics[0], `Dua ${tag}`, image);
    const q3 = await createQuestion(client, topics[1], `Tiga ${tag}`);
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Tes", exact: true }).click();
    await page.getByRole("link", { name: "Daftar Tes", exact: true }).click();
    await expect(page).toHaveURL(/\/data-tes\/daftar$/);
    await expect(page.getByText("Pengelolaan jadwal & pelaksanaan tes")).toBeVisible();
    const form = await openForm(page);
    await fillForm(form, periodId, `Ujian ${tag}`);
    await expect(form.getByText(/Perkiraan akhir:.*18\/11\/2026 01:00 WIB/)).toBeVisible();
    await selectComboboxOption(form, "Filter mata pelajaran", `Matematika Tes ${tag}`);
    await form.getByRole("button", { name: `Lihat isi soal ${q1.id}` }).click();
    await expect(form.locator('p[dir="rtl"]')).toContainText("سُؤَالٌ");
    await expect(form.locator("table")).toHaveCount(1); await expect(form.locator("math mfrac")).toHaveCount(1);
    await form.getByRole("button", { name: `Lihat isi soal ${q2.id}` }).click();
    await expect(form.getByText("Jawaban benar")).toBeVisible();
    const imageElement = form.getByAltText(`Gambar soal ${q2.id}`);
    await expect(imageElement).toBeVisible();
    await expect.poll(() => imageElement.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(4);
    await form.getByRole("button", { name: "Pilih semua hasil" }).click();
    await selectComboboxOption(form, "Filter mata pelajaran", `Arab Tes ${tag}`);
    await form.getByLabel(`Pilih soal ${q3.id}`).check();
    await form.getByRole("button", { name: `Naikkan soal ${q3.id}` }).click();
    await form.getByRole("button", { name: `Naikkan soal ${q3.id}` }).click();
    const order = form.getByRole("list", { name: "Urutan soal terpilih" }).getByRole("listitem");
    await expect(order.nth(0)).toContainText(`#${q3.id}`); await expect(order.nth(1)).toContainText(`#${q1.id}`); await expect(order.nth(2)).toContainText(`#${q2.id}`);
    await form.getByLabel("Acak urutan soal").check(); await form.getByLabel("Acak urutan pilihan jawaban").check();
    await form.getByRole("button", { name: "Simpan rancangan" }).click(); await expect(form).toBeHidden();
    let dbRows: { id: string; utc: string; time_zone: string; duration_minutes: number; shuffle_questions: boolean; shuffle_options: boolean }[] = [];
    await expect.poll(async () => { dbRows = (await client.query(`SELECT id::text AS id, to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') AS utc, time_zone, duration_minutes, shuffle_questions, shuffle_options FROM exam_tests WHERE period_id=$1`, [periodId])).rows; return dbRows.length; }).toBe(1);
    const id = dbRows[0].id;
    expect(dbRows[0]).toEqual({ id, utc: "2026-11-17T16:30", time_zone: "WIB", duration_minutes: 90, shuffle_questions: true, shuffle_options: true });
    expect((await client.query("SELECT question_id::text AS id FROM exam_test_questions WHERE exam_test_id=$1 ORDER BY position", [id])).rows.map((r) => r.id)).toEqual([q3.id, q1.id, q2.id]);
    await expect(row(page, id)).toContainText("18/11/2026 01:00 WIB");
    await expect(row(page, id)).toContainText("3 soal");
    await expect(client.query("DELETE FROM exam_periods WHERE id=$1", [periodId])).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23001)$/) });
    await expect(client.query("DELETE FROM question_bank WHERE id=$1", [q1.id])).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23001)$/) });
    await page.goto("/data-modul/soal"); await page.getByLabel("Cari soal").fill(tag);
    const deleteQuestion = await deletion(page, q1.id); await deleteQuestion.getByRole("button", { name: "Ya, hapus soal" }).click();
    await expect(deleteQuestion.getByRole("alert")).toContainText("masih digunakan oleh data lain"); await deleteQuestion.getByRole("button", { name: "Batal" }).click();
    await page.goto("/data-tes/daftar"); const edit = await openForm(page, id);
    await edit.getByLabel("Nama tes").fill(`Diubah ${tag}`);
    await edit.getByLabel("Durasi (menit)").fill("45"); await edit.getByLabel("Acak urutan soal").uncheck(); await edit.getByLabel("Acak urutan pilihan jawaban").uncheck();
    await edit.getByRole("button", { name: `Lepas soal ${q2.id}` }).click();
    await edit.getByRole("button", { name: "Simpan rancangan" }).click(); await expect(edit).toBeHidden();
    await expect(row(page, id)).toContainText(`Diubah ${tag}`);
    expect((await client.query("SELECT question_id::text AS id FROM exam_test_questions WHERE exam_test_id=$1 ORDER BY position", [id])).rows.map((r) => r.id)).toEqual([q3.id, q1.id]);
    expect((await client.query("SELECT to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI') AS utc, time_zone, duration_minutes, shuffle_questions, shuffle_options FROM exam_tests WHERE id=$1", [id])).rows[0]).toEqual({ utc: "2026-11-17T16:30", time_zone: "WIB", duration_minutes: 45, shuffle_questions: false, shuffle_options: false });
    await page.reload(); await page.getByLabel("Cari tes").fill(tag); await expect(row(page, id)).toContainText("18/11/2026 00:15 WIB");
    await row(page, id).getByRole("button", { name: `Hapus tes ${id}` }).click();
    const confirm = page.getByRole("dialog", { name: "Hapus rancangan tes?" });
    await expect(confirm).toContainText("Soal pada bank tidak dihapus");
    await confirm.getByRole("button", { name: "Ya, hapus rancangan" }).click(); await expect(confirm).toBeHidden();
    expect((await client.query("SELECT id FROM exam_tests WHERE id=$1", [id])).rowCount).toBe(0);
    expect((await client.query("SELECT id FROM question_bank WHERE id=ANY($1::bigint[])", [[q1.id, q2.id, q3.id]])).rowCount).toBe(3);
  } finally { await cleanup(client, periodId, topics); await client.end(); }
});

test("constraint melindungi periode, soal, durasi, zona, dan posisi", async () => {
  const client = testDatabase(); await client.connect();
  try {
    await client.query("BEGIN"); const tag = suffix(); const period = await createPeriod(client, tag); const topic = await createTopic(client, `Constraint Tes ${tag}`);
    const q = await createQuestion(client, topic, `Constraint ${tag}`); const id = await createDraft(client, period, `Tes ${tag}`, [q.id]);
    const cases: Array<[string, unknown[] | undefined, string]> = [
      ["UPDATE exam_tests SET name='' WHERE id=$1", [id], "23514"],
      ["UPDATE exam_tests SET name=$2 WHERE id=$1", [id, "x".repeat(101)], "23514"],
      ["UPDATE exam_tests SET duration_minutes=0 WHERE id=$1", [id], "23514"],
      ["UPDATE exam_tests SET duration_minutes=10081 WHERE id=$1", [id], "23514"],
      ["UPDATE exam_tests SET time_zone='UTC' WHERE id=$1", [id], "23514"],
      ["UPDATE exam_tests SET period_id=9223372036854775807 WHERE id=$1", [id], "23503"],
      ["UPDATE exam_tests SET starts_at='2102-01-01Z' WHERE id=$1", [id], "23514"],
      ["INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,2)", [id, q.id], "23505"],
      ["UPDATE exam_test_questions SET position=0 WHERE exam_test_id=$1", [id], "23514"],
      ["UPDATE exam_test_questions SET position=1001 WHERE exam_test_id=$1", [id], "23514"],
      ["DELETE FROM question_bank WHERE id=$1", [q.id], "restrict"],
      ["DELETE FROM exam_periods WHERE id=$1", [period], "restrict"],
    ];
    for (const [sql, params, code] of cases) {
      await client.query("SAVEPOINT constraint_check");
      try { await expect(client.query(sql, params)).rejects.toMatchObject({ code: code === "restrict" ? expect.stringMatching(/^(23503|23001)$/) : code }); }
      finally { await client.query("ROLLBACK TO SAVEPOINT constraint_check"); }
    }
    await client.query("DELETE FROM exam_tests WHERE id=$1", [id]);
    expect((await client.query("SELECT id FROM question_bank WHERE id=$1", [q.id])).rowCount).toBe(1);
    expect((await client.query("SELECT exam_test_id FROM exam_test_questions WHERE exam_test_id=$1", [id])).rowCount).toBe(0);
  } finally { await client.query("ROLLBACK").catch(() => {}); await client.end(); }
});

test("rancangan kosong dapat disimpan; filter, pencarian, dan tampilan ponsel tetap berfungsi", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const tag = suffix(); let period: string | undefined;
  try {
    period = await createPeriod(client, tag); await page.setViewportSize({ width: 390, height: 844 }); await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    const form = await openForm(page); await fillForm(form, period, `Kosong ${tag}`);
    await expect(form.getByText("Belum ada soal terpilih.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await form.getByRole("button", { name: "Simpan rancangan" }).click(); await expect(form).toBeHidden();
    const result = await client.query<{ id: string }>("SELECT id::text AS id FROM exam_tests WHERE period_id=$1", [period]); const id = result.rows[0].id;
    await page.getByLabel("Cari tes").fill(`Kosong ${tag}`); await page.getByLabel("Filter periode tes").selectOption(period);
    await expect(row(page, id)).toContainText("0 soal"); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByLabel("Cari tes").fill("tidak ada hasil 789xz"); await expect(page.getByText("Tidak ada tes yang cocok")).toBeVisible();
  } finally { await cleanup(client, period, []); await client.end(); }
});

test("formulir usang tidak menimpa perubahan tes maupun soal di bank", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const tag = suffix(); let period: string | undefined; const topics: string[] = [];
  try {
    period = await createPeriod(client, tag); topics.push(await createTopic(client, `Usang Tes ${tag}`));
    const q = await createQuestion(client, topics[0], `Sebelum ${tag}`); const id = await createDraft(client, period, `Awal ${tag}`, [q.id]);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    const first = await openForm(page, id);
    await client.query("UPDATE exam_tests SET name=$1 WHERE id=$2", [`Pemenang ${tag}`, id]);
    await first.getByLabel("Nama tes").fill(`Jangan menimpa ${tag}`); await first.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect(first.getByRole("alert")).toContainText("Tes sudah berubah atau dihapus");
    await first.getByRole("button", { name: "Muat ulang daftar" }).click(); await expect(first).toBeHidden(); await expect(row(page, id)).toContainText(`Pemenang ${tag}`);
    const second = await openForm(page, id); await second.getByLabel("Nama tes").fill(`Tidak tersimpan ${tag}`);
    await client.query("UPDATE question_bank SET prompt_text=$1 WHERE id=$2", [`Soal baru ${tag}`, q.id]);
    await second.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect(second.getByRole("alert")).toContainText("Ada soal yang berubah atau dihapus");
    expect((await client.query("SELECT name FROM exam_tests WHERE id=$1", [id])).rows[0].name).toBe(`Pemenang ${tag}`);
    expect((await client.query("SELECT question_id::text AS id, position FROM exam_test_questions WHERE exam_test_id=$1", [id])).rows).toEqual([{ id: q.id, position: 1 }]);
    await second.getByRole("button", { name: "Muat ulang daftar" }).click(); await expect(second).toBeHidden();
    await row(page, id).getByRole("button", { name: `Hapus tes ${id}` }).click(); const confirm = page.getByRole("dialog", { name: "Hapus rancangan tes?" });
    await client.query("UPDATE exam_tests SET name=$1 WHERE id=$2", [`Terbaru ${tag}`, id]);
    await confirm.getByRole("button", { name: "Ya, hapus rancangan" }).click(); await expect(confirm.getByRole("alert")).toContainText("Tes sudah berubah atau dihapus");
    expect((await client.query("SELECT id FROM exam_tests WHERE id=$1", [id])).rowCount).toBe(1);
  } finally { await cleanup(client, period, topics); await client.end(); }
});

test("penyimpanan menunggu soal yang sedang diubah lalu membatalkan seluruh perubahan", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); const blocker = testDatabase(); await client.connect(); await blocker.connect(); const tag = suffix(); let period: string | undefined; const topics: string[] = [];
  try {
    period = await createPeriod(client, tag); topics.push(await createTopic(client, `Tunggu Tes ${tag}`)); const q = await createQuestion(client, topics[0], `Sebelum ${tag}`); const id = await createDraft(client, period, `Asli ${tag}`, [q.id]);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar"); const form = await openForm(page, id); await form.getByLabel("Nama tes").fill(`Tidak boleh tersimpan ${tag}`);
    await blocker.query("BEGIN"); await blocker.query("UPDATE question_bank SET prompt_text=$1 WHERE id=$2", [`Menang ${tag}`, q.id]);
    await form.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM question_bank WHERE id=ANY%FOR SHARE%') AS waiting`)).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await blocker.query("COMMIT"); await expect(form.getByRole("alert")).toContainText("Ada soal yang berubah atau dihapus");
    expect((await client.query("SELECT name FROM exam_tests WHERE id=$1", [id])).rows[0].name).toBe(`Asli ${tag}`);
    expect((await client.query("SELECT question_id::text AS id FROM exam_test_questions WHERE exam_test_id=$1", [id])).rows).toEqual([{ id: q.id }]);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); await cleanup(client, period, topics); await client.end(); }
});

test("halaman privat dan sesi yang dicabut tidak mengubah rancangan", async ({ page, browser }) => {
  const client = testDatabase(); await client.connect(); const tag = suffix(); let period: string | undefined;
  try {
    period = await createPeriod(client, tag); const id = await createDraft(client, period, `Privat ${tag}`);
    const anonymous = await browser.newContext();
    try { const p = await anonymous.newPage(); await p.goto("/data-tes/daftar"); await expect(p).toHaveURL(/\/login$/); }
    finally { await anonymous.close(); }
    await loginAsAdmin(page); const response = await page.goto("/data-tes/daftar");
    expect(response?.headers()["cache-control"]).toContain("private"); expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    const form = await openForm(page, id); await form.getByLabel("Nama tes").fill(`Jangan simpan ${tag}`);
    const token = await sessionDigest(page); await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [token]);
    await form.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect.poll(async () => (await client.query("SELECT name FROM exam_tests WHERE id=$1", [id])).rows[0].name).toBe(`Privat ${tag}`);
    await page.goto("/data-tes/daftar"); await expect(page).toHaveURL(/\/login$/);
  } finally { await cleanup(client, period, []); await client.end(); }
});

test("tag tes, filter tag, pencarian multi-kata, dan peringatan tanggal di luar periode berfungsi tanpa memblokir simpan", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const tag = suffix(); let periodId: string | undefined;
  try {
    periodId = (await client.query<{ id: string }>(
      "INSERT INTO exam_periods(name,start_date,end_date) VALUES($1,'2026-06-01','2026-06-30') RETURNING id::text AS id",
      [`Periode Tag ${tag}`],
    )).rows[0].id;
    await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    const form = await openForm(page);
    await form.getByLabel("Nama tes").fill(`Fisika Lanjut ${tag}`);
    await form.getByLabel("Periode ujian").selectOption(periodId);
    // Tanggal di luar rentang 2026-06-01..2026-06-30 -> tampilkan peringatan lunak tetapi tetap boleh disimpan
    await form.getByLabel("Tanggal dan waktu mulai").fill("2026-07-05T08:00");
    await expect(form.getByText("Tanggal di luar rentang periode (peringatan)")).toBeVisible();
    await form.getByLabel("Tag tes (opsional)").fill(`UTS-${tag}, Kelas-XI`);
    await form.getByRole("button", { name: "Tambah tag" }).click();
    await form.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect(form).toBeHidden();

    const stored = (await client.query<{ id: string; tags: string[] }>("SELECT id::text AS id, tags FROM exam_tests WHERE period_id=$1", [periodId])).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].tags).toEqual(["Kelas-XI", `UTS-${tag}`]);

    await page.getByLabel("Cari tes").fill(`Kelas-XI Fisika ${tag}`);
    await expect(row(page, stored[0].id)).toBeVisible();
    await page.getByLabel("Cari tes").fill("");
    await page.getByLabel("Filter tag tes").getByRole("button", { name: `UTS-${tag}`, exact: true }).click();
    await expect(row(page, stored[0].id)).toBeVisible();
  } finally { await cleanup(client, periodId, []); await client.end(); }
});

