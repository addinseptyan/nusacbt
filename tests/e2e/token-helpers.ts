import { expect, type Locator, type Page } from "@playwright/test";
import type pg from "pg";

export async function tokenBaseline(client: pg.Client) {
  const rows = (await client.query<{ id: string; openGlobal: boolean }>("SELECT id::text AS id, (scope='global' AND revoked_at IS NULL) AS \"openGlobal\" FROM exam_access_tokens")).rows;
  if (rows.some((row) => row.openGlobal)) throw new Error("Database khusus tes sudah memiliki slot token global; gunakan database pengujian kosong.");
  const operations = (await client.query<{ id: string }>("SELECT operation_id::text AS id FROM exam_token_issue_operations")).rows.map((row) => row.id);
  return { tokens: rows.map((row) => row.id), operations };
}
export async function cleanupTokens(client: pg.Client, before: { tokens: string[]; operations: string[] }, periods: string[]) {
  // Semua data baru di database khusus pengujian; jangan menghapus baris yang
  // sudah ada sebelum kasus ini dimulai. Kasus token harus berjalan serial.
  await client.query("DELETE FROM exam_token_issue_operations WHERE NOT (operation_id=ANY($1::uuid[]))", [before.operations]);
  await client.query("DELETE FROM exam_access_tokens WHERE NOT (id=ANY($1::bigint[]))", [before.tokens]);
  if (periods.length) {
    await client.query("DELETE FROM exam_tests WHERE period_id=ANY($1::bigint[])", [periods]);
    await client.query("DELETE FROM exam_periods WHERE id=ANY($1::bigint[])", [periods]);
  }
}
export async function makeTest(client: pg.Client, tag: string) {
  const periodId = (await client.query<{ id: string }>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2026-01-01') RETURNING id::text AS id", [`Periode Token ${tag}`])).rows[0].id;
  const test = (await client.query<{ id: string; revision: string }>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2026-11-17T01:30Z','WIB',90) RETURNING id::text AS id,xmin::text AS revision", [periodId, `Tes Token ${tag}`])).rows[0];
  return { periodId, testId: test.id, revision: test.revision };
}
export async function issueForm(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Buat token", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Buat token", exact: true }); await expect(dialog).toBeVisible(); return dialog;
}
export async function finishIssue(page: Page) {
  const result = page.getByRole("dialog", { name: "Token berhasil dibuat", exact: true }); await expect(result).toBeVisible();
  const code = await result.getByLabel("Kode token baru").inputValue();
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){2}$/);
  return { result, code };
}
export function tokenRow(page: Page, id: string) {
  return page.getByRole("list", { name: "Daftar token" }).getByRole("listitem").filter({ has: page.getByText(new RegExp(`^Token #${id} ·`)) });
}
