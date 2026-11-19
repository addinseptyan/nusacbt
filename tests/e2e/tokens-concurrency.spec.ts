import { expect, test, type Page } from "@playwright/test";

import { digestExamToken } from "../../src/lib/exam-token.mjs";
import { loginAsAdmin } from "./helpers";
import { sessionDigest, suffix, testDatabase } from "./question-helpers";
import { cleanupTokens, confirmIssue, globalPanel, issueForm, makeTest, showAllTokenDates, tokenBaseline } from "./token-helpers";

test("dua admin tidak diam-diam menimpa token baru atau mencabut versi yang usang", async ({ page }) => {
  test.setTimeout(90_000); const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); let second: Page | undefined;
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/token"); second = await page.context().newPage(); await second.goto("/data-tes/token");
    const form1 = await issueForm(page); const form2 = await issueForm(second); await confirmIssue(form1);
    const firstId = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id;
    await expect(globalPanel(page)).toContainText(`Token #${firstId}`);
    await form2.getByRole("button", { name: "Ya, aktifkan token" }).click(); await expect(form2.getByRole("alert")).toContainText("Status token sudah berubah");
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(1);
    await globalPanel(page).getByRole("button", { name: `Cabut token ${firstId}` }).click(); const staleRevoke = page.getByRole("dialog", { name: "Cabut token?" });
    await form2.getByRole("button", { name: "Muat ulang status" }).click(); await expect(form2).toBeHidden(); await expect(globalPanel(second)).toContainText(`Token #${firstId}`);
    const rotate = await issueForm(second); await confirmIssue(rotate);
    const currentId = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id; expect(currentId).not.toBe(firstId);
    await staleRevoke.getByRole("button", { name: "Ya, cabut token" }).click(); await expect(staleRevoke.getByRole("alert")).toContainText("Token sudah berubah atau tidak aktif");
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE id=$1 AND revoked_at IS NULL", [currentId])).rowCount).toBe(1);
  } finally { await second?.close(); await cleanupTokens(client, before, []); await client.end(); }
});

test("tes yang berubah saat formulir token terbuka menolak penerbitan", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const data = await makeTest(client, tag); periods.push(data.periodId); await loginAsAdmin(page); await page.goto("/data-tes/token"); await showAllTokenDates(page);
    const form = await issueForm(page, `tes ${data.testId}`); await client.query("UPDATE exam_tests SET name=$1 WHERE id=$2", [`Sudah berubah ${tag}`, data.testId]);
    await form.getByRole("button", { name: "Ya, aktifkan token" }).click(); await expect(form.getByRole("alert")).toContainText("Tes sudah berubah atau dihapus");
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE exam_test_id=$1", [data.testId])).rowCount).toBe(0);
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("sesi berakhir saat menunggu kunci: penggantian dibatalkan dan token lama tetap ada", async ({ page }) => {
  test.setTimeout(60_000); const client = testDatabase(); const blocker = testDatabase(); await client.connect(); await blocker.connect(); const before = await tokenBaseline(client);
  try {
    const id = (await client.query<{ id: string }>(`WITH moment AS (SELECT clock_timestamp() AS issued)
      INSERT INTO exam_access_tokens(scope,token_hash,duration_minutes,issued_at,expires_at,created_by_admin_id)
      SELECT 'global',$1,15,moment.issued,moment.issued+interval '15 minutes',a.id FROM admin_users a,moment WHERE a.username=$2 RETURNING exam_access_tokens.id::text AS id`, [digestExamToken("ABCD-EFGH-JK23"), process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    await loginAsAdmin(page); await page.goto("/data-tes/token"); const form = await issueForm(page); await form.getByLabel("Saya memahami token sebelumnya akan diganti.").check();
    const digest = await sessionDigest(page); await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE token_hash=$1", [digest]);
    await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock($1::bigint)", [2026111903]); await form.getByRole("button", { name: "Ya, ganti token" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%') AS waiting")).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await client.query<{ expired: boolean }>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest])).rows[0].expired, { timeout: 12_000 }).toBe(true);
    await blocker.query("COMMIT"); await expect(form.getByRole("alert")).toContainText("Sesi admin sudah berakhir");
    expect((await client.query("SELECT id::text AS id,revoked_at FROM exam_access_tokens WHERE scope='global'")).rows).toEqual([{ id, revoked_at: null }]);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); await cleanupTokens(client, before, []); await client.end(); }
});

test("kegagalan insert tidak meninggalkan token lama tercabut atau token baru parsial", async ({ page }) => {
  test.setTimeout(60_000); const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const tag = suffix(); const fn = `e2e_token_fail_${tag}`; const trigger = `e2e_token_trigger_${tag}`;
  try {
    const id = (await client.query<{ id: string }>(`WITH moment AS (SELECT clock_timestamp() AS issued)
      INSERT INTO exam_access_tokens(scope,token_hash,duration_minutes,issued_at,expires_at,created_by_admin_id)
      SELECT 'global',$1,15,moment.issued,moment.issued+interval '15 minutes',a.id FROM admin_users a,moment WHERE a.username=$2 RETURNING exam_access_tokens.id::text AS id`, [digestExamToken("ABCD-EFGH-JK23"), process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    await client.query(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.scope='global' THEN RAISE EXCEPTION 'synthetic token insert failure'; END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON exam_access_tokens FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
    await loginAsAdmin(page); await page.goto("/data-tes/token"); const form = await issueForm(page); await form.getByLabel("Saya memahami token sebelumnya akan diganti.").check();
    await form.getByRole("button", { name: "Ya, ganti token" }).click(); const recovery = page.getByRole("dialog", { name: "Hasil pembuatan belum pasti" }); await expect(recovery).toBeVisible();
    expect((await client.query("SELECT id::text AS id,revoked_at FROM exam_access_tokens WHERE scope='global'")).rows).toEqual([{ id, revoked_at: null }]);
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Permintaan diamankan");
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click(); await expect(recovery).toBeHidden();
  } finally { await client.query(`DROP TRIGGER IF EXISTS "${trigger}" ON exam_access_tokens`); await client.query(`DROP FUNCTION IF EXISTS "${fn}"()`); await cleanupTokens(client, before, []); await client.end(); }
});
