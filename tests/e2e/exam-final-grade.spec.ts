import { createHash, randomInt } from "node:crypto";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import type pg from "pg";

import { participantAttemptBucket } from "../../src/lib/participant-login-validation.mjs";
import { encryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { hashParticipantPassword } from "../../src/lib/password.mjs";
import { cleanupAttemptFixture, openStart, seedAttemptFixture, seedAttemptToken, startWithToken, type AttemptFixture } from "./exam-attempt-helpers";
import { loginAsAdmin } from "./helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });
const baseURL = "http://127.0.0.1:3100";

type Kind = "regular" | "makeup" | "remedial";
async function addRun(client: pg.Client, f: AttemptFixture, kind: Kind, label: string) {
  if (kind === "regular") {
    await client.query("INSERT INTO exam_session_plans(period_id,updated_by) SELECT $1,id FROM admin_users WHERE username=$2 ON CONFLICT DO NOTHING", [f.login.periodA, process.env.TEST_ADMIN_USERNAME]);
    await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,30) ON CONFLICT DO NOTHING", [f.login.periodA]);
  }
  const run = (await client.query<{ id: string }>(
    `INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,session_number,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
     SELECT exam_test_id,period_id,$2,$3,CASE WHEN $2='regular' THEN 1 ELSE NULL END,starts_at,time_zone,duration_minutes,created_by,published_at,published_by
     FROM exam_schedule_runs WHERE id=$1 RETURNING id::text AS id`, [f.runId, kind, label],
  )).rows[0].id;
  await client.query(`INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
    SELECT id,exam_test_id,period_id,kind,$2,$3 FROM exam_schedule_runs WHERE id=$1`, [run, f.login.studentA, f.login.placementA]);
  return run;
}
async function finish(page: Page, correct: boolean) {
  if (correct) {
    await page.locator('input[type="radio"][value="D"]').check();
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Kumpulkan tes" }).click();
  await page.getByRole("button", { name: "Ya, kumpulkan" }).click();
  await expect(page.getByText("PENGERJAAN SELESAI")).toBeVisible();
}
function finalRow(page: Page, f: AttemptFixture) { return page.getByTestId("final-grade-row").filter({ hasText: f.login.studentAName }); }
function attemptRow(page: Page, f: AttemptFixture, label: string, number: number) {
  return page.getByRole("row").filter({ hasText: f.login.studentAName }).filter({ hasText: label }).filter({ hasText: `Pengerjaan ke-${number}` });
}
async function grant(admin: Page, f: AttemptFixture, label: string, number: number) {
  const row = attemptRow(admin, f, label, number);
  await row.getByRole("button", { name: /Berikan izin ulang/ }).click();
  const dialog = admin.getByRole("dialog", { name: "Berikan izin mengulang?" });
  await dialog.getByRole("button", { name: "Ya, berikan izin" }).click();
  await expect(dialog).toBeHidden(); await expect(row).toContainText("Izin tersedia");
}
async function changeMethod(admin: Page, f: AttemptFixture) {
  await admin.getByRole("button", { name: `Ubah metode nilai akhir ${f.login.activeName}` }).click();
  const dialog = admin.getByRole("dialog", { name: "Ubah metode nilai akhir?" });
  await expect(dialog).toContainText("dihitung ulang");
  await dialog.getByRole("button", { name: "Ya, ubah metode" }).click(); await expect(dialog).toBeHidden();
}
async function reopen(admin: Page, f: AttemptFixture) {
  await finalRow(admin, f).getByRole("button", { name: /Buka kembali/ }).click();
  const dialog = admin.getByRole("dialog", { name: "Buka kembali nilai akhir?" });
  await expect(dialog).toContainText("tidak dipulihkan otomatis");
  await dialog.getByRole("button", { name: "Ya, buka kembali" }).click(); await expect(dialog).toBeHidden();
}
async function setVisibility(admin: Page, kind: "Reguler" | "Susulan" | "Remidi", visible: boolean) {
  const section = admin.getByRole("region", { name: `Pengaturan nilai ${kind}` });
  await section.getByRole("button", { name: visible ? "Tampilkan nilai" : "Sembunyikan nilai", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: visible ? "Tampilkan nilai peserta?" : "Sembunyikan nilai peserta?" });
  await dialog.getByRole("button", { name: visible ? "Ya, tampilkan" : "Ya, sembunyikan" }).click();
  await expect(section).toContainText(`Nilai peserta: ${visible ? "ditampilkan" : "disembunyikan"}`);
}
async function replay(request: Request, page: Page, origin = baseURL) {
  const headers = request.headers(); const body = request.postDataBuffer();
  if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Aksi tidak tertangkap.");
  return page.request.post(request.url(), { headers: { origin, "next-action": headers["next-action"], "content-type": headers["content-type"] }, data: body, failOnStatusCode: false, maxRedirects: 0 });
}
async function waitForBlocked(client: pg.Client, fragment: string, count = 1) {
  await expect.poll(async () => (await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
     AND state='active' AND wait_event_type='Lock' AND query LIKE $1`, [`%${fragment}%`],
  )).rows[0].n, { timeout: 12_000, intervals: [100, 200, 500] }).toBeGreaterThanOrEqual(count);
}

type Other = { student: string; placement: string; identity: string; username: string; password: string };
async function addOther(client: pg.Client, f: AttemptFixture): Promise<Other> {
  const password = "SANDIUJI", username = `u${f.login.suffix}`;
  const student = (await client.query<{ id: string }>("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id", [`Peserta lain ${f.login.suffix}`, String(randomInt(1_000_000_000)).padStart(10, "0")])).rows[0].id;
  const placement = (await client.query<{ id: string }>("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4) RETURNING id::text AS id", [student, f.login.periodA, f.login.classId, `X ${f.login.majorName}`])).rows[0].id;
  const identity = (await client.query<{ id: string }>("INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES($1,$2,$3,$4) RETURNING id::text AS id", [student, f.login.periodA, `LAIN-${f.login.suffix}`, username])).rows[0].id;
  const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
  try {
    const encrypted = encryptParticipantPassword(password, key, { identityId: identity, periodId: f.login.periodA });
    await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES($1,$2,$3,$4,$5)", [identity, await hashParticipantPassword(password), encrypted.nonce, encrypted.ciphertext, encrypted.authenticationTag]);
  } finally { key.fill(0); }
  return { student, placement, identity, username, password };
}
async function cleanupOther(client: pg.Client, other: Other, period: string) {
  await client.query("DELETE FROM participant_login_attempts WHERE bucket_hash=$1", [participantAttemptBucket(period, other.username.toLowerCase())]);
  await client.query("DELETE FROM participant_sessions WHERE participant_identity_id=$1", [other.identity]);
  await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=$1", [other.identity]);
  await client.query("DELETE FROM participant_identities WHERE id=$1", [other.identity]);
  await client.query("DELETE FROM student_class_placements WHERE id=$1", [other.placement]);
  await client.query("DELETE FROM school_students WHERE id=$1", [other.student]);
}

test("nilai lintas kategori, ulang, izin lama, visibilitas, perubahan metode dan pembukaan kembali", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=true,revision=revision+1 WHERE NOT visible_to_participants");
  const f = await seedAttemptFixture(client, 0);
  const savedWindow = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL }); const admin = await adminContext.newPage();
  const otherContext = await browser.newContext({ baseURL }); const otherPage = await otherContext.newPage();
  let other: Other | undefined;
  try {
    other = await addOther(client, f);
    const regular = await addRun(client, f, "regular", "Reguler nilai akhir");
    const remedial = await addRun(client, f, "remedial", "Remidi nilai akhir");
    const unused = await addRun(client, f, "remedial", "Remidi belum mulai");
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    await seedAttemptToken(client, f, "global", "987654");
    await loginParticipant(page, f.login.username, f.login.passwordA); await loginParticipant(otherPage, other.username, other.password);
    await loginAsAdmin(admin);
    const regId = await startWithToken(page, regular, "987654"); await finish(page, true);
    const makeupId = await startWithToken(page, f.runId, "987654"); await finish(page, false);
    await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await expect(finalRow(admin, f)).toContainText("Sementara");
    await expect(finalRow(admin, f)).toContainText("100,00");
    await grant(admin, f, "Jadwal fiktif", 1);
    await page.goto("/peserta");
    const schedule = page.getByRole("listitem").filter({ hasText: f.login.activeName }).filter({ hasText: "Jadwal fiktif" });
    await schedule.getByRole("button", { name: "Mulai ulang tes" }).click(); await page.getByLabel("Token tes").fill("987654");
    await page.getByRole("button", { name: "Mulai pengulangan" }).click(); await expect(page).toHaveURL(/\/peserta\/pengerjaan\/\d+/);
    const retakeId = page.url().match(/\/pengerjaan\/(\d+)/)![1]; await finish(page, true);
    await admin.reload(); await expect(finalRow(admin, f)).toContainText("3 selesai");
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    const staleFinalize = admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" });
    const remedialId = await startWithToken(page, remedial, "987654");
    await staleFinalize.getByRole("button", { name: "Ya, tetapkan nilai" }).click();
    await expect(staleFinalize.getByRole("alert")).toContainText("belum selesai");
    expect((await client.query("SELECT 1 FROM exam_final_grade_state WHERE exam_test_id=$1", [f.login.activeTest])).rowCount).toBe(0);
    await staleFinalize.getByRole("button", { name: "Muat ulang daftar" }).click(); await finish(page, false);
    await admin.reload(); await expect(finalRow(admin, f)).toContainText("4 selesai");
    await grant(admin, f, "Reguler nilai akhir", 1); await grant(admin, f, "Jadwal fiktif", 2);
    await changeMethod(admin, f); await expect(finalRow(admin, f)).toContainText("50,00");
    const historyBefore = (await client.query("SELECT id,run_id,kind,correct_count,question_count,completed_at FROM exam_attempts WHERE exam_test_id=$1 ORDER BY id", [f.login.activeTest])).rows;
    expect(historyBefore.map((row) => row.correct_count)).toEqual([1, 0, 1, 0]);
    await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    let scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" }); await expect(scores).toContainText("Pengerjaan ke-2"); await expect(scores).not.toContainText("Nilai akhir ·");
    await scores.getByRole("button", { name: "Tutup" }).click();
    // Siapkan formulir mulai dan izin sebelum penetapan, namun jalankan setelah pembukaan kembali.
    const staleStart = await page.context().newPage(); await openStart(staleStart, unused); await staleStart.getByLabel("Token tes").fill("987654");
    const staleAdmin = await adminContext.newPage(); await staleAdmin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await attemptRow(staleAdmin, f, "Remidi nilai akhir", 1).getByRole("button", { name: /Berikan izin ulang/ }).click();
    const staleGrant = staleAdmin.getByRole("dialog", { name: "Berikan izin mengulang?" });
    await admin.bringToFront();
    const capture = admin.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-tes/monitoring");
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    const confirm = admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" }); await expect(confirm).toContainText("2 saat daftar dimuat");
    await confirm.getByRole("button", { name: "Ya, tetapkan nilai" }).click(); const finalRequest = await capture;
    await expect(confirm).toBeHidden(); await expect(finalRow(admin, f)).toContainText("Ditetapkan");
    expect((await client.query<{ n: number }>("SELECT count(*)::int AS n FROM exam_retake_permissions WHERE run_id=ANY($1::bigint[]) AND revoked_at IS NOT NULL", [[regular, f.runId]])).rows[0].n).toBe(2);
    const audit = (await client.query<{ ids: string[]; hundredths: number; count: number; revoked: number }>(
      `SELECT recorded_attempt_ids::text[] AS ids,recorded_hundredths AS hundredths,recorded_attempt_count AS count,revoked_permissions AS revoked
       FROM exam_final_grade_operations WHERE exam_test_id=$1 AND action='finalize' AND result='applied'`, [f.login.activeTest],
    )).rows[0];
    expect(audit).toEqual({ ids: [regId, makeupId, retakeId, remedialId], hundredths: 5000, count: 4, revoked: 2 });
    const foreign = await replay(finalRequest, admin, "https://attacker.invalid"); expect(foreign.status()).toBeGreaterThanOrEqual(400);
    await replay(finalRequest, otherPage); // Sesi peserta bukan admin.
    await otherPage.goto("/peserta/nilai"); await expect(otherPage.getByText("Belum ada nilai yang dibagikan")).toBeVisible();
    expect(await otherPage.content()).not.toContain("50,00");
    await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" });
    const finalScore = scores.getByRole("listitem").filter({ hasText: "Nilai akhir · Rata-rata" });
    await expect(finalScore.getByTestId("score-value")).toHaveText("50,00"); await expect(finalScore.getByTestId("score-value")).toBeHidden();
    await finalScore.getByText("Perlihatkan nilai", { exact: true }).click(); await expect(finalScore.getByTestId("score-value")).toBeVisible();
    await scores.getByRole("button", { name: "Tutup" }).click();
    const plainContext = await browser.newContext({ baseURL, javaScriptEnabled: false, storageState: await page.context().storageState() });
    const plain = await plainContext.newPage(); await plain.goto("/peserta/nilai");
    const plainFinal = plain.getByRole("listitem").filter({ hasText: "Nilai akhir · Rata-rata" });
    await plainFinal.getByText("Perlihatkan nilai", { exact: true }).click(); await expect(plainFinal.getByTestId("score-value")).toHaveText("50,00");
    await admin.goto("/data-tes/pengaturan-pengerjaan"); await setVisibility(admin, "Susulan", false);
    await page.goto("/peserta"); const responsePromise = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/peserta");
    await page.getByRole("button", { name: "Nilai dibagikan" }).click(); const response = await responsePromise;
    scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" }); await expect(scores).not.toContainText("Nilai akhir ·");
    await expect(scores).toContainText("Reguler nilai akhir"); await expect(scores).not.toContainText("Jadwal fiktif");
    const body = await response.text(); expect(body).not.toContain("50,00"); expect(body).not.toContain("final:");
    for (const secret of ["correctCount", "questionCount", "correct_count", "correct_option"]) expect(body).not.toContain(secret);
    await plain.goto("/peserta/nilai"); expect(await plain.content()).not.toContain("50,00"); await expect(plain.getByText(/^Nilai akhir · (Rata-rata|Tertinggi)$/)).toHaveCount(0);
    await plainContext.close(); await setVisibility(admin, "Susulan", true);
    await admin.bringToFront(); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    // Dialog buka kembali yang dibuka sebelum perubahan metode harus ditolak.
    const staleReopenPage = await adminContext.newPage(); await staleReopenPage.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await finalRow(staleReopenPage, f).getByRole("button", { name: /Buka kembali/ }).click();
    const staleReopen = staleReopenPage.getByRole("dialog", { name: "Buka kembali nilai akhir?" });
    await admin.bringToFront(); await changeMethod(admin, f); await expect(finalRow(admin, f)).toContainText("100,00");
    await staleReopenPage.bringToFront();
    await staleReopen.getByRole("button", { name: "Ya, buka kembali" }).click(); await expect(staleReopen.getByRole("alert")).toContainText("Metode tes sudah berubah");
    await staleReopenPage.close();
    await page.bringToFront(); await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" }); await expect(scores.getByRole("listitem").filter({ hasText: "Nilai akhir · Tertinggi" }).getByTestId("score-value")).toHaveText("100,00");
    await scores.getByRole("button", { name: "Tutup" }).click();
    await admin.bringToFront(); await reopen(admin, f); await expect(finalRow(admin, f)).toContainText("Sementara");
    await replay(finalRequest, admin); // Operasi yang sudah diterapkan tidak menetapkan ulang setelah dibuka.
    expect((await client.query<{ final: boolean; rev: string }>("SELECT finalized_at IS NOT NULL AS final,revision::text AS rev FROM exam_final_grade_state WHERE exam_test_id=$1", [f.login.activeTest])).rows[0]).toEqual({ final: false, rev: "2" });
    await staleAdmin.bringToFront();
    await staleGrant.getByRole("button", { name: "Ya, berikan izin" }).click(); await expect(staleGrant.getByRole("alert")).toContainText("Status nilai akhir sudah berubah");
    await staleAdmin.close();
    await staleStart.bringToFront();
    await staleStart.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(staleStart.getByRole("alert")).toContainText("Status kesempatan tes sudah berubah");
    expect((await client.query("SELECT id FROM exam_attempts WHERE run_id=$1", [unused])).rowCount).toBe(0);
    await page.bringToFront(); await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" }); await expect(scores).not.toContainText("Nilai akhir ·"); await expect(scores).toContainText("Pengerjaan ke-2");
    expect((await client.query("SELECT id,run_id,kind,correct_count,question_count,completed_at FROM exam_attempts WHERE exam_test_id=$1 ORDER BY id", [f.login.activeTest])).rows).toEqual(historyBefore);
    await staleStart.bringToFront(); await startWithToken(staleStart, unused, "987654");
    await admin.bringToFront(); await admin.reload(); await grant(admin, f, "Remidi nilai akhir", 1);
    expect((await client.query<{ n: number }>("SELECT count(*)::int AS n FROM exam_retake_permissions WHERE run_id=$1 AND revoked_at IS NULL AND consumed_at IS NULL", [remedial])).rows[0].n).toBe(1);
  } finally {
    await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=true,revision=revision+1 WHERE NOT visible_to_participants");
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [savedWindow]);
    await adminContext.close().catch(() => {}); await otherContext.close().catch(() => {});
    if (other) await cleanupOther(client, other, f.login.periodA);
    await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("mulai pelaksanaan lain yang menang membuat penetapan ditolak", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  const saved = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL }); const admin = await adminContext.newPage();
  try {
    const nextRun = await addRun(client, f, "remedial", "Remidi bersamaan");
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    await seedAttemptToken(client, f, "global", "122334"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await startWithToken(page, f.runId, "122334"); await finish(page, true);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    const dialog = admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" });
    await openStart(page, nextRun); await page.getByLabel("Token tes").fill("122334");
    // Mulai mengambil kunci pasangan sebelum kunci per pelaksanaan ini.
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:start:' || $1::text || ':' || $2::text, 0))", [nextRun, f.login.identityA]);
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await waitForBlocked(client, "nusacbt:start:");
    await dialog.getByRole("button", { name: "Ya, tetapkan nilai" }).click(); await waitForBlocked(client, "nusacbt:final-grade:");
    await blocker.query("COMMIT");
    await expect(page).toHaveURL(/\/peserta\/pengerjaan\/\d+/);
    await expect(dialog.getByRole("alert")).toContainText("belum selesai");
    expect((await client.query("SELECT 1 FROM exam_final_grade_state WHERE exam_test_id=$1", [f.login.activeTest])).rowCount).toBe(0);
    expect((await client.query<{ active: number; finished: number }>(`SELECT count(*) FILTER (WHERE completed_at IS NULL)::int AS active,
      count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS finished FROM exam_attempts WHERE exam_test_id=$1`, [f.login.activeTest])).rows[0]).toEqual({ active: 1, finished: 1 });
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [saved]);
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});

test("penetapan menang atas mulai pertama, izin baru dan penetapan ganda", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  const saved = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL }); const admin = await adminContext.newPage();
  try {
    const nextRun = await addRun(client, f, "remedial", "Remidi bersamaan");
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    await seedAttemptToken(client, f, "global", "344556"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await startWithToken(page, f.runId, "344556"); await finish(page, true);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    const duplicate = await adminContext.newPage(); await duplicate.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    const grantPage = await adminContext.newPage(); await grantPage.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    const dialog = admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" });
    await finalRow(duplicate, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    const duplicateDialog = duplicate.getByRole("dialog", { name: "Tetapkan nilai akhir?" });
    await attemptRow(grantPage, f, "Jadwal fiktif", 1).getByRole("button", { name: /Berikan izin ulang/ }).click();
    const grantDialog = grantPage.getByRole("dialog", { name: "Berikan izin mengulang?" });
    await openStart(page, nextRun); await page.getByLabel("Token tes").fill("344556");
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:final-grade:' || $1::text || ':' || $2::text, 0))", [f.login.activeTest, f.login.identityA]);
    await dialog.getByRole("button", { name: "Ya, tetapkan nilai" }).click(); await waitForBlocked(client, "nusacbt:final-grade:", 1);
    await duplicateDialog.getByRole("button", { name: "Ya, tetapkan nilai" }).click(); await waitForBlocked(client, "nusacbt:final-grade:", 2);
    await grantDialog.getByRole("button", { name: "Ya, berikan izin" }).click(); await waitForBlocked(client, "nusacbt:final-grade:", 3);
    await page.getByRole("button", { name: "Mulai pengerjaan" }).click(); await waitForBlocked(client, "nusacbt:final-grade:", 4);
    await blocker.query("COMMIT");
    await admin.bringToFront();
    await expect(dialog).toBeHidden();
    await duplicate.bringToFront(); await expect(duplicateDialog.getByRole("alert")).toContainText("Status nilai akhir sudah berubah");
    await grantPage.bringToFront(); await expect(grantDialog.getByRole("alert")).toContainText("Nilai akhir sudah ditetapkan");
    await page.bringToFront(); await expect(page.getByRole("alert")).toContainText("Nilai akhir tes ini sudah ditetapkan");
    expect((await client.query("SELECT id FROM exam_attempts WHERE run_id=$1", [nextRun])).rowCount).toBe(0);
    expect((await client.query("SELECT id FROM exam_retake_permissions WHERE run_id=$1 AND revoked_at IS NULL AND consumed_at IS NULL", [f.runId])).rowCount).toBe(0);
    expect((await client.query<{ count: number }>("SELECT count(*)::int AS count FROM exam_final_grade_operations WHERE exam_test_id=$1 AND action='finalize' AND result='applied'", [f.login.activeTest])).rows[0].count).toBe(1);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [saved]);
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});

test("respons hilang dipulihkan pada tab yang sama dan request terlambat dipagari", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  const saved = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL }); const admin = await adminContext.newPage();
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    await seedAttemptToken(client, f, "global", "556677"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await startWithToken(page, f.runId, "556677"); await finish(page, true);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    let captured: Request | undefined;
    let sendFirst = false;
    const handler = async (route: Route) => {
      const request = route.request();
      if (request.method() === "POST" && new URL(request.url()).pathname === "/data-tes/monitoring") {
        captured = request; if (sendFirst) await route.fetch(); await route.abort("failed");
      } else await route.continue();
    };
    await admin.route("**/*", handler);
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    await admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" }).getByRole("button", { name: "Ya, tetapkan nilai" }).click();
    let recovery = admin.getByRole("dialog", { name: "Hasil tindakan nilai akhir belum pasti" }); await expect(recovery).toBeVisible();
    await admin.unroute("**/*", handler); if (!captured) throw new Error("Request penetapan tidak tertangkap."); const late = captured;
    // Respons pemeriksaan juga hilang setelah commit; identitas tetap tersimpan.
    let resolver: Request | undefined;
    const lostResolver = async (route: Route) => {
      if (route.request().method() === "POST") { resolver = route.request(); await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    };
    await admin.route("**/*", lostResolver); await recovery.getByRole("button", { name: "Periksa dan amankan" }).click();
    await expect(recovery.getByRole("alert")).toContainText("Belum dapat mengamankan"); await admin.unroute("**/*", lostResolver);
    if (!resolver) throw new Error("Resolver tidak tertangkap.");
    expect((await client.query<{ result: string }>("SELECT result FROM exam_final_grade_operations WHERE exam_test_id=$1 AND action='finalize'", [f.login.activeTest])).rows).toEqual([{ result: "cancelled" }]);
    await admin.reload(); recovery = admin.getByRole("dialog", { name: "Hasil tindakan nilai akhir belum pasti" }); await expect(recovery).toBeVisible();
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Permintaan diamankan");
    await replay(resolver, admin); await replay(late, admin);
    expect((await client.query("SELECT 1 FROM exam_final_grade_state WHERE exam_test_id=$1", [f.login.activeTest])).rowCount).toBe(0);
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click();
    captured = undefined; sendFirst = true; await admin.route("**/*", handler);
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    await admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" }).getByRole("button", { name: "Ya, tetapkan nilai" }).click();
    recovery = admin.getByRole("dialog", { name: "Hasil tindakan nilai akhir belum pasti" }); await expect(recovery).toBeVisible();
    await admin.unroute("**/*", handler); if (!captured) throw new Error("Request penetapan kedua tidak tertangkap."); const applied = captured;
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Tindakan sempat berhasil");
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click();
    await expect(finalRow(admin, f)).toContainText("Ditetapkan"); await reopen(admin, f);
    await replay(applied, admin); await replay(late, admin);
    const state = (await client.query<{ final: boolean; revision: string }>("SELECT finalized_at IS NOT NULL AS final,revision::text AS revision FROM exam_final_grade_state WHERE exam_test_id=$1", [f.login.activeTest])).rows[0];
    expect(state).toEqual({ final: false, revision: "2" });
    expect(await admin.evaluate(() => sessionStorage.getItem("nusacbt.final-grade.pending.v1"))).toBeNull();
  } finally {
    await adminContext.close().catch(() => {}); await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [saved]);
    await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("nilai akhir rata-rata dibulatkan setelah agregasi, bukan dari tampilan per pengerjaan", async ({ page, browser }) => {
  test.setTimeout(100_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=true,revision=revision+1 WHERE NOT visible_to_participants");
  const f = await seedAttemptFixture(client, 5);
  const saved = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL }); const admin = await adminContext.newPage();
  try {
    const remedial = await addRun(client, f, "remedial", "Remidi pecahan");
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    await seedAttemptToken(client, f, "global", "667788"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const first = await startWithToken(page, f.runId, "667788");
    const correct = (await client.query<{ answer: string }>(`SELECT s.correct_option AS answer FROM exam_attempt_questions q
      JOIN exam_question_snapshots s ON s.id=q.snapshot_id WHERE q.attempt_id=$1 AND q.position=1`, [first])).rows[0].answer;
    await page.locator(`input[type="radio"][value="${correct}"]`).check(); await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    await finish(page, false); await startWithToken(page, remedial, "667788"); await finish(page, false);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await expect(finalRow(admin, f)).toContainText("16,67"); await changeMethod(admin, f);
    // (100/6 + 0)/2 = 8,333... -> 8,33; 16,67/2 akan memberi 8,335.
    await expect(finalRow(admin, f)).toContainText("8,33");
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    const dialog = admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" }); await dialog.getByRole("button", { name: "Ya, tetapkan nilai" }).click();
    await expect(dialog).toBeHidden(); await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    const scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" });
    await expect(scores.getByRole("listitem").filter({ hasText: "Nilai akhir · Rata-rata" }).getByTestId("score-value")).toHaveText("8,33");
    // Reguler tidak menyumbang: menutupnya tidak boleh menyembunyikan agregat.
    await admin.goto("/data-tes/pengaturan-pengerjaan"); await setVisibility(admin, "Reguler", false);
    await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    await expect(page.getByRole("dialog", { name: "Nilai yang dibagikan" }).getByRole("listitem").filter({ hasText: "Nilai akhir · Rata-rata" }).getByTestId("score-value")).toHaveText("8,33");
  } finally {
    await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=true,revision=revision+1 WHERE NOT visible_to_participants");
    await adminContext.close().catch(() => {}); await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [saved]);
    await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("sesi admin yang habis saat menunggu tidak menetapkan atau menerima nilai", async ({ page, browser }) => {
  test.setTimeout(100_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  const saved = (await client.query<{ n: number }>("SELECT submission_window_minutes AS n FROM exam_work_settings WHERE id=1")).rows[0].n;
  const adminContext = await browser.newContext({ baseURL }); const admin = await adminContext.newPage();
  async function expireSoon() {
    const token = (await adminContext.cookies()).find((item) => item.name === "nusacbt_admin_session")?.value;
    if (!token) throw new Error("Sesi admin fixture tidak ditemukan.");
    const digest = createHash("sha256").update(token).digest("hex");
    expect((await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '6 seconds' WHERE token_hash=$1", [digest])).rowCount).toBe(1);
    return digest;
  }
  async function waitUntilExpired(digest: string) {
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0]?.expired, { timeout: 15_000 }).toBe(true);
  }
  try {
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=10080 WHERE id=1");
    await seedAttemptToken(client, f, "global", "778899"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await startWithToken(page, f.runId, "778899"); await finish(page, true);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    const dialog = admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" });
    const firstSession = await expireSoon();
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:final-grade:' || $1::text || ':' || $2::text, 0))", [f.login.activeTest, f.login.identityA]);
    await dialog.getByRole("button", { name: "Ya, tetapkan nilai" }).click();
    await waitForBlocked(client, "nusacbt:final-grade:"); await waitUntilExpired(firstSession);
    await blocker.query("COMMIT");
    await expect(dialog.getByRole("alert")).toContainText("Sesi admin berakhir");
    expect((await client.query("SELECT 1 FROM exam_final_grade_state WHERE exam_test_id=$1", [f.login.activeTest])).rowCount).toBe(0);
    expect((await client.query<{ result: string }>("SELECT result FROM exam_final_grade_operations WHERE exam_test_id=$1 AND action='finalize'", [f.login.activeTest])).rows).toEqual([{ result: "cancelled" }]);

    // Kunci tabel memaksa halaman monitoring menunggu setelah autentikasi awal;
    // nama dan nilai tidak boleh dikirim jika sesi habis sebelum respons siap.
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await expect(finalRow(admin, f)).toContainText("100,00");
    const secondSession = await expireSoon();
    await blocker.query("BEGIN"); await blocker.query("LOCK TABLE exam_final_grade_settings IN ACCESS EXCLUSIVE MODE");
    const responsePromise = admin.request.get(`/data-tes/monitoring?tes=${f.login.activeTest}`, { maxRedirects: 0, failOnStatusCode: false, timeout: 30_000 });
    await waitForBlocked(client, "exam_final_grade_settings"); await waitUntilExpired(secondSession);
    await blocker.query("COMMIT");
    const response = await responsePromise; const body = await response.text();
    expect(body).not.toContain(f.login.studentAName); expect(body).not.toContain("100,00");
    expect((response.status() >= 300 && response.status() < 400) || body.includes("/login")).toBe(true);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await client.query("UPDATE exam_work_settings SET submission_window_minutes=$1 WHERE id=1", [saved]);
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});

test("worker menyelesaikan pengerjaan lewat batas sebelum nilai akhir dapat ditetapkan", async ({ page, browser }) => {
  test.setTimeout(80_000);
  const client = loginTestDatabase(), blocker = loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);
  const adminContext = await browser.newContext({ baseURL }); const admin = await adminContext.newPage();
  try {
    await seedAttemptToken(client, f, "global", "889900"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const attemptId = await startWithToken(page, f.runId, "889900");
    await page.locator('input[type="radio"][value="D"]').check(); await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    // Baris dikunci melewati deadline; worker memakai SKIP LOCKED dan tidak
    // boleh membuat hasil parsial. Tidak ada kunjungan peserta setelah ini.
    await client.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '4 seconds' WHERE id=$1", [attemptId]);
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM exam_attempts WHERE id=$1 FOR UPDATE", [attemptId]);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT deadline<=clock_timestamp() AS expired FROM exam_attempts WHERE id=$1", [attemptId])).rows[0].expired, { timeout: 10_000 }).toBe(true);
    await loginAsAdmin(admin); await admin.goto(`/data-tes/monitoring?tes=${f.login.activeTest}`);
    await expect(finalRow(admin, f)).toContainText("1 belum selesai");
    await expect(finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ })).toBeDisabled();
    await expect(attemptRow(admin, f, "Jadwal fiktif", 1)).toContainText("Menunggu penyelesaian");
    await blocker.query("COMMIT");
    await expect.poll(async () => (await client.query<{ reason: string | null }>("SELECT completion_reason AS reason FROM exam_attempts WHERE id=$1", [attemptId])).rows[0].reason, { timeout: 12_000, intervals: [100, 250, 500] }).toBe("time_expired");
    await admin.reload(); await expect(finalRow(admin, f)).toContainText("100,00");
    await finalRow(admin, f).getByRole("button", { name: /Tetapkan nilai akhir/ }).click();
    const dialog = admin.getByRole("dialog", { name: "Tetapkan nilai akhir?" });
    await dialog.getByRole("button", { name: "Ya, tetapkan nilai" }).click(); await expect(dialog).toBeHidden();
    expect((await client.query<{ ids: string[]; grade: number }>("SELECT recorded_attempt_ids::text[] AS ids,recorded_hundredths AS grade FROM exam_final_grade_operations WHERE exam_test_id=$1 AND action='finalize' AND result='applied'", [f.login.activeTest])).rows).toEqual([{ ids: [attemptId], grade: 10000 }]);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await adminContext.close().catch(() => {});
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});
