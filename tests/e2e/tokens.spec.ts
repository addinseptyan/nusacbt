import { expect, test } from "@playwright/test";

import { decryptSixDigitToken, digestSixDigitToken } from "../../src/lib/exam-token-crypto.mjs";
import { digestExamToken } from "../../src/lib/exam-token.mjs";
import { loginAsAdmin } from "./helpers";
import { suffix, testDatabase } from "./question-helpers";
import { cleanupTokens, confirmIssue, fixtureTokenKey, globalPanel, issueForm, makeTest, openTokenHistory, showAllTokenDates, testPanel, tokenBaseline, tokenRow, visibleCode } from "./token-helpers";

test("token global dan khusus enam digit tetap terlihat, ada timer, dropdown, penggantian dan pencabutan", async ({ page }) => {
  test.setTimeout(90_000); const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix(); const key = await fixtureTokenKey();
  try {
    const future = await makeTest(client, `${tag}-future`); periods.push(future.periodId);
    const active = await makeTest(client, `${tag}-active`, "active"); periods.push(active.periodId);
    const past = await makeTest(client, `${tag}-past`, "past"); periods.push(past.periodId);
    await loginAsAdmin(page); await page.getByRole("button", { name: "Data Tes", exact: true }).click(); await page.getByRole("link", { name: "Token", exact: true }).click();
    await expect(page).toHaveURL(/\/data-tes\/token$/); await expect(page.getByText("Persiapan admin, belum untuk ujian")).toBeVisible();
    await showAllTokenDates(page);
    await expect(testPanel(page, future.testId)).toContainText("Mendatang"); await expect(testPanel(page, active.testId)).toContainText("Berlangsung (jadwal)"); await expect(testPanel(page, past.testId)).toHaveCount(0);
    expect(await page.getByLabel("Durasi token global").locator("option").allTextContents()).toEqual(["5 menit", "15 menit", "30 menit", "1 jam", "2 jam", "6 jam", "1 hari"]);
    await expect(globalPanel(page)).toContainText("Durasi token baru"); await expect(testPanel(page, future.testId)).toContainText("Durasi token baru");
    let form = await issueForm(page, "global", "5"); await expect(form).toContainText("dihitung segera"); await confirmIssue(form);
    let code = await visibleCode(page); const firstCode = code;
    const first = (await client.query<{ id: string; token_hash: Buffer; code_nonce: Buffer; code_ciphertext: Buffer; code_tag: Buffer; seconds: number; scope: string; code_version: number }>("SELECT id::text AS id,token_hash,code_nonce,code_ciphertext,code_tag,code_version,extract(epoch FROM expires_at-issued_at)::int AS seconds,scope FROM exam_access_tokens WHERE revoked_at IS NULL AND scope='global'")).rows[0];
    expect(first.scope).toBe("global"); expect(first.seconds).toBe(300); expect(first.code_version).toBe(2); expect(first.token_hash).toEqual(digestSixDigitToken(code, key));
    expect(first.code_ciphertext).not.toEqual(Buffer.from(code)); expect(decryptSixDigitToken({ nonce: first.code_nonce, ciphertext: first.code_ciphertext, tag: first.code_tag }, key, { id: first.id, scope: "global" })).toBe(code);
    expect(page.url()).not.toContain(code); await expect(globalPanel(page)).toContainText("Aktif");
    await expect(page.getByLabel("Kode token global", { exact: true })).toHaveClass(/text-foreground/);
    await expect(globalPanel(page).getByRole("button", { name: "Salin kode token global" })).toBeVisible();
    const timer = page.getByLabel("Sisa waktu token global"); const initial = await timer.textContent(); expect(initial).toMatch(/^00:0[0-5]:[0-5][0-9]$/); await expect.poll(async () => timer.textContent(), { timeout: 4000 }).not.toBe(initial);
    await page.reload(); expect(await visibleCode(page)).toBe(firstCode); await expect(testPanel(page, future.testId)).toContainText("Menggunakan token global");
    await expect(globalPanel(page)).toContainText("WIB");
    form = await issueForm(page, "global", "1440"); await expect(form).toContainText("akan langsung tidak berlaku");
    await form.getByRole("button", { name: "Ya, ganti token" }).click(); expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(1);
    await confirmIssue(form); await expect(page.getByLabel("Kode token global", { exact: true })).not.toHaveText(firstCode); code = await visibleCode(page); expect(code).not.toBe(firstCode);
    const global = (await client.query<{ id: string; seconds: number }>("SELECT id::text AS id,extract(epoch FROM expires_at-issued_at)::int AS seconds FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0];
    expect(global.seconds).toBe(86400); await expect(page.getByRole("list", { name: "Riwayat token" })).toHaveCount(0);
    await openTokenHistory(page); await expect(tokenRow(page, first.id)).toContainText(firstCode); await expect(tokenRow(page, first.id)).toContainText("Diganti · tidak berlaku");
    await expect(page.getByLabel(`Kode riwayat token ${first.id}`)).toHaveClass(/text-muted-foreground/);
    await expect(tokenRow(page, first.id).getByRole("button", { name: `Salin kode riwayat token ${first.id}` })).toHaveCount(0);
    await page.goBack(); await expect(testPanel(page, future.testId)).toBeVisible();
    form = await issueForm(page, `tes ${future.testId}`, "30"); await confirmIssue(form); const specificCode = await visibleCode(page, `tes ${future.testId}`);
    const special = (await client.query<{ id: string; token_hash: Buffer; test_id: string }>("SELECT id::text AS id,token_hash,exam_test_id::text AS test_id FROM exam_access_tokens WHERE scope='test' AND exam_test_id=$1 AND revoked_at IS NULL", [future.testId])).rows[0];
    expect(special.token_hash).toEqual(digestSixDigitToken(specificCode, key)); expect(special.test_id).toBe(future.testId); await expect(testPanel(page, future.testId)).not.toContainText("Menggunakan token global");
    await testPanel(page, future.testId).getByRole("button", { name: `Cabut token ${special.id}` }).click(); const revoke = page.getByRole("dialog", { name: "Cabut token?" }); await expect(revoke).toContainText("token global yang masih aktif dapat digunakan kembali");
    await revoke.getByRole("button", { name: "Ya, cabut token" }).click(); await expect(revoke).toBeHidden(); await expect(testPanel(page, future.testId)).toContainText("Menggunakan token global");
    await expect(testPanel(page, future.testId)).toContainText("Dicabut · tidak berlaku");
    await expect(page.getByLabel(`Kode token tes ${future.testId}`, { exact: true })).toHaveClass(/text-muted-foreground/);
    await expect(testPanel(page, future.testId).getByRole("button", { name: `Salin kode token tes ${future.testId}` })).toHaveCount(0);
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE id=$1 AND revoked_at IS NULL", [global.id])).rowCount).toBe(1);
    await page.reload(); expect(await visibleCode(page, `tes ${future.testId}`)).toBe(specificCode); expect(await visibleCode(page)).toBe(code);
    await openTokenHistory(page); await expect(tokenRow(page, special.id)).toContainText("Dicabut · tidak berlaku"); await expect(tokenRow(page, special.id)).toContainText(specificCode);
  } finally { key.fill(0); await cleanupTokens(client, before, periods); await client.end(); }
});

test("timer berhenti saat kedaluwarsa, fallback global muncul, dan tes yang berakhir menghilang tanpa reload", async ({ page }) => {
  test.setTimeout(45_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const future = await makeTest(client, `${tag}-future`); periods.push(future.periodId);
    const ending = await makeTest(client, `${tag}-ending`, "active"); periods.push(ending.periodId);
    await loginAsAdmin(page); await page.goto("/data-tes/token"); await showAllTokenDates(page);
    await confirmIssue(await issueForm(page, "global", "5")); await confirmIssue(await issueForm(page, `tes ${future.testId}`, "5"));
    const code = await visibleCode(page, `tes ${future.testId}`);
    await client.query(`WITH moment AS (SELECT clock_timestamp() AS now)
      UPDATE exam_access_tokens SET issued_at=moment.now-interval '4 minutes 50 seconds',expires_at=moment.now+interval '10 seconds'
      FROM moment WHERE scope='test' AND exam_test_id=$1 AND revoked_at IS NULL`, [future.testId]);
    await client.query("UPDATE exam_tests SET starts_at=clock_timestamp()-interval '89 minutes 45 seconds' WHERE id=$1", [ending.testId]);
    await page.reload(); await expect(testPanel(page, future.testId)).toContainText("Aktif"); await expect(testPanel(page, ending.testId)).toBeVisible();
    await expect(page.getByLabel(`Kode token tes ${future.testId}`, { exact: true })).toHaveClass(/text-foreground/);
    await expect(testPanel(page, future.testId).getByRole("button", { name: `Salin kode token tes ${future.testId}` })).toBeVisible();
    await expect(page.getByLabel(`Sisa waktu token tes ${future.testId}`)).toHaveText("00:00:00", { timeout: 15_000 });
    await expect(testPanel(page, future.testId)).toContainText("Kedaluwarsa · tidak berlaku"); await expect(testPanel(page, future.testId)).toContainText("Menggunakan token global");
    await expect(page.getByLabel(`Kode token tes ${future.testId}`, { exact: true })).toHaveText(code); await expect(page.getByLabel(`Kode token tes ${future.testId}`, { exact: true })).toHaveClass(/text-muted-foreground/);
    await expect(testPanel(page, future.testId).getByRole("button", { name: `Salin kode token tes ${future.testId}` })).toHaveCount(0);
    await expect(globalPanel(page).getByRole("button", { name: "Salin kode token global" })).toBeVisible();
    await expect(testPanel(page, future.testId).getByRole("button", { name: `Aktifkan token tes ${future.testId}` })).toBeEnabled();
    await expect(testPanel(page, ending.testId)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("1 tes", { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("menghapus tes tidak mengubah scope dan kode khusus tetap tampil di riwayat", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const data = await makeTest(client, tag); periods.push(data.periodId); await loginAsAdmin(page); await page.goto("/data-tes/token"); await showAllTokenDates(page);
    const form = await issueForm(page, `tes ${data.testId}`); await confirmIssue(form); const code = await visibleCode(page, `tes ${data.testId}`);
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE exam_test_id=$1", [data.testId])).rows[0].id;
    await page.goto("/data-tes/daftar"); await page.getByRole("button", { name: `Hapus tes ${data.testId}` }).click();
    const confirm = page.getByRole("dialog", { name: "Hapus rancangan tes?" }); await expect(confirm).toContainText("Token khusus tes ini menjadi tidak berlaku"); await confirm.getByRole("button", { name: "Ya, hapus rancangan" }).click(); await expect(confirm).toBeHidden();
    expect((await client.query("SELECT scope,exam_test_id,test_name_snapshot FROM exam_access_tokens WHERE id=$1", [id])).rows[0]).toEqual({ scope: "test", exam_test_id: null, test_name_snapshot: `Tes Token ${tag}` });
    await page.goto("/data-tes/token/riwayat"); await expect(tokenRow(page, id)).toContainText("Tes dihapus"); await expect(tokenRow(page, id)).toContainText(code);
    await expect(tokenRow(page, id)).toContainText("tidak berlaku"); await expect(tokenRow(page, id).getByRole("button", { name: `Salin kode riwayat token ${id}` })).toHaveCount(0);
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rowCount).toBe(0);
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});

test("kode baru dan metadata lama tetap tercatat lebih dari satu hari; privat dan responsif", async ({ page, browser }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  try {
    await client.query(`WITH moment AS (SELECT clock_timestamp()-interval '3 days' AS issued)
      INSERT INTO exam_access_tokens(scope,token_hash,duration_minutes,issued_at,expires_at,revoked_at,revoked_reason)
      SELECT 'global',$1,5,moment.issued,moment.issued+interval '5 minutes',moment.issued+interval '6 minutes','replaced' FROM moment`, [digestExamToken("ABCD-EFGH-JK23")]);
    const anonymous = await browser.newContext(); try { const p = await anonymous.newPage(); for (const url of ["/data-tes/token", "/data-tes/token/riwayat", "/data-tes/token/riwayat?halaman=2"]) { await p.goto(url); await expect(p).toHaveURL(/\/login$/); } } finally { await anonymous.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); await loginAsAdmin(page); const response = await page.goto("/data-tes/token");
    expect(response?.headers()["cache-control"]).toContain("private"); expect(response?.headers()["cache-control"]).toContain("no-store"); expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.getByRole("list", { name: "Riwayat token" })).toHaveCount(0);
    const historyResponse = await page.goto("/data-tes/token/riwayat");
    expect(historyResponse?.headers()["cache-control"]).toContain("private"); expect(historyResponse?.headers()["cache-control"]).toContain("no-store"); expect(historyResponse?.headers()["x-robots-tag"]).toContain("noindex"); expect(historyResponse?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByText("Kode lama tidak tersedia").first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Riwayat token");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("link", { name: "Kembali ke Token" }).click();
    const form = await issueForm(page, "global", "5"); await confirmIssue(form); const code = await visibleCode(page); const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id;
    await client.query(`WITH moment AS (SELECT clock_timestamp()-interval '2 days' AS issued) UPDATE exam_access_tokens k SET issued_at=moment.issued,expires_at=moment.issued+k.duration_minutes*interval '1 minute' FROM moment WHERE k.id=$1`, [id]);
    await page.reload(); expect(await visibleCode(page)).toBe(code); await expect(globalPanel(page)).toContainText("Kedaluwarsa · tidak berlaku"); await expect(page.getByLabel("Sisa waktu token global")).toHaveText("00:00:00");
    await expect(page.getByLabel("Kode token global", { exact: true })).toHaveClass(/text-muted-foreground/);
    await expect(globalPanel(page).getByRole("button", { name: "Salin kode token global" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await openTokenHistory(page); await expect(tokenRow(page, id)).toContainText(code); await expect(tokenRow(page, id)).toContainText("tidak berlaku");
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
    await loginAsAdmin(page); await page.goto("/data-tes/token"); await expect(page.getByText("125 catatan")).toHaveCount(0); await openTokenHistory(page);
    await expect(page.getByText("125 catatan")).toBeVisible(); await expect(page.getByText("Halaman 1 dari 7")).toBeVisible();
    await page.getByRole("link", { name: "Berikutnya" }).click(); await expect(page.getByText("Halaman 2 dari 7")).toBeVisible();
    await page.goto("/data-tes/token/riwayat?halaman=7"); await expect(page.getByText("Halaman 7 dari 7")).toBeVisible(); await expect(tokenRow(page, rows[rows.length - 1].id)).toBeVisible();
  } finally { await cleanupTokens(client, before, []); await client.end(); }
});

test("auto-generate token global aktifkan rotasi otomatis saat kedaluwarsa dan nonaktif saat dicabut", async ({ page }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = []; const tag = suffix();
  try {
    const testWithTags = await makeTest(client, `${tag}-tags`, "active");
    periods.push(testWithTags.periodId);
    await client.query("UPDATE exam_tests SET tags=$1::text[], tags_signature=$2 WHERE id=$3", [["IPA", "Kelas-XI"], "ipa\x1fkelas-xi", testWithTags.testId]);
    const admin = (await client.query<{ id: string }>("SELECT id::text AS id FROM admin_users WHERE username=$1", [process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    await client.query("INSERT INTO exam_session_plans(period_id,updated_by) VALUES($1,$2)", [testWithTags.periodId, admin]);
    await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,30)", [testWithTags.periodId]);
    await client.query(
      `INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,session_number,label,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
       VALUES($1,$2,'regular',1,'Sesi 1',clock_timestamp()-interval '10 minutes','WIB',60,$3,clock_timestamp(),$3)`,
      [testWithTags.testId, testWithTags.periodId, admin],
    );

    await loginAsAdmin(page); await page.goto("/data-tes/token"); await showAllTokenDates(page);
    await expect(testPanel(page, testWithTags.testId)).toContainText("IPA");
    await expect(testPanel(page, testWithTags.testId)).toContainText("Kelas-XI");

    await page.getByLabel("Durasi token global").selectOption("15");
    const autoSwitch = page.getByRole("switch", { name: /Auto-generate token global/i });
    await expect(autoSwitch).toHaveAttribute("aria-checked", "false");
    await autoSwitch.click();
    await expect(autoSwitch).toHaveAttribute("aria-checked", "true");
    await expect(globalPanel(page)).toContainText("Auto tiap 15 menit");

    const firstCode = await visibleCode(page);
    const firstRow = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0];
    expect((await client.query("SELECT enabled, duration_minutes FROM global_token_auto_rotate WHERE id=1")).rows[0]).toEqual({ enabled: true, duration_minutes: 15 });

    // Ubah durasi saat auto-generate aktif -> sinkron interval di DB
    await page.getByLabel("Durasi token global").selectOption("30");
    await expect.poll(async () => (await client.query<{ duration_minutes: number }>("SELECT duration_minutes FROM global_token_auto_rotate WHERE id=1")).rows[0].duration_minutes).toBe(30);

    // Persingkat sisa waktu menjadi 4 detik agar hitungan mundur alami memicu auto-rotate + auto-refresh UI
    await client.query(
      `WITH moment AS (SELECT clock_timestamp() AS now)
       UPDATE exam_access_tokens
       SET issued_at = moment.now - (duration_minutes * interval '1 minute') + interval '4 seconds',
           expires_at = moment.now + interval '4 seconds'
       FROM moment
       WHERE id = $1`,
      [firstRow.id],
    );
    await page.reload();
    await expect.poll(async () => (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0]?.id, { timeout: 15_000 }).not.toBe(firstRow.id);
    await expect(page.getByLabel("Kode token global", { exact: true })).not.toHaveText(firstCode, { timeout: 15_000 });
    const rotatedCode = await visibleCode(page);
    expect(rotatedCode).toMatch(/^[0-9]{6}$/);

    // Dashboard ikut menampilkan indikator auto-generate & tags
    await page.goto("/");
    const dashTokens = page.getByRole("table", { name: "Tabel token live" });
    await expect(dashTokens).toContainText(rotatedCode);
    await expect(dashTokens).toContainText("Auto 30 mnt");
    const dashMonitor = page.getByRole("table", { name: "Monitoring pelaksanaan tes" });
    await expect(dashMonitor).toContainText("IPA");

    // Cabut token global -> menonaktifkan auto-generate
    await page.goto("/data-tes/token");
    const activeGlobal = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0];
    await globalPanel(page).getByRole("button", { name: `Cabut token ${activeGlobal.id}` }).click();
    const revoke = page.getByRole("dialog", { name: "Cabut token?" });
    await expect(revoke).toContainText("Auto-generate token global akan ikut dinonaktifkan");
    await revoke.getByRole("button", { name: "Ya, cabut token" }).click();
    await expect(revoke).toBeHidden();
    await expect(page.getByRole("switch", { name: /Auto-generate token global/i })).toHaveAttribute("aria-checked", "false");
    expect((await client.query("SELECT enabled FROM global_token_auto_rotate WHERE id=1")).rows[0].enabled).toBe(false);
  } finally {
    await client.query("UPDATE global_token_auto_rotate SET enabled=false, updated_by_admin_id=NULL, updated_at=clock_timestamp() WHERE id=1").catch(() => {});
    if (periods.length) {
      await client.query("DELETE FROM exam_schedule_runs WHERE period_id=ANY($1::bigint[])", [periods]).catch(() => {});
      await client.query("DELETE FROM exam_session_groups WHERE period_id=ANY($1::bigint[])", [periods]).catch(() => {});
      await client.query("DELETE FROM exam_session_plans WHERE period_id=ANY($1::bigint[])", [periods]).catch(() => {});
    }
    await cleanupTokens(client, before, periods);
    await client.end();
  }
});
