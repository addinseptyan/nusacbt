import { createHash, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type pg from "pg";

import { cleanupAttemptFixture, seedAttemptFixture, type AttemptFixture } from "./exam-attempt-helpers";
import { loginAsAdmin } from "./helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

const baseURL = "http://127.0.0.1:3100";
test.use({ actionTimeout: 15_000 });

async function adminPage(browser: Browser) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage(); await loginAsAdmin(page);
  return { context, page };
}
async function addRemedial(client: pg.Client, f: AttemptFixture) {
  const run = (await client.query<{ id: string }>(
    `INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
     SELECT exam_test_id,period_id,'remedial','Remidi laporan',starts_at,time_zone,duration_minutes,created_by,published_at,published_by
     FROM exam_schedule_runs WHERE id=$1 RETURNING id::text AS id`, [f.runId],
  )).rows[0].id;
  await client.query(`INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
    SELECT id,exam_test_id,period_id,kind,$2,$3 FROM exam_schedule_runs WHERE id=$1`, [run, f.login.studentA, f.login.placementA]);
  return run;
}
async function insertAttempt(client: pg.Client, f: AttemptFixture, run: string, input: {
  started: string; deadline: string; completed: string | null; correct: number | null; questions: number; className: string; testName?: string;
}) {
  return (await client.query<{ id: string }>(
    `INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,
      participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,
      started_at,deadline,question_count,completed_at,completion_reason,correct_count,answered_count)
     SELECT r.id,r.exam_test_id,r.period_id,r.kind,$2,$3,$4,$5,$6,COALESCE($7::text,t.name),r.label,r.time_zone,
       $8::timestamptz,$9::timestamptz,$10::int,$11::timestamptz,CASE WHEN $11::timestamptz IS NULL THEN NULL ELSE 'submitted' END,
       $12::int,CASE WHEN $11::timestamptz IS NULL THEN NULL ELSE $12::int END
     FROM exam_schedule_runs r JOIN exam_tests t ON t.id=r.exam_test_id WHERE r.id=$1 RETURNING id::text AS id`,
    [run, f.login.identityA, f.login.studentA, f.login.studentAName, `N-A-${f.login.suffix}`, input.className, input.testName ?? null,
      input.started, input.deadline, input.questions, input.completed, input.correct],
  )).rows[0].id;
}
function archive(buffer: Buffer) {
  const files = unzipSync(buffer);
  return { summary: strFromU8(files["xl/worksheets/sheet1.xml"]), attempts: strFromU8(files["xl/worksheets/sheet2.xml"]),
    info: strFromU8(files["xl/worksheets/sheet3.xml"]), files };
}

