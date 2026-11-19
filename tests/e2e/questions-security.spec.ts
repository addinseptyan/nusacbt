import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { loginAsAdmin } from "./helpers";
import { cleanupTopics, createQuestion, createTopic, deletion, editor, fillDraft, questionRow, sessionDigest, suffix, testDatabase } from "./question-helpers";

test("batas dan hubungan soal ditegakkan oleh constraint database", async () => {
  const client = testDatabase(); await client.connect();
  try {
    await client.query("BEGIN");
    const topicId = await createTopic(client, `Constraint Soal ${suffix()}`);
    const base = { topic: topicId, prompt: "Isi", a: "A", b: "B", c: "C", d: "D", e: "E", correct: "A", image: null as Buffer | null, mime: null as string | null };
    async function insert(value: typeof base) {
      return client.query(`INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option,prompt_image,prompt_image_mime)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [value.topic, value.prompt, value.a, value.b, value.c, value.d, value.e, value.correct, value.image, value.mime]);
    }
    expect((await insert(base)).rowCount).toBe(1);
    const checks: Array<{ change: Partial<typeof base>; code: string; constraint?: string }> = [
      { change: { topic: "9223372036854775807" }, code: "23503" },
      { change: { correct: "F" }, code: "23514", constraint: "question_bank_correct_option_check" },
      { change: { prompt: "  \t\n" }, code: "23514", constraint: "question_bank_prompt_required_check" },
      { change: { prompt: "x".repeat(5001) }, code: "23514", constraint: "question_bank_prompt_text_check" },
      { change: { prompt: "a\u0001b" }, code: "23514", constraint: "question_bank_prompt_text_check" },
      { change: { c: "  " }, code: "23514", constraint: "question_bank_option_c_required_check" },
      { change: { e: "x".repeat(2001) }, code: "23514", constraint: "question_bank_option_e_text_check" },
      { change: { image: Buffer.alloc(0), mime: "image/png" }, code: "23514", constraint: "question_bank_prompt_image_check" },
      { change: { image: Buffer.alloc(1024 * 1024 + 1), mime: "image/png" }, code: "23514", constraint: "question_bank_prompt_image_check" },
      { change: { image: Buffer.from("x"), mime: null }, code: "23514", constraint: "question_bank_prompt_image_check" },
      { change: { image: null, mime: "image/png" }, code: "23514", constraint: "question_bank_prompt_image_check" },
      { change: { image: Buffer.from("x"), mime: "image/svg+xml" }, code: "23514", constraint: "question_bank_prompt_image_check" },
    ];
    for (const { change, code, constraint } of checks) {
      await client.query("SAVEPOINT periksa_soal");
      try { await expect(insert({ ...base, ...change })).rejects.toMatchObject({ code, ...(constraint ? { constraint } : {}) }); }
      finally { await client.query("ROLLBACK TO SAVEPOINT periksa_soal"); }
    }
    // Constraint database menjaga ukuran/keterkaitan; aplikasi memvalidasi isi
    // gambar dengan decoder sebelum menyimpannya.
    expect((await insert({ ...base, prompt: "", image: Buffer.from("x"), mime: "image/png" })).rowCount).toBe(1);
    await client.query("SAVEPOINT periksa_referensi");
    try { await expect(client.query("DELETE FROM question_topics WHERE id=$1", [topicId])).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23001)$/) }); }
    finally { await client.query("ROLLBACK TO SAVEPOINT periksa_referensi"); }
  } finally { await client.query("ROLLBACK").catch(() => {}); await client.end(); }
});

test("teks aman dari markup/SQL; action menolak asal asing, anonim, kunci ganda, dan kunci tidak valid", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const tag = suffix(); const topic = `Keamanan Soal ${tag}`;
  const prompt = `<img src=x onerror=alert(1)> ' OR 1=1 -- ${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  let dialogOpened = false;
  page.on("dialog", (dialog) => { dialogOpened = true; void dialog.dismiss(); });
  try {
    topics.push(await createTopic(client, topic));
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    const form = await editor(page);
    await fillDraft(form, topic, prompt, [`<script>alert(1)</script>`, "b", "c", "d", "e"], "A");
    const requestPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-modul/soal");
    await form.getByRole("button", { name: "Simpan soal" }).click();
    const captured = await requestPromise;
    await expect(form).toBeHidden();
    const headers = captured.headers(); const body = captured.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");
    const first = (await client.query<{ id: string }>("SELECT id::text AS id FROM question_bank WHERE topic_id=$1", [topics[0]])).rows[0].id;
    await page.getByLabel("Cari soal").fill(tag);
    await expect(questionRow(page, first)).toContainText(prompt);
    await expect(questionRow(page, first).locator("img")).toHaveCount(0);
    await questionRow(page, first).getByRole("button", { name: `Lihat soal ${first}` }).click();
    const detail = page.getByRole("dialog", { name: "Detail soal" });
    await expect(detail).toContainText("<script>alert(1)</script>");
    await expect(detail.locator("script, img")).toHaveCount(0);
    expect(dialogOpened).toBe(false);
    await detail.getByRole("button", { name: "Tutup" }).click();

    const requestHeaders = { "content-type": headers["content-type"], "next-action": headers["next-action"] };
    const valid = await page.request.post("/data-modul/soal", { headers: { ...requestHeaders, origin: "http://127.0.0.1:3100" }, data: body, failOnStatusCode: false });
    expect(valid.ok()).toBe(true);
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(2);
    await client.query("DELETE FROM question_bank WHERE topic_id=$1 AND id<>$2", [topics[0], first]);

    const foreign = await page.request.post("/data-modul/soal", { headers: { ...requestHeaders, origin: "https://attacker.invalid" }, data: body, failOnStatusCode: false });
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    const raw = body.toString("utf8");
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(headers["content-type"]);
    const field = /name="([^"]*correctOption)"\r\n\r\nA\r\n/.exec(raw);
    if (!boundary || !field) throw new Error("Body multipart soal tidak sesuai format tes.");
    const delimiter = boundary[1] ?? boundary[2];
    const duplicate = `--${delimiter}\r\nContent-Disposition: form-data; name="${field[1]}"\r\n\r\nB\r\n`;
    // React merekonstruksi FormData dari field berurutan sebelum field model "0".
    const duplicateBody = raw.replace(field[0], `${field[0]}${duplicate}`);
    expect(duplicateBody).not.toBe(raw);
    const duplicateResponse = await page.request.post("/data-modul/soal", { headers: { ...requestHeaders, origin: "http://127.0.0.1:3100" }, data: duplicateBody, failOnStatusCode: false });
    expect(await duplicateResponse.text()).toContain("nilai ganda");
    const invalidBody = raw.replace(field[0], `name="${field[1]}"\r\n\r\nF\r\n`);
    const invalidResponse = await page.request.post("/data-modul/soal", { headers: { ...requestHeaders, origin: "http://127.0.0.1:3100" }, data: invalidBody, failOnStatusCode: false });
    expect(await invalidResponse.text()).toContain("Pilih tepat satu jawaban benar");
    // Lewati validasi browser: kirim langsung file >1 MiB tetapi <8 MB.
    const prefix = field[1].slice(0, -"correctOption".length);
    const modelField = `--${delimiter}\r\nContent-Disposition: form-data; name="0"`;
    expect(raw).toContain(modelField);
    const oversizedFile = `--${delimiter}\r\nContent-Disposition: form-data; name="${prefix}image_A"; filename="besar.png"\r\nContent-Type: image/png\r\n\r\n${"x".repeat(1024 * 1024 + 1)}\r\n`;
    const oversizedBody = raw.replace(modelField, `${oversizedFile}${modelField}`);
    const oversized = await page.request.post("/data-modul/soal", { headers: { ...requestHeaders, origin: "http://127.0.0.1:3100" }, data: oversizedBody, failOnStatusCode: false });
    expect(await oversized.text()).toContain("Gambar pilihan A: ukuran maksimal 1 MiB");
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(1);
    const anonymous = await browser.newContext();
    try {
      const anonymousPage = await anonymous.newPage();
      await anonymousPage.goto("http://127.0.0.1:3100/data-modul/soal");
      await expect(anonymousPage).toHaveURL(/\/login$/);
      await anonymous.request.post("http://127.0.0.1:3100/data-modul/soal", { headers: { ...requestHeaders, origin: "http://127.0.0.1:3100" }, data: body, failOnStatusCode: false });
    } finally { await anonymous.close(); }
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(1);
    expect(dialogOpened).toBe(false);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("formulir usang tidak menimpa, menghapus, atau membuat kembali soal yang berubah", async ({ page }) => {
  const tag = suffix(); const topic = `Revisi Soal ${tag}`; const original = `Awal ${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  let second: Page | undefined;
  try {
    topics.push(await createTopic(client, topic));
    const row = await createQuestion(client, topics[0], original);
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    await page.getByLabel("Cari soal").fill(tag);
    second = await page.context().newPage(); await second.goto("/data-modul/soal"); await second.getByLabel("Cari soal").fill(tag);
    const firstForm = await editor(page, row.id); const staleForm = await editor(second, row.id);
    await firstForm.getByRole("textbox", { name: "Isi soal", exact: true }).fill(`Pemenang ${tag}`);
    await firstForm.getByRole("button", { name: "Simpan soal" }).click();
    await expect(firstForm).toBeHidden();
    await staleForm.getByRole("textbox", { name: "Isi soal", exact: true }).fill(`Jangan menimpa ${tag}`);
    await staleForm.getByRole("button", { name: "Simpan soal" }).click();
    await expect(staleForm.getByRole("alert")).toContainText("Soal sudah berubah atau dihapus");
    expect((await client.query("SELECT prompt_text FROM question_bank WHERE id=$1", [row.id])).rows).toEqual([{ prompt_text: `Pemenang ${tag}` }]);
    await staleForm.getByRole("button", { name: "Muat ulang daftar" }).click();
    await expect(staleForm).toBeHidden();
    await expect(questionRow(second, row.id)).toContainText(`Pemenang ${tag}`);

    const staleDelete = await deletion(second, row.id);
    await client.query("UPDATE question_bank SET prompt_text=$1 WHERE id=$2", [`Perubahan kedua ${tag}`, row.id]);
    await staleDelete.getByRole("button", { name: "Ya, hapus soal" }).click();
    await expect(staleDelete.getByRole("alert")).toContainText("Soal sudah berubah atau dihapus");
    await staleDelete.getByRole("button", { name: "Muat ulang daftar" }).click();
    await expect(questionRow(second, row.id)).toContainText(`Perubahan kedua ${tag}`);
    const deletedForm = await editor(second, row.id);
    await client.query("DELETE FROM question_bank WHERE id=$1", [row.id]);
    await deletedForm.getByRole("button", { name: "Simpan soal" }).click();
    await expect(deletedForm.getByRole("alert")).toContainText("Soal sudah berubah atau dihapus");
    expect((await client.query("SELECT id FROM question_bank WHERE id=$1", [row.id])).rowCount).toBe(0);
  } finally { await second?.close(); await cleanupTopics(client, topics); await client.end(); }
});

test("pengubahan usang yang menunggu row lock tidak menimpa transaksi pemenang", async ({ page }) => {
  test.setTimeout(50_000);
  const tag = suffix(); const topic = `Kunci Baris Soal ${tag}`;
  const client = testDatabase(); await client.connect(); const blocker = testDatabase(); await blocker.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic)); const question = await createQuestion(client, topics[0], `Awal ${tag}`);
    await loginAsAdmin(page); await page.goto("/data-modul/soal"); await page.getByLabel("Cari soal").fill(tag);
    const form = await editor(page, question.id); await form.getByRole("textbox", { name: "Isi soal", exact: true }).fill(`Usang ${tag}`);
    await blocker.query("BEGIN"); await blocker.query("UPDATE question_bank SET prompt_text=$1 WHERE id=$2", [`Pemenang ${tag}`, question.id]);
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
       AND wait_event_type='Lock' AND query LIKE '%FROM question_bank WHERE id=%FOR UPDATE%') AS waiting`,
    )).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await blocker.query("COMMIT");
    await expect(form.getByRole("alert")).toContainText("Soal sudah berubah atau dihapus");
    expect((await client.query("SELECT prompt_text FROM question_bank WHERE id=$1", [question.id])).rows).toEqual([{ prompt_text: `Pemenang ${tag}` }]);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); await cleanupTopics(client, topics); await client.end(); }
});

