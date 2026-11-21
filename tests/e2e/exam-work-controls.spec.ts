import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

test("token OTP, identitas dan timer sticky, ragu, progres serta tepi navigasi 20 soal", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1200, height: 520 });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 19);
  try {
    await seedAttemptToken(client, f, "global", "001234"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await page.goto(`/peserta/jadwal/${f.runId}`);
    const tokenDialog = page.getByRole("dialog", { name: "Masukkan token ujian" });
    await expect(tokenDialog).toBeVisible(); await expect(tokenDialog.getByTestId("token-slots").locator("span")).toHaveCount(6);
    const token = tokenDialog.getByLabel("Token tes"); await token.fill("009"); await token.press("Backspace"); await expect(token).toHaveValue("00");
    await token.evaluate((node: HTMLInputElement) => {
      const data = new DataTransfer(); data.setData("text/plain", "00 12 34");
      node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await expect(token).toHaveValue("001234");
    await expect(tokenDialog.getByTestId("token-slots").locator("span")).toHaveText(["0", "0", "1", "2", "3", "4"]);
    await tokenDialog.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
    const attempt = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1];
    const nisn = (await client.query<{ nisn: string }>("SELECT nisn FROM school_students WHERE id=$1", [f.login.studentA])).rows[0].nisn;
    const header = page.getByTestId("exam-sticky-header");
    await expect(header).toContainText(f.login.studentAName); await expect(header).toContainText(nisn);
    await expect(header).toContainText(`X ${f.login.majorName}`); await expect(header).toContainText(f.login.periodAName);
    await expect(header.getByLabel(/Perkiraan sisa waktu/)).toBeVisible();
    expect(await header.evaluate((node) => getComputedStyle(node).position)).toBe("sticky");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(async () => Math.round((await header.boundingBox())?.y ?? -1)).toBe(0);
    await expect(page.getByRole("button", { name: "Kembali ke jadwal" })).toHaveCount(0);

    const mark = page.getByRole("checkbox", { name: "Ragu-ragu" }); await mark.check();
    await expect(page.getByText("Tanda ragu tersimpan", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /0 sudah dijawab tanpa ragu, 1 ragu-ragu, 19 belum dijawab/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Soal 1, ragu-ragu, belum dijawab" })).toBeVisible();
    await page.locator('input[type="radio"][value="D"]').check(); await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Soal 1, ragu-ragu, terjawab" })).toBeVisible();
    let row = (await client.query<{ answer: string; answerRev: string; doubtful: boolean; doubtRev: string }>(
      'SELECT answer,answer_revision::text AS "answerRev",is_doubtful AS doubtful,doubt_revision::text AS "doubtRev" FROM exam_attempt_questions WHERE attempt_id=$1 AND position=1', [attempt],
    )).rows[0];
    expect(row).toEqual({ answer: "D", answerRev: "1", doubtful: true, doubtRev: "1" });
    await page.reload(); await expect(page.getByRole("checkbox", { name: "Ragu-ragu" })).toBeChecked();
    await expect(page.locator('input[type="radio"][value="D"]')).toBeChecked();
    await page.getByRole("button", { name: "Soal 2, belum dijawab" }).click();
    await expect(page.getByRole("heading", { name: /^Soal 2 \/ 20/ })).toBeVisible();
    await page.getByRole("checkbox", { name: "Ragu-ragu" }).check(); await expect(page.getByText("Tanda ragu tersimpan", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /0 sudah dijawab tanpa ragu, 2 ragu-ragu, 18 belum dijawab/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Keterangan status soal" })).toContainText("Soal aktif");

    const nav = page.getByRole("navigation", { name: "Navigasi soal" });
    for (const position of [1, 5, 6, 10, 11, 15, 16, 20]) {
      const button = nav.getByRole("button", { name: new RegExp(`^Soal ${position},`) });
      await button.click(); await expect(page.getByRole("heading", { name: new RegExp(`^Soal ${position} /`) })).toBeVisible();
      await expect(button).toHaveAttribute("aria-current", "step");
      const navBox = await nav.boundingBox(), box = await button.boundingBox();
      expect(navBox && box).toBeTruthy();
      expect(box!.x - navBox!.x).toBeGreaterThanOrEqual(4); expect(navBox!.x + navBox!.width - box!.x - box!.width).toBeGreaterThanOrEqual(4);
      expect(box!.y - navBox!.y).toBeGreaterThanOrEqual(4); expect(navBox!.y + navBox!.height - box!.y - box!.height).toBeGreaterThanOrEqual(4);
    }
    row = (await client.query('SELECT answer,answer_revision::text AS "answerRev",is_doubtful AS doubtful,doubt_revision::text AS "doubtRev" FROM exam_attempt_questions WHERE attempt_id=$1 AND position=1', [attempt])).rows[0];
    expect(row).toEqual({ answer: "D", answerRev: "1", doubtful: true, doubtRev: "1" });
    expect(await page.content()).not.toContain("correct_option");
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});

test("tanda ragu aman saat respons hilang, retry dan konflik tab tanpa mengubah jawaban", async ({ page }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "global", "777888"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "777888");
    await page.locator('input[type="radio"][value="D"]').check(); await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    const pattern = `**/peserta/pengerjaan/${attempt}`; let dropped = false;
    await page.route(pattern, async (route) => {
      if (!dropped && route.request().method() === "POST") { dropped = true; await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByRole("checkbox", { name: "Ragu-ragu" }).check();
    await expect(page.getByRole("alert").filter({ hasText: "belum dapat dianggap aman" })).toBeVisible();
    const get = async () => (await client.query<{ answer: string; doubtful: boolean; revision: string }>(
      'SELECT answer,is_doubtful AS doubtful,doubt_revision::text AS revision FROM exam_attempt_questions WHERE attempt_id=$1', [attempt],
    )).rows[0];
    expect(await get()).toEqual({ answer: "D", doubtful: true, revision: "1" });
    await page.unroute(pattern); await page.getByRole("button", { name: "Coba simpan lagi" }).click();
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible(); expect(await get()).toEqual({ answer: "D", doubtful: true, revision: "1" });
    const other = await page.context().newPage(); await other.goto(`/peserta/pengerjaan/${attempt}`);
    await expect(other.getByRole("checkbox", { name: "Ragu-ragu" })).toBeChecked();
    await page.getByRole("checkbox", { name: "Ragu-ragu" }).uncheck(); await expect.poll(async () => (await get()).revision).toBe("2");
    await page.getByRole("checkbox", { name: "Ragu-ragu" }).check(); await expect.poll(async () => (await get()).revision).toBe("3");
    await other.getByRole("checkbox", { name: "Ragu-ragu" }).uncheck();
    await expect(other.getByRole("alert").filter({ hasText: "berubah pada tab atau perangkat lain" })).toBeVisible();
    expect(await get()).toEqual({ answer: "D", doubtful: true, revision: "3" }); await other.close();
    await page.context().setOffline(true); await page.getByRole("checkbox", { name: "Ragu-ragu" }).uncheck();
    await expect(page.getByRole("alert").filter({ hasText: "belum dapat dianggap aman" })).toBeVisible(); expect(await get()).toEqual({ answer: "D", doubtful: true, revision: "3" });
    await page.context().setOffline(false); await page.getByRole("button", { name: "Coba simpan lagi" }).click();
    await expect.poll(async () => (await get()).revision).toBe("4"); expect(await get()).toEqual({ answer: "D", doubtful: false, revision: "4" });
  } finally { await page.context().setOffline(false).catch(() => {}); await cleanupAttemptFixture(client, f); await client.end(); }
});

test("batas global terbaru ditegakkan server dan tab admin usang ditolak", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const changeSetting = async (value: number) => {
    await admin.goto("/data-tes/pengaturan-pengerjaan"); await admin.getByLabel("Batas pengumpulan manual").fill(String(value));
    await admin.getByRole("button", { name: "Simpan pengaturan" }).click();
    await expect.poll(async () => (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n).toBe(value);
  };
  try {
    expect((await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n).toBe(5);
    await page.goto("/data-tes/pengaturan-pengerjaan"); await expect(page).toHaveURL(/\/login$/);
    await loginAsAdmin(admin); await admin.goto("/data-tes/pengaturan-pengerjaan");
    const stale = await adminContext.newPage(); await stale.goto("/data-tes/pengaturan-pengerjaan");
    await admin.getByLabel("Batas pengumpulan manual").fill("60"); await admin.getByRole("button", { name: "Simpan pengaturan" }).click();
    await expect.poll(async () => (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n).toBe(60);
    await stale.getByLabel("Batas pengumpulan manual").fill("10"); await stale.getByRole("button", { name: "Simpan pengaturan" }).click();
    await expect(stale.getByRole("alert").filter({ hasText: "sudah berubah" })).toBeVisible();
    expect((await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n).toBe(60); await stale.close();
    await changeSetting(5);
    await seedAttemptToken(client, f, "global", "112244"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "112244");
    await page.locator('input[type="radio"][value="D"]').check(); await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Ragu-ragu" }).check(); await expect.poll(async () => (await client.query<{ b: boolean }>("SELECT is_doubtful AS b FROM exam_attempt_questions WHERE attempt_id=$1", [attempt])).rows[0].b).toBe(true);
    await page.getByRole("button", { name: "Selesaikan tes" }).click();
    let dialog = page.getByRole("dialog", { name: "Belum dapat dikumpulkan" }); await expect(dialog).toContainText("5 menit terakhir");
    await dialog.getByRole("button", { name: "Tutup" }).click();
    await client.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '4 minutes 50 seconds' WHERE id=$1", [attempt]);
    await page.getByRole("button", { name: "Selesaikan tes" }).click();
    dialog = page.getByRole("dialog", { name: "Kumpulkan tes sekarang?" }); await expect(dialog).toContainText("1 ditandai ragu-ragu");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await client.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '20 minutes' WHERE id=$1", [attempt]);
    await changeSetting(60); // Halaman peserta tidak dimuat ulang.
    await page.getByRole("button", { name: "Selesaikan tes" }).click();
    dialog = page.getByRole("dialog", { name: "Kumpulkan tes sekarang?" }); await expect(dialog).toContainText("60 menit terakhir");
    await changeSetting(5); // Berubah ketika dialog konfirmasi masih terbuka.
    const sent = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === `/peserta/pengerjaan/${attempt}`);
    await dialog.getByRole("button", { name: "Ya, kumpulkan" }).click();
    const request = await sent, body = request.postDataBuffer(), headers = request.headers();
    expect(body).toBeTruthy(); expect(headers["next-action"]).toBeTruthy();
    dialog = page.getByRole("dialog", { name: "Belum dapat dikumpulkan" }); await expect(dialog).toContainText("5 menit terakhir");
    expect((await client.query<{ completed: Date | null }>("SELECT completed_at AS completed FROM exam_attempts WHERE id=$1", [attempt])).rows[0].completed).toBeNull();
    // Memanggil aksi langsung dengan payload sah tanpa dialog tidak dapat melewati aturan server.
    const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3100";
    const direct = await page.request.post(`/peserta/pengerjaan/${attempt}`, { data: body!, headers: { "content-type": headers["content-type"], "next-action": headers["next-action"], origin: base } });
    expect(await direct.text()).toContain("Pengumpulan hanya tersedia pada 5 menit terakhir");
    const alien = await page.request.post(`/peserta/pengerjaan/${attempt}`, { data: body!, headers: { "content-type": headers["content-type"], "next-action": headers["next-action"], origin: "https://attacker.invalid" }, failOnStatusCode: false });
    expect(alien.status()).toBeGreaterThanOrEqual(400);
    expect((await client.query<{ completed: Date | null }>("SELECT completed_at AS completed FROM exam_attempts WHERE id=$1", [attempt])).rows[0].completed).toBeNull();
    await changeSetting(60); await dialog.getByRole("button", { name: "Tutup" }).click();
    await page.getByRole("button", { name: "Selesaikan tes" }).click();
    dialog = page.getByRole("dialog", { name: "Kumpulkan tes sekarang?" }); await expect(dialog).toContainText("1 ditandai ragu-ragu");
    await dialog.getByRole("button", { name: "Ya, kumpulkan" }).click(); await expect(page.getByText("PENGERJAAN SELESAI")).toBeVisible();
    const result = (await client.query<{ reason: string; correct: number; answered: number; doubtful: boolean }>(
      `SELECT a.completion_reason AS reason,a.correct_count AS correct,a.answered_count AS answered,q.is_doubtful AS doubtful
       FROM exam_attempts a JOIN exam_attempt_questions q ON q.attempt_id=a.id WHERE a.id=$1`, [attempt],
    )).rows[0];
    expect(result).toEqual({ reason: "submitted", correct: 1, answered: 1, doubtful: true });
  } finally {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=5,revision=revision+1,updated_at=clock_timestamp(),updated_by=NULL WHERE id=1");
    await adminContext.close(); await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("form token memiliki fallback tanpa JavaScript", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  const noJs = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100", javaScriptEnabled: false });
  try {
    await seedAttemptToken(client, f, "global", "001122"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await noJs.addCookies(await page.context().cookies()); const fallback: Page = await noJs.newPage();
    const response = await fallback.goto(`/peserta/jadwal/${f.runId}`);
    expect(response?.headers()["cache-control"]).toContain("no-store"); expect(response?.headers()["referrer-policy"]).toBe("same-origin");
    await fallback.getByLabel("Token tes").fill("001122");
    await fallback.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await expect(fallback).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
    await expect(fallback.getByText(/JavaScript diperlukan untuk menyimpan jawaban/)).toBeVisible();
    await expect(fallback.locator('input[type="radio"]').first()).toBeDisabled();
  } finally { await noJs.close(); await cleanupAttemptFixture(client, f); await client.end(); }
});
