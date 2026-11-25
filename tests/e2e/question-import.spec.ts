import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { loginAsAdmin } from "./helpers";
import { cleanupTopics, createTopic, selectComboboxOption, sessionDigest, suffix, testDatabase } from "./question-helpers";

const fixture = path.join(process.cwd(), "public/templates/template-soal-nusacbt.docx");
const destination = "/data-modul/import-soal";

async function previewFile(page: Page, topic: string) {
  await page.goto(destination);
  await selectComboboxOption(page, "Topik / mata pelajaran", topic);
  await page.getByLabel("File Word").setInputFiles(fixture);
  await page.getByRole("button", { name: "Periksa pratinjau" }).click();
  await expect(page.getByRole("heading", { name: "Pratinjau soal" })).toBeVisible();
}
async function confirmSave(page: Page) {
  await page.getByRole("button", { name: "Simpan hasil impor" }).click();
  const confirm = page.getByRole("dialog", { name: "Simpan hasil impor?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Ya, simpan impor" }).click();
}
function isSave(request: Request) {
  return request.method() === "POST" && new URL(request.url()).pathname === destination;
}
type CapturedField = { key: string; value?: string; filename?: string; mime?: string };
async function captureNextForm(page: Page) {
  // Chromium does not expose postDataBuffer for file multipart bodies. Capture
  // the actual FormData before fetch, then replay with the same fixture bytes.
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method === "POST" && init.body instanceof FormData) {
        (window as Window & { capturedQuestionImport?: CapturedField[] }).capturedQuestionImport = Array.from(init.body.entries(), ([key, value]) =>
          typeof value === "string" ? { key, value } : { key, filename: value.name, mime: value.type },
        );
      }
      return original(input, init);
    };
  });
}
async function replayForm(page: Page) {
  const fields = await page.evaluate(() => (window as Window & { capturedQuestionImport?: CapturedField[] }).capturedQuestionImport);
  if (!fields?.length) throw new Error("FormData impor tidak dapat direkam.");
  const form = new FormData();
  const data = readFileSync(fixture);
  for (const field of fields) {
    if (field.filename) form.append(field.key, new Blob([new Uint8Array(data)], { type: field.mime }), field.filename);
    else form.append(field.key, field.value ?? "");
  }
  return form;
}

