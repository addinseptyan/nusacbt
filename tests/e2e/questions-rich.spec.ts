import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers";
import { cleanupTopics, createQuestion, createTopic, editor, fillDraft, LETTERS, questionRow, suffix, testDatabase } from "./question-helpers";

const mathml = '<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><mml:mfrac><mml:mrow><mml:msqrt><mml:mn>48</mml:mn></mml:msqrt><mml:mo>+</mml:mo><mml:mn>2</mml:mn><mml:msqrt><mml:mn>27</mml:mn></mml:msqrt></mml:mrow><mml:msqrt><mml:mn>12</mml:mn></mml:msqrt></mml:mfrac></mml:math>';

async function paste(element: Locator, plain: string, html = "") {
  await element.evaluate((node, data) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", data.plain);
    if (data.html) clipboard.setData("text/html", data.html);
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, { plain, html });
}

async function addTable(page: Page, dialog: Locator, label: string, marker: string) {
  const textbox = dialog.getByRole("textbox", { name: label, exact: true });
  await textbox.click();
  await textbox.press("End");
  await dialog.getByRole("button", { name: `Tambah tabel — ${label}`, exact: true }).click();
  const table = textbox.locator("table");
  await expect(table).toHaveCount(1);
  await table.locator("th").first().click();
  await page.keyboard.insertText(`Judul ${marker}`);
  await table.locator("td").first().click();
  await page.keyboard.insertText(`Isi ${marker}`);
  return textbox;
}

