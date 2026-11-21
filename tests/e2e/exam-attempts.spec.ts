import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { activateLoginPeriod, loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";
import { cleanupAttemptFixture, openStart, PIXEL_PNG, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";

test.use({ actionTimeout: 15_000 });

test("token khusus, snapshot gambar/kunci, resume, penilaian dan perlindungan rilis", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client); const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const anonymous = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" });
  try {
    const globalId = await seedAttemptToken(client, f, "global", "001234");
    const testId = await seedAttemptToken(client, f, "test", "987654");
    await loginParticipant(page, f.login.username, f.login.passwordA);
    const schedule = page.getByRole("listitem").filter({ hasText: f.login.activeName });
    await expect(schedule.getByRole("button", { name: "Mulai tes" })).toBeVisible();
    await schedule.getByRole("button", { name: "Mulai tes" }).click();
    await expect(page).toHaveURL(/\/peserta$/);
    await expect(page.getByRole("dialog", { name: "Masukkan token ujian" })).toBeVisible();
    await page.getByLabel("Token tes").fill("001234"); await page.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Token tidak cocok" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(0);
    await page.getByLabel("Token tes").fill("987654"); await page.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
    const attempt = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1];
    const metadata = (await client.query<{ deadlineMatches: boolean; started: string; deadline: string }>(
      `SELECT a.deadline=r.starts_at+r.duration_minutes*interval '1 minute' AS "deadlineMatches",a.started_at::text AS started,a.deadline::text AS deadline
       FROM exam_attempts a JOIN exam_schedule_runs r ON r.id=a.run_id WHERE a.id=$1`, [attempt],
    )).rows[0];
    expect(metadata.deadlineMatches).toBe(true);
    const snapshot = (await client.query<{ position: number; source: string; order: string; correct: string }>(
      `SELECT aq.position,s.source_question_id::text AS source,aq.option_order AS "order",s.correct_option AS correct
       FROM exam_attempt_questions aq JOIN exam_question_snapshots s ON s.id=aq.snapshot_id WHERE aq.attempt_id=$1 ORDER BY aq.position`, [attempt],
    )).rows;
    expect(snapshot).toHaveLength(3);
    for (const q of snapshot) expect([...q.order].sort().join("")).toBe("ABCDE");
    const original = snapshot.find((q) => q.source === f.login.questionId)!;
    const other = snapshot.find((q) => q.source !== f.login.questionId)!;
    expect(original.correct).toBe("D");
    const imageUrl = `/peserta/pengerjaan/${attempt}/gambar/${original.position}/prompt`;
    expect((await anonymous.request.get(imageUrl)).status()).toBe(404);
    const firstImage = await page.request.get(imageUrl); expect(firstImage.status()).toBe(200);
    expect(firstImage.headers()["cache-control"]).toContain("no-store"); expect(await firstImage.body()).toEqual(PIXEL_PNG);
    await page.goto(`/peserta/pengerjaan/${attempt}?soal=${original.position}`);
    await expect(page.getByText(f.login.questionSecret)).toBeVisible();
    expect(await page.content()).not.toContain("correct_option"); expect(await page.content()).not.toContain("correct_count");
    await page.locator('input[type="radio"][value="D"]').check();
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Soal ${other.position}, belum dijawab` }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Soal ${other.position} /`) })).toBeVisible();
    await page.locator(`input[type="radio"][value="${other.correct === "A" ? "B" : "A"}"]`).check();
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();

    // Perubahan bank setelah mulai tidak boleh mengubah soal, gambar atau kunci snapshot.
    await client.query("UPDATE question_bank SET prompt_text=$2,correct_option='A',prompt_image=$3,updated_at=clock_timestamp() WHERE id=$1", [f.login.questionId, `BANK DIUBAH ${f.login.suffix}`, Buffer.from("lain")]);
    await page.goto(`/peserta/pengerjaan/${attempt}?soal=${original.position}`);
    await expect(page.getByText(f.login.questionSecret)).toBeVisible(); await expect(page.getByText(`BANK DIUBAH ${f.login.suffix}`)).toHaveCount(0);
    expect(await (await page.request.get(imageUrl)).body()).toEqual(PIXEL_PNG);
    await expect(page.locator('input[type="radio"][value="D"]')).toBeChecked();

    // Token tidak lagi diperlukan untuk resume, sekalipun dicabut dan peserta login ulang.
    await client.query("UPDATE exam_access_tokens SET revoked_at=clock_timestamp(),revoked_reason='manual' WHERE id=ANY($1::bigint[])", [[globalId, testId]]);
    await expect(page.getByRole("button", { name: "Kembali ke jadwal" })).toHaveCount(0);
    // Simulasikan tab ditinggalkan lewat navigasi browser; tombol tidak lagi ada di layar ujian.
    await page.goto("/peserta");
    await page.getByRole("button", { name: "Keluar" }).click();
    await loginParticipant(page, f.login.username, f.login.passwordA);
    await page.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("link", { name: "Lanjutkan tes" }).click();
    await expect(page).toHaveURL(new RegExp(`/pengerjaan/${attempt}(?:\\?|$)`));
    const after = (await client.query<{ position: number; source: string; order: string; correct: string }>(
      `SELECT aq.position,s.source_question_id::text AS source,aq.option_order AS "order",s.correct_option AS correct
       FROM exam_attempt_questions aq JOIN exam_question_snapshots s ON s.id=aq.snapshot_id WHERE aq.attempt_id=$1 ORDER BY aq.position`, [attempt],
    )).rows;
    expect(after).toEqual(snapshot);
    const same = (await client.query<{ started: string; deadline: string }>("SELECT started_at::text AS started,deadline::text AS deadline FROM exam_attempts WHERE id=$1", [attempt])).rows[0];
    expect(same).toEqual({ started: metadata.started, deadline: metadata.deadline });

    // UI admin tidak dapat menarik rilis atau menimpa riwayat yang sudah dimulai.
    await loginAsAdmin(admin); await admin.goto(`/data-tes/daftar/${f.login.activeTest}`);
    await admin.getByRole("button", { name: "Tarik rilis Jadwal fiktif" }).click();
    const dialog = admin.getByRole("dialog", { name: "Tarik rilis jadwal?" });
    await dialog.getByRole("button", { name: "Ya, tarik rilis" }).click();
    await expect(dialog.getByRole("alert")).toContainText("sudah ada peserta yang mulai");
    expect((await client.query<{ published: boolean }>("SELECT published_at IS NOT NULL AS published FROM exam_schedule_runs WHERE id=$1", [f.runId])).rows[0].published).toBe(true);

    await page.bringToFront();
    // Fixture khusus: pindahkan deadline attempt ke dalam lima menit terakhir.
    await client.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '4 minutes' WHERE id=$1", [attempt]);
    await page.reload();
    await page.getByRole("button", { name: "Selesaikan tes" }).click(); await page.getByRole("button", { name: "Ya, kumpulkan" }).click();
    await expect(page.getByText("PENGERJAAN SELESAI")).toBeVisible();
    const result = (await client.query<{ reason: string; correct: number; answered: number; total: number }>(
      'SELECT completion_reason AS reason,correct_count AS correct,answered_count AS answered,question_count AS total FROM exam_attempts WHERE id=$1', [attempt],
    )).rows[0];
    expect(result).toEqual({ reason: "submitted", correct: 1, answered: 2, total: 3 });
    await expect(page.getByTestId("score-value")).toHaveText("33,33"); await expect(page.getByTestId("score-value")).toBeHidden();
    await page.getByText("Perlihatkan nilai", { exact: true }).click(); await expect(page.getByTestId("score-value")).toBeVisible();
    expect(await page.content()).not.toContain("correct_count");
    await page.goto("/data-tes/monitoring"); await expect(page).toHaveURL(/\/login$/);
    await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    const row = admin.getByRole("row").filter({ hasText: f.login.studentAName });
    await expect(row).toContainText("Dikumpulkan"); await expect(row).toContainText("2 / 3"); await expect(row).toContainText("33,33");
    expect((await admin.request.get(`/data-tes/monitoring?tes=${f.login.activeTest}`)).headers()["cache-control"]).toContain("no-store");
  } finally { await anonymous.close(); await adminContext.close(); await cleanupAttemptFixture(client, f); await client.end(); }
});