async function addManyTests(client: pg.Client, f: AttemptFixture, count: number) {
  const prefix = `Rekap ${f.login.suffix} `;
  await client.query(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
    SELECT $1,$2 || n::text,'2026-03-01 02:00:00+00','WIB',90 FROM generate_series(1,$3::int) n`, [f.login.periodA, prefix, count]);
  await client.query(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
    SELECT t.id,t.period_id,'makeup','Pelaksanaan rekap',t.starts_at,t.time_zone,t.duration_minutes,a.id,clock_timestamp(),a.id
    FROM exam_tests t CROSS JOIN (SELECT id FROM admin_users WHERE username=$3) a
    WHERE t.period_id=$1 AND left(t.name,length($2))=$2`, [f.login.periodA, prefix, process.env.TEST_ADMIN_USERNAME]);
  await client.query(`INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
    SELECT r.id,r.exam_test_id,r.period_id,r.kind,$3,$4 FROM exam_schedule_runs r JOIN exam_tests t ON t.id=r.exam_test_id
    WHERE r.period_id=$1 AND left(t.name,length($2))=$2`, [f.login.periodA, prefix, f.login.studentA, f.login.placementA]);
  await client.query(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,
    participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,started_at,deadline,
    question_count,completed_at,completion_reason,correct_count,answered_count)
    SELECT r.id,r.exam_test_id,r.period_id,r.kind,$3,$4,$5,$6,$7,t.name,r.label,r.time_zone,
      '2026-03-01 02:00:00+00','2026-03-01 04:00:00+00',1,'2026-03-01 03:00:00+00','submitted',1,1
    FROM exam_schedule_runs r JOIN exam_tests t ON t.id=r.exam_test_id WHERE r.period_id=$1 AND left(t.name,length($2))=$2`,
    [f.login.periodA, prefix, f.login.identityA, f.login.studentA, f.login.studentAName, `N-A-${f.login.suffix}`, `X ${f.login.majorName}`]);
}

test("matriks dan Excel menjaga snapshot, formula literal, filter, no-JS, kerahasiaan soal dan otorisasi", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const admin = await adminPage(browser);
  const originalVisibility = (await client.query<{ kind: string; visible: boolean }>("SELECT kind,visible_to_participants AS visible FROM exam_score_category_visibility")).rows;
  try {
    const remedial = await addRemedial(client, f);
    const oldClass = ` X LAMA ${f.login.suffix} `; const newClass = `XI BARU ${f.login.suffix}`;
    // Satu selesai di luar rentang (Februari), satu selesai di rentang 2026-03-01 WIB, plus satu belum selesai (harus diabaikan).
    await insertAttempt(client, f, f.runId, { started: "2026-02-01T02:50:00Z", deadline: "2026-02-01T04:00:00Z", completed: "2026-02-01T03:00:00Z", correct: 1, questions: 6, className: oldClass });
    await insertAttempt(client, f, f.runId, { started: "2026-03-01T02:50:00Z", deadline: "2026-03-01T04:00:00Z", completed: "2026-03-01T03:00:59.999Z", correct: 0, questions: 1, className: newClass, testName: "=1+1" });
    await insertAttempt(client, f, f.runId, { started: "2026-03-02T02:50:00Z", deadline: "2026-03-04T04:00:00Z", completed: null, correct: null, questions: 1, className: newClass });
    await insertAttempt(client, f, remedial, { started: "2026-03-01T02:50:00Z", deadline: "2026-03-01T04:00:00Z", completed: "2026-03-01T03:00:59.999Z", correct: 1, questions: 1, className: newClass });
    await client.query(`INSERT INTO exam_final_grade_settings(exam_test_id,method,revision,updated_by)
      SELECT $1,'average',1,id FROM admin_users WHERE username=$2`, [f.login.activeTest, process.env.TEST_ADMIN_USERNAME]);
    await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=false WHERE kind IN ('makeup','remedial')");

    const q = new URLSearchParams({ tes: f.login.activeTest, kelas: newClass, kategori: "makeup", dari: "2026-03-01", sampai: "2026-03-01", zona: "WIB" });
    await admin.page.goto(`/laporan/rekap?${q}`);
    const row = admin.page.getByTestId("matrix-row"); await expect(row).toHaveCount(1);
    await expect(row).toContainText("0,00"); await expect(row).toContainText(newClass);
    await expect(admin.page.getByText("1 pengerjaan selesai cocok")).toBeVisible();
    expect(await admin.page.content()).not.toContain(f.login.questionSecret);

    // Filter mencakup kedua pengerjaan Susulan (Februari + Maret): rata-rata (16,6667 + 0)/2 = 8,33.
    const bothQ = new URLSearchParams({ tes: f.login.activeTest, kategori: "makeup", dari: "2026-02-01", sampai: "2026-03-01", zona: "WIB" });
    await admin.page.goto(`/laporan/rekap?${bothQ}`);
    await expect(row).toContainText("8,33");
    const [download] = await Promise.all([admin.page.waitForEvent("download"), admin.page.getByRole("link", { name: "Unduh Excel" }).click()]);
    expect(download.suggestedFilename()).toBe("rekap-hasil-nusacbt.xlsx");
    const filePath = await download.path(); if (!filePath) throw new Error("File Excel tidak diunduh.");
    const excel = archive(await readFile(filePath));
    expect((excel.summary.match(/<row r=/g) ?? []).length).toBe(11); // 8 preamble + banner + header + 1 siswa
    expect((excel.attempts.match(/<row r=/g) ?? []).length).toBe(3); // header + 2 pengerjaan cocok
    expect(excel.summary).toContain("<v>8.33</v>");
    expect(excel.summary).toContain("DAFTAR NAMA TES");
    expect(excel.summary).toContain(">=1+1\n");
    expect(excel.attempts).toContain(">=1+1</t>");
    expect(excel.attempts).not.toMatch(/<f(?:\s|>)/);
    expect(excel.summary).not.toMatch(/<f(?:\s|>)/);
    expect(excel.info).toContain("Metode tes diterapkan hanya pada pengerjaan selesai");
    for (const contents of Object.values(excel.files)) expect(strFromU8(contents)).not.toContain(f.login.questionSecret);

    const response = await admin.page.request.get(`/laporan/rekap/unduh?${bothQ}`);
    expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["content-type"]).toContain("spreadsheetml"); expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    const bad = await admin.page.request.get(`/laporan/rekap/unduh?tes=${f.login.activeTest}&tes=${f.login.activeTest}`); expect(bad.status()).toBe(400);
    const badDate = await admin.page.request.get("/laporan/rekap/unduh?dari=2025-02-29"); expect(badDate.status()).toBe(400);

    const plain = await browser.newContext({ baseURL, javaScriptEnabled: false, storageState: await admin.context.storageState() });
    try {
      const plainPage = await plain.newPage(); await plainPage.goto(`/laporan/rekap?${bothQ}`);
      await expect(plainPage.getByTestId("matrix-row")).toContainText("8,33");
      await expect(plainPage.getByRole("link", { name: "Unduh Excel" })).toBeVisible();
    } finally { await plain.close(); }

    const oldOnly = new URLSearchParams({ tes: f.login.activeTest, kelas: oldClass, kategori: "makeup" });
    await admin.page.goto(`/laporan/rekap?${oldOnly}`); await expect(admin.page.getByTestId("matrix-row")).toHaveCount(1);
    await expect(admin.page.getByLabel("Kelas / rombel")).toHaveValue(oldClass);
    const impossible = new URLSearchParams(q); impossible.set("kelas", oldClass);
    await admin.page.goto(`/laporan/rekap?${impossible}`); await expect(admin.page.getByTestId("matrix-row")).toHaveCount(0);
    const wildcard = new URLSearchParams({ tes: f.login.activeTest, siswa: "%", kategori: "makeup" });
    await admin.page.goto(`/laporan/rekap?${wildcard}`); await expect(admin.page.getByTestId("matrix-row")).toHaveCount(0);
    const wrongPeriod = new URLSearchParams({ tes: f.login.activeTest, periode: f.login.periodB, kategori: "makeup" });
    await admin.page.goto(`/laporan/rekap?${wrongPeriod}`); await expect(admin.page.getByTestId("matrix-row")).toHaveCount(0);

    // 2026-03-01 03:00:59.999Z adalah 10:00:59 WIB (11:00:59 WITA, tetap 1 Mar 2026);
    // uji batas hari UTC 16:30 UTC (23:30 WIB 1 Mar vs 00:30 WITA 2 Mar).
    await insertAttempt(client, f, f.runId, { started: "2026-03-01T16:00:00Z", deadline: "2026-03-01T17:30:00Z", completed: "2026-03-01T16:30:00Z", correct: 1, questions: 10, className: newClass });
    await admin.page.goto(`/laporan/rekap?tes=${f.login.activeTest}&kategori=makeup&dari=2026-03-02&sampai=2026-03-02&zona=WIB`);
    await expect(admin.page.getByTestId("matrix-row")).toHaveCount(0);
    await admin.page.goto(`/laporan/rekap?tes=${f.login.activeTest}&kategori=makeup&dari=2026-03-02&sampai=2026-03-02&zona=WITA`);
    await expect(admin.page.getByTestId("matrix-row")).toHaveCount(1);

    await client.query("UPDATE exam_final_grade_settings SET method='highest',revision=revision+1 WHERE exam_test_id=$1", [f.login.activeTest]);
    await admin.page.goto(`/laporan/rekap?${bothQ}`); await expect(admin.page.getByTestId("matrix-row")).toContainText("16,67");
    await admin.page.setViewportSize({ width: 390, height: 800 });
    expect(await admin.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const anonymous = await browser.newContext({ baseURL });
    try { expect((await anonymous.request.get(`/laporan/rekap/unduh?${q}`)).status()).toBe(401); }
    finally { await anonymous.close(); }
    await loginParticipant(page, f.login.username, f.login.passwordA);
    const forbidden = await page.request.get(`/laporan/rekap/unduh?${q}`); expect(forbidden.status()).toBe(401); expect(await forbidden.text()).not.toContain(f.login.studentAName);
    await page.goto(`/laporan/rekap?${q}`); await expect(page).toHaveURL(/\/login/); expect(await page.content()).not.toContain("16,67");
  } finally {
    for (const v of originalVisibility) await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=$2 WHERE kind=$1", [v.kind, v.visible]);
    await admin.context.close().catch(() => {}); await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("paginasi 30 siswa dan Excel mengunduh seluruh halaman", async ({ browser }) => {
  test.setTimeout(100_000);
  const client = loginTestDatabase(); await client.connect(); const f = await seedAttemptFixture(client, 0); const admin = await adminPage(browser);
  const extraStudentIds: string[] = [];
  try {
    const base = randomInt(100_000, 900_000);
    for (let i = 0; i < 31; i++) {
      const name = `Siswa Matriks ${f.login.suffix} ${String(i + 1).padStart(2, "0")}`;
      const nisn = String(base + i).padStart(10, "0");
      const studentId = (await client.query<{ id: string }>("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id", [name, nisn])).rows[0].id;
      extraStudentIds.push(studentId);
      const identityId = (await client.query<{ id: string }>(
        "INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES($1,$2,$3,$4) RETURNING id::text AS id",
        [studentId, f.login.periodA, `M-${f.login.suffix}-${i}`, `m_${f.login.suffix}_${i}`],
      )).rows[0].id;
      const placementId = (await client.query<{ id: string }>(
        "INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4) RETURNING id::text AS id",
        [studentId, f.login.periodA, f.login.classId, `X ${f.login.majorName}`],
      )).rows[0].id;
      await client.query(
        `INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
         SELECT id,exam_test_id,period_id,kind,$2,$3 FROM exam_schedule_runs WHERE id=$1`,
        [f.runId, studentId, placementId],
      );
      await client.query(
        `INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,
          participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,started_at,deadline,
          question_count,completed_at,completion_reason,correct_count,answered_count)
         SELECT r.id,r.exam_test_id,r.period_id,r.kind,$2,$3,$4,$5,$6,t.name,r.label,r.time_zone,
           '2026-03-01 02:00:00+00','2026-03-01 04:00:00+00',1,'2026-03-01 03:00:00+00','submitted',1,1
         FROM exam_schedule_runs r JOIN exam_tests t ON t.id=r.exam_test_id WHERE r.id=$1`,
        [f.runId, identityId, studentId, name, `M-${f.login.suffix}-${i}`, `X ${f.login.majorName}`],
      );
    }
    const q = new URLSearchParams({ tes: f.login.activeTest, kategori: "makeup" });
    await admin.page.goto(`/laporan/rekap?${q}`); await expect(admin.page.getByTestId("matrix-row")).toHaveCount(30);
    await expect(admin.page.getByRole("navigation", { name: "Halaman rekap" })).toContainText("Halaman 1 dari 2");
    await admin.page.getByRole("link", { name: "Berikutnya" }).click(); await expect(admin.page.getByTestId("matrix-row")).toHaveCount(1);
    await expect(admin.page.getByRole("navigation", { name: "Halaman rekap" })).toContainText("Halaman 2 dari 2");
    const href = await admin.page.getByRole("link", { name: "Unduh Excel" }).getAttribute("href");
    const res = await admin.page.request.get(href!); expect(res.status()).toBe(200);
    const excel = archive(await res.body());
    expect((excel.summary.match(/<row r=/g) ?? []).length).toBe(41); // 8 preamble + banner + header + 31 siswa
    expect((excel.attempts.match(/<row r=/g) ?? []).length).toBe(32); // header + 31 pengerjaan
  } finally {
    await admin.context.close().catch(() => {});
    if (extraStudentIds.length) {
      await client.query("DELETE FROM exam_attempts WHERE student_id = ANY($1::bigint[])", [extraStudentIds]);
      await client.query("DELETE FROM exam_schedule_participants WHERE student_id = ANY($1::bigint[])", [extraStudentIds]);
      await client.query("DELETE FROM student_class_placements WHERE student_id = ANY($1::bigint[])", [extraStudentIds]);
      await client.query("DELETE FROM participant_identities WHERE student_id = ANY($1::bigint[])", [extraStudentIds]);
      await client.query("DELETE FROM school_students WHERE id = ANY($1::bigint[])", [extraStudentIds]);
    }
    await cleanupAttemptFixture(client, f); await client.end();
  }
});

test("batas kolom tes (59) memblokir tanpa menghasilkan file parsial", async ({ browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); const f = await seedAttemptFixture(client, 0); const admin = await adminPage(browser);
  try {
    await addManyTests(client, f, 60);
    const q = new URLSearchParams({ periode: f.login.periodA, siswa: f.login.studentAName, kategori: "makeup" });
    await admin.page.goto(`/laporan/rekap?${q}`);
    await expect(admin.page.getByRole("alert").filter({ hasText: "Terlalu banyak kolom tes" })).toBeVisible();
    await expect(admin.page.getByLabel("Tes", { exact: true })).toBeVisible();
    await expect(admin.page.getByTestId("matrix-row")).toHaveCount(0);
    await expect(admin.page.getByRole("button", { name: "Unduh Excel" })).toBeDisabled();
    const res = await admin.page.request.get(`/laporan/rekap/unduh?${q}`); expect(res.status()).toBe(413);
    expect(await res.text()).toContain("maksimal 59"); expect(res.headers()["content-type"]).not.toContain("spreadsheetml");
  } finally { await admin.context.close().catch(() => {}); await cleanupAttemptFixture(client, f); await client.end(); }
});

test("batas rincian pengerjaan (10.000) mempertahankan formulir filter dan tidak menghasilkan file parsial", async ({ browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); const f = await seedAttemptFixture(client, 0); const admin = await adminPage(browser);
  try {
    await client.query(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,
      participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,started_at,deadline,
      question_count,completed_at,completion_reason,correct_count,answered_count)
      SELECT r.id,r.exam_test_id,r.period_id,r.kind,$2,$3,$4,$5,$6,t.name,r.label,r.time_zone,
        '2026-03-01 02:00:00+00','2026-03-01 04:00:00+00',1,'2026-03-01 03:00:00+00','submitted',1,1
      FROM exam_schedule_runs r JOIN exam_tests t ON t.id=r.exam_test_id CROSS JOIN generate_series(1,10001) n WHERE r.id=$1`,
      [f.runId, f.login.identityA, f.login.studentA, f.login.studentAName, `N-A-${f.login.suffix}`, `X ${f.login.majorName}`]);
    const query = `tes=${f.login.activeTest}&kategori=makeup`;
    await admin.page.goto(`/laporan/rekap?${query}`);
    await expect(admin.page.getByRole("alert").filter({ hasText: "Terlalu banyak pengerjaan cocok" })).toBeVisible();
    await expect(admin.page.getByLabel("Tes", { exact: true })).toBeVisible();
    await expect(admin.page.getByTestId("matrix-row")).toHaveCount(0);
    await expect(admin.page.getByRole("button", { name: "Unduh Excel" })).toBeDisabled();
    const res = await admin.page.request.get(`/laporan/rekap/unduh?${query}`); expect(res.status()).toBe(413);
    expect(await res.text()).toContain("maksimal 10000");
  } finally { await admin.context.close().catch(() => {}); await cleanupAttemptFixture(client, f); await client.end(); }
});

