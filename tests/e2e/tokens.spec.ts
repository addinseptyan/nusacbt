import { expect, test } from "@playwright/test";

import { decryptSixDigitToken, digestSixDigitToken } from "../../src/lib/exam-token-crypto.mjs";
import { digestExamToken } from "../../src/lib/exam-token.mjs";
import { loginAsAdmin } from "./helpers";
import { suffix, testDatabase } from "./question-helpers";
import { cleanupTokens, confirmIssue, fixtureTokenKey, globalPanel, issueForm, makeTest, testPanel, tokenBaseline, tokenRow, visibleCode } from "./token-helpers";

test("token global dan khusus enam digit tetap terlihat, ada timer, dropdown, penggantian dan pencabutan", async ({ page }) => {
  test.setTimeout(90_000); const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix(); const key = await fixtureTokenKey();
  try {
    const future = await makeTest(client, `${tag}-future`); periods.push(future.periodId);
    const active = await makeTest(client, `${tag}-active`, "active"); periods.push(active.periodId);
    const past = await makeTest(client, `${tag}-past`, "past"); periods.push(past.periodId);
    await loginAsAdmin(page); await page.getByRole("button", { name: "Data Tes", exact: true }).click(); await page.getByRole("link", { name: "Token", exact: true }).click();
    await expect(page).toHaveURL(/\/data-tes\/token$/); await expect(page.getByText("Persiapan admin, belum untuk ujian")).toBeVisible();
    await expect(testPanel(page, future.testId)).toContainText("Mendatang"); await expect(testPanel(page, active.testId)).toContainText("Berlangsung (jadwal)"); await expect(testPanel(page, past.testId)).toHaveCount(0);
    expect(await page.getByLabel("Durasi token global").locator("option").allTextContents()).toEqual(["5 menit", "15 menit", "30 menit", "1 jam", "2 jam", "6 jam", "1 hari"]);
    await expect(globalPanel(page)).toContainText("Durasi token baru"); await expect(testPanel(page, future.testId)).toContainText("Durasi token baru");
    let form = await issueForm(page, "global", "5"); await expect(form).toContainText("dihitung segera"); await confirmIssue(form);
    let code = await visibleCode(page); const firstCode = code;
    const first = (await client.query<{ id: string; token_hash: Buffer; code_nonce: Buffer; code_ciphertext: Buffer; code_tag: Buffer; seconds: number; scope: string; code_version: number }>("SELECT id::text AS id,token_hash,code_nonce,code_ciphertext,code_tag,code_version,extract(epoch FROM expires_at-issued_at)::int AS seconds,scope FROM exam_access_tokens WHERE revoked_at IS NULL AND scope='global'")).rows[0];
    expect(first.scope).toBe("global"); expect(first.seconds).toBe(300); expect(first.code_version).toBe(2); expect(first.token_hash).toEqual(digestSixDigitToken(code, key));
    expect(first.code_ciphertext).not.toEqual(Buffer.from(code)); expect(decryptSixDigitToken({ nonce: first.code_nonce, ciphertext: first.code_ciphertext, tag: first.code_tag }, key, { id: first.id, scope: "global" })).toBe(code);
    expect(page.url()).not.toContain(code); await expect(globalPanel(page)).toContainText("Aktif");
    const timer = page.getByLabel("Sisa waktu token global"); const initial = await timer.textContent(); expect(initial).toMatch(/^00:0[0-5]:[0-5][0-9]$/); await expect.poll(async () => timer.textContent(), { timeout: 4000 }).not.toBe(initial);
    await page.reload(); expect(await visibleCode(page)).toBe(firstCode); await expect(testPanel(page, future.testId)).toContainText("Menggunakan token global");
    await page.getByLabel("Zona waktu").selectOption("WITA"); await expect(globalPanel(page)).toContainText("WITA");
    form = await issueForm(page, "global", "1440"); await expect(form).toContainText("akan langsung tidak berlaku");
    await form.getByRole("button", { name: "Ya, ganti token" }).click(); expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(1);
    await confirmIssue(form); await expect(page.getByLabel("Kode token global", { exact: true })).not.toHaveText(firstCode); code = await visibleCode(page); expect(code).not.toBe(firstCode);
    const global = (await client.query<{ id: string; seconds: number }>("SELECT id::text AS id,extract(epoch FROM expires_at-issued_at)::int AS seconds FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0];
    expect(global.seconds).toBe(86400); await expect(tokenRow(page, first.id)).toContainText(firstCode); await expect(tokenRow(page, first.id)).toContainText("Diganti");
    form = await issueForm(page, `tes ${future.testId}`, "30"); await confirmIssue(form); const specificCode = await visibleCode(page, `tes ${future.testId}`);
    const special = (await client.query<{ id: string; token_hash: Buffer; test_id: string }>("SELECT id::text AS id,token_hash,exam_test_id::text AS test_id FROM exam_access_tokens WHERE scope='test' AND exam_test_id=$1 AND revoked_at IS NULL", [future.testId])).rows[0];
    expect(special.token_hash).toEqual(digestSixDigitToken(specificCode, key)); expect(special.test_id).toBe(future.testId); await expect(testPanel(page, future.testId)).not.toContainText("Menggunakan token global");
    await testPanel(page, future.testId).getByRole("button", { name: `Cabut token ${special.id}` }).click(); const revoke = page.getByRole("dialog", { name: "Cabut token?" }); await expect(revoke).toContainText("token global yang masih aktif dapat digunakan kembali");
    await revoke.getByRole("button", { name: "Ya, cabut token" }).click(); await expect(revoke).toBeHidden(); await expect(testPanel(page, future.testId)).toContainText("Menggunakan token global");
    await expect(tokenRow(page, special.id)).toContainText("Dicabut"); await expect(tokenRow(page, special.id)).toContainText(specificCode);
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE id=$1 AND revoked_at IS NULL", [global.id])).rowCount).toBe(1);
    await page.reload(); expect(await visibleCode(page, `tes ${future.testId}`)).toBe(specificCode); expect(await visibleCode(page)).toBe(code);
  } finally { key.fill(0); await cleanupTokens(client, before, periods); await client.end(); }
});

test("timer berhenti saat kedaluwarsa, fallback global muncul, dan tes yang berakhir menghilang tanpa reload", async ({ page }) => {
  test.setTimeout(45_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const future = await makeTest(client, `${tag}-future`); periods.push(future.periodId);
    const ending = await makeTest(client, `${tag}-ending`, "active"); periods.push(ending.periodId);
    await loginAsAdmin(page); await page.goto("/data-tes/token");
    await confirmIssue(await issueForm(page, "global", "5")); await confirmIssue(await issueForm(page, `tes ${future.testId}`, "5"));
    await client.query(`WITH moment AS (SELECT clock_timestamp() AS now)
      UPDATE exam_access_tokens SET issued_at=moment.now-interval '4 minutes 54 seconds',expires_at=moment.now+interval '6 seconds'
      FROM moment WHERE scope='test' AND exam_test_id=$1 AND revoked_at IS NULL`, [future.testId]);
    await client.query("UPDATE exam_tests SET starts_at=clock_timestamp()-interval '89 minutes 48 seconds' WHERE id=$1", [ending.testId]);
    await page.reload(); await expect(testPanel(page, future.testId)).toContainText("Aktif"); await expect(testPanel(page, ending.testId)).toBeVisible();
    await expect(page.getByLabel(`Sisa waktu token tes ${future.testId}`)).toHaveText("00:00:00", { timeout: 15_000 });
    await expect(testPanel(page, future.testId)).toContainText("Kedaluwarsa"); await expect(testPanel(page, future.testId)).toContainText("Menggunakan token global");
    await expect(testPanel(page, future.testId).getByRole("button", { name: `Aktifkan token tes ${future.testId}` })).toBeEnabled();
    await expect(testPanel(page, ending.testId)).toHaveCount(0, { timeout: 15_000 });
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("menghapus tes tidak mengubah scope dan kode khusus tetap tampil di riwayat", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const data = await makeTest(client, tag); periods.push(data.periodId); await loginAsAdmin(page); await page.goto("/data-tes/token");
    const form = await issueForm(page, `tes ${data.testId}`); await confirmIssue(form); const code = await visibleCode(page, `tes ${data.testId}`);
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE exam_test_id=$1", [data.testId])).rows[0].id;
    await page.goto("/data-tes/daftar"); await page.getByRole("button", { name: `Hapus tes ${data.testId}` }).click();
    const confirm = page.getByRole("dialog", { name: "Hapus rancangan tes?" }); await expect(confirm).toContainText("Token khusus tes ini menjadi tidak berlaku"); await confirm.getByRole("button", { name: "Ya, hapus rancangan" }).click(); await expect(confirm).toBeHidden();
    expect((await client.query("SELECT scope,exam_test_id,test_name_snapshot FROM exam_access_tokens WHERE id=$1", [id])).rows[0]).toEqual({ scope: "test", exam_test_id: null, test_name_snapshot: `Tes Token ${tag}` });
    await page.goto("/data-tes/token"); await expect(tokenRow(page, id)).toContainText("Tes dihapus"); await expect(tokenRow(page, id)).toContainText(code);
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rowCount).toBe(0);
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("kode baru dan metadata lama tetap tercatat lebih dari satu hari; privat dan responsif", async ({ page, browser }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  try {
    await client.query(`WITH moment AS (SELECT clock_timestamp()-interval '3 days' AS issued)
      INSERT INTO exam_access_tokens(scope,token_hash,duration_minutes,issued_at,expires_at,revoked_at,revoked_reason)
      SELECT 'global',$1,5,moment.issued,moment.issued+interval '5 minutes',moment.issued+interval '6 minutes','replaced' FROM moment`, [digestExamToken("ABCD-EFGH-JK23")]);
    const anonymous = await browser.newContext(); try { const p = await anonymous.newPage(); await p.goto("/data-tes/token"); await expect(p).toHaveURL(/\/login$/); } finally { await anonymous.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); await loginAsAdmin(page); const response = await page.goto("/data-tes/token");
    expect(response?.headers()["cache-control"]).toContain("private"); expect(response?.headers()["x-robots-tag"]).toContain("noindex"); await expect(page.getByText("Kode lama tidak tersedia").first()).toBeVisible();
    const form = await issueForm(page, "global", "5"); await confirmIssue(form); const code = await visibleCode(page); const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id;
    await client.query(`WITH moment AS (SELECT clock_timestamp()-interval '2 days' AS issued) UPDATE exam_access_tokens k SET issued_at=moment.issued,expires_at=moment.issued+k.duration_minutes*interval '1 minute' FROM moment WHERE k.id=$1`, [id]);
    await page.reload(); expect(await visibleCode(page)).toBe(code); await expect(globalPanel(page)).toContainText("Kedaluwarsa"); await expect(page.getByLabel("Sisa waktu token global")).toHaveText("00:00:00"); await expect(tokenRow(page, id)).toContainText(code);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally { await cleanupTokens(client, before, []); await client.end(); }
});

test("seluruh riwayat termasuk lebih dari 100 catatan tersedia melalui halaman berikutnya", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  try {
    const rows = (await client.query<{ id: string }>(`WITH moment AS MATERIALIZED (SELECT clock_timestamp()-interval '10 days' AS base, clock_timestamp()-interval '9 days' AS revoked)
      INSERT INTO exam_access_tokens(scope,token_hash,duration_minutes,issued_at,expires_at,revoked_at,revoked_reason)
      SELECT 'global',decode(md5('fixture-a-'||g::text)||md5('fixture-b-'||g::text),'hex'),5,
        moment.base-g*interval '1 minute',moment.base-g*interval '1 minute'+interval '5 minutes',moment.revoked,'manual'
      FROM generate_series(1,125) g,moment RETURNING id::text AS id`)).rows;
    await loginAsAdmin(page); await page.goto("/data-tes/token"); await expect(page.getByText("125 catatan")).toBeVisible(); await expect(page.getByText("Halaman 1 dari 7")).toBeVisible();
    await page.getByRole("link", { name: "Berikutnya" }).click(); await expect(page.getByText("Halaman 2 dari 7")).toBeVisible();
    await page.goto("/data-tes/token?history=7"); await expect(page.getByText("Halaman 7 dari 7")).toBeVisible(); await expect(tokenRow(page, rows[rows.length - 1].id)).toBeVisible();
  } finally { await cleanupTokens(client, before, []); await client.end(); }
});