test("editor mendukung tabel pada soal dan semua pilihan, RTL, MathML, simpan dan ubah lagi", async ({ page }) => {
  test.setTimeout(120_000);
  const tag = suffix(); const name = `Rich Soal ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name));
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    let form = await editor(page);
    await fillDraft(form, name, `السُّؤَالُ 12 + 3؟ ${tag}`, ["Satu", "Dua", "Tiga", "Empat", "Lima"], "C");
    const prompt = form.getByRole("textbox", { name: "Isi soal", exact: true });
    await prompt.click();
    await form.getByRole("button", { name: "Arah kanan ke kiri — Isi soal", exact: true }).click();
    await expect(prompt.locator('p[dir="rtl"]').first()).toContainText("السُّؤَالُ");
    await addTable(page, form, "Isi soal", "soal");
    for (const letter of LETTERS) await addTable(page, form, `Pilihan ${letter}`, letter);
    const optionB = form.getByRole("textbox", { name: "Pilihan B", exact: true });
    await optionB.locator("td").first().click();
    await paste(optionB, mathml);
    await expect(optionB.locator("math mfrac")).toHaveCount(1);
    await expect(optionB.locator("math")).toHaveCSS("math-style", "normal");
    const before = await optionB.innerText();
    await paste(optionB, "TEKS TIDAK BOLEH HILANG", '<p>TEKS TIDAK BOLEH HILANG <m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></p>');
    await expect(form.getByRole("alert").filter({ hasText: "Tempelan berisi rumus" })).toBeVisible();
    expect(await optionB.innerText()).toBe(before);
    const optionE = form.getByRole("textbox", { name: "Pilihan E", exact: true });
    await optionE.locator("td").first().click();
    await form.getByRole("button", { name: "Tebal — Pilihan E", exact: true }).click();
    await page.keyboard.insertText(" tebal");
    await expect(optionE.locator("strong")).toContainText("tebal");
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    const result = await client.query(`SELECT id::text AS id,prompt_text,prompt_rich,option_a_rich,option_b_rich,option_c_rich,option_d_rich,option_e_rich,correct_option FROM question_bank WHERE topic_id=$1`, [topics[0]]);
    expect(result.rowCount).toBe(1);
    const row = result.rows[0];
    expect(row.correct_option).toBe("C");
    expect(row.prompt_text).toContain("السُّؤَالُ 12 + 3؟");
    for (const col of ["prompt_rich", "option_a_rich", "option_b_rich", "option_c_rich", "option_d_rich", "option_e_rich"]) {
      expect(row[col].content.some((part: { type: string }) => part.type === "table")).toBe(true);
    }
    expect(JSON.stringify(row.option_b_rich)).toContain('"mathFormula"');
    await page.getByLabel("Cari soal").fill(tag);
    await questionRow(page, row.id).getByRole("button", { name: `Lihat soal ${row.id}` }).click();
    const detail = page.getByRole("dialog", { name: "Detail soal" });
    await expect(detail.locator("table")).toHaveCount(6);
    await expect(detail.locator("math mfrac")).toHaveCount(1);
    await expect(detail.locator("math")).toHaveCSS("math-style", "normal");
    await expect(detail.locator('p[dir="rtl"]').first()).toContainText("السُّؤَالُ");
    await detail.getByRole("button", { name: "Tutup" }).click();
    form = await editor(page, row.id);
    const again = form.getByRole("textbox", { name: "Pilihan B", exact: true });
    await expect(again.locator("math mfrac")).toHaveCount(1);
    await again.locator("td").first().click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(" diperbarui");
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    const updated = (await client.query("SELECT option_b_text,option_b_rich FROM question_bank WHERE id=$1", [row.id])).rows[0];
    expect(updated.option_b_text).toContain("diperbarui");
    expect(JSON.stringify(updated.option_b_rich)).toContain('"mathFormula"');
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("tempel teks berformat dan tabel HTML dapat diedit kembali", async ({ page }) => {
  const tag = suffix(); const name = `Tempel Rich ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name));
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    const form = await editor(page); await fillDraft(form, name, "", ["A", "B", "C", "D", "E"], "A");
    const textbox = form.getByRole("textbox", { name: "Isi soal", exact: true });
    await textbox.click();
    await paste(textbox, `سُؤَالٌ ${tag}\nKiri\tKanan`, `<p dir="rtl"><strong>سُؤَالٌ ${tag}</strong></p><table><tbody><tr><td><p>Kiri</p></td><td><p>Kanan</p></td></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>`);
    await expect(textbox.locator('p[dir="rtl"] strong')).toContainText("سُؤَالٌ");
    await expect(textbox.locator("table")).toHaveCount(1);
    await textbox.locator("td").first().click(); await page.keyboard.press("End"); await page.keyboard.insertText(" diperbaiki");
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form).toBeHidden();
    const row = (await client.query("SELECT prompt_text,prompt_rich FROM question_bank WHERE topic_id=$1", [topics[0]])).rows[0];
    expect(row.prompt_text).toContain("Kiri diperbaiki");
    expect(JSON.stringify(row.prompt_rich)).toContain('"table"');
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("data rich rusak tidak ditimpa diam-diam oleh editor", async ({ page }) => {
  const tag = suffix(); const name = `Rich Rusak ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name));
    const row = await createQuestion(client, topics[0], `Teks lama ${tag}`);
    await client.query("UPDATE question_bank SET prompt_rich='{}'::jsonb WHERE id=$1", [row.id]);
    await loginAsAdmin(page); await page.goto("/data-modul/soal"); await page.getByLabel("Cari soal").fill(tag);
    await questionRow(page, row.id).getByRole("button", { name: `Lihat soal ${row.id}` }).click();
    const detail = page.getByRole("dialog", { name: "Detail soal" });
    await expect(detail.getByRole("alert")).toContainText("tidak dapat ditampilkan dengan aman");
    await detail.getByRole("button", { name: "Tutup" }).click();
    const form = await editor(page, row.id);
    await expect(form.getByRole("alert").filter({ hasText: "Penyuntingan dan penyimpanan soal ini diblokir" })).toBeVisible();
    await expect(form.getByRole("textbox", { name: "Isi soal", exact: true })).toHaveAttribute("contenteditable", "false");
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form.getByRole("alert").filter({ hasText: "Isi soal:" })).toBeVisible();
    const after = (await client.query("SELECT prompt_text,prompt_rich FROM question_bank WHERE id=$1", [row.id])).rows[0];
    expect(after).toEqual({ prompt_text: `Teks lama ${tag}`, prompt_rich: {} });
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("klien lama tanpa field rich tidak boleh menghapus format tersimpan", async ({ page }) => {
  const tag = suffix(); const name = `Klien Lama ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name));
    const row = await createQuestion(client, topics[0], `Asli ${tag}`);
    const document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Asli ${tag}`, marks: [{ type: "bold" }] }] }] };
    await client.query("UPDATE question_bank SET prompt_rich=$1::jsonb WHERE id=$2", [JSON.stringify(document), row.id]);
    await loginAsAdmin(page); await page.goto("/data-modul/soal"); await page.getByLabel("Cari soal").fill(tag);
    const form = await editor(page, row.id);
    await form.getByRole("textbox", { name: "Isi soal", exact: true }).fill(`Tidak boleh ${tag}`);
    await form.locator('input[name="prompt_rich"]').evaluate((element) => element.remove());
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form.getByRole("alert").filter({ hasText: "Format soal belum terbaca lengkap" })).toBeVisible();
    const after = (await client.query("SELECT prompt_text,prompt_rich FROM question_bank WHERE id=$1", [row.id])).rows[0];
    expect(after).toEqual({ prompt_text: `Asli ${tag}`, prompt_rich: document });
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test("JSON berbahaya pada field rich ditolak di server", async ({ page }) => {
  const tag = suffix(); const name = `Serangan Rich ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
  try {
    topics.push(await createTopic(client, name));
    await loginAsAdmin(page); await page.goto("/data-modul/soal");
    const form = await editor(page); await fillDraft(form, name, `Aman ${tag}`);
    await form.locator('input[name="prompt_rich"]').evaluate((element: HTMLInputElement) => {
      element.value = JSON.stringify({ type: "doc", content: [{ type: "script", attrs: { onload: "alert(1)" } }] });
    });
    await form.getByRole("button", { name: "Simpan soal" }).click();
    await expect(form.getByRole("alert").filter({ hasText: "Isi soal:" })).toBeVisible();
    expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(0);
  } finally { await cleanupTopics(client, topics); await client.end(); }
});

test.describe("rich editor pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("toolbar dan tabel tidak menyebabkan halaman melebar", async ({ page }) => {
    const tag = suffix(); const name = `Rich Mobile ${tag}`; const client = testDatabase(); await client.connect(); const topics: string[] = [];
    try {
      topics.push(await createTopic(client, name));
      await loginAsAdmin(page); await page.goto("/data-modul/soal");
      const form = await editor(page); await fillDraft(form, name, `Soal mobile ${tag}`);
      await addTable(page, form, "Isi soal", "mobile");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const rect = await form.boundingBox();
      expect(rect).not.toBeNull(); expect(rect!.width).toBeLessThanOrEqual(390);
      await form.getByRole("button", { name: "Simpan soal" }).click();
      await expect(form).toBeHidden();
      expect((await client.query("SELECT id FROM question_bank WHERE topic_id=$1", [topics[0]])).rowCount).toBe(1);
    } finally { await cleanupTopics(client, topics); await client.end(); }
  });
});
