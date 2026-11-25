import { expect, test } from "@playwright/test";
import pg from "pg";

import { loginAsAdmin } from "./helpers";
import { cleanupTopics, createQuestion, createTopic, selectComboboxOption, sessionDigest, suffix, testDatabase } from "./question-helpers";

async function period(client: pg.Client, tag: string) {
  return (await client.query<{ id: string }>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2026-01-01') RETURNING id::text AS id", [`Keamanan Tes ${tag}`])).rows[0].id;
}
async function cleanup(client: pg.Client, periodId: string | undefined, topicIds: string[]) {
  if (periodId) await client.query("DELETE FROM exam_tests WHERE period_id=$1", [periodId]);
  await cleanupTopics(client, topicIds);
  if (periodId) await client.query("DELETE FROM exam_periods WHERE id=$1", [periodId]);
}
const BOUNDARY = "nusacbt-exam-test-boundary";
function multipart(entries: Array<[string, string]>) {
  return Buffer.from(entries.map(([key, value]) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join("") + `--${BOUNDARY}--\r\n`);
}
function duplicate(entries: Array<[string, string]>, suffixName: string, value: string) {
  const result = entries.map((entry) => [...entry] as [string, string]);
  const index = result.findIndex(([key]) => key.endsWith(suffixName));
  if (index < 0) throw new Error(`Field ${suffixName} tidak tertangkap.`);
  result.splice(index + 1, 0, [result[index][0], value]); return result;
}
function replace(entries: Array<[string, string]>, suffixName: string, value: string) {
  const result = entries.map((entry) => [...entry] as [string, string]);
  const field = result.find(([key]) => key.endsWith(suffixName));
  if (!field) throw new Error(`Field ${suffixName} tidak tertangkap.`);
  field[1] = value; return result;
}

test("aksi menolak asal asing, anonim, field ganda, soal ganda dan jadwal palsu; teks ditampilkan aman", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect(); const tag = suffix(); let periodId: string | undefined; const topics: string[] = []; let openedDialog = false;
  page.on("dialog", (dialog) => { openedDialog = true; void dialog.dismiss(); });
  try {
    periodId = await period(client, tag); topics.push(await createTopic(client, `Payload Tes ${tag}`)); const q = await createQuestion(client, topics[0], `Soal aman ${tag}`);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    await page.evaluate(() => {
      const w = window as Window & { capturedExamFields?: Array<[string, string]> };
      const original = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body instanceof FormData) {
          w.capturedExamFields = Array.from(init.body.entries()).map(([key, value]) => {
            if (typeof value !== "string") throw new Error("File tidak diharapkan pada rancangan tes.");
            return [key, value];
          });
        }
        return original(input, init);
      }) as typeof fetch;
    });
    await page.getByRole("button", { name: "Tambah tes", exact: true }).click(); const form = page.getByRole("dialog", { name: "Tambah rancangan tes" });
    const name = `<img src=x onerror=alert(1)> ' OR 1=1 -- ${tag}`;
    await form.getByLabel("Nama tes").fill(name); await form.getByLabel("Periode ujian").selectOption(periodId);
    await form.getByLabel("Tanggal dan waktu mulai").fill("2026-11-17T08:30"); await form.getByLabel("Cari soal bank").fill(tag);
    await form.getByLabel(`Pilih soal ${q.id}`).check();
    const capturedRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-tes/daftar");
    await form.getByRole("button", { name: "Simpan rancangan" }).click(); const request = await capturedRequest; await expect(form).toBeHidden();
    const action = request.headers()["next-action"]; if (!action) throw new Error("Identitas Server Action tidak tertangkap.");
    const entries = await page.evaluate(() => (window as Window & { capturedExamFields?: Array<[string, string]> }).capturedExamFields ?? []);
    expect(entries.length).toBeGreaterThan(5);
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_tests WHERE period_id=$1", [periodId])).rows[0].id;
    const row = page.getByRole("list", { name: "Daftar rancangan tes" }).getByRole("listitem").filter({ has: page.getByRole("button", { name: `Ubah tes ${id}` }) });
    await expect(row).toContainText(name); expect(await row.locator("img, script").count()).toBe(0); expect(openedDialog).toBe(false);
    const headers = { "content-type": `multipart/form-data; boundary=${BOUNDARY}`, "next-action": action };
    const foreign = await page.request.post("/data-tes/daftar", { headers: { ...headers, origin: "https://attacker.invalid" }, data: multipart(entries), failOnStatusCode: false });
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    const dup = await page.request.post("/data-tes/daftar", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(duplicate(entries, "timeZone", "WIT")), failOnStatusCode: false });
    expect(await dup.text()).toContain("nilai ganda");
    const dupQ = await page.request.post("/data-tes/daftar", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(duplicate(duplicate(entries, "questionIds", q.id), "questionRevisions", q.revision)), failOnStatusCode: false });
    expect(await dupQ.text()).toContain("soal ganda");
    const invalid = await page.request.post("/data-tes/daftar", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(replace(entries, "startLocal", "2026-02-31T08:30")), failOnStatusCode: false });
    expect(await invalid.text()).toContain("Tanggal dan waktu mulai tidak valid");
    const oldForm = await page.request.post("/data-tes/daftar", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(replace(entries, "formVersion", "draft-v0")), failOnStatusCode: false });
    expect(await oldForm.text()).toContain("Versi formulir tidak sesuai");
    const anonymous = await browser.newContext();
    try { await anonymous.request.post("http://127.0.0.1:3100/data-tes/daftar", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(entries), failOnStatusCode: false }); }
    finally { await anonymous.close(); }
    expect((await client.query("SELECT id FROM exam_tests WHERE period_id=$1", [periodId])).rowCount).toBe(1);
    expect((await client.query("SELECT question_id FROM exam_test_questions WHERE exam_test_id=$1", [id])).rowCount).toBe(1);
  } finally { await cleanup(client, periodId, topics); await client.end(); }
});

