import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupTopics, createQuestion, createTopic, suffix, testDatabase } from "./question-helpers";

test("perubahan tes yang menunggu row lock tidak menimpa transaksi pemenang", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); const blocker = testDatabase(); await client.connect(); await blocker.connect(); const tag = suffix(); let period: string | undefined; const topics: string[] = [];
  try {
    period = (await client.query<{ id: string }>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2026-01-01') RETURNING id::text AS id", [`Kunci Tes ${tag}`])).rows[0].id;
    topics.push(await createTopic(client, `Kunci Soal Tes ${tag}`)); const question = await createQuestion(client, topics[0], `Pertanyaan ${tag}`);
    const id = (await client.query<{ id: string }>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2026-11-17T01:30Z','WIB',90) RETURNING id::text AS id", [period, `Asli ${tag}`])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [id, question.id]);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar"); await page.getByRole("button", { name: `Ubah tes ${id}` }).click();
    const form = page.getByRole("dialog", { name: "Ubah rancangan tes" }); await form.getByLabel("Nama tes").fill(`Tidak menang ${tag}`);
    await blocker.query("BEGIN"); await blocker.query("UPDATE exam_tests SET name=$1 WHERE id=$2", [`Pemenang ${tag}`, id]);
    await form.getByRole("button", { name: "Simpan rancangan" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM exam_tests WHERE id=%FOR UPDATE%') AS waiting")).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await blocker.query("COMMIT"); await expect(form.getByRole("alert")).toContainText("Tes sudah berubah atau dihapus");
    expect((await client.query("SELECT name FROM exam_tests WHERE id=$1", [id])).rows[0].name).toBe(`Pemenang ${tag}`);
    expect((await client.query("SELECT question_id::text AS id FROM exam_test_questions WHERE exam_test_id=$1", [id])).rows).toEqual([{ id: question.id }]);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); if (period) await client.query("DELETE FROM exam_tests WHERE period_id=$1", [period]); await cleanupTopics(client, topics); if (period) await client.query("DELETE FROM exam_periods WHERE id=$1", [period]); await client.end(); }
});
