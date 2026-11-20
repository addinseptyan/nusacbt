import { expect, test } from "@playwright/test";

import { parseMathML } from "../../src/lib/question-math.mjs";
import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

test("respons tersimpan yang hilang tetap ditandai belum pasti; retry idempoten", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "global", "777888"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "777888");
    let dropped = false;
    const pattern = `**/peserta/pengerjaan/${attempt}`;
    await page.route(pattern, async (route) => {
      if (!dropped && route.request().method() === "POST") {
        dropped = true;
        // Server memproses dan commit, tetapi respons sengaja tidak diberikan ke browser.
        const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed");
      } else await route.continue();
    });
    await page.locator('input[type="radio"][value="D"]').check();
    await expect(page.getByRole("alert").filter({ hasText: "belum dapat dianggap aman" })).toBeVisible();
    expect(dropped).toBe(true);
    const stored = (await client.query<{ answer: string; revision: string }>("SELECT answer,answer_revision::text AS revision FROM exam_attempt_questions WHERE attempt_id=$1", [attempt])).rows[0];
    expect(stored).toEqual({ answer: "D", revision: "1" });
    await page.unroute(pattern); await page.getByRole("button", { name: "Coba simpan lagi" }).click();
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    expect((await client.query<{ answer: string; revision: string }>("SELECT answer,answer_revision::text AS revision FROM exam_attempt_questions WHERE attempt_id=$1", [attempt])).rows[0]).toEqual(stored);
    await page.reload(); await expect(page.locator('input[type="radio"][value="D"]')).toBeChecked();
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});

test("token global digunakan kembali setelah token khusus kedaluwarsa", async ({ page }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "global", "778899"); const special = await seedAttemptToken(client, f, "test", "887766");
    await client.query("WITH m AS (SELECT clock_timestamp() AS t) UPDATE exam_access_tokens SET issued_at=m.t-interval '16 minutes',expires_at=m.t-interval '1 minute' FROM m WHERE id=$1", [special]);
    await loginParticipant(page, f.login.username, f.login.passwordA); await startWithToken(page, f.runId, "778899");
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(1);
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});

test("snapshot berformat mempertahankan teks Arab, rumus, tabel dan pilihan saat bank diubah", async ({ page }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const rich = { type: "doc", content: [
      { type: "paragraph", attrs: { dir: "rtl" }, content: [
        { type: "text", text: "سُؤَالٌ آمن", marks: [{ type: "bold" }] },
        { type: "mathFormula", attrs: { formula: parseMathML('<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>') } },
      ] },
      { type: "table", content: [{ type: "tableRow", content: [
        { type: "tableCell", content: [p("Kiri fiktif")] }, { type: "tableCell", content: [p("Kanan fiktif")] },
      ] }] },
    ] };
    const option = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Pilihan tebal fiktif", marks: [{ type: "bold" }] }] }] };
    await client.query("UPDATE question_bank SET prompt_rich=$2::jsonb,option_a_rich=$3::jsonb,updated_at=clock_timestamp() WHERE id=$1", [f.login.questionId, JSON.stringify(rich), JSON.stringify(option)]);
    await seedAttemptToken(client, f, "global", "779988"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "779988");
    const section = page.locator('section[aria-labelledby="question-heading"]');
    await expect(section.locator('p[dir="rtl"] strong')).toContainText("سُؤَالٌ آمن");
    await expect(section.locator("math mfrac")).toHaveCount(1); await expect(section.locator("table td")).toHaveCount(2);
    await expect(section.locator("strong").filter({ hasText: "Pilihan tebal fiktif" })).toBeVisible();
    await client.query("UPDATE question_bank SET prompt_text='Isi baru',prompt_rich=NULL,option_a_rich=NULL,updated_at=clock_timestamp() WHERE id=$1", [f.login.questionId]);
    await page.reload(); await expect(section.locator('p[dir="rtl"] strong')).toContainText("سُؤَالٌ آمن");
    await expect(section.locator("math mfrac")).toHaveCount(1); await expect(section.locator("table td")).toHaveCount(2);
    await expect(section.locator("strong").filter({ hasText: "Pilihan tebal fiktif" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE id=$1", [attempt])).rowCount).toBe(1);
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});

test("tanpa JavaScript pilihan dinonaktifkan, bukan tampak tersimpan", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  const noJs = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100", javaScriptEnabled: false });
  try {
    await page.bringToFront(); await seedAttemptToken(client, f, "global", "889900"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "889900");
    await noJs.addCookies(await page.context().cookies()); const fallback = await noJs.newPage();
    await fallback.goto(`/peserta/pengerjaan/${attempt}`); await expect(fallback.getByText(/JavaScript diperlukan untuk menyimpan jawaban/)).toBeVisible();
    for (const radio of await fallback.locator('input[type="radio"]').all()) await expect(radio).toBeDisabled();
    expect((await client.query<{ answer: string | null }>("SELECT answer FROM exam_attempt_questions WHERE attempt_id=$1", [attempt])).rows[0].answer).toBeNull();
  } finally { await noJs.close().catch(() => {}); await cleanupAttemptFixture(client, f); await client.end(); }
});
