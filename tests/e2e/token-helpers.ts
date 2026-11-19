import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import type pg from "pg";

export async function tokenBaseline(client: pg.Client) {
  const rows = (await client.query<{ id: string; openGlobal: boolean }>("SELECT id::text AS id, (scope='global' AND revoked_at IS NULL) AS \"openGlobal\" FROM exam_access_tokens")).rows;
  if (rows.some((row) => row.openGlobal)) throw new Error("Database khusus tes sudah memiliki slot token global; gunakan database pengujian kosong.");
  const operations = (await client.query<{ id: string }>("SELECT operation_id::text AS id FROM exam_token_issue_operations")).rows.map((row) => row.id);
  return { tokens: rows.map((row) => row.id), operations };
}
export async function cleanupTokens(client: pg.Client, before: { tokens: string[]; operations: string[] }, periods: string[]) {
  // Database fiktif khusus tes dan satu worker; jangan hapus baris awal.
  await client.query("DELETE FROM exam_token_issue_operations WHERE NOT (operation_id=ANY($1::uuid[]))", [before.operations]);
  await client.query("DELETE FROM exam_access_tokens WHERE NOT (id=ANY($1::bigint[]))", [before.tokens]);
  if (periods.length) {
    await client.query("DELETE FROM exam_tests WHERE period_id=ANY($1::bigint[])", [periods]);
    await client.query("DELETE FROM exam_periods WHERE id=ANY($1::bigint[])", [periods]);
  }
}
export async function makeTest(client: pg.Client, tag: string, schedule: "future" | "active" | "past" = "future") {
  const periodId = (await client.query<{ id: string }>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2026-01-01') RETURNING id::text AS id", [`Periode Token ${tag}`])).rows[0].id;
  const interval = schedule === "future" ? "1 hour" : schedule === "active" ? "-30 minutes" : "-3 hours";
  const test = (await client.query<{ id: string; revision: string }>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,clock_timestamp()+$3::interval,'WIB',90) RETURNING id::text AS id,xmin::text AS revision", [periodId, `Tes Token ${tag}`, interval])).rows[0];
  return { periodId, testId: test.id, revision: test.revision };
}
export function globalPanel(page: Page) { return page.getByRole("region", { name: "Token global" }); }
export function testPanel(page: Page, id: string) { return page.getByRole("listitem", { name: `Tes ${id}` }); }
export function tokenRow(page: Page, id: string) {
  return page.getByRole("list", { name: "Riwayat token" }).getByRole("listitem").filter({ has: page.getByText(new RegExp(`^Token #${id} ·`)) });
}
export async function issueForm(page: Page, target = "global", duration = "15"): Promise<Locator> {
  await page.getByLabel(`Durasi token ${target}`).selectOption(duration);
  await page.getByRole("button", { name: new RegExp(`^(Aktifkan|Ganti) token ${target}$`) }).click();
  const dialog = page.getByRole("dialog", { name: /^(Aktifkan token\?|Ganti token aktif\?)$/ }); await expect(dialog).toBeVisible(); return dialog;
}
export async function confirmIssue(dialog: Locator) {
  const checkbox = dialog.getByLabel("Saya memahami token sebelumnya akan diganti."); if (await checkbox.count()) await checkbox.check();
  await dialog.getByRole("button", { name: /^(Ya, aktifkan token|Ya, ganti token)$/ }).click(); await expect(dialog).toBeHidden();
}
export async function visibleCode(page: Page, target = "global") {
  const field = page.getByLabel(`Kode token ${target}`, { exact: true }); await expect(field).toHaveText(/^[0-9]{6}$/); return (await field.textContent())!;
}
export async function fixtureTokenKey() {
  if (!process.env.NUSACBT_EXAM_TOKEN_KEY_FILE) throw new Error("Kunci token fiktif diperlukan untuk tes.");
  return Buffer.from((await readFile(process.env.NUSACBT_EXAM_TOKEN_KEY_FILE, "utf8")).trim(), "base64");
}