test("jawaban offline tidak dianggap aman; retry dikonfirmasi, lalu otomatis dinilai tanpa browser saat deadline", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "global", "123456"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "123456");
    await page.locator('input[type="radio"][value="D"]').check(); await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    await page.context().setOffline(true);
    await page.locator('input[type="radio"][value="A"]').check();
    await expect(page.getByRole("alert").filter({ hasText: "belum dapat dianggap aman" })).toBeVisible();
    expect((await client.query<{ answer: string }>("SELECT answer FROM exam_attempt_questions WHERE attempt_id=$1", [attempt])).rows[0].answer).toBe("D");
    await page.context().setOffline(false); await page.getByRole("button", { name: "Coba simpan lagi" }).click();
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    expect((await client.query<{ answer: string }>("SELECT answer FROM exam_attempt_questions WHERE attempt_id=$1", [attempt])).rows[0].answer).toBe("A");
    await page.context().setOffline(true); await page.locator('input[type="radio"][value="D"]').check();
    await expect(page.getByRole("alert").filter({ hasText: "belum dapat dianggap aman" })).toBeVisible();
    // Hanya fixture: mendekatkan deadline. Browser tetap offline selama worker bekerja.
    await client.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '2 seconds' WHERE id=$1", [attempt]);
    await expect.poll(async () => (await client.query<{ reason: string | null }>("SELECT completion_reason AS reason FROM exam_attempts WHERE id=$1", [attempt])).rows[0].reason, { timeout: 20_000 }).toBe("time_expired");
    const result = (await client.query<{ answer: string; correct: number; answered: number }>(
      `SELECT aq.answer,a.correct_count AS correct,a.answered_count AS answered FROM exam_attempts a JOIN exam_attempt_questions aq ON aq.attempt_id=a.id WHERE a.id=$1`, [attempt],
    )).rows[0];
    expect(result).toEqual({ answer: "A", correct: 0, answered: 1 });
    await page.context().setOffline(false); const reopened = await page.context().newPage();
    await reopened.goto(`/peserta/pengerjaan/${attempt}`); await expect(reopened.getByText("PENGERJAAN SELESAI")).toBeVisible();
    await expect(reopened.getByText(/dikumpulkan otomatis/)).toBeVisible();
    await expect(reopened.getByTestId("score-value")).toBeHidden();
    await reopened.getByText("Perlihatkan nilai", { exact: true }).click(); await expect(reopened.getByTestId("score-value")).toHaveText("0,00");
  } finally { await page.context().setOffline(false); await cleanupAttemptFixture(client, f); await client.end(); }
});