test("penambahan soal yang menunggu kategori terhapus dibatalkan seluruhnya", async ({ page }) => {
  test.setTimeout(50_000);
  const tag = suffix(); const topic = `Kategori Dihapus ${tag}`;
  const client = testDatabase(); await client.connect(); const blocker = testDatabase(); await blocker.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic)); await loginAsAdmin(page); await page.goto("/data-modul/soal");
    const form = await editor(page); await fillDraft(form, topic, `Tidak boleh tersimpan ${tag}`);
    await blocker.query("BEGIN"); await blocker.query("DELETE FROM question_topics WHERE id=$1", [topics[0]]);
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
       AND wait_event_type='Lock' AND (query LIKE '%INSERT INTO question_bank%' OR query LIKE '%FROM ONLY%question_topics%')) AS waiting`,
    )).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await blocker.query("COMMIT");
    await expect(form.getByRole("alert")).toContainText("Topik atau mata pelajaran tidak ditemukan atau sudah dihapus");
    expect((await client.query("SELECT id FROM question_bank WHERE prompt_text=$1", [`Tidak boleh tersimpan ${tag}`])).rowCount).toBe(0);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); await cleanupTopics(client, topics); await client.end(); }
});

test("soal dengan referensi pembatas tidak dapat dihapus", async ({ page }) => {
  const tag = suffix(); const topic = `Referensi Soal ${tag}`; const table = `e2e_question_ref_${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = []; let tableCreated = false;
  try {
    topics.push(await createTopic(client, topic)); const question = await createQuestion(client, topics[0], `Soal dengan referensi ${tag}`);
    await client.query(`CREATE TABLE "${table}" (question_id bigint NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT)`); tableCreated = true;
    await client.query(`INSERT INTO "${table}" (question_id) VALUES($1)`, [question.id]);
    await expect(client.query("DELETE FROM question_bank WHERE id=$1", [question.id])).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|23001)$/) });
    await loginAsAdmin(page); await page.goto("/data-modul/soal"); await page.getByLabel("Cari soal").fill(tag);
    const confirm = await deletion(page, question.id);
    await confirm.getByRole("button", { name: "Ya, hapus soal" }).click();
    await expect(confirm.getByRole("alert")).toContainText("masih digunakan oleh data lain");
    expect((await client.query("SELECT id FROM question_bank WHERE id=$1", [question.id])).rowCount).toBe(1);
    await client.query(`DELETE FROM "${table}" WHERE question_id=$1`, [question.id]);
    await confirm.getByRole("button", { name: "Ya, hapus soal" }).click();
    await expect(confirm).toBeHidden();
    expect((await client.query("SELECT id FROM question_bank WHERE id=$1", [question.id])).rowCount).toBe(0);
  } finally { if (tableCreated) await client.query(`DROP TABLE "${table}"`); await cleanupTopics(client, topics); await client.end(); }
});

