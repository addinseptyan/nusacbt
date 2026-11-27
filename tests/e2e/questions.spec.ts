import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { loginAsAdmin } from "./helpers";
import { cleanupTopics, createQuestion, createTopic, deletion, editor, fillDraft, LETTERS, questionRow, selectComboboxOption, SLOTS, suffix, testDatabase } from "./question-helpers";

test("kategori kosong meminta admin menyiapkan topik sebelum menambah soal", async ({ page }) => {
  const client = testDatabase(); await client.connect();
  try {
    const count = Number((await client.query("SELECT count(*) FROM question_topics")).rows[0].count);
    test.skip(count > 0, "Tes keadaan kosong hanya berlaku pada database uji tanpa kategori lain.");
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    await expect(page.getByText("Siapkan kategori terlebih dahulu")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tambah soal" })).toBeDisabled();
    await page.getByRole("alert").filter({ hasText: "Siapkan kategori terlebih dahulu" }).getByRole("link", { name: "Mata Pelajaran" }).click();
    await expect(page).toHaveURL(/\/data-modul\/topik$/);
  } finally { await client.end(); }
});

test("admin membuat, mencari, melihat, mengubah, memfilter, dan menghapus soal manual", async ({ page }) => {
  test.setTimeout(90_000);
  const tag = suffix();
  const firstTopic = `Matematika Soal ${tag}`;
  const secondTopic = `Aljabar Soal ${tag}`;
  const prompt = `Berapa hasil 2 + 2? ${tag}`;
  const changed = `Pertanyaan diperbarui ${tag}`;
  const client = testDatabase(); await client.connect();
  const topics: string[] = [];
  try {
    topics.push(await createTopic(client, firstTopic));
    topics.push(await createTopic(client, secondTopic));
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Modul", exact: true }).click();
    await page.getByRole("link", { name: "Mata Pelajaran", exact: true }).click();
    await expect(page).toHaveURL(/\/data-modul\/topik$/);
    await page.getByRole("link", { name: "Semua Bank Soal", exact: true }).click();
    await expect(page).toHaveURL(/\/data-modul\/soal$/);
    await expect(page.getByRole("heading", { name: "Bank Soal", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kembali ke Mata Pelajaran" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Export Soal Word" })).toBeVisible();

    let form = await editor(page);
    await fillDraft(form, firstTopic, "", ["1", "2", "3", "4", "5"]);
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form.getByRole("alert")).toContainText("Isi soal harus berisi teks atau gambar");
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
    // Editor rich-text dipulihkan setelah transisi validasi; alert dapat muncul
    // sedikit lebih dahulu daripada contenteditable kembali aktif.
    await expect(form.getByRole("textbox", { name: "Isi soal", exact: true })).toBeEditable();
    await form.getByRole("textbox", { name: "Isi soal", exact: true }).fill(`  ${prompt}  `);
    await expect(form.getByLabel("Pilihan B", { exact: true })).toBeEditable();
    await form.getByLabel("Pilihan B", { exact: true }).fill("  ");
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form.getByRole("alert")).toContainText("Pilihan B harus berisi teks atau gambar");
    await expect(form.getByLabel("Pilihan B", { exact: true })).toBeEditable();
    await form.getByLabel("Pilihan B", { exact: true }).fill(`Jawaban khusus ${tag}`);
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText("Soal berhasil ditambahkan.")).toBeVisible();
    const inserted = await client.query<{ id: string; prompt_text: string; option_b_text: string; correct_option: string }>(
      "SELECT id::text AS id,prompt_text,option_b_text,correct_option FROM question_bank WHERE topic_id=$1", [topics[0]],
    );
    expect(inserted.rows).toHaveLength(1);
    expect(inserted.rows[0]).toMatchObject({ prompt_text: prompt, option_b_text: `Jawaban khusus ${tag}`, correct_option: "D" });
    const { id } = inserted.rows[0];
    await expect(questionRow(page, id)).toContainText("Kunci: D");

    await page.getByLabel("Cari soal").fill(`JAWABAN KHUSUS ${tag.toUpperCase()}`);
    await expect(questionRow(page, id)).toBeVisible();
    await expect(page.getByText("1 soal ditemukan")).toBeVisible();
    await selectComboboxOption(page, "Filter mata pelajaran", secondTopic);
    await expect(questionRow(page, id)).toHaveCount(0);
    await expect(page.getByText("Soal tidak ditemukan")).toBeVisible();
    await selectComboboxOption(page, "Filter mata pelajaran", firstTopic);
    await expect(questionRow(page, id)).toBeVisible();

    await questionRow(page, id).getByRole("button", { name: `Lihat soal ${id}` }).click();
    const detail = page.getByRole("dialog", { name: "Detail soal" });
    await expect(detail).toContainText(prompt);
    await expect(detail).toContainText(`Jawaban khusus ${tag}`);
    await expect(detail).toContainText("Jawaban benar");
    expect(await detail.getByText("Jawaban benar").count()).toBe(1);
    await detail.getByRole("button", { name: "Tutup" }).click();

    form = await editor(page, id);
    await selectComboboxOption(form, "Topik / mata pelajaran", secondTopic);
    await form.getByRole("textbox", { name: "Isi soal", exact: true }).fill(changed);
    await form.getByLabel("Jawaban B benar").check();
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form).toBeHidden();
    await expect(questionRow(page, id)).toHaveCount(0);
    await page.getByLabel("Cari soal").fill(tag);
    await selectComboboxOption(page, "Filter mata pelajaran", secondTopic);
    await expect(questionRow(page, id)).toContainText(changed);
    expect((await client.query("SELECT topic_id::text,prompt_text,correct_option FROM question_bank WHERE id=$1", [id])).rows).toEqual([
      { topic_id: topics[1], prompt_text: changed, correct_option: "B" },
    ]);

    let confirm = await deletion(page, id);
    await confirm.getByRole("button", { name: "Batal" }).click();
    await expect(questionRow(page, id)).toBeVisible();
    confirm = await deletion(page, id);
    let release = () => {};
    let started = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    await page.route("**/data-modul/soal", async (route) => {
      if (route.request().method() === "POST") { started(); await gate; }
      await route.continue();
    });
    const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-modul/soal", { timeout: 15_000 });
    try {
      await confirm.getByRole("button", { name: "Ya, hapus soal" }).click();
      await waiting;
      await expect(confirm.getByRole("button", { name: "Menghapus..." })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(confirm).toBeVisible();
      expect((await client.query("SELECT id FROM question_bank WHERE id=$1", [id])).rowCount).toBe(1);
    } finally { release(); await response.catch(() => {}); await page.unroute("**/data-modul/soal"); }
    await expect(confirm).toBeHidden();
    await expect(questionRow(page, id)).toHaveCount(0);
    expect((await client.query("SELECT id FROM question_bank WHERE id=$1", [id])).rowCount).toBe(0);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("enam gambar disimpan atomik, hanya admin dapat mengakses, dan perubahan tidak mencampur revisi", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const tag = suffix();
  const topic = `Gambar Soal ${tag}`;
  const client = testDatabase(); await client.connect();
  const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic));
    // Masing-masing mendekati 1 MiB; menguji enam unggahan sekaligus tanpa
    // mengandalkan file eksternal atau data asli.
    const pixels = randomBytes(580 * 580 * 3);
    const png = await sharp(pixels, { raw: { width: 580, height: 580, channels: 3 } }).png().withMetadata({ orientation: 6 }).toBuffer();
    expect(png.length).toBeGreaterThan(1_000_000);
    expect(png.length).toBeLessThan(1024 * 1024);
    const jpeg = await sharp({ create: { width: 48, height: 30, channels: 3, background: "blue" } }).jpeg().toBuffer();
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    const form = await editor(page);
    await selectComboboxOption(form, "Topik / mata pelajaran", topic);
    await form.getByLabel("Jawaban E benar").check();
    for (const slot of SLOTS) {
      const label = slot === "prompt" ? "Gambar soal" : `Gambar pilihan ${slot}`;
      await form.getByLabel(label, { exact: true }).setInputFiles({ name: `fiktif-${slot}.png`, mimeType: "image/png", buffer: png });
    }
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form).toBeHidden({ timeout: 90_000 });
    const query = `SELECT id::text AS id,xmin::text AS revision, correct_option,
      md5(prompt_image) AS prompt_hash,md5(option_a_image) AS a_hash,md5(option_b_image) AS b_hash,
      md5(option_c_image) AS c_hash,md5(option_d_image) AS d_hash,md5(option_e_image) AS e_hash,
      prompt_image,prompt_image_mime,option_a_image,option_a_image_mime,option_b_image,option_c_image,option_d_image,option_e_image
      FROM question_bank WHERE topic_id=$1`;
    let stored = (await client.query(query, [topics[0]])).rows[0];
    expect(stored).toBeDefined();
    expect(stored.correct_option).toBe("E");
    expect(stored.prompt_image_mime).toBe("image/png");
    for (const key of ["prompt_image", "option_a_image", "option_b_image", "option_c_image", "option_d_image", "option_e_image"]) {
      expect(stored[key]).toBeInstanceOf(Buffer);
      expect(stored[key].length).toBeLessThanOrEqual(1024 * 1024);
      const meta = await sharp(stored[key]).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.format).toBe("png");
    }
    const { id, revision } = stored;
    await expect(questionRow(page, id)).toContainText("Soal bergambar tanpa teks");
    await questionRow(page, id).getByRole("button", { name: `Lihat soal ${id}` }).click();
    const detail = page.getByRole("dialog", { name: "Detail soal" });
    await expect(detail.getByAltText("Gambar soal")).toBeVisible();
    for (const letter of LETTERS) {
      const image = detail.getByAltText(`Gambar pilihan ${letter}`);
      await expect.poll(async () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: 20_000 }).toBe(true);
    }
    const url = `/api/admin/soal/${id}/prompt?versi=${revision}`;
    const response = await page.request.get(url);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["cross-origin-resource-policy"]).toBe("same-origin");
    expect(await response.body()).toEqual(stored.prompt_image);
    const html = await page.request.get("/data-modul/soal");
    expect(html.headers()["cache-control"]).toContain("no-store");
    expect(html.headers()["referrer-policy"]).toBe("no-referrer");
    const anonymous = await browser.newContext();
    try {
      const denied = await anonymous.request.get(`http://127.0.0.1:3100${url}`);
      expect(denied.status()).toBe(401);
      expect(denied.headers()["cache-control"]).toContain("no-store");
      expect((await denied.body()).length).toBe(0);
    } finally { await anonymous.close(); }
    for (const badPath of [`/api/admin/soal/${id}/toString?versi=${revision}`, `/api/admin/soal/0/prompt?versi=${revision}`, `/api/admin/soal/${id}/prompt`, `/api/admin/soal/${id}/prompt?versi=${revision}&versi=${revision}`]) {
      expect((await page.request.get(badPath)).status()).toBe(404);
    }
    await detail.getByRole("button", { name: "Tutup" }).click();

    // Menghapus gambar pada soal kosong ditolak, sehingga keenam gambar utuh.
    let edit = await editor(page, id);
    await edit.locator('input[name="remove_prompt"]').check();
    await edit.getByRole("button", { name: "Simpan soal" }).click();
    await expect(edit.getByRole("alert")).toContainText("Isi soal harus berisi teks atau gambar");
    let again = (await client.query(query, [topics[0]])).rows[0];
    expect(again.revision).toBe(revision);
    for (const key of ["prompt_hash", "a_hash", "b_hash", "c_hash", "d_hash", "e_hash"]) expect(again[key]).toBe(stored[key]);
    // Tunggu editor kembali dapat diedit setelah transisi validasi selesai.
    // Penggantian sekaligus penghapusan pada slot sama ditolak tanpa perubahan.
    const promptEditor = edit.getByRole("textbox", { name: "Isi soal", exact: true });
    await expect(promptEditor).toHaveAttribute("contenteditable", "true");
    await promptEditor.fill(`Teks pengganti ${tag}`);
    await edit.locator('input[name="remove_A"]').check();
    await edit.getByLabel("Gambar pilihan A", { exact: true }).setInputFiles({ name: "baru.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await edit.getByRole("button", { name: "Simpan soal" }).click();
    await expect(edit.getByRole("alert")).toContainText("pilih mengganti atau menghapus gambar, bukan keduanya");
    again = (await client.query(query, [topics[0]])).rows[0];
    expect(again.revision).toBe(revision);
    await edit.locator('input[name="remove_A"]').uncheck();
    await edit.getByRole("button", { name: "Simpan soal" }).click();
    await expect(edit).toBeHidden({ timeout: 30_000 });
    stored = (await client.query(query, [topics[0]])).rows[0];
    expect(stored.revision).not.toBe(revision);
    expect(stored.prompt_image).toBeNull();
    expect(stored.option_a_image_mime).toBe("image/jpeg");
    for (const key of ["b_hash", "c_hash", "d_hash", "e_hash"]) expect(stored[key]).toBe(again[key]);
    expect((await page.request.get(url)).status()).toBe(404);
    expect((await page.request.get(`/api/admin/soal/${id}/prompt?versi=${stored.revision}`)).status()).toBe(404);
    const newImage = await page.request.get(`/api/admin/soal/${id}/A?versi=${stored.revision}`);
    expect(newImage.status()).toBe(200);
    expect(newImage.headers()["content-type"]).toBe("image/jpeg");
    expect(await newImage.body()).toEqual(stored.option_a_image);

    edit = await editor(page, id);
    await edit.locator('input[name="remove_A"]').check();
    await edit.getByRole("button", { name: "Simpan soal" }).click();
    await expect(edit.getByRole("alert")).toContainText("Pilihan A harus berisi teks atau gambar");
    const optionAEditor = edit.getByLabel("Pilihan A", { exact: true });
    await expect(optionAEditor).toHaveAttribute("contenteditable", "true");
    await optionAEditor.fill("Pengganti gambar A");
    await edit.getByRole("button", { name: "Simpan soal" }).click();
    await expect(edit).toBeHidden();
    const final = (await client.query(query, [topics[0]])).rows[0];
    expect(final.option_a_image).toBeNull();
    expect(final.option_a_image_mime).toBeNull();
    for (const key of ["b_hash", "c_hash", "d_hash", "e_hash"]) expect(final[key]).toBe(stored[key]);
    const confirm = await deletion(page, id);
    await confirm.getByRole("button", { name: "Ya, hapus soal" }).click();
    await expect(confirm).toBeHidden();
    expect((await client.query("SELECT id FROM question_bank WHERE id=$1", [id])).rowCount).toBe(0);
    expect((await page.request.get(`/api/admin/soal/${id}/B?versi=${final.revision}`)).status()).toBe(404);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("file yang menyamar, kosong, kebesaran, dan gambar tidak valid ditolak tanpa menyimpan sebagian", async ({ page }) => {
  test.setTimeout(90_000);
  const tag = suffix(); const topic = `Validasi Gambar ${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic));
    const valid = await sharp({ create: { width: 20, height: 20, channels: 3, background: "green" } }).png().toBuffer();
    const webp = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).webp().toBuffer();
    const tooWide = await sharp({ create: { width: 4001, height: 3, channels: 3, background: "white" } }).png().toBuffer();
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    const form = await editor(page);
    await fillDraft(form, topic, `Validasi gambar ${tag}`);
    await form.getByLabel("Gambar soal", { exact: true }).setInputFiles({ name: "asli.png", mimeType: "image/png", buffer: valid });
    const files = [
      { name: "bohong.png", mimeType: "image/png", buffer: Buffer.from('<svg onload="alert(1)"></svg>') },
      { name: "webp.png", mimeType: "image/png", buffer: webp },
      { name: "rusak.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
      { name: "kosong.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
      { name: "besar.png", mimeType: "image/png", buffer: Buffer.alloc(1024 * 1024 + 1) },
      { name: "lebar.png", mimeType: "image/png", buffer: tooWide },
    ];
    for (const file of files) {
      await form.getByLabel("Gambar pilihan B", { exact: true }).setInputFiles(file);
      await form.getByRole("button", { name: "Simpan soal" }).click();
      await expect(form.getByRole("alert")).toContainText("Gambar pilihan B:");
      expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
    }
    await form.getByLabel("Gambar pilihan B", { exact: true }).setInputFiles({ name: "sah.png", mimeType: "application/octet-stream", buffer: valid });
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form).toBeHidden();
    const result = (await client.query("SELECT prompt_image_mime,option_b_image_mime FROM question_bank WHERE topic_id=$1", [topics[0]])).rows;
    expect(result).toEqual([{ prompt_image_mime: "image/png", option_b_image_mime: "image/png" }]);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("kategori yang dipakai tidak dapat dihapus dan penggantian nama mempertahankan referensi", async ({ page }) => {
  const tag = suffix(); const topic = `Kategori Dipakai ${tag}`; const renamed = `Kategori Baru ${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic));
    const question = await createQuestion(client, topics[0], `Soal referensi ${tag}`);
    await expect(client.query("DELETE FROM question_topics WHERE id=$1", [topics[0]])).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23001)$/) });
    await loginAsAdmin(page); await page.goto("/data-modul/topik");
    await page.getByLabel("Cari mata pelajaran atau tag").fill(tag);
    const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: topic, exact: true }) });
    await row.getByRole("button", { name: `Hapus mata pelajaran ${topic}` }).click();
    const confirm = page.getByRole("dialog", { name: "Hapus mata pelajaran?" });
    await confirm.getByRole("button", { name: "Ya, hapus mata pelajaran" }).click();
    await expect(confirm.getByRole("alert")).toContainText("masih digunakan oleh data lain");
    await confirm.getByRole("button", { name: "Batal" }).click();
    await row.getByRole("button", { name: `Ubah mata pelajaran ${topic}` }).click();
    const form = page.getByRole("dialog", { name: "Ubah mata pelajaran" });
    await form.getByLabel("Nama mata pelajaran").fill(renamed);
    await form.getByRole("button", { name: "Simpan mata pelajaran" }).click();
    await expect(form).toBeHidden();
    const renamedRow = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: renamed, exact: true }) });
    await renamedRow.getByRole("link", { name: `Kelola soal ${renamed}` }).click();
    await expect(page).toHaveURL(new RegExp(`/data-modul/soal\\?topik=${topics[0]}$`));
    await expect(questionRow(page, question.id)).toContainText(renamed);
    await expect(questionRow(page, question.id).getByLabel("Nomor 1")).toBeVisible();
    expect((await client.query("SELECT topic_id::text AS topic FROM question_bank WHERE id=$1", [question.id])).rows).toEqual([{ topic: topics[0] }]);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("pencarian dan paginasi menangani lebih dari dua halaman serta filter kategori", async ({ page }) => {
  const tag = suffix(); const topic = `Paginasi Satu ${tag}`; const second = `Paginasi Dua ${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic));
    topics.push(await createTopic(client, second));
    await client.query(`INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option)
      SELECT CASE WHEN i <= 13 THEN $1::bigint ELSE $2::bigint END,
        'Pertanyaan ' || $3::text || ' ' || lpad(i::text,2,'0'), 'A','B','C','D','E','A' FROM generate_series(1,25) i`, [topics[0], topics[1], tag]);
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    await page.getByLabel("Cari soal").fill(tag.toUpperCase());
    await expect(page.getByText("25 soal ditemukan")).toBeVisible();
    await expect(page.getByText("Halaman 1 dari 3 · 25 soal")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: `Pertanyaan ${tag} 25` })).toBeVisible();
    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    await expect(page.getByText("Halaman 2 dari 3 · 25 soal")).toBeVisible();
    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    await expect(page.getByText("Halaman 3 dari 3 · 25 soal")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: `Pertanyaan ${tag} 01` })).toBeVisible();
    await selectComboboxOption(page, "Filter mata pelajaran", topic);
    await expect(page.getByText("13 soal ditemukan")).toBeVisible();
    await expect(page.getByText("Halaman 1 dari 2 · 13 soal")).toBeVisible();
    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    await expect(page.getByText("Halaman 2 dari 2 · 13 soal")).toBeVisible();
    await selectComboboxOption(page, "Filter mata pelajaran", second);
    await expect(page.getByText("12 soal ditemukan")).toBeVisible();
    await expect(page.getByText("Halaman 1 dari 2 · 12 soal")).toBeVisible();
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test.describe("soal pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 640 } });
  test("navigasi, mode gelap, teks panjang, dan dialog sangat pendek tanpa overflow", async ({ page }) => {
    const tag = suffix(); const topic = `Layar Kecil ${tag}`;
    const client = testDatabase(); await client.connect(); const topics: string[] = [];
    try {
      topics.push(await createTopic(client, topic));
      const question = await createQuestion(client, topics[0], `Panjang${tag}${"P".repeat(1500)}`);
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await page.getByRole("button", { name: "Buka atau tutup sidebar" }).click();
      const sidebar = page.getByRole("dialog");
      await sidebar.getByRole("button", { name: "Data Modul", exact: true }).click();
      await sidebar.getByRole("link", { name: "Mata Pelajaran", exact: true }).click();
      await expect(sidebar).toBeHidden();
      await page.getByLabel("Cari mata pelajaran atau tag").fill(tag);
      await page.getByRole("link", { name: `Kelola soal ${topic}` }).click();
      await page.getByLabel("Cari soal").fill(tag);
      await expect(questionRow(page, question.id)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 360, height: 320 });
      const form = await editor(page, question.id);
      await expect.poll(async () => { const box = await form.boundingBox(); return Boolean(box && box.y >= 0 && box.y + box.height <= 320); }).toBe(true);
      await form.getByRole("button", { name: "Batal" }).scrollIntoViewIfNeeded();
      await expect(form.getByRole("button", { name: "Batal" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await form.getByRole("button", { name: "Batal" }).click();
      await expect(form).toBeHidden();
    } finally { await cleanupTopics(client, topics); await client.end(); }
  });
});