test("dua tab mulai membuat satu attempt; jawaban tab usang tidak menimpa dan asal asing ditolak", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "global", "654321"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const second = await page.context().newPage(); await Promise.all([openStart(page, f.runId), openStart(second, f.runId)]);
    await Promise.all([page.getByLabel("Token tes").fill("654321"), second.getByLabel("Token tes").fill("654321")]);
    await Promise.all([page.getByRole("button", { name: "Mulai pengerjaan" }).click(), second.getByRole("button", { name: "Mulai pengerjaan" }).click()]);
    await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/); await expect(second).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
    expect(new URL(page.url()).pathname).toBe(new URL(second.url()).pathname);
    const attempt = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1];
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(1);
    const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname.includes(`/pengerjaan/${attempt}`));
    await page.locator('input[type="radio"][value="A"]').check(); const savedRequest = await request;
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    await second.locator('input[type="radio"][value="B"]').check();
    await expect(second.getByRole("alert").filter({ hasText: "Jawaban telah berubah pada tab atau perangkat lain" })).toBeVisible();
    expect((await client.query<{ answer: string; revision: string }>("SELECT answer,answer_revision::text AS revision FROM exam_attempt_questions WHERE attempt_id=$1", [attempt])).rows[0]).toEqual({ answer: "A", revision: "1" });
    const headers = savedRequest.headers(); const body = savedRequest.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Aksi jawaban tidak dapat diperiksa.");
    const foreign = await page.request.post(`/peserta/pengerjaan/${attempt}`, { headers: { origin: "https://attacker.invalid", "next-action": headers["next-action"], "content-type": headers["content-type"] }, data: body, failOnStatusCode: false });
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    expect((await client.query<{ answer: string; revision: string }>("SELECT answer,answer_revision::text AS revision FROM exam_attempt_questions WHERE attempt_id=$1", [attempt])).rows[0]).toEqual({ answer: "A", revision: "1" });
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});