test("tambah, ubah, hapus, dan gambar menolak sesi yang dicabut", async ({ page }) => {
  test.setTimeout(80_000);
  const tag = suffix(); const topic = `Sesi Soal ${tag}`;
  const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic));
    const image = await sharp({ create: { width: 5, height: 5, channels: 3, background: "green" } }).png().toBuffer();
    const question = await createQuestion(client, topics[0], `Asli ${tag}`, image);
    for (const operation of ["create", "update", "delete"] as const) {
      await loginAsAdmin(page); await page.goto("/data-modul/soal"); await page.getByLabel("Cari soal").fill(tag);
      const form = operation === "delete" ? await deletion(page, question.id) : await editor(page, operation === "update" ? question.id : undefined);
      if (operation !== "delete") await fillDraft(form, topic, `Tidak tersimpan ${tag}`);
      const digest = await sessionDigest(page);
      const imageUrl = `/api/admin/soal/${question.id}/prompt?versi=${question.revision}`;
      expect((await page.request.get(imageUrl)).status()).toBe(200);
      await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [digest]);
      const denied = await page.request.get(imageUrl);
      expect(denied.status()).toBe(401); expect((await denied.body()).length).toBe(0);
      const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-modul/soal");
      await form.getByRole("button", { name: operation === "delete" ? "Ya, hapus soal" : "Simpan soal" }).click();
      await response; await expect(page).toHaveURL(/\/login$/);
      expect((await client.query("SELECT prompt_text FROM question_bank WHERE id=$1", [question.id])).rows).toEqual([{ prompt_text: `Asli ${tag}` }]);
      expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(1);
    }
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("sesi yang kedaluwarsa saat mutasi menunggu kunci menyebabkan rollback", async ({ page }) => {
  test.setTimeout(70_000);
  const tag = suffix(); const topic = `Kedaluwarsa Mutasi ${tag}`;
  const client = testDatabase(); await client.connect(); const blocker = testDatabase(); await blocker.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic)); const question = await createQuestion(client, topics[0], `Asli ${tag}`);
    await loginAsAdmin(page); await page.goto("/data-modul/soal"); await page.getByLabel("Cari soal").fill(tag);
    const form = await editor(page, question.id); await form.getByRole("textbox", { name: "Isi soal", exact: true }).fill(`Tidak tersimpan ${tag}`);
    const digest = await sessionDigest(page);
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp() + interval '8 seconds' WHERE token_hash=$1", [digest]);
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM question_bank WHERE id=$1 FOR UPDATE", [question.id]);
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
       AND wait_event_type='Lock' AND query LIKE '%FROM question_bank WHERE id=%FOR UPDATE%') AS waiting`,
    )).rows[0].waiting, { timeout: 6_000 }).toBe(true);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0]?.expired, { timeout: 12_000 }).toBe(true);
    await blocker.query("COMMIT");
    await expect(form.getByRole("alert")).toContainText("Sesi admin sudah berakhir");
    expect((await client.query("SELECT prompt_text FROM question_bank WHERE id=$1", [question.id])).rows).toEqual([{ prompt_text: `Asli ${tag}` }]);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); await cleanupTopics(client, topics); await client.end(); }
});

test("gambar tidak dikirim jika sesi kedaluwarsa saat pembacaan menunggu kunci", async ({ page }) => {
  test.setTimeout(70_000);
  const tag = suffix(); const topic = `Kedaluwarsa Gambar ${tag}`;
  const client = testDatabase(); await client.connect(); const blocker = testDatabase(); await blocker.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, topic));
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "green" } }).png().toBuffer();
    const question = await createQuestion(client, topics[0], `Gambar ${tag}`, image);
    await loginAsAdmin(page); const digest = await sessionDigest(page);
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp() + interval '8 seconds' WHERE token_hash=$1", [digest]);
    await blocker.query("BEGIN"); await blocker.query("LOCK TABLE question_bank IN ACCESS EXCLUSIVE MODE");
    const responsePromise = page.request.get(`/api/admin/soal/${question.id}/prompt?versi=${question.revision}`, { timeout: 30_000 });
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
       AND wait_event_type='Lock' AND query LIKE '%FROM question_bank WHERE id=%xmin::text%') AS waiting`,
    )).rows[0].waiting, { timeout: 6_000 }).toBe(true);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0]?.expired, { timeout: 12_000 }).toBe(true);
    await blocker.query("COMMIT");
    const response = await responsePromise;
    expect(response.status()).toBe(401); expect((await response.body()).length).toBe(0); expect(response.headers()["cache-control"]).toContain("no-store");
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); await cleanupTopics(client, topics); await client.end(); }
});
