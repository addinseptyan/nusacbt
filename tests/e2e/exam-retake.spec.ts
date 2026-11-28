import { createHash, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page, type Request, type Route } from "@playwright/test";

import { cleanupAttemptFixture, openStart, seedAttemptFixture, seedAttemptToken, type AttemptFixture } from "./exam-attempt-helpers";
import { loginAsAdmin } from "./helpers";
import { activateLoginPeriod, deactivateLoginPeriod, loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

function rowFor(page: Page, f: AttemptFixture, number: number) {
  return page.getByRole("row").filter({ hasText: f.login.studentAName }).filter({ hasText: `Pengerjaan ke-${number}` });
}
async function finish(page: Page) {
  await page.getByRole("button", { name: "Kumpulkan tes" }).click();
  await page.getByRole("button", { name: "Ya, kumpulkan" }).click();
  await expect(page.getByText("PENGERJAAN SELESAI")).toBeVisible();
}
async function grant(page: Page, f: AttemptFixture, number: number) {
  const row = rowFor(page, f, number);
  await row.getByRole("button", { name: /Berikan izin ulang/ }).click();
  const dialog = page.getByRole("dialog", { name: "Berikan izin mengulang?" });
  await expect(dialog).toContainText(f.login.studentAName);
  await expect(dialog).toContainText("batas akhir tidak diperpanjang");
  await dialog.getByRole("button", { name: "Ya, berikan izin" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText("Izin tersedia");
}
async function revoke(page: Page, f: AttemptFixture, number: number) {
  const row = rowFor(page, f, number);
  await row.getByRole("button", { name: /Cabut izin ulang/ }).click();
  const dialog = page.getByRole("dialog", { name: "Cabut izin mengulang?" });
  await dialog.getByRole("button", { name: "Ya, cabut izin" }).click();
  await expect(dialog).toBeHidden(); await expect(row).toContainText("Izin dicabut");
}
async function replay(request: Request, context: APIRequestContext, origin?: string, replacement?: { from: string; to: string }) {
  const headers = request.headers(); let body = request.postDataBuffer();
  if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Permintaan aksi tidak dapat diperiksa.");
  if (replacement) {
    const original = body.toString("utf8");
    const pattern = new RegExp(`(name="[^"\\r\\n]*attemptId"\\r\\n\\r\\n)${replacement.from}(\\r\\n)`);
    if (!pattern.test(original)) throw new Error("Identitas attempt pada permintaan tidak ditemukan.");
    const patchedAttempt = original.replace(pattern, (_match, prefix: string, suffix: string) => `${prefix}${replacement.to}${suffix}`);
    const operationPattern = /(name="[^"\r\n]*operationId"\r\n\r\n)[0-9a-f-]{36}(\r\n)/i;
    if (!operationPattern.test(patchedAttempt)) throw new Error("Identitas operasi pada permintaan tidak ditemukan.");
    body = Buffer.from(patchedAttempt.replace(operationPattern, (_match, prefix: string, suffix: string) => `${prefix}${randomUUID()}${suffix}`));
  }
  return context.post(request.url(), { headers: { origin: origin ?? new URL(request.url()).origin,
    "next-action": headers["next-action"], "content-type": headers["content-type"] }, data: body, failOnStatusCode: false, maxRedirects: 0 });
}
async function waitForBlocked(client: ReturnType<typeof loginTestDatabase>, fragment: string) {
  await expect.poll(async () => (await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
     AND state='active' AND wait_event_type='Lock' AND query LIKE $1`, [`%${fragment}%`],
  )).rows[0].n, { timeout: 12_000, intervals: [100, 200, 500] }).toBeGreaterThan(0);
}

test("izin sekali pakai, riwayat, token, pencabutan, tab ganda dan formulir tanpa JavaScript", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  const savedWindow = (await client.query<{ minutes: number }>("SELECT submission_window_minutes AS minutes FROM exam_work_settings WHERE id=1")).rows[0].minutes;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  let plainContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    await seedAttemptToken(client, f, "global", "246810");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId);
    await page.getByLabel("Token tes").fill("246810");
    const firstStartRequest = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === `/peserta/jadwal/${f.runId}`);
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); const initialRequest = await firstStartRequest;
    await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
    const firstId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1];
    await page.locator('input[type="radio"][value="D"]').check(); await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await expect(rowFor(admin, f, 1)).toContainText("Mengerjakan");
    await expect(rowFor(admin, f, 1).getByRole("button", { name: /Berikan izin ulang/ })).toHaveCount(0);
    await page.bringToFront(); await finish(page);
    const firstBefore = (await client.query<{ deadline: string; answer: string; snapshot: string; ordering: string; correct: number }>(
      `SELECT a.deadline::text AS deadline,q.answer,q.snapshot_id::text AS snapshot,q.option_order AS ordering,a.correct_count AS correct
       FROM exam_attempts a JOIN exam_attempt_questions q ON q.attempt_id=a.id WHERE a.id=$1`, [firstId],
    )).rows[0];
    expect(firstBefore.correct).toBe(1); expect(firstBefore.answer).toBe("D");
    // Mengubah bank tidak mengubah konten/kunci snapshot pada pengulangan.
    await client.query("UPDATE question_bank SET prompt_text=$2,correct_option='A',updated_at=clock_timestamp() WHERE id=$1", [f.login.questionId, `BANK DIUBAH ${f.login.suffix}`]);
    await admin.bringToFront(); await admin.reload();
    const grantRequestPromise = admin.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/data-tes/monitoring");
    await grant(admin, f, 1); const firstGrantRequest = await grantRequestPromise;
    let permissions = (await client.query<{ id: string; revoked: boolean; used: boolean }>(
      `SELECT id::text AS id,revoked_at IS NOT NULL AS revoked,consumed_at IS NOT NULL AS used FROM exam_retake_permissions WHERE previous_attempt_id=$1 ORDER BY id`, [firstId],
    )).rows;
    expect(permissions).toHaveLength(1); expect(permissions[0]).toMatchObject({ revoked: false, used: false });
    await page.bringToFront(); await page.goto("/peserta");
    let schedule = page.getByRole("listitem").filter({ hasText: f.login.activeName });
    await expect(schedule).toContainText("Izin mengulang tersedia");
    await schedule.getByRole("button", { name: "Mulai ulang tes" }).click();
    await expect(page.getByRole("dialog", { name: "Masukkan token ujian" })).toContainText("satu kali");
    await page.getByLabel("Token tes").fill("000000"); await page.getByRole("button", { name: "Mulai pengulangan" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Token tidak cocok" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(1);
    await admin.bringToFront(); await revoke(admin, f, 1);
    await page.bringToFront(); await page.getByLabel("Token tes").fill("246810"); await page.getByRole("button", { name: "Mulai pengulangan" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Izin mengulang tidak tersedia" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(1);
    // Form grant lama tidak dapat membuat izin lagi setelah pencabutan.
    await replay(firstGrantRequest, admin.request);
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(1);
    await admin.bringToFront(); await admin.reload(); await grant(admin, f, 1);
    permissions = (await client.query<{ id: string; revoked: boolean; used: boolean }>(
      `SELECT id::text AS id,revoked_at IS NOT NULL AS revoked,consumed_at IS NOT NULL AS used FROM exam_retake_permissions WHERE previous_attempt_id=$1 ORDER BY id`, [firstId],
    )).rows;
    expect(permissions).toHaveLength(2); expect(permissions[0].revoked).toBe(true); expect(permissions[1].used).toBe(false);
    // Origin asing dan sesi non-admin tidak dapat menerbitkan izin.
    const foreign = await replay(firstGrantRequest, admin.request, "https://attacker.invalid"); expect(foreign.status()).toBeGreaterThanOrEqual(400);
    await replay(firstGrantRequest, page.request);
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(2);

    await page.bringToFront(); await page.goto("/peserta"); const secondTab = await page.context().newPage(); await secondTab.goto("/peserta");
    schedule = page.getByRole("listitem").filter({ hasText: f.login.activeName });
    const secondSchedule = secondTab.getByRole("listitem").filter({ hasText: f.login.activeName });
    await Promise.all([schedule.getByRole("button", { name: "Mulai ulang tes" }).click(), secondSchedule.getByRole("button", { name: "Mulai ulang tes" }).click()]);
    await Promise.all([page.getByLabel("Token tes").fill("246810"), secondTab.getByLabel("Token tes").fill("246810")]);
    const retakeRequestPromise = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/peserta");
    await Promise.all([page.getByRole("button", { name: "Mulai pengulangan" }).click(), secondTab.getByRole("button", { name: "Mulai pengulangan" }).click()]);
    const retakeRequest = await retakeRequestPromise;
    await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/); await expect(secondTab).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
    expect(new URL(secondTab.url()).pathname).toBe(new URL(page.url()).pathname);
    const secondId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; expect(secondId).not.toBe(firstId);
    const attempts = (await client.query<{ id: string; deadline: string; answer: string | null; snapshot: string; ordering: string; correct: number | null }>(
      `SELECT a.id::text AS id,a.deadline::text AS deadline,q.answer,q.snapshot_id::text AS snapshot,q.option_order AS ordering,a.correct_count AS correct
       FROM exam_attempts a JOIN exam_attempt_questions q ON q.attempt_id=a.id WHERE a.run_id=$1 ORDER BY a.id`, [f.runId],
    )).rows;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ id: firstId, ...firstBefore });
    expect(attempts[1]).toMatchObject({ id: secondId, deadline: firstBefore.deadline, answer: null, snapshot: firstBefore.snapshot, ordering: firstBefore.ordering, correct: null });
    await expect(page.getByText(f.login.questionSecret)).toBeVisible(); await expect(page.getByText(`BANK DIUBAH ${f.login.suffix}`)).toHaveCount(0);
    expect((await client.query<{ id: string }>("SELECT consumed_attempt_id::text AS id FROM exam_retake_permissions WHERE id=$1", [permissions[1].id])).rows[0].id).toBe(secondId);
    // Memalsukan form admin untuk attempt yang masih berjalan ditolak server.
    // UUID penolakan juga dipagari, bahkan jika request yang sama datang
    // kembali setelah attempt itu selesai.
    const forgedAttemptRequest = await replay(firstGrantRequest, admin.request, undefined, { from: firstId, to: secondId });
    expect(await forgedAttemptRequest.text()).toContain("pengerjaan terakhir yang sudah selesai");
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [secondId])).rowCount).toBe(0);
    const failedOperation = (await client.query<{ id: string; result: string }>("SELECT operation_id::text AS id,result FROM exam_retake_operations WHERE attempt_id=$1", [secondId])).rows[0];
    expect(failedOperation.result).toBe("cancelled");
    await page.bringToFront(); await page.locator('input[type="radio"][value="A"]').check();
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible(); await finish(page);
    const originalBody = firstGrantRequest.postDataBuffer()!.toString();
    const firstOperationId = originalBody.match(/name="[^"\r\n]*operationId"\r\n\r\n([0-9a-f-]{36})\r\n/i)![1];
    const delayedBody = originalBody.replace(firstOperationId, failedOperation.id).replace(new RegExp(`(name="[^"\\r\\n]*attemptId"\\r\\n\\r\\n)${firstId}(\\r\\n)`), (_match, prefix: string, suffix: string) => `${prefix}${secondId}${suffix}`);
    await admin.request.post(firstGrantRequest.url(), { headers: { "next-action": firstGrantRequest.headers()["next-action"], origin: new URL(firstGrantRequest.url()).origin, "content-type": firstGrantRequest.headers()["content-type"] }, data: Buffer.from(delayedBody) });
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [secondId])).rowCount).toBe(0);
    await page.goto("/peserta"); schedule = page.getByRole("listitem").filter({ hasText: f.login.activeName });
    await expect(schedule.getByRole("button", { name: "Mulai ulang tes" })).toHaveCount(0);
    await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    const scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" });
    await expect(scores).toContainText("Pengerjaan ke-1"); await expect(scores).toContainText("Pengerjaan ke-2");
    await expect(scores).toContainText("100,00"); await expect(scores).toContainText("0,00");
    await scores.getByRole("button", { name: "Tutup" }).click();
    await admin.bringToFront(); await admin.reload();
    await expect(rowFor(admin, f, 1)).toContainText("Izin digunakan"); await grant(admin, f, 2);
    const nextPermission = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_retake_permissions WHERE previous_attempt_id=$1 AND revoked_at IS NULL", [secondId])).rows[0].id;
    // Permintaan awal dan replay izin lama tidak boleh mengonsumsi izin baru.
    await replay(initialRequest, page.request); await replay(retakeRequest, page.request);
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(2);
    expect((await client.query<{ used: boolean }>("SELECT consumed_at IS NOT NULL AS used FROM exam_retake_permissions WHERE id=$1", [nextPermission])).rows[0].used).toBe(false);
    // Form cadangan tanpa JavaScript tetap meneruskan izin yang tepat.
    plainContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100", javaScriptEnabled: false, storageState: await page.context().storageState() });
    const plain = await plainContext.newPage(); await plain.goto("/peserta");
    await plain.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("link", { name: "Mulai ulang tanpa JavaScript" }).click();
    await expect(plain.getByText("Izin mengulang tersedia")).toBeVisible(); await plain.getByLabel("Token tes").fill("246810");
    await plain.getByRole("button", { name: "Mulai pengulangan" }).click(); await expect(plain).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
    const thirdId = plain.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; expect(thirdId).not.toBe(secondId);
    expect((await client.query<{ deadline: string }>("SELECT deadline::text AS deadline FROM exam_attempts WHERE id=$1", [thirdId])).rows[0].deadline).toBe(firstBefore.deadline);
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(3);
  } finally {
    await plainContext?.close().catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("permintaan mulai menang atas pencabutan yang bersamaan; tidak ada izin ganda", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1"); await seedAttemptToken(client, f, "global", "123890");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId); await page.getByLabel("Token tes").fill("123890");
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    const firstId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; await finish(page);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    const otherAdmin = await adminContext.newPage(); await otherAdmin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await Promise.all([rowFor(admin, f, 1).getByRole("button", { name: /Berikan izin ulang/ }).click(), rowFor(otherAdmin, f, 1).getByRole("button", { name: /Berikan izin ulang/ }).click()]);
    await Promise.all([admin.getByRole("dialog", { name: "Berikan izin mengulang?" }).getByRole("button", { name: "Ya, berikan izin" }).click(),
      otherAdmin.getByRole("dialog", { name: "Berikan izin mengulang?" }).getByRole("button", { name: "Ya, berikan izin" }).click()]);
    await expect.poll(async () => (await client.query("SELECT id FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(1);
    await expect.poll(async () => (await client.query("SELECT id FROM exam_retake_permissions WHERE previous_attempt_id=$1 AND revoked_at IS NULL", [firstId])).rowCount).toBe(1);
    // Kedua respons harus selesai sebelum reload, agar tab yang kalah tidak
    // sedang memulihkan request yang hasilnya belum diterima.
    await expect.poll(() => admin.evaluate(() => sessionStorage.getItem("nusacbt.retake.pending.v1"))).toBeNull();
    await expect.poll(() => otherAdmin.evaluate(() => sessionStorage.getItem("nusacbt.retake.pending.v1"))).toBeNull();
    await admin.reload(); const permission = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rows[0].id;
    await page.goto("/peserta"); await page.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("button", { name: "Mulai ulang tes" }).click();
    await page.getByLabel("Token tes").fill("123890");
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM exam_retake_permissions WHERE id=$1 FOR UPDATE", [permission]);
    await page.getByRole("button", { name: "Mulai pengulangan" }).click();
    await waitForBlocked(client, "FROM exam_retake_permissions");
    await rowFor(admin, f, 1).getByRole("button", { name: /Cabut izin ulang/ }).click();
    const dialog = admin.getByRole("dialog", { name: "Cabut izin mengulang?" }); await dialog.getByRole("button", { name: "Ya, cabut izin" }).click();
    // Mulai kini memegang kunci tes/identitas sebelum attempt dan izin.
    await waitForBlocked(client, "nusacbt:final-grade:");
    await blocker.query("COMMIT");
    await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/); const secondId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1];
    await expect(dialog.getByRole("alert")).toContainText("sudah dicabut atau digunakan");
    expect((await client.query<{ used: string; revoked: boolean }>(
      "SELECT consumed_attempt_id::text AS used,revoked_at IS NOT NULL AS revoked FROM exam_retake_permissions WHERE id=$1", [permission],
    )).rows[0]).toEqual({ used: secondId, revoked: false });
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(2);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});

test("batas waktu habis saat menunggu kunci: izin tidak terpakai dan attempt baru dibatalkan", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1"); await seedAttemptToken(client, f, "test", "223344");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId); await page.getByLabel("Token tes").fill("223344");
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    const firstId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; await finish(page);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`); await grant(admin, f, 1);
    await page.goto("/peserta"); await page.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("button", { name: "Mulai ulang tes" }).click();
    await page.getByLabel("Token tes").fill("223344");
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM exam_attempts WHERE id=$1 FOR UPDATE", [firstId]);
    await page.getByRole("button", { name: "Mulai pengulangan" }).click(); await waitForBlocked(client, "FROM exam_attempts");
    await blocker.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '2 seconds' WHERE id=$1", [firstId]);
    await expect.poll(async () => (await blocker.query<{ expired: boolean }>("SELECT deadline<=clock_timestamp() AS expired FROM exam_attempts WHERE id=$1", [firstId])).rows[0].expired,
      { timeout: 10_000, intervals: [100, 200, 500] }).toBe(true);
    await blocker.query("COMMIT");
    await expect(page.getByRole("alert").filter({ hasText: "Izin mengulang tidak tersedia" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(1);
    expect((await client.query<{ used: boolean }>("SELECT consumed_at IS NOT NULL AS used FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rows[0].used).toBe(false);
    await admin.reload(); await expect(rowFor(admin, f, 1)).toContainText("Izin kedaluwarsa");
    await expect(rowFor(admin, f, 1).getByRole("button", { name: /Berikan izin ulang/ })).toHaveCount(0);
    await page.goto("/peserta"); await expect(page.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("button", { name: "Mulai ulang tes" })).toHaveCount(0);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});


test("token dicabut setelah pemeriksaan awal: pengulangan dibatalkan tanpa memakai izin", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    const tokenId = await seedAttemptToken(client, f, "global", "445566");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId); await page.getByLabel("Token tes").fill("445566");
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    const firstId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; await finish(page);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`); await grant(admin, f, 1);
    const permissionId = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rows[0].id;
    await page.goto("/peserta"); await page.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("button", { name: "Mulai ulang tes" }).click();
    await page.getByLabel("Token tes").fill("445566");
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM exam_retake_permissions WHERE id=$1 FOR UPDATE", [permissionId]);
    await page.getByRole("button", { name: "Mulai pengulangan" }).click(); await waitForBlocked(client, "FROM exam_retake_permissions");
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(2026111903)");
      await client.query("UPDATE exam_access_tokens SET revoked_at=clock_timestamp(),revoked_reason='manual' WHERE id=$1", [tokenId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    await blocker.query("COMMIT");
    await expect(page.getByRole("alert").filter({ hasText: "Token berubah atau kedaluwarsa" })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(1);
    expect((await client.query<{ used: boolean }>("SELECT consumed_at IS NOT NULL AS used FROM exam_retake_permissions WHERE id=$1", [permissionId])).rows[0].used).toBe(false);
    await seedAttemptToken(client, f, "global", "667788");
    await page.getByLabel("Token tes").fill("667788"); await page.getByRole("button", { name: "Mulai pengulangan" }).click();
    await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(2);
    expect((await client.query<{ used: boolean }>("SELECT consumed_at IS NOT NULL AS used FROM exam_retake_permissions WHERE id=$1", [permissionId])).rows[0].used).toBe(true);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});

test("izin dan pengerjaan tidak dapat dipakai peserta atau periode lain", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1"); await seedAttemptToken(client, f, "global", "889900");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId); await page.getByLabel("Token tes").fill("889900");
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    const firstId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; await finish(page);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`); await grant(admin, f, 1);
    const permissionId = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rows[0].id;
    await page.goto("/peserta"); await page.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("button", { name: "Mulai ulang tes" }).click();
    await page.getByLabel("Token tes").fill("111111");
    const requestPromise = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/peserta");
    await page.getByRole("button", { name: "Mulai pengulangan" }).click(); const captured = await requestPromise;
    await expect(page.getByRole("alert").filter({ hasText: "Token tidak cocok" })).toBeVisible();
    await admin.bringToFront(); await activateLoginPeriod(admin, f.login.periodBName); await deactivateLoginPeriod(admin, f.login.periodAName);
    await page.bringToFront(); await loginParticipant(page, f.login.username, f.login.passwordB);
    await replay(captured, page.request);
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(1);
    expect((await client.query<{ used: boolean }>("SELECT consumed_at IS NOT NULL AS used FROM exam_retake_permissions WHERE id=$1", [permissionId])).rows[0].used).toBe(false);
    expect((await page.goto(`/peserta/jadwal/${f.runId}`))?.status()).toBe(404);
    expect((await page.goto(`/peserta/pengerjaan/${firstId}`))?.status()).toBe(404);
    expect(await page.content()).not.toContain(f.login.questionSecret);
  } finally {
    await adminContext.close().catch(() => {}); await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("hasil admin hilang: pagar membatalkan request terlambat atau melaporkan tindakan yang sudah commit", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1"); await seedAttemptToken(client, f, "global", "102938");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId); await page.getByLabel("Token tes").fill("102938");
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    const firstId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; await finish(page);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    const pattern = /\/data-tes\/monitoring(?:\?.*)?$/;
    async function loseResponse(action: "grant" | "revoke", sendFirst: boolean) {
      let intercepted = false;
      const handler = async (route: Route) => {
        if (!intercepted && route.request().method() === "POST") {
          intercepted = true; if (sendFirst) await route.fetch(); await route.abort("failed");
        } else await route.continue();
      };
      await admin.route(pattern, handler);
      await rowFor(admin, f, 1).getByRole("button", { name: action === "grant" ? /Berikan izin ulang/ : /Cabut izin ulang/ }).click();
      const confirm = admin.getByRole("dialog", { name: action === "grant" ? "Berikan izin mengulang?" : "Cabut izin mengulang?" });
      const requestPromise = admin.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/data-tes/monitoring");
      await confirm.getByRole("button", { name: action === "grant" ? "Ya, berikan izin" : "Ya, cabut izin" }).click();
      const captured = await requestPromise;
      await expect(admin.getByRole("dialog", { name: "Hasil tindakan izin belum pasti" })).toBeVisible();
      await admin.unroute(pattern, handler);
      return captured;
    }
    // Permintaan pertama tidak tiba di server; setelah pemulihan, replay lama dipagari.
    const late = await loseResponse("grant", false);
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(0);
    await admin.reload(); // Identitas permintaan dipertahankan di sesi tab.
    let recovery = admin.getByRole("dialog", { name: "Hasil tindakan izin belum pasti" }); await expect(recovery).toBeVisible();
    // Tangkap resolver tanpa mengirimnya, lalu buktikan peserta dan origin
    // asing tidak dapat membuat pagar atau membatalkan permintaan admin.
    const resolverHandler = async (route: Route) => { if (route.request().method() === "POST") await route.abort("failed"); else await route.continue(); };
    await admin.route(pattern, resolverHandler);
    const resolveRequestPromise = admin.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/data-tes/monitoring");
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click();
    const resolverRequest = await resolveRequestPromise; await expect(recovery.getByRole("alert")).toContainText("Belum dapat mengamankan");
    await admin.unroute(pattern, resolverHandler);
    await replay(resolverRequest, page.request);
    expect((await client.query("SELECT 1 FROM exam_retake_operations WHERE attempt_id=$1", [firstId])).rowCount).toBe(0);
    expect((await replay(resolverRequest, admin.request, "https://attacker.invalid")).status()).toBeGreaterThanOrEqual(400);
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Permintaan diamankan");
    await replay(resolverRequest, admin.request); // Resolver sendiri juga idempoten.
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click();
    await replay(late, admin.request);
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(0);
    expect((await client.query<{ result: string }>("SELECT result FROM exam_retake_operations WHERE attempt_id=$1", [firstId])).rows[0].result).toBe("cancelled");
    // Respons hilang setelah commit: pemulihan melaporkan izin yang benar, bukan membuat yang baru.
    await admin.reload(); const applied = await loseResponse("grant", true);
    recovery = admin.getByRole("dialog", { name: "Hasil tindakan izin belum pasti" });
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Tindakan sempat berhasil");
    await expect(recovery).toContainText("pemberian"); await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click();
    await replay(applied, admin.request);
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(1);
    await admin.reload(); await expect(rowFor(admin, f, 1)).toContainText("Izin tersedia");
    // Pencabutan yang belum masuk server dapat dipagari tanpa mencabut izin.
    const lateRevoke = await loseResponse("revoke", false);
    recovery = admin.getByRole("dialog", { name: "Hasil tindakan izin belum pasti" });
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Permintaan diamankan");
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click(); await replay(lateRevoke, admin.request);
    expect((await client.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL AS revoked FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rows[0].revoked).toBe(false);
    await admin.reload(); await expect(rowFor(admin, f, 1)).toContainText("Izin tersedia");
    // Pemulihan pencabutan juga melaporkan commit dan tidak menghidupkan izin.
    await loseResponse("revoke", true); recovery = admin.getByRole("dialog", { name: "Hasil tindakan izin belum pasti" });
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Tindakan sempat berhasil");
    await expect(recovery).toContainText("pencabutan"); await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click();
    await admin.reload(); await expect(rowFor(admin, f, 1)).toContainText("Izin dicabut");
    expect((await client.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL AS revoked FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rows[0].revoked).toBe(true);
  } finally {
    await adminContext.close().catch(() => {}); await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("pemulihan menunggu transaksi yang sudah memegang lock dan melaporkan satu izin", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1"); await seedAttemptToken(client, f, "global", "332211");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId); await page.getByLabel("Token tes").fill("332211");
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    const firstId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; await finish(page);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    const pattern = /\/data-tes\/monitoring(?:\?.*)?$/;
    const handler = async (route: Route) => { if (route.request().method() === "POST") await route.abort("failed"); else await route.continue(); };
    await admin.route(pattern, handler); await rowFor(admin, f, 1).getByRole("button", { name: /Berikan izin ulang/ }).click();
    const capturedPromise = admin.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/data-tes/monitoring");
    await admin.getByRole("dialog", { name: "Berikan izin mengulang?" }).getByRole("button", { name: "Ya, berikan izin" }).click();
    const captured = await capturedPromise; const recovery = admin.getByRole("dialog", { name: "Hasil tindakan izin belum pasti" }); await expect(recovery).toBeVisible();
    await admin.unroute(pattern, handler);
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM exam_attempts WHERE id=$1 FOR UPDATE", [firstId]);
    const inFlight = replay(captured, admin.request); await waitForBlocked(client, "FROM exam_attempts");
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await waitForBlocked(client, "nusacbt:retake-operation:");
    await blocker.query("COMMIT"); await inFlight; await expect(recovery).toContainText("Tindakan sempat berhasil");
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(1);
    expect((await client.query<{ result: string }>("SELECT result FROM exam_retake_operations WHERE attempt_id=$1", [firstId])).rows).toEqual([{ result: "applied" }]);
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click();
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});

test("sesi admin yang berakhir saat menunggu tidak dapat menerbitkan izin", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1"); await seedAttemptToken(client, f, "global", "998811");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId); await page.getByLabel("Token tes").fill("998811");
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    const firstId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1]; await finish(page);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await rowFor(admin, f, 1).getByRole("button", { name: /Berikan izin ulang/ }).click();
    const cookie = (await adminContext.cookies()).find((c) => c.name === "nusacbt_admin_session")!.value;
    const hash = createHash("sha256").update(cookie).digest("hex");
    expect((await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE token_hash=$1", [hash])).rowCount).toBe(1);
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM exam_attempts WHERE id=$1 FOR UPDATE", [firstId]);
    const capturedPromise = admin.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/data-tes/monitoring");
    const dialog = admin.getByRole("dialog", { name: "Berikan izin mengulang?" }); await dialog.getByRole("button", { name: "Ya, berikan izin" }).click();
    const captured = await capturedPromise; await waitForBlocked(client, "FROM exam_attempts");
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [hash])).rows[0].expired,
      { timeout: 12_000, intervals: [100, 200, 500] }).toBe(true);
    await blocker.query("COMMIT"); await expect(dialog.getByRole("alert")).toContainText("Sesi admin berakhir");
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(0);
    expect((await client.query<{ result: string }>("SELECT result FROM exam_retake_operations WHERE attempt_id=$1", [firstId])).rows).toEqual([{ result: "cancelled" }]);
    await loginAsAdmin(admin); await replay(captured, admin.request);
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(0);
    // Sesi berakhir sebelum request memperoleh lock: tab harus menyimpan
    // identitas dan hanya boleh memagari setelah admin masuk kembali.
    await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await rowFor(admin, f, 1).getByRole("button", { name: /Berikan izin ulang/ }).click();
    const currentCookie = (await adminContext.cookies()).find((c) => c.name === "nusacbt_admin_session")!.value;
    const currentHash = createHash("sha256").update(currentCookie).digest("hex");
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [currentHash]);
    const expiredPromise = admin.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/data-tes/monitoring");
    await admin.getByRole("dialog", { name: "Berikan izin mengulang?" }).getByRole("button", { name: "Ya, berikan izin" }).click();
    const expiredRequest = await expiredPromise; let recovery = admin.getByRole("dialog", { name: "Hasil tindakan izin belum pasti" }); await expect(recovery).toBeVisible();
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery.getByRole("alert")).toContainText("Sesi admin berakhir");
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    recovery = admin.getByRole("dialog", { name: "Hasil tindakan izin belum pasti" }); await expect(recovery).toBeVisible();
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Permintaan diamankan");
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click(); await replay(expiredRequest, admin.request);
    expect((await client.query("SELECT 1 FROM exam_retake_permissions WHERE previous_attempt_id=$1", [firstId])).rowCount).toBe(0);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});

test("batas pengumpulan global tetap berlaku sebelum dan setelah pengulangan", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=5 WHERE id=1"); await seedAttemptToken(client, f, "global", "331199");
    await loginParticipant(page, f.login.username, f.login.passwordA); await openStart(page, f.runId); await page.getByLabel("Token tes").fill("331199");
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    await page.getByRole("button", { name: "Kumpulkan tes" }).click();
    let dialog = page.getByRole("dialog", { name: "Belum dapat dikumpulkan" }); await expect(dialog).toContainText("5 menit terakhir");
    await dialog.getByRole("button", { name: "Tutup" }).click();
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await expect(rowFor(admin, f, 1).getByRole("button", { name: /Berikan izin ulang/ })).toHaveCount(0);
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    await finish(page); await admin.reload(); await grant(admin, f, 1);
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=5 WHERE id=1");
    await page.goto("/peserta"); await page.getByRole("listitem").filter({ hasText: f.login.activeName }).getByRole("button", { name: "Mulai ulang tes" }).click();
    await page.getByLabel("Token tes").fill("331199"); await page.getByRole("button", { name: "Mulai pengulangan" }).click(); await expect(page).toHaveURL(/\/pengerjaan\/[1-9]\d*/);
    const secondId = page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1];
    await page.getByRole("button", { name: "Kumpulkan tes" }).click();
    dialog = page.getByRole("dialog", { name: "Belum dapat dikumpulkan" }); await expect(dialog).toContainText("5 menit terakhir");
    expect((await client.query<{ completed: boolean }>("SELECT completed_at IS NOT NULL AS completed FROM exam_attempts WHERE id=$1", [secondId])).rows[0].completed).toBe(false);
    await admin.reload(); await expect(rowFor(admin, f, 2).getByRole("button", { name: /Berikan izin ulang/ })).toHaveCount(0);
  } finally {
    await adminContext.close().catch(() => {}); await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await cleanupAttemptFixture(client, f); await client.end();
  }
});
