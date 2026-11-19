import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { suffix, testDatabase } from "./question-helpers";
import { cleanupTokens, confirmIssue, issueForm, makeTest, openTokenHistory, showAllTokenDates, tokenBaseline, tokenRow, visibleCode } from "./token-helpers";

test("riwayat menandai jadwal berakhir dan menyinkronkan ulang saat kembali ke tab", async ({ page }) => {
  test.setTimeout(45_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const periods: string[] = [];
  try {
    const data = await makeTest(client, suffix(), "active"); periods.push(data.periodId);
    await loginAsAdmin(page); await page.goto("/data-tes/token"); await showAllTokenDates(page);
    await confirmIssue(await issueForm(page, "global")); const globalCode = await visibleCode(page);
    const globalId = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id;
    await confirmIssue(await issueForm(page, `tes ${data.testId}`)); const code = await visibleCode(page, `tes ${data.testId}`);
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE exam_test_id=$1 AND revoked_at IS NULL", [data.testId])).rows[0].id;
    await client.query("UPDATE exam_tests SET starts_at=clock_timestamp()-interval '89 minutes 45 seconds' WHERE id=$1", [data.testId]);
    await openTokenHistory(page);
    await expect(tokenRow(page, id)).toContainText("Aktif");
    await expect(tokenRow(page, id).getByRole("button", { name: `Salin kode riwayat token ${id}` })).toBeVisible();
    await client.query(`WITH moment AS (SELECT clock_timestamp()-interval '20 minutes' AS issued)
      UPDATE exam_access_tokens k SET issued_at=moment.issued,expires_at=moment.issued+k.duration_minutes*interval '1 minute' FROM moment WHERE k.id=$1`, [globalId]);
    // Menggambarkan tab yang kembali terlihat setelah timer browser tertunda.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(tokenRow(page, globalId)).toContainText("Kedaluwarsa · tidak berlaku", { timeout: 10_000 });
    await expect(tokenRow(page, globalId)).toContainText(globalCode);
    await expect(tokenRow(page, globalId).getByRole("button", { name: `Salin kode riwayat token ${globalId}` })).toHaveCount(0);
    await expect(tokenRow(page, id)).toContainText("Jadwal berakhir · tidak berlaku", { timeout: 20_000 });
    await expect(page.getByLabel(`Kode riwayat token ${id}`)).toHaveText(code);
    await expect(page.getByLabel(`Kode riwayat token ${id}`)).toHaveClass(/text-muted-foreground/);
    await expect(tokenRow(page, id).getByRole("button", { name: `Salin kode riwayat token ${id}` })).toHaveCount(0);
  } finally { await cleanupTokens(client, before, periods); await client.end(); }
});
