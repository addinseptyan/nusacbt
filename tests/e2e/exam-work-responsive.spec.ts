import { expect, test } from "@playwright/test";

import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

test("tampilan ponsel 320px menjaga timer sticky, dialog dan navigasi tetap terbaca", async ({ page }, testInfo) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 320, height: 568 });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 19);
  try {
    await client.query("UPDATE exam_tests SET tags=$1::text[], tags_signature=$2 WHERE id=$3", [["Biologi", "XI"], "biologi\x1fxi", f.login.activeTest]);
    await seedAttemptToken(client, f, "global", "000456"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await expect(page.getByRole("list", { name: "Jadwal tes" })).toContainText("Biologi");
    await page.goto(`/peserta/jadwal/${f.runId}`);
    await expect(page.locator("main")).toContainText("Biologi");
    const token = page.getByRole("dialog", { name: "Masukkan token ujian" });
    await token.getByLabel("Token tes").fill("000456"); await expect(token.getByTestId("token-slots").locator("span")).toHaveCount(6);
    await page.screenshot({ path: testInfo.outputPath("mobile-token.png") });
    await token.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page.getByRole("heading", { name: /^Soal 1/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const header = page.getByTestId("exam-sticky-header"); await expect(header.getByLabel(/Waktu tersisa/)).toBeVisible(); await expect(header).not.toContainText("Perkiraan sisa");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(async () => Math.round((await header.boundingBox())?.y ?? -1)).toBe(0);
    const bottom = page.getByTestId("exam-bottom-nav"); await expect(bottom).toBeInViewport();
    expect(await bottom.evaluate((node) => getComputedStyle(node).position)).toBe("fixed");
    await expect.poll(async () => Math.abs((await bottom.boundingBox())!.y + (await bottom.boundingBox())!.height - 568)).toBeLessThanOrEqual(1);
    await expect(header).toContainText(f.login.periodAName); await expect(header).toContainText("NISN");
    await expect(page.locator("main")).not.toContainText("Biologi");
    await expect(page.getByTestId("exam-number-panel")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Navigasi soal" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Navigasi nomor soal ringkas" })).toBeVisible();
    const clearBtn = page.getByRole("button", { name: "Kosongkan jawaban" });
    await expect(clearBtn).toBeVisible();
    expect(Number.parseFloat(await clearBtn.evaluate((el) => getComputedStyle(el).borderTopWidth))).toBeGreaterThanOrEqual(1);
    const mobileSubmitBtn = header.getByRole("button", { name: "Kumpulkan atau akhiri tes" });
    await expect(mobileSubmitBtn).toContainText("Kumpulkan");
    await mobileSubmitBtn.click();
    const dialog = page.getByRole("dialog", { name: "Belum dapat dikumpulkan" }); await expect(dialog).toContainText("5 menit terakhir");
    await expect(dialog.getByRole("button", { name: "Tutup" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mobile-dialog.png") }); await dialog.getByRole("button", { name: "Tutup" }).click();
    await page.screenshot({ path: testInfo.outputPath("mobile-pengerjaan.png"), fullPage: true });
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});

test("soal pendek muat pada 1366×768 dan navigasi bawah tetap saat konten panjang", async ({ page }, testInfo) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 1366, height: 768 });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 19);
  try {
    await seedAttemptToken(client, f, "global", "123098"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await startWithToken(page, f.runId, "123098");
    await expect(page.getByRole("heading", { name: /^Soal 1/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kumpulkan tes" })).toBeInViewport();
    await expect(page.getByTestId("exam-bottom-nav").getByRole("button", { name: "Berikutnya" })).toBeInViewport();
    const measurements = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight }));
    expect(measurements.width).toBeLessThanOrEqual(1366);
    expect(measurements.height).toBeLessThanOrEqual(measurements.clientHeight + 1);
    await page.screenshot({ path: testInfo.outputPath("desktop-1366x768.png") });
    // Konten panjang memang boleh memerlukan scroll; tombol harus tetap terjangkau.
    await page.locator("#question-heading").evaluate((heading) => { const spacer = document.createElement("p"); spacer.textContent = "Konten panjang simulasi"; spacer.style.height = "1000px"; heading.parentElement?.after(spacer); });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bottom = page.getByTestId("exam-bottom-nav"); await expect(bottom).toBeInViewport();
    await expect.poll(async () => Math.abs((await bottom.boundingBox())!.y + (await bottom.boundingBox())!.height - 768)).toBeLessThanOrEqual(1);
    await bottom.getByRole("button", { name: "Berikutnya" }).click();
    await expect(page.getByRole("heading", { name: /^Soal 2/ })).toBeVisible();
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});

test("auto-submit menilai jawaban terakhir meski soal bertanda ragu", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 1);
  try {
    await seedAttemptToken(client, f, "global", "321456"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "321456");
    const correct = (await client.query<{ answer: string }>(
      "SELECT s.correct_option AS answer FROM exam_attempt_questions q JOIN exam_question_snapshots s ON s.id=q.snapshot_id WHERE q.attempt_id=$1 AND q.position=1", [attempt],
    )).rows[0].answer;
    await page.locator(`input[type="radio"][value="${correct}"]`).check(); await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Ragu-ragu" }).check();
    await expect.poll(async () => (await client.query<{ b: boolean }>("SELECT is_doubtful AS b FROM exam_attempt_questions WHERE attempt_id=$1 AND position=1", [attempt])).rows[0].b).toBe(true);
    await page.getByRole("button", { name: "Soal 2, belum dijawab" }).click(); await expect(page.getByRole("heading", { name: /^Soal 2/ })).toBeVisible();
    await page.getByRole("checkbox", { name: "Ragu-ragu" }).check();
    await expect.poll(async () => (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM exam_attempt_questions WHERE attempt_id=$1 AND is_doubtful", [attempt])).rows[0].n).toBe(2);
    const context = page.context();
    await client.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '2 seconds' WHERE id=$1", [attempt]); await page.close();
    await expect.poll(async () => (await client.query<{ reason: string | null }>("SELECT completion_reason AS reason FROM exam_attempts WHERE id=$1", [attempt])).rows[0].reason, { timeout: 15_000 }).toBe("time_expired");
    const finished = await context.newPage(); await finished.goto(`/peserta/pengerjaan/${attempt}`);
    await expect(finished.getByText(/Waktu tes telah habis/)).toBeVisible();
    await expect(finished.getByTestId("completion-celebration")).toBeVisible();
    const result = (await client.query<{ correct: number; answered: number; doubtful: number }>(
      `SELECT a.correct_count AS correct,a.answered_count AS answered,(SELECT count(*)::int FROM exam_attempt_questions q WHERE q.attempt_id=a.id AND q.is_doubtful) AS doubtful
       FROM exam_attempts a WHERE a.id=$1`, [attempt],
    )).rows[0];
    expect(result).toEqual({ correct: 1, answered: 1, doubtful: 2 });
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});

test("nomor soal selalu terjangkau pada soal panjang di desktop dan ponsel", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 19);
  try {
    await seedAttemptToken(client, f, "global", "432109"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await page.setViewportSize({ width: 1366, height: 768 });
    await startWithToken(page, f.runId, "432109");
    await page.locator("#question-heading").evaluate((heading) => { const spacer = document.createElement("p"); spacer.textContent = "Soal panjang simulasi"; spacer.style.height = "1400px"; heading.parentElement?.after(spacer); });
    await page.evaluate(() => window.scrollTo(0, 700));
    const panel = page.getByTestId("exam-number-panel"); const header = page.getByTestId("exam-sticky-header"); const bottom = page.getByTestId("exam-bottom-nav");
    expect(await panel.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    await expect(panel.getByRole("button", { name: "Soal 2, belum dijawab" })).toBeInViewport();
    const panelBox = await panel.boundingBox(), headerBox = await header.boundingBox(), bottomBox = await bottom.boundingBox();
    expect(panelBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(bottomBox!.y + 2);
    await panel.getByRole("button", { name: "Soal 2, belum dijawab" }).click(); await expect(page.getByRole("heading", { name: /^Soal 2/ })).toBeVisible();

    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator("#question-heading").evaluate((heading) => { const spacer = document.createElement("p"); spacer.textContent = "Soal panjang simulasi"; spacer.style.height = "1400px"; heading.parentElement?.after(spacer); });
    await page.evaluate(() => window.scrollTo(0, 700));
    const compact = page.getByRole("navigation", { name: "Navigasi nomor soal ringkas" });
    await expect(compact).toBeInViewport(); await expect(compact.getByRole("button", { name: "Nomor 3, belum dijawab" })).toBeInViewport();
    await compact.getByRole("button", { name: "Nomor 3, belum dijawab" }).click(); await expect(page.getByRole("heading", { name: /^Soal 3/ })).toBeVisible();
    const theme = page.getByRole("button", { name: "Ganti tema" }); await theme.click(); await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await theme.click(); await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});
