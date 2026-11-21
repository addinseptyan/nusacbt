import { expect, test } from "@playwright/test";

import { PARTICIPANT_SCHEDULE_DAY_FILTER, PARTICIPANT_SCHEDULE_DAY_JOIN } from "../../src/lib/participant-schedule-day.mjs";
import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken } from "./exam-attempt-helpers";
import { cleanupLoginFixture, loginParticipant, loginTestDatabase, resetLoginGlobal, seedLoginFixture, seedPublishedSchedules } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

test("batas tanggal dan akhir tepat diuji pada tiga zona menggunakan SQL yang dipakai halaman", async () => {
  const client = loginTestDatabase(); await client.connect();
  try {
    // Mengganti hanya jam database dengan parameter memungkinkan simulasi
    // tengah malam, tanpa mengubah jam sistem maupun data dalam database.
    const join = PARTICIPANT_SCHEDULE_DAY_JOIN.replaceAll("statement_timestamp()", "$1::timestamptz");
    const predicate = PARTICIPANT_SCHEDULE_DAY_FILTER.replaceAll("statement_timestamp()", "$1::timestamptz");
    const visible = async (now: string, start: string, minutes: number) => (await client.query<{ zone: string; visible: boolean }>(
      `SELECT r.time_zone AS zone,${predicate} AS visible
       FROM (SELECT z AS time_zone,$2::timestamptz AS starts_at,$3::integer AS duration_minutes
         FROM unnest(ARRAY['WIB','WITA','WIT']) AS z) r ${join} ORDER BY r.time_zone`, [now, start, minutes],
    )).rows.map((row) => [row.zone, row.visible]);
    const now = "2026-01-01T16:30:00Z"; // WIB 23:30, WITA 00:30, WIT 01:30
    expect(await visible(now, "2026-01-01T17:30:00Z", 60)).toEqual([["WIB", false], ["WIT", true], ["WITA", true]]);
    expect(await visible(now, "2026-01-01T16:45:00Z", 60)).toEqual([["WIB", true], ["WIT", true], ["WITA", true]]);
    // Pada WITA jadwal ini mulai kemarin; tepat akhir tidak lagi terlihat.
    expect(await visible(now, "2026-01-01T15:00:00Z", 120)).toEqual([["WIB", true], ["WIT", true], ["WITA", true]]);
    expect(await visible(now, "2026-01-01T15:00:00Z", 90)).toEqual([["WIB", true], ["WIT", true], ["WITA", false]]);
    // Mulai lebih dari kemarin tetap tersembunyi sekalipun durasinya panjang.
    expect(await visible(now, "2025-12-30T12:00:00Z", 5000)).toEqual([["WIB", false], ["WIT", false], ["WITA", false]]);
    expect(await visible("2026-01-01T15:30:00Z", "2026-01-01T16:30:00Z", 60)).toEqual([["WIB", true], ["WIT", true], ["WITA", false]]);
    expect(await visible("2026-01-01T17:30:00Z", "2026-01-01T16:00:00Z", 120)).toEqual([["WIB", true], ["WIT", true], ["WITA", true]]);
    expect(await visible("2026-01-01T17:30:00Z", "2026-01-01T16:00:00Z", 90)).toEqual([["WIB", false], ["WIT", true], ["WITA", true]]);
  } finally { await client.end(); }
});

