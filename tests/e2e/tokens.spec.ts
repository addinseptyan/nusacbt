import { expect, test } from "@playwright/test";

import { digestExamToken } from "../../src/lib/exam-token.mjs";
import { loginAsAdmin } from "./helpers";
import { suffix, testDatabase } from "./question-helpers";
import { cleanupTokens, finishIssue, issueForm, makeTest, tokenBaseline, tokenRow } from "./token-helpers";

test("admin menerbitkan, mengganti, dan mencabut token global maupun khusus tanpa menyimpan kode", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const data = await makeTest(client, tag); periods.push(data.periodId);
    await loginAsAdmin(page); await page.getByRole("button", { name: "Data Tes", exact: true }).click(); await page.getByRole("link", { name: "Token", exact: true }).click();
    await expect(page).toHaveURL(/\/data-tes\/token$/); await expect(page.getByText("Persiapan admin, belum untuk ujian")).toBeVisible();
    let form = await issueForm(page); await form.getByLabel("Masa aktif (menit)").fill("5"); await form.getByRole("button", { name: "Buat token", exact: true }).click();
    let issued = await finishIssue(page); const globalCode = issued.code;
    const first = (await client.query<{ id: string; token_hash: Buffer; seconds: number; scope: string }>("SELECT id::text AS id,token_hash,extract(epoch FROM expires_at-issued_at)::int AS seconds,scope FROM exam_access_tokens WHERE revoked_at IS NULL AND scope='global'")).rows[0];
    expect(first.scope).toBe("global"); expect(first.seconds).toBe(300); expect(first.token_hash).toEqual(digestExamToken(globalCode));
    expect(JSON.stringify(first)).not.toContain(globalCode); expect(page.url()).not.toContain(globalCode);
    await issued.result.getByRole("button", { name: "Saya sudah mencatat, tutup" }).click(); await expect(issued.result).toBeHidden();
    await expect(tokenRow(page, first.id)).toContainText("Aktif");
    await page.reload(); await expect(page.getByLabel("Kode token baru")).toHaveCount(0); expect(await page.content()).not.toContain(globalCode);
    await page.getByLabel("Tampilkan waktu dalam").selectOption("WITA"); await expect(tokenRow(page, first.id)).toContainText("WITA");

    form = await issueForm(page); await form.getByLabel("Masa aktif (menit)").fill("1440");
    await expect(form.getByText(/Membuat token baru akan mencabut token aktif sebelumnya/)).toBeVisible();
    await form.getByRole("button", { name: "Buat token", exact: true }).click();
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(1);
    await form.getByLabel("Saya memahami token sebelumnya akan diganti.").check(); await form.getByRole("button", { name: "Buat token", exact: true }).click();
    issued = await finishIssue(page); const newGlobalCode = issued.code; expect(newGlobalCode).not.toBe(globalCode);
    const global = (await client.query<{ id: string; token_hash: Buffer; seconds: number }>("SELECT id::text AS id,token_hash,extract(epoch FROM expires_at-issued_at)::int AS seconds FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0];
    expect(global.seconds).toBe(86400); expect(global.token_hash).toEqual(digestExamToken(newGlobalCode));
    expect((await client.query("SELECT revoked_reason FROM exam_access_tokens WHERE id=$1", [first.id])).rows[0].revoked_reason).toBe("replaced");
    await issued.result.getByRole("button", { name: "Saya sudah mencatat, tutup" }).click(); await expect(tokenRow(page, first.id)).toContainText("Diganti");

    form = await issueForm(page); await form.getByLabel("Cakupan token").selectOption("test"); await form.getByLabel("Pilih tes").selectOption(data.testId); await form.getByLabel("Masa aktif (menit)").fill("10");
    await form.getByRole("button", { name: "Buat token", exact: true }).click(); issued = await finishIssue(page); const specificCode = issued.code;
    const special = (await client.query<{ id: string; token_hash: Buffer; test_id: string }>("SELECT id::text AS id, token_hash, exam_test_id::text AS test_id FROM exam_access_tokens WHERE scope='test' AND exam_test_id=$1 AND revoked_at IS NULL", [data.testId])).rows[0];
    expect(special.token_hash).toEqual(digestExamToken(specificCode)); expect(special.test_id).toBe(data.testId);
    await issued.result.getByRole("button", { name: "Saya sudah mencatat, tutup" }).click(); await expect(tokenRow(page, special.id)).toContainText(`Tes Token ${tag}`);
    await tokenRow(page, special.id).getByRole("button", { name: `Cabut token ${special.id}` }).click();
    const revoke = page.getByRole("dialog", { name: "Cabut token?" }); await expect(revoke).toContainText("token global yang masih aktif dapat digunakan kembali");
    await revoke.getByRole("button", { name: "Ya, cabut token" }).click(); await expect(revoke).toBeHidden(); await expect(tokenRow(page, special.id)).toContainText("Dicabut");
    expect((await client.query("SELECT revoked_reason FROM exam_access_tokens WHERE id=$1", [special.id])).rows[0].revoked_reason).toBe("manual");
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE id=$1 AND scope='global' AND revoked_at IS NULL", [global.id])).rowCount).toBe(1);
    await page.reload(); expect(await page.content()).not.toContain(specificCode); expect(await page.content()).not.toContain(newGlobalCode);
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("menghapus tes melepaskan token khusus tanpa mengubahnya menjadi global", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const data = await makeTest(client, tag); periods.push(data.periodId); await loginAsAdmin(page); await page.goto("/data-tes/token");
    const form = await issueForm(page); await form.getByLabel("Cakupan token").selectOption("test"); await form.getByLabel("Pilih tes").selectOption(data.testId); await form.getByRole("button", { name: "Buat token", exact: true }).click();
    const issued = await finishIssue(page); await issued.result.getByRole("button", { name: "Saya sudah mencatat, tutup" }).click();
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE exam_test_id=$1", [data.testId])).rows[0].id;
    await page.goto("/data-tes/daftar"); await page.getByRole("button", { name: `Hapus tes ${data.testId}` }).click();
    const confirm = page.getByRole("dialog", { name: "Hapus rancangan tes?" }); await expect(confirm).toContainText("Token khusus tes ini menjadi tidak berlaku");
    await confirm.getByRole("button", { name: "Ya, hapus rancangan" }).click(); await expect(confirm).toBeHidden();
    expect((await client.query("SELECT scope,exam_test_id,test_name_snapshot FROM exam_access_tokens WHERE id=$1", [id])).rows[0]).toEqual({ scope: "test", exam_test_id: null, test_name_snapshot: `Tes Token ${tag}` });
    await page.goto("/data-tes/token"); await expect(tokenRow(page, id)).toContainText("Tes dihapus");
    await expect(tokenRow(page, id).getByRole("button", { name: `Cabut token ${id}` })).toHaveCount(0);
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rowCount).toBe(0);
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("halaman token privat, mendukung layar kecil, dan status kedaluwarsa tidak dianggap aktif", async ({ page, browser }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  try {
    await client.query(`WITH moment AS (SELECT clock_timestamp()-interval '10 minutes' AS issued)
      INSERT INTO exam_access_tokens(scope,token_hash,duration_minutes,issued_at,expires_at,created_by_admin_id)
      SELECT 'global', $1, 5, moment.issued, moment.issued + interval '5 minutes', a.id FROM admin_users a, moment WHERE a.username=$2`, [digestExamToken("ABCD-EFGH-JK23"), process.env.TEST_ADMIN_USERNAME]);
    const anonymous = await browser.newContext(); try { const p = await anonymous.newPage(); await p.goto("/data-tes/token"); await expect(p).toHaveURL(/\/login$/); } finally { await anonymous.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); await loginAsAdmin(page); const response = await page.goto("/data-tes/token");
    expect(response?.headers()["cache-control"]).toContain("private"); expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.getByRole("list", { name: "Daftar token" })).toContainText("Kedaluwarsa");
    await expect(page.getByRole("button", { name: /^Cabut token/ })).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const form = await issueForm(page); await expect(form.getByText(/Token sebelumnya sudah tidak aktif/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); await form.getByRole("button", { name: "Batal" }).click();
  } finally { await cleanupTokens(client, before, []); await client.end(); }
});
