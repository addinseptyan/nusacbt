import { expect, test } from "@playwright/test";

import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test("daftar nilai dibagikan dipaginasi, responsif, dan tidak mencampur data tersembunyi", async ({ page, browser }) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 320, height: 568 });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=true,revision=revision+1 WHERE NOT visible_to_participants");
    await seedAttemptToken(client, f, "global", "788901"); await loginParticipant(page, f.login.username, f.login.passwordA);
    const first = await startWithToken(page, f.runId, "788901");
    // Fixture dengan banyak pelaksanaan selesai: semua FK dan snapshot tetap sah.
    await client.query(`UPDATE exam_attempt_questions q SET answer=s.correct_option,answer_revision=1,answered_at=clock_timestamp()
      FROM exam_question_snapshots s WHERE q.snapshot_id=s.id AND q.attempt_id=$1`, [first]);
    await client.query("UPDATE exam_attempts SET completed_at=clock_timestamp(),completion_reason='submitted',correct_count=1,answered_count=1 WHERE id=$1", [first]);
    const runs = (await client.query<{ id: string }>(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
      SELECT r.exam_test_id,r.period_id,'makeup','Nilai batch '||g,r.starts_at,r.time_zone,r.duration_minutes,r.created_by,r.published_at,r.published_by
      FROM exam_schedule_runs r CROSS JOIN generate_series(1,22) g WHERE r.id=$1 RETURNING id::text AS id`, [f.runId])).rows.map((row) => row.id);
    await client.query(`INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
      SELECT id,exam_test_id,period_id,kind,$2,$3 FROM exam_schedule_runs WHERE id=ANY($1::bigint[])`, [runs, f.login.studentA, f.login.placementA]);
    const attempts = (await client.query<{ id: string }>(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,
      student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,
      started_at,deadline,question_count,completed_at,completion_reason,correct_count,answered_count)
      SELECT r.id,r.exam_test_id,r.period_id,r.kind,a.participant_identity_id,a.student_id,a.student_name_snapshot,a.participant_number_snapshot,
        a.class_name_snapshot,a.test_name_snapshot,r.label,r.time_zone,a.started_at,a.deadline,a.question_count,clock_timestamp(),'submitted',1,1
      FROM exam_schedule_runs r CROSS JOIN exam_attempts a WHERE r.id=ANY($1::bigint[]) AND a.id=$2 RETURNING id::text AS id`, [runs, first])).rows.map((row) => row.id);
    await client.query(`INSERT INTO exam_attempt_questions(attempt_id,position,snapshot_id,option_order,answer,answer_revision,answered_at)
      SELECT a.id,q.position,q.snapshot_id,q.option_order,q.answer,q.answer_revision,clock_timestamp()
      FROM exam_attempts a CROSS JOIN exam_attempt_questions q WHERE a.id=ANY($1::bigint[]) AND q.attempt_id=$2`, [attempts, first]);
    await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    const dialog = page.getByRole("dialog", { name: "Nilai yang dibagikan" });
    await expect(dialog.getByRole("list", { name: "Nilai yang dibagikan" }).getByRole("listitem")).toHaveCount(20);
    await expect(dialog.getByText("Halaman 1 dari 2")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const nav = dialog.getByRole("navigation", { name: "Halaman nilai" });
    await expect(nav.getByRole("button", { name: "Sebelumnya" })).toBeDisabled(); await nav.getByRole("button", { name: "Berikutnya" }).click();
    await expect(dialog.getByText("Halaman 2 dari 2")).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Nilai yang dibagikan" }).getByRole("listitem")).toHaveCount(3);
    await expect(nav.getByRole("button", { name: "Berikutnya" })).toBeDisabled();
    const noJs = await browser.newContext({ baseURL: "http://127.0.0.1:3100", javaScriptEnabled: false });
    try {
      await noJs.addCookies(await page.context().cookies()); const plain = await noJs.newPage(); await plain.goto("/peserta/nilai?halaman=999");
      await expect(plain.getByText("Halaman 2 dari 2")).toBeVisible();
      await expect(plain.getByRole("list", { name: "Nilai yang dibagikan" }).getByRole("listitem")).toHaveCount(3);
    } finally { await noJs.close(); }
    await dialog.getByRole("button", { name: "Tutup" }).click();
    await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=false,revision=revision+1 WHERE kind='makeup'");
    await page.getByRole("button", { name: "Nilai dibagikan" }).click(); await expect(dialog).toContainText("Belum ada nilai yang dibagikan");
    await expect(dialog.getByRole("navigation", { name: "Halaman nilai" })).toHaveCount(0);
  } finally { await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=true,revision=revision+1 WHERE NOT visible_to_participants"); await cleanupAttemptFixture(client, f); await client.end(); }
});
