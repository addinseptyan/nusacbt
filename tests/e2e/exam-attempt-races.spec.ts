import { expect, test } from "@playwright/test";

import { cleanupAttemptFixture, openStart, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

async function waitForBlocked(client: ReturnType<typeof loginTestDatabase>, fragment: string) {
  await expect.poll(async () => (await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
       AND state='active' AND wait_event_type='Lock' AND query LIKE $1`, [`%${fragment}%`],
  )).rows[0].n, { timeout: 12_000, intervals: [100, 250, 500] }).toBeGreaterThan(0);
}

test("token dicabut setelah precheck tetapi sebelum snapshot selesai: mulai dibatalkan atomik", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  try {
    const token = await seedAttemptToken(client, f, "test", "224466"); await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId);
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM question_bank WHERE id=$1 FOR UPDATE", [f.login.questionId]);
    await page.getByLabel("Token tes").fill("224466");
    const response = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/peserta/jadwal/${f.runId}`);
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await waitForBlocked(client, "FROM question_bank WHERE id=ANY");
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(2026111903)");
      await client.query("UPDATE exam_access_tokens SET revoked_at=clock_timestamp(),revoked_reason='manual' WHERE id=$1", [token]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    await blocker.query("COMMIT"); await response;
    await expect(page.getByRole("alert").filter({ hasText: "Token berubah atau kedaluwarsa" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(0);
    expect((await client.query("SELECT 1 FROM exam_question_snapshots WHERE source_question_id=$1", [f.login.questionId])).rowCount).toBe(0);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await cleanupAttemptFixture(client, f); await blocker.end(); await client.end(); }
});

test("tarik rilis yang menang sebelum mulai mencegah attempt baru", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "global", "335577"); await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId);
    await blocker.query("BEGIN");
    // Sama dengan urutan admin: tes, lalu pelaksanaan.
    await blocker.query("SELECT id FROM exam_tests WHERE id=$1 FOR UPDATE", [f.login.activeTest]);
    await blocker.query("SELECT id FROM exam_schedule_runs WHERE id=$1 FOR UPDATE", [f.runId]);
    await page.getByLabel("Token tes").fill("335577");
    const response = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/peserta/jadwal/${f.runId}`);
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await waitForBlocked(client, "FROM exam_tests WHERE id=");
    await blocker.query("UPDATE exam_schedule_runs SET published_at=NULL,published_by=NULL WHERE id=$1", [f.runId]);
    await blocker.query("COMMIT"); await response;
    await expect(page.getByRole("alert").filter({ hasText: "Jadwal tidak dapat dimulai" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(0);
    expect((await client.query<{ released: boolean }>("SELECT published_at IS NOT NULL AS released FROM exam_schedule_runs WHERE id=$1", [f.runId])).rows[0].released).toBe(false);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await cleanupAttemptFixture(client, f); await blocker.end(); await client.end(); }
});

test("jawaban yang menunggu kunci sampai melewati batas tidak disimpan", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "global", "446688"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attempt = await startWithToken(page, f.runId, "446688");
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM exam_attempts WHERE id=$1 FOR UPDATE", [attempt]);
    await blocker.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '2 seconds' WHERE id=$1", [attempt]);
    const response = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/peserta/pengerjaan/${attempt}`);
    await page.locator('input[type="radio"][value="D"]').check();
    await waitForBlocked(client, "FROM exam_attempts WHERE id=");
    // Baca jam database, bukan tidur berdasarkan jam browser.
    await expect.poll(async () => (await blocker.query<{ expired: boolean }>("SELECT deadline<=clock_timestamp() AS expired FROM exam_attempts WHERE id=$1", [attempt])).rows[0].expired,
      { timeout: 10_000, intervals: [100, 200, 500] }).toBe(true);
    await blocker.query("COMMIT"); await response;
    await expect(page.getByRole("alert").filter({ hasText: /Waktu habis/ })).toBeVisible();
    await expect.poll(async () => (await client.query<{ reason: string | null }>("SELECT completion_reason AS reason FROM exam_attempts WHERE id=$1", [attempt])).rows[0].reason, { timeout: 15_000 }).toBe("time_expired");
    const result = (await client.query<{ answer: string | null; answered: number; correct: number }>(
      "SELECT q.answer,a.answered_count AS answered,a.correct_count AS correct FROM exam_attempts a JOIN exam_attempt_questions q ON q.attempt_id=a.id WHERE a.id=$1", [attempt],
    )).rows[0];
    expect(result).toEqual({ answer: null, answered: 0, correct: 0 });
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await cleanupAttemptFixture(client, f); await blocker.end(); await client.end(); }
});