test("daftar hanya memuat hari ini tiap zona dan kemarin yang masih aktif sebelum paginasi", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  try {
    const exams = (await client.query<{ id: string; name: string; zone: string }>(
      `WITH zones(zone,tz) AS (VALUES ('WIB','Asia/Jakarta'),('WITA','Asia/Makassar'),('WIT','Asia/Jayapura')),
       cases(tag,offset_from_midnight,minutes) AS (VALUES
         ('awal',interval '0',60),('akhir',interval '23 hours 59 minutes',60),
         ('kemarin-aktif',interval '-1 minute',1441),('kemarin-selesai',interval '-1 minute',1),
         ('lebih-lama-aktif',interval '-1 day -1 minute',2881),('besok',interval '1 day',60))
       INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
       SELECT $1::bigint,'Harian '||zones.zone||' '||cases.tag||' '||$2,
         (date_trunc('day',clock_timestamp() AT TIME ZONE zones.tz)+cases.offset_from_midnight) AT TIME ZONE zones.tz,
         zones.zone,cases.minutes FROM zones CROSS JOIN cases
       RETURNING id::text AS id,name,time_zone AS zone`, [f.periodA, f.suffix],
    )).rows;
    await seedPublishedSchedules(client, exams.map((row) => row.id), f.studentA, f.placementA);
    await loginParticipant(page, f.username, f.passwordA);
    await expect(page.getByText("10 jadwal hari ini atau berlanjut dari kemarin")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Halaman jadwal" })).toHaveCount(0);
    const list = page.getByRole("list", { name: "Jadwal tes" }); await expect(list.getByRole("listitem")).toHaveCount(10);
    for (const zone of ["WIB", "WITA", "WIT"]) {
      for (const tag of ["awal", "akhir", "kemarin-aktif"]) {
        const card = list.getByRole("listitem").filter({ hasText: `Harian ${zone} ${tag} ${f.suffix}` });
        await expect(card).toBeVisible(); await expect(card).toContainText(zone);
        if (tag === "kemarin-aktif") { await expect(card).toContainText("Berlangsung"); await expect(card.getByRole("button", { name: "Mulai tes" })).toBeVisible(); }
      }
      for (const tag of ["kemarin-selesai", "lebih-lama-aktif", "besok"]) await expect(page.getByText(`Harian ${zone} ${tag} ${f.suffix}`, { exact: true })).toHaveCount(0);
    }
    const html = await page.content();
    for (const hidden of [f.futureName, f.pastName, f.hiddenName]) expect(html).not.toContain(hidden);
    expect(html).not.toContain(f.questionSecret);
    // URL alternatif tanpa JavaScript tidak mengungkap detail tanggal lain.
    for (const tag of ["besok", "kemarin-selesai", "lebih-lama-aktif"]) {
      const exam = exams.find((item) => item.name === `Harian WIB ${tag} ${f.suffix}`)!;
      const run = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_schedule_runs WHERE exam_test_id=$1", [exam.id])).rows[0].id;
      const response = await page.request.get(`/peserta/jadwal/${run}`); expect(response.status()).toBe(404); expect(await response.text()).not.toContain(exam.name);
    }
    const overnight = exams.find((item) => item.name === `Harian WITA kemarin-aktif ${f.suffix}`)!;
    const overnightRun = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_schedule_runs WHERE exam_test_id=$1", [overnight.id])).rows[0].id;
    expect((await page.request.get(`/peserta/jadwal/${overnightRun}`)).status()).toBe(200);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("tes kemarin yang masih berlangsung dapat dimulai lewat modal dan dilanjutkan", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await client.query(`UPDATE exam_schedule_runs SET starts_at=(date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Makassar') - interval '1 minute') AT TIME ZONE 'Asia/Makassar',
      time_zone='WITA',duration_minutes=1441 WHERE id=$1`, [f.runId]);
    await seedAttemptToken(client, f, "global", "009876"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const card = page.getByRole("listitem").filter({ hasText: f.login.activeName }); await expect(card).toContainText("Berlangsung"); await expect(card).toContainText("WITA");
    await card.getByRole("button", { name: "Mulai tes" }).click(); await expect(page).toHaveURL(/\/peserta$/);
    const modal = page.getByRole("dialog", { name: "Masukkan token ujian" }); await expect(modal).toBeVisible();
    await modal.getByLabel("Token tes").fill("009876"); await modal.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await expect(page.getByRole("heading", { name: /^Soal 1/ })).toBeVisible(); const attemptUrl = page.url();
    await page.goto("/peserta"); await expect(card.getByRole("link", { name: "Lanjutkan tes" })).toBeVisible();
    await card.getByRole("link", { name: "Lanjutkan tes" }).click(); await expect(page).toHaveURL(attemptUrl);
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});