test("periode yang dihapus saat penyimpanan menunggu menyebabkan seluruh pembuatan dibatalkan", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); const blocker = testDatabase(); await client.connect(); await blocker.connect(); const tag = suffix(); let periodId: string | undefined;
  try {
    periodId = await period(client, tag); await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    await page.getByRole("button", { name: "Tambah tes", exact: true }).click(); const form = page.getByRole("dialog", { name: "Tambah rancangan tes" });
    await form.getByLabel("Nama tes").fill(`Jangan ada ${tag}`); await form.getByLabel("Periode ujian").selectOption(periodId); await form.getByLabel("Tanggal dan waktu mulai").fill("2026-11-17T08:30");
    await blocker.query("BEGIN"); await blocker.query("DELETE FROM exam_periods WHERE id=$1", [periodId]);
    await form.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM exam_periods WHERE id=%FOR KEY SHARE%') AS waiting")).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await blocker.query("COMMIT"); await expect(form.getByRole("alert")).toContainText("Periode sudah dihapus");
    expect((await client.query("SELECT id FROM exam_tests WHERE name=$1", [`Jangan ada ${tag}`])).rowCount).toBe(0);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); await cleanup(client, periodId, []); await client.end(); }
});

test("sesi yang berakhir saat menunggu kunci soal membatalkan transaksi", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); const blocker = testDatabase(); await client.connect(); await blocker.connect(); const tag = suffix(); let periodId: string | undefined; const topics: string[] = [];
  try {
    periodId = await period(client, tag); topics.push(await createTopic(client, `Sesi Tes ${tag}`)); const q = await createQuestion(client, topics[0], `Soal sesi ${tag}`);
    const id = (await client.query<{ id: string }>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2026-11-17T01:30Z','WIB',90) RETURNING id::text AS id", [periodId, `Sebelum ${tag}`])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [id, q.id]);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar"); await page.getByRole("button", { name: `Ubah tes ${id}` }).click();
    const form = page.getByRole("dialog", { name: "Ubah rancangan tes" }); await form.getByLabel("Nama tes").fill(`Tidak tersimpan ${tag}`);
    const digest = await sessionDigest(page); await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE token_hash=$1", [digest]);
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM question_bank WHERE id=$1 FOR UPDATE", [q.id]);
    await form.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM question_bank WHERE id=ANY%FOR SHARE%') AS waiting")).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0].expired, { timeout: 12_000 }).toBe(true);
    await blocker.query("COMMIT"); await expect(form.getByRole("alert")).toContainText("Sesi admin sudah berakhir");
    expect((await client.query("SELECT name FROM exam_tests WHERE id=$1", [id])).rows[0].name).toBe(`Sebelum ${tag}`);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); await cleanup(client, periodId, topics); await client.end(); }
});

test("batas 1000 soal diterapkan pada pilih semua dan dapat disimpan sebagai satu transaksi", async ({ page }) => {
  test.setTimeout(150_000);
  const client = testDatabase(); await client.connect(); const tag = suffix(); let periodId: string | undefined; const topics: string[] = [];
  try {
    periodId = await period(client, tag); topics.push(await createTopic(client, `Batas Tes ${tag}`));
    await client.query(`INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option)
      SELECT $1, $2 || CASE WHEN n<=1000 THEN ' PILIH ' ELSE ' EXTRA ' END || n::text, 'A','B','C','D','E','A' FROM generate_series(1,1001) AS n`, [topics[0], tag]);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar"); await page.getByRole("button", { name: "Tambah tes", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Tambah rancangan tes" }); await form.getByLabel("Nama tes").fill(`Batas ${tag}`); await form.getByLabel("Periode ujian").selectOption(periodId); await form.getByLabel("Tanggal dan waktu mulai").fill("2026-11-17T08:30");
    await selectComboboxOption(form, "Filter topik / mata pelajaran", `Batas Tes ${tag}`); await form.getByRole("button", { name: "Pilih semua hasil" }).click();
    await expect(form.getByRole("alert")).toContainText("melebihi batas 1000 soal");
    await form.getByLabel("Cari soal bank").fill(`${tag} PILIH`); await form.getByRole("button", { name: "Pilih semua hasil" }).click();
    await expect(form.getByText("Urutan soal terpilih (1000)")).toBeVisible(); await form.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect(form).toBeHidden({ timeout: 60_000 });
    const result = await client.query<{ id: string; count: string }>("SELECT e.id::text AS id,count(eq.question_id)::text AS count FROM exam_tests e LEFT JOIN exam_test_questions eq ON eq.exam_test_id=e.id WHERE e.period_id=$1 GROUP BY e.id", [periodId]);
    expect(result.rows).toHaveLength(1); expect(result.rows[0].count).toBe("1000");
    expect((await client.query("SELECT min(position) AS first,max(position) AS last,count(DISTINCT position)::int AS total FROM exam_test_questions WHERE exam_test_id=$1", [result.rows[0].id])).rows[0]).toEqual({ first: 1, last: 1000, total: 1000 });
  } finally { await cleanup(client, periodId, topics); await client.end(); }
});
