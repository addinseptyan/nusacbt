import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type pg from "pg";

import { participantAttemptBucket } from "../../src/lib/participant-login-validation.mjs";
import { encryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { hashParticipantPassword } from "../../src/lib/password.mjs";
import { loginAsAdmin } from "./helpers";
import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken, startWithToken, type AttemptFixture } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal, seedPublishedSchedules } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

type OtherParticipant = { student: string; placement: string; identity: string; username: string; password: string };
async function addOtherParticipant(client: pg.Client, f: AttemptFixture): Promise<OtherParticipant> {
  const password = "SANDIUJI", username = `u${f.login.suffix}`;
  await client.query("BEGIN");
  try {
  const student = (await client.query<{ id: string }>("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id", [`Peserta lain ${f.login.suffix}`, String(randomInt(1_000_000_000)).padStart(10, "0")])).rows[0].id;
  const placement = (await client.query<{ id: string }>("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4) RETURNING id::text AS id", [student, f.login.periodA, f.login.classId, `X ${f.login.majorName}`])).rows[0].id;
  const identity = (await client.query<{ id: string }>("INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES($1,$2,$3,$4) RETURNING id::text AS id", [student, f.login.periodA, `N-LAIN-${f.login.suffix}`, username])).rows[0].id;
  const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
  try {
    const encrypted = encryptParticipantPassword(password, key, { identityId: identity, periodId: f.login.periodA });
    await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES($1,$2,$3,$4,$5)", [identity, await hashParticipantPassword(password), encrypted.nonce, encrypted.ciphertext, encrypted.authenticationTag]);
  } finally { key.fill(0); }
  await client.query(`INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
    SELECT id,exam_test_id,period_id,kind,$2,$3 FROM exam_schedule_runs WHERE id=$1`, [f.runId, student, placement]);
  await client.query("COMMIT"); return { student, placement, identity, username, password };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
async function cleanupOther(client: pg.Client, other: OtherParticipant, period: string) {
  await client.query("DELETE FROM participant_login_attempts WHERE bucket_hash=$1", [participantAttemptBucket(period, other.username.toLowerCase())]);
  await client.query("DELETE FROM exam_attempt_questions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE participant_identity_id=$1)", [other.identity]);
  await client.query("DELETE FROM exam_attempts WHERE participant_identity_id=$1", [other.identity]);
  await client.query("DELETE FROM exam_start_token_attempts WHERE participant_identity_id=$1", [other.identity]);
  await client.query("DELETE FROM participant_sessions WHERE participant_identity_id=$1", [other.identity]);
  await client.query("DELETE FROM participant_password_audit WHERE participant_identity_id=$1", [other.identity]);
  await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=$1", [other.identity]);
  await client.query("DELETE FROM exam_schedule_participants WHERE student_id=$1", [other.student]);
  await client.query("DELETE FROM participant_identities WHERE id=$1", [other.identity]);
  await client.query("DELETE FROM student_class_placements WHERE id=$1", [other.placement]);
  await client.query("DELETE FROM school_students WHERE id=$1", [other.student]);
}
async function finishWithCorrectAnswers(client: pg.Client, page: Page, attempt: string, correctCount: number) {
  const questions = (await client.query<{ position: number; correct: string }>(`SELECT q.position,s.correct_option AS correct
    FROM exam_attempt_questions q JOIN exam_question_snapshots s ON s.id=q.snapshot_id
    WHERE q.attempt_id=$1 ORDER BY q.position`, [attempt])).rows;
  for (const question of questions.slice(0, correctCount)) {
    await page.goto(`/peserta/pengerjaan/${attempt}?soal=${question.position}`);
    await page.locator(`input[type="radio"][value="${question.correct}"]`).check();
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
  }
  await client.query("UPDATE exam_attempts SET deadline=clock_timestamp()+interval '4 minutes' WHERE id=$1", [attempt]);
  await page.reload(); await page.getByRole("button", { name: "Selesaikan tes" }).click();
  await page.getByRole("dialog", { name: "Kumpulkan tes sekarang?" }).getByRole("button", { name: "Ya, kumpulkan" }).click();
  await expect(page.getByText("PENGERJAAN SELESAI")).toBeVisible();
}
async function setVisibility(admin: Page, visible: boolean) {
  await admin.getByRole("button", { name: visible ? "Tampilkan nilai" : "Sembunyikan nilai", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: visible ? "Tampilkan nilai peserta?" : "Sembunyikan nilai peserta?" });
  await expect(dialog).toContainText("seluruh pelaksanaan");
  await dialog.getByRole("button", { name: visible ? "Ya, tampilkan" : "Ya, sembunyikan" }).click();
  await expect(admin.getByText(`Nilai peserta: ${visible ? "ditampilkan" : "disembunyikan"}`)).toBeVisible();
}

function scoreButton(page: Page) { return page.getByRole("button", { name: "Nilai dibagikan", exact: true }); }

test("nilai per tes tertutup secara default, hanya untuk pengerjaan selesai dan pemiliknya; membuka lalu menyembunyikan", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 2);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  const otherContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const otherPage = await otherContext.newPage();
  let other: OtherParticipant | undefined;
  try {
    other = await addOtherParticipant(client, f);
    await seedAttemptToken(client, f, "global", "000789");
    await loginParticipant(page, f.login.username, f.login.passwordA); await loginParticipant(otherPage, other.username, other.password);
    const first = await startWithToken(page, f.runId, "000789");
    const second = await startWithToken(otherPage, f.runId, "000789");
    await loginAsAdmin(admin); await admin.goto(`/data-tes/daftar/${f.login.activeTest}`);
    await admin.getByRole("link", { name: "Hasil & visibilitas nilai" }).click();
    await expect(admin).toHaveURL(new RegExp(`/data-tes/monitoring\\?tes=${f.login.activeTest}$`));
    await expect(admin.getByText("Nilai peserta: disembunyikan")).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_score_visibility WHERE exam_test_id=$1", [f.login.activeTest])).rowCount).toBe(0);
    await setVisibility(admin, true); // Berlaku juga pada tes yang sudah dirilis.
    await page.reload(); await expect(page.getByRole("heading", { name: /^Soal 1/ })).toBeVisible();
    expect(await page.content()).not.toContain("Nilai pengerjaan"); expect(await page.content()).not.toContain("correct_count");
    await page.goto("/peserta"); await scoreButton(page).click();
    let scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" }); await expect(scores).toContainText("Belum ada nilai yang dibagikan");
    await scores.getByRole("button", { name: "Tutup" }).click();
    await setVisibility(admin, false);
    await finishWithCorrectAnswers(client, page, first, 1); await finishWithCorrectAnswers(client, otherPage, second, 2);
    const values = (await client.query<{ id: string; correct: number; total: number }>("SELECT id::text AS id,correct_count AS correct,question_count AS total FROM exam_attempts WHERE id=ANY($1::bigint[]) ORDER BY id", [[first, second]])).rows;
    expect(values.map((item) => [item.correct, item.total])).toEqual([[1, 3], [2, 3]]);
    const hiddenHtml = await page.content(); expect(hiddenHtml).not.toContain("33,33"); expect(hiddenHtml).not.toContain("correct_count");
    await page.goto("/peserta");
    const card = page.getByRole("listitem").filter({ hasText: f.login.activeName }).filter({ hasText: "Jadwal fiktif" });
    await card.getByRole("button", { name: "Lihat status pengerjaan" }).click(); await expect(page).toHaveURL(/\/peserta$/);
    let status = page.getByRole("dialog", { name: "Status pengerjaan" }); await expect(status).toContainText("Nilai belum dibagikan");
    await expect(status).not.toContainText("33,33"); await status.getByRole("button", { name: "Tutup" }).click();
    await scoreButton(page).click(); scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" });
    await expect(scores).toContainText("Belum ada nilai yang dibagikan"); await scores.getByRole("button", { name: "Tutup" }).click();
    expect((await otherPage.request.get(`/peserta/pengerjaan/${first}`)).status()).toBe(404);

    // Pelaksanaan susulan induk yang sama ikut kebijakan tes, bukan kebijakan per run.
    const sameTestRun = (await client.query<{ id: string }>(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
      SELECT exam_test_id,period_id,'makeup','Susulan nilai',starts_at,time_zone,duration_minutes,created_by,published_at,published_by
      FROM exam_schedule_runs WHERE id=$1 RETURNING id::text AS id`, [f.runId])).rows[0].id;
    await client.query(`INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
      SELECT id,exam_test_id,period_id,kind,$2,$3 FROM exam_schedule_runs WHERE id=$1`, [sameTestRun, f.login.studentA, f.login.placementA]);
    const sameTestAttempt = await startWithToken(page, sameTestRun, "000789"); await finishWithCorrectAnswers(client, page, sameTestAttempt, 0);
    expect(await page.content()).not.toContain("0,00");

    // Tes lain dalam periode yang sama tetap tersembunyi meskipun tes pertama dibuka.
    const otherTest = (await client.query<{ id: string }>(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
      VALUES($1,$2,clock_timestamp()-interval '5 minutes','WIB',90) RETURNING id::text AS id`, [f.login.periodA, `Tes lain ${f.login.suffix}`])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [otherTest, f.login.questionId]);
    await seedPublishedSchedules(client, [otherTest], f.login.studentA, f.login.placementA);
    const otherRun = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_schedule_runs WHERE exam_test_id=$1", [otherTest])).rows[0].id;
    const third = await startWithToken(page, otherRun, "000789"); await finishWithCorrectAnswers(client, page, third, 1);
    expect(await page.content()).not.toContain("100,00");

    await setVisibility(admin, true);
    await page.goto("/peserta");
    const statusResponsePromise = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/peserta");
    await card.getByRole("button", { name: "Lihat status pengerjaan" }).click();
    const statusResponse = await statusResponsePromise;
    status = page.getByRole("dialog", { name: "Status pengerjaan" }); await expect(status).toContainText("33,33");
    // Menyalin action ID dan body status peserta pertama tidak memberi akses ke peserta kedua.
    const capturedStatus = statusResponse.request(); const statusHeaders = capturedStatus.headers(); const statusBody = capturedStatus.postDataBuffer();
    if (!statusHeaders["next-action"] || !statusHeaders["content-type"] || !statusBody) throw new Error("Permintaan status tidak tertangkap.");
    const stolen = await otherPage.request.post("/peserta", { headers: { origin: "http://127.0.0.1:3100", "next-action": statusHeaders["next-action"], "content-type": statusHeaders["content-type"] }, data: statusBody });
    const stolenBody = await stolen.text(); expect(stolenBody).not.toContain("33,33"); expect(stolenBody).toContain("tidak ditemukan");
    await expect(status).toContainText("bukan nilai akhir gabungan"); await expect(page).toHaveURL(/\/peserta$/);
    await status.getByRole("button", { name: "Tutup" }).click();
    const responsePromise = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/peserta");
    await scoreButton(page).click(); const scoreResponse = await responsePromise;
    scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" }); await expect(scores).toContainText("33,33");
    await expect(scores).toContainText("0,00"); await expect(scores).toContainText("Susulan nilai");
    await expect(scores).not.toContainText("66,67"); await expect(scores).not.toContainText("100,00");
    const serialized = await scoreResponse.text();
    expect(serialized).toContain("33,33"); expect(serialized).not.toContain("66,67"); expect(serialized).not.toContain("100,00");
    for (const secret of ["correct_count", "correct_option", f.login.questionSecret]) expect(serialized).not.toContain(secret);
    await scores.getByRole("button", { name: "Tutup" }).click();
    await otherPage.goto("/peserta"); await scoreButton(otherPage).click();
    const otherScores = otherPage.getByRole("dialog", { name: "Nilai yang dibagikan" }); await expect(otherScores).toContainText("66,67");
    await expect(otherScores).not.toContainText("33,33");
    const fallback = await page.request.get("/peserta/nilai"); expect(fallback.headers()["cache-control"]).toContain("no-store");
    const fallbackHtml = await fallback.text(); expect(fallbackHtml).toContain("33,33"); expect(fallbackHtml).not.toContain("100,00");
    const noJs = await browser.newContext({ baseURL: "http://127.0.0.1:3100", javaScriptEnabled: false });
    try {
      await noJs.addCookies(await page.context().cookies()); const plain = await noJs.newPage(); await plain.goto("/peserta");
      const plainCard = plain.getByRole("listitem").filter({ hasText: f.login.activeName }).filter({ hasText: "Jadwal fiktif" });
      await plainCard.getByRole("link", { name: "Lihat status tanpa JavaScript" }).click(); await expect(plain.getByText("33,33", { exact: true })).toBeVisible();
      await plain.goto("/peserta"); await plain.getByRole("link", { name: "Nilai dibagikan tanpa JavaScript" }).click();
      await expect(plain.getByText("33,33", { exact: true })).toBeVisible(); await expect(plain.getByText("100,00", { exact: true })).toHaveCount(0);
    } finally { await noJs.close(); }
    // Saat jadwal lampau tidak ditampilkan lagi, nilai yang dibagikan tetap dapat ditemukan.
    await client.query("UPDATE exam_schedule_runs SET starts_at=clock_timestamp()-interval '3 days' WHERE id=$1", [f.runId]);
    await page.goto("/peserta"); await expect(card).toHaveCount(0); await scoreButton(page).click();
    scores = page.getByRole("dialog", { name: "Nilai yang dibagikan" }); await expect(scores).toContainText("33,33");
    await scores.getByRole("button", { name: "Tutup" }).click();
    await client.query("UPDATE exam_schedule_runs SET starts_at=clock_timestamp()-interval '5 minutes' WHERE id=$1", [f.runId]);
    await page.goto(`/peserta/pengerjaan/${first}`); await expect(page.getByText("33,33", { exact: true })).toBeVisible();

    await setVisibility(admin, false);
    await page.reload(); await expect(page.getByText("Nilai belum dibagikan oleh pengawas.")).toBeVisible();
    expect(await page.content()).not.toContain("33,33");
    const newFallback = await page.request.get("/peserta/nilai"); expect(await newFallback.text()).not.toContain("33,33");
    await page.goto("/peserta"); await card.getByRole("button", { name: "Lihat status pengerjaan" }).click();
    status = page.getByRole("dialog", { name: "Status pengerjaan" }); await expect(status).toContainText("Nilai belum dibagikan");
    await expect(status).not.toContainText("33,33");
    // Aksi hasil lama tetap memeriksa sesi pada setiap permintaan, bahkan jika nilai kembali dibuka.
    await setVisibility(admin, true);
    await client.query("DELETE FROM participant_sessions WHERE participant_identity_id=$1", [f.login.identityA]);
    const capturedScores = scoreResponse.request(); const scoreHeaders = capturedScores.headers(); const scoreBody = capturedScores.postDataBuffer();
    if (!scoreHeaders["next-action"] || !scoreHeaders["content-type"] || !scoreBody) throw new Error("Permintaan nilai tidak tertangkap.");
    const revoked = await page.request.post("/peserta", { headers: { origin: "http://127.0.0.1:3100", "next-action": scoreHeaders["next-action"], "content-type": scoreHeaders["content-type"] }, data: scoreBody });
    const revokedBody = await revoked.text(); expect(revokedBody).toContain("Sesi berakhir"); expect(revokedBody).not.toContain("33,33");
  } finally {
    await adminContext.close(); await otherContext.close();
    if (other) await cleanupOther(client, other, f.login.periodA);
    await cleanupAttemptFixture(client, f); await client.end();
  }
});