test("pratinjau Word fiktif, simpan atomik dan pengulangan operasi tidak menggandakan", async ({ page }) => {
  test.setTimeout(60_000);
  const tag = suffix(); const name = `Impor Word ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name));
    await loginAsAdmin(page); await previewFile(page, name);
    const list = page.getByRole("list", { name: "Pratinjau impor soal" });
    await expect(list).toContainText("السُّؤَالُ");
    await expect(list.locator("table")).toHaveCount(1);
    await expect(list.locator("math mfrac")).toHaveCount(2);
    await page.getByRole("button", { name: "Berikutnya" }).click();
    await expect(list.getByAltText("Gambar soal 4")).toBeVisible();
    await expect(page.getByText("Halaman 2 dari 2")).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
    await captureNextForm(page);
    const requestPromise = page.waitForRequest(isSave);
    const responsePromise = page.waitForResponse((response) => isSave(response.request()));
    await confirmSave(page);
    const request = await requestPromise; const response = await responsePromise;
    await expect(page.getByRole("status").filter({ hasText: "4 soal berhasil ditambahkan" })).toBeVisible();
    const rows = await client.query("SELECT prompt_text,prompt_rich,prompt_image IS NOT NULL AS image,correct_option FROM question_bank WHERE topic_id=$1 ORDER BY id", [topics[0]]);
    expect(rows.rowCount).toBe(4);
    expect(rows.rows[0].prompt_text).toBe("السُّؤَالُ: مَا لَوْنُ السَّمَاءِ؟");
    expect(JSON.stringify(rows.rows[1].prompt_rich)).toContain('"table"');
    expect(JSON.stringify(rows.rows[2].prompt_rich)).toContain('"mathFormula"');
    expect(rows.rows[3].image).toBe(true);
    expect(rows.rows.every((row) => row.correct_option === "A")).toBe(true);
    const headers = request.headers();
    const replay = await page.request.post(destination, { headers: { "next-action": headers["next-action"], origin: "http://127.0.0.1:3100" }, multipart: await replayForm(page), failOnStatusCode: false });
    expect(replay.ok()).toBe(true);
    const replayText = await replay.text();
    expect(replayText).toContain('"alreadySaved":true');
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(4);
    expect((await client.query("SELECT operation_id FROM question_import_batches WHERE topic_id=$1", [topics[0]])).rowCount).toBe(1);
    expect(response.ok()).toBe(true);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("mengganti kategori atau file menghapus pratinjau; dokumen rusak tidak disimpan", async ({ page }) => {
  const tag = suffix(); const name = `Kategori Impor A ${tag}`; const second = `Kategori Impor B ${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name), await createTopic(client, second));
    await loginAsAdmin(page); await previewFile(page, name);
    await selectComboboxOption(page, "Topik / mata pelajaran", second);
    await expect(page.getByRole("heading", { name: "Pratinjau soal" })).toHaveCount(0);
    await page.getByRole("button", { name: "Periksa pratinjau" }).click();
    await expect(page.getByRole("heading", { name: "Pratinjau soal" })).toBeVisible();
    await page.getByLabel("File Word").setInputFiles({ name: "rusak.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("bukan dokumen Word") });
    await expect(page.getByRole("heading", { name: "Pratinjau soal" })).toHaveCount(0);
    await page.getByRole("button", { name: "Periksa pratinjau" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "File bukan .docx" })).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=ANY($1::bigint[])", [topics])).rowCount).toBe(0);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("kegagalan insert tengah transaksi rollback semua, lalu pratinjau yang sama dapat dicoba ulang", async ({ page }) => {
  test.setTimeout(60_000);
  const tag = suffix(); const name = `Rollback Impor ${tag}`; const constraint = `test_import_${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  let constraintAdded = false;
  try {
    topics.push(await createTopic(client, name));
    await loginAsAdmin(page); await previewFile(page, name);
    await client.query(`ALTER TABLE question_bank ADD CONSTRAINT ${constraint} CHECK (prompt_text NOT LIKE 'Perhatikan tabel kegiatan fiktif%') NOT VALID`);
    constraintAdded = true;
    await confirmSave(page);
    await expect(page.getByRole("alert").filter({ hasText: "Hasil penyimpanan belum dapat dipastikan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pratinjau soal" })).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
    expect((await client.query("SELECT operation_id FROM question_import_batches WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
    await client.query(`ALTER TABLE question_bank DROP CONSTRAINT ${constraint}`); constraintAdded = false;
    await confirmSave(page);
    await expect(page.getByRole("status").filter({ hasText: "4 soal berhasil ditambahkan" })).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(4);
  } finally {
    if (constraintAdded) await client.query(`ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS ${constraint}`);
    await cleanupTopics(client, topics); await client.end();
  }
});

test("respons gagal setelah commit tetap menyimpan ID operasi; ganti nama kategori tidak membuat duplikat", async ({ page }) => {
  test.setTimeout(60_000);
  const tag = suffix(); const name = `Respons Impor ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name));
    await loginAsAdmin(page); await previewFile(page, name);
    await page.evaluate(() => {
      const original = window.fetch.bind(window); let first = true;
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        if (!first || init?.method !== "POST" || !(init.body instanceof FormData)) return response;
        first = false;
        const text = await response.text();
        const changed = text.replace('{"ok":true,"count":4,"alreadySaved":false}', '{"ok":false,"error":"Hasil penyimpanan belum dapat dipastikan; coba lagi pratinjau yang sama."}');
        if (text === changed) throw new Error("Bentuk respons tindakan impor tidak dikenali.");
        const headers = new Headers(response.headers); headers.delete("content-length"); headers.delete("content-encoding");
        return new Response(changed, { status: response.status, statusText: response.statusText, headers });
      };
    });
    await confirmSave(page);
    await expect(page.getByRole("alert").filter({ hasText: "Hasil penyimpanan belum dapat dipastikan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pratinjau soal" })).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(4);
    await client.query("UPDATE question_topics SET name=$1 WHERE id=$2", [`Nama Baru ${tag}`, topics[0]]);
    await confirmSave(page);
    await expect(page.getByRole("status").filter({ hasText: "Pratinjau ini sebelumnya sudah tersimpan" })).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(4);
    expect((await client.query("SELECT operation_id FROM question_import_batches WHERE topic_id=$1", [topics[0]])).rowCount).toBe(1);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("dua permintaan bersamaan memakai operasi yang sama hanya menyimpan sekali", async ({ page }) => {
  test.setTimeout(60_000);
  const tag = suffix(); const name = `Serentak Impor ${tag}`; const second = `Kategori Lain ${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name), await createTopic(client, second));
    await loginAsAdmin(page); await previewFile(page, name);
    await page.evaluate(() => {
      const original = window.fetch.bind(window); let first = true;
      window.fetch = (input, init) => {
        if (first && init?.method === "POST" && init.body instanceof FormData) {
          first = false;
          const state = window as Window & { capturedQuestionImport?: CapturedField[]; capturedQuestionAction?: string | null };
          state.capturedQuestionImport = Array.from(init.body.entries(), ([key, value]) => typeof value === "string" ? { key, value } : { key, filename: value.name, mime: value.type });
          state.capturedQuestionAction = new Headers(init.headers).get("next-action");
          return Promise.reject(new TypeError("Koneksi fiktif terputus sebelum permintaan dikirim"));
        }
        return original(input, init);
      };
    });
    await confirmSave(page);
    await expect(page.getByRole("alert").filter({ hasText: "Hasil penyimpanan belum dapat dipastikan" })).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
    const action = await page.evaluate(() => (window as Window & { capturedQuestionAction?: string }).capturedQuestionAction);
    if (!action) throw new Error("ID server action tidak tersedia.");
    const headers = { "next-action": action, origin: "http://127.0.0.1:3100" };
    const [first, secondResponse] = await Promise.all([
      page.request.post(destination, { headers, multipart: await replayForm(page), failOnStatusCode: false }),
      page.request.post(destination, { headers, multipart: await replayForm(page), failOnStatusCode: false }),
    ]);
    expect(first.ok() && secondResponse.ok()).toBe(true);
    const responses = await Promise.all([first.text(), secondResponse.text()]);
    expect(responses.filter((body) => body.includes('"alreadySaved":false'))).toHaveLength(1);
    expect(responses.filter((body) => body.includes('"alreadySaved":true'))).toHaveLength(1);
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(4);
    const changed = await replayForm(page);
    const topicField = Array.from(changed.keys()).find((key) => key.endsWith("topicId"));
    if (!topicField) throw new Error("Kolom kategori impor tidak ditemukan.");
    changed.set(topicField, topics[1]);
    const changedResponse = await page.request.post(destination, { headers, multipart: changed, failOnStatusCode: false });
    expect(await changedResponse.text()).toContain("File atau kategori berbeda dari pratinjau");
    const foreign = await page.request.post(destination, { headers: { ...headers, origin: "https://attacker.invalid" }, multipart: await replayForm(page), failOnStatusCode: false });
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    await confirmSave(page);
    await expect(page.getByRole("status").filter({ hasText: "Pratinjau ini sebelumnya sudah tersimpan" })).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=ANY($1::bigint[])", [topics])).rowCount).toBe(4);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test.describe("impor pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("pratinjau tabel dan dialog konfirmasi tetap dapat digunakan", async ({ page }) => {
    const tag = suffix(); const name = `Impor Mobile ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
    try {
      topics.push(await createTopic(client, name));
      await loginAsAdmin(page); await previewFile(page, name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const list = page.getByRole("list", { name: "Pratinjau impor soal" });
      await expect(list.locator("table")).toHaveCount(1);
      await confirmSave(page);
      await expect(page.getByRole("status").filter({ hasText: "4 soal berhasil ditambahkan" })).toBeVisible();
      expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(4);
    } finally { await cleanupTopics(client, topics); await client.end(); }
  });
});

test("sesi yang dicabut setelah pratinjau tidak dapat menyimpan", async ({ page }) => {
  const tag = suffix(); const name = `Sesi Impor ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name));
    await loginAsAdmin(page); await previewFile(page, name);
    await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [await sessionDigest(page)]);
    await confirmSave(page);
    await expect.poll(async () => (await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
    expect((await client.query("SELECT operation_id FROM question_import_batches WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});