test("sesi peserta periode lain tidak dapat membuka attempt atau gambar", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const otherContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const other = await otherContext.newPage();
  try {
    await page.bringToFront();
    await seedAttemptToken(client, f, "global", "112233"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "112233");
    await admin.bringToFront(); await loginAsAdmin(admin); await activateLoginPeriod(admin, f.login.periodBName);
    await other.bringToFront(); await loginParticipant(other, f.login.username, f.login.passwordB);
    expect((await other.request.get(`/peserta/pengerjaan/${attempt}/gambar/1/prompt`)).status()).toBe(404);
    const response = await other.goto(`/peserta/pengerjaan/${attempt}`); expect(response?.status()).toBe(404);
    expect(await other.content()).not.toContain(f.login.questionSecret);
    await page.bringToFront(); await page.goto(`/peserta/pengerjaan/${attempt}`); await expect(page).toHaveURL(/\/peserta\/login\?sesi=berakhir/);
    await admin.bringToFront(); await activateLoginPeriod(admin, f.login.periodAName);
    await page.bringToFront(); await loginParticipant(page, f.login.username, f.login.passwordA);
    await page.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("link", { name: "Lanjutkan tes" }).click();
    await expect(page).toHaveURL(new RegExp(`/pengerjaan/${attempt}(?:\\?|$)`));
  } finally { await otherContext.close().catch(() => {}); await adminContext.close().catch(() => {}); await cleanupAttemptFixture(client, f); await client.end(); }
});

test("lima token salah mengunci identitas, batas global dan kedaluwarsa kunci diperiksa server", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "test", "998877"); await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId);
    for (let i = 0; i < 5; i += 1) {
      await page.getByLabel("Token tes").fill(`00000${i}`); await page.getByRole("button", { name: "Mulai pengerjaan" }).click();
      await expect.poll(async () => (await client.query<{ n: number }>("SELECT failed_attempts AS n FROM exam_start_token_attempts WHERE participant_identity_id=$1", [f.login.identityA])).rows[0]?.n).toBe(i + 1);
    }
    expect((await client.query<{ locked: boolean }>("SELECT locked_until>clock_timestamp() AS locked FROM exam_start_token_attempts WHERE participant_identity_id=$1", [f.login.identityA])).rows[0].locked).toBe(true);
    await page.getByLabel("Token tes").fill("998877");
    const lockedResponse = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/peserta/jadwal/${f.runId}`);
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await lockedResponse;
    await expect(page.getByRole("button", { name: "Mulai pengerjaan" })).toBeEnabled();
    await expect(page.getByRole("alert").filter({ hasText: "sementara terkunci" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(0);
    await client.query("UPDATE exam_start_token_attempts SET locked_until=clock_timestamp()-interval '1 second' WHERE participant_identity_id=$1", [f.login.identityA]);
    await client.query("UPDATE exam_start_token_global_limit SET failed_attempts=60,window_started_at=clock_timestamp() WHERE id=1");
    await page.getByLabel("Token tes").fill("998877");
    const globalResponse = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/peserta/jadwal/${f.runId}`);
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await globalResponse;
    await expect(page.getByRole("button", { name: "Mulai pengerjaan" })).toBeEnabled();
    await expect(page.getByRole("alert").filter({ hasText: "sementara terkunci" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(0);
    await client.query("UPDATE exam_start_token_global_limit SET failed_attempts=0,window_started_at=clock_timestamp()-interval '2 minutes' WHERE id=1");
    await page.getByLabel("Token tes").fill("998877"); await page.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});