test("Excel konsisten dalam satu snapshot ketika metode berubah bersamaan", async ({ browser }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); const blocker = loginTestDatabase(); await client.connect(); await blocker.connect();
  const f = await seedAttemptFixture(client, 0); const admin = await adminPage(browser);
  try {
    const cls = `X ${f.login.majorName}`;
    await insertAttempt(client, f, f.runId, { started: "2026-03-01T02:50:00Z", deadline: "2026-03-01T04:00:00Z", completed: "2026-03-01T03:00:00Z", correct: 1, questions: 6, className: cls });
    await insertAttempt(client, f, f.runId, { started: "2026-03-02T02:50:00Z", deadline: "2026-03-02T04:00:00Z", completed: "2026-03-02T03:00:00Z", correct: 0, questions: 1, className: cls });
    await client.query(`INSERT INTO exam_final_grade_settings(exam_test_id,method,revision,updated_by)
      SELECT $1,'average',1,id FROM admin_users WHERE username=$2`, [f.login.activeTest, process.env.TEST_ADMIN_USERNAME]);
    const token = (await admin.context.cookies()).find((cookie) => cookie.name === "nusacbt_admin_session")?.value;
    if (!token) throw new Error("Sesi fixture tidak ditemukan.");
    const digest = createHash("sha256").update(token).digest("hex");
    await blocker.query("BEGIN"); await blocker.query("SELECT token_hash FROM admin_sessions WHERE token_hash=$1 FOR UPDATE", [digest]);
    const pending = admin.page.request.get(`/laporan/rekap/unduh?tes=${f.login.activeTest}&kategori=makeup`, { timeout: 30000 });
    await expect.poll(async () => (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE OF s, a%'`)).rows[0].n, { timeout: 12_000 }).toBeGreaterThan(0);
    await client.query("UPDATE exam_final_grade_settings SET method='highest',revision=revision+1 WHERE exam_test_id=$1", [f.login.activeTest]);
    await blocker.query("COMMIT");
    const response = await pending; expect(response.status()).toBe(200);
    const oldSnapshot = archive(await response.body()); expect(oldSnapshot.summary).toContain("<v>8.33</v>"); expect(oldSnapshot.attempts).toContain("Rata-rata");
    const fresh = await admin.page.request.get(`/laporan/rekap/unduh?tes=${f.login.activeTest}&kategori=makeup`); expect(fresh.status()).toBe(200);
    const newSnapshot = archive(await fresh.body()); expect(newSnapshot.summary).toContain("<v>16.67</v>"); expect(newSnapshot.attempts).toContain("Tertinggi");
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await admin.context.close().catch(() => {});
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});

test("sesi admin habis saat menunggu kunci: file Excel tidak dikirim", async ({ browser }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); const blocker = loginTestDatabase(); await client.connect(); await blocker.connect();
  const f = await seedAttemptFixture(client, 0); const admin = await adminPage(browser);
  try {
    await insertAttempt(client, f, f.runId, { started: "2026-03-01T02:50:00Z", deadline: "2026-03-01T04:00:00Z", completed: "2026-03-01T03:00:00Z", correct: 1, questions: 1, className: `X ${f.login.majorName}` });
    const token = (await admin.context.cookies()).find((cookie) => cookie.name === "nusacbt_admin_session")?.value;
    if (!token) throw new Error("Sesi fixture tidak ditemukan.");
    const digest = createHash("sha256").update(token).digest("hex");
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '6 seconds' WHERE token_hash=$1", [digest]);
    await blocker.query("BEGIN"); await blocker.query("SELECT token_hash FROM admin_sessions WHERE token_hash=$1 FOR UPDATE", [digest]);
    const pending = admin.page.request.get(`/laporan/rekap/unduh?tes=${f.login.activeTest}&kategori=makeup`, { timeout: 30000 });
    await expect.poll(async () => (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE OF s, a%'`)).rows[0].n, { timeout: 12_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0].expired,
      { timeout: 15_000 }).toBe(true);
    await blocker.query("COMMIT"); const response = await pending; expect(response.status()).toBe(401);
    expect(response.headers()["content-type"]).not.toContain("spreadsheetml"); expect(await response.text()).not.toContain(f.login.studentAName);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await admin.context.close().catch(() => {});
    await cleanupAttemptFixture(client, f); await blocker.end(); await client.end();
  }
});
