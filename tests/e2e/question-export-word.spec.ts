import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { readQuestionDocx } from "../../src/lib/question-docx.mjs";
import { loginAsAdmin } from "./helpers";
import { cleanupTopics, createTopic, suffix, testDatabase } from "./question-helpers";

const templateDocx = path.join(process.cwd(), "public/templates/template-soal-nusacbt.docx");

test("ekspor soal Word menyertakan rumus, tabel, Arab, gambar, dan dapat diimpor ulang", async ({ page }) => {
  test.setTimeout(60_000);
  const tag = suffix();
  const topicA = `Ekspor Sumber ${tag}`;
  const topicB = `Ekspor Impor Ulang ${tag}`;
  const client = testDatabase();
  await client.connect();
  const topics: string[] = [];

  try {
    topics.push(await createTopic(client, topicA), await createTopic(client, topicB));
    await loginAsAdmin(page);

    // 1. Impor 4 soal kaya dari template ke topicA
    await page.goto("/data-modul/import-soal");
    await page.getByLabel("Topik / mata pelajaran").selectOption({ label: topicA });
    await page.getByLabel("File Word").setInputFiles(templateDocx);
    await page.getByRole("button", { name: "Periksa pratinjau" }).click();
    await expect(page.getByRole("heading", { name: "Pratinjau soal" })).toBeVisible();
    await page.getByRole("button", { name: "Simpan hasil impor" }).click();
    const confirm = page.getByRole("dialog", { name: "Simpan hasil impor?" });
    await confirm.getByRole("button", { name: "Ya, simpan impor" }).click();
    await expect(page.getByRole("status").filter({ hasText: "4 soal berhasil ditambahkan" })).toBeVisible();

    // 2. Buka halaman Export Soal Word terfilter pada topicA dan unduh .docx
    await page.goto(`/data-modul/export-soal?topik=${topics[0]}`);
    await expect(page.getByRole("heading", { name: "Export Soal Word" })).toBeVisible();
    await expect(page.getByText("Terpilih 4 dari maksimal 100 soal per file.")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Ekspor 4 soal ke Word/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.docx$/);
    const savedPath = await download.path();
    if (!savedPath) throw new Error("Berkas ekspor Word tidak tersimpan oleh Playwright.");
    const exportedBuffer = readFileSync(savedPath);

    // 3. Verifikasi file .docx hasil ekspor terbaca utuh oleh readQuestionDocx
    const parsed = await readQuestionDocx(exportedBuffer);
    expect(parsed).toHaveLength(4);
    expect(parsed.map((q) => q.prompt.text).join("\n")).toContain("السُّؤَالُ");
    expect(parsed.some((q) => JSON.stringify(q.prompt.rich).includes('"table"'))).toBe(true);
    expect(parsed.some((q) => JSON.stringify(q.prompt.rich).includes('"mathFormula"'))).toBe(true);
    expect(parsed.some((q) => q.prompt.image !== null)).toBe(true);

    // 4. Impor ulang file hasil ekspor tersebut ke topicB lewat UI Import Soal Word
    await page.goto("/data-modul/import-soal");
    await page.getByLabel("Topik / mata pelajaran").selectOption({ label: topicB });
    await page.getByLabel("File Word").setInputFiles({
      name: "roundtrip.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: exportedBuffer,
    });
    await page.getByRole("button", { name: "Periksa pratinjau" }).click();
    await expect(page.getByRole("heading", { name: "Pratinjau soal" })).toBeVisible();
    await page.getByRole("button", { name: "Simpan hasil impor" }).click();
    await page.getByRole("dialog", { name: "Simpan hasil impor?" }).getByRole("button", { name: "Ya, simpan impor" }).click();
    await expect(page.getByRole("status").filter({ hasText: "4 soal berhasil ditambahkan" })).toBeVisible();

    const rowsB = await client.query("SELECT id FROM question_bank WHERE topic_id = $1", [topics[1]]);
    expect(rowsB.rowCount).toBe(4);
  } finally {
    await cleanupTopics(client, topics);
    await client.end();
  }
});
