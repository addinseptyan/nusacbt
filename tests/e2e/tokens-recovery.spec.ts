import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { testDatabase } from "./question-helpers";
import { cleanupTokens, issueForm, tokenBaseline, tokenRow } from "./token-helpers";

const storageKey = "nusacbt.token.pending-issue.v1";

test("respons yang hilang setelah commit dipulihkan sesudah reload tanpa membuka ulang kode", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); let intercepted = false;
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/token");
    await page.route("**/data-tes/token", async (route) => {
      if (!intercepted && route.request().method() === "POST") {
        intercepted = true;
        // Server memproses dan commit, tetapi browser tidak menerima respons.
        await route.fetch(); await route.abort("failed");
      } else await route.continue();
    });
    const form = await issueForm(page); await form.getByRole("button", { name: "Buat token", exact: true }).click();
    let recovery = page.getByRole("dialog", { name: "Hasil pembuatan belum pasti" }); await expect(recovery).toBeVisible(); expect(intercepted).toBe(true);
    const operationId = await page.evaluate((key) => sessionStorage.getItem(key), storageKey); expect(operationId).toMatch(/^[0-9a-f-]{36}$/);
    const state = (await client.query<{ result: string; token_id: string }>("SELECT result,token_id::text AS token_id FROM exam_token_issue_operations WHERE operation_id=$1::uuid", [operationId])).rows[0];
    expect(state.result).toBe("issued"); expect(state.token_id).toBeTruthy();
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE id=$1 AND revoked_at IS NULL", [state.token_id])).rowCount).toBe(1);
    await page.unroute("**/data-tes/token"); await page.reload(); recovery = page.getByRole("dialog", { name: "Hasil pembuatan belum pasti" }); await expect(recovery).toBeVisible();
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Token sempat dibuat"); await expect(recovery).toContainText(`token #${state.token_id}`);
    await expect(page.getByLabel("Kode token baru")).toHaveCount(0); expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click(); await expect(tokenRow(page, state.token_id)).toContainText("Aktif");
    await tokenRow(page, state.token_id).getByRole("button", { name: `Cabut token ${state.token_id}` }).click(); await page.getByRole("dialog", { name: "Cabut token?" }).getByRole("button", { name: "Ya, cabut token" }).click(); await expect(tokenRow(page, state.token_id)).toContainText("Dicabut");
  } finally { await page.unroute("**/data-tes/token"); await cleanupTokens(client, before, []); await client.end(); }
});

test("pemulihan memagari permintaan yang datang terlambat dan aman diulang", async ({ page }) => {
  test.setTimeout(60_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  let captured: { body: Buffer; action: string; contentType: string } | undefined;
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/token");
    await page.route("**/data-tes/token", async (route) => {
      if (!captured && route.request().method() === "POST") {
        const request = route.request(); const body = request.postDataBuffer(); const action = request.headers()["next-action"]; const contentType = request.headers()["content-type"];
        if (!body || !action || !contentType) throw new Error("Permintaan tidak tertangkap lengkap.");
        captured = { body, action, contentType }; await route.abort("failed");
      } else await route.continue();
    });
    const form = await issueForm(page); await form.getByRole("button", { name: "Buat token", exact: true }).click();
    let recovery = page.getByRole("dialog", { name: "Hasil pembuatan belum pasti" }); await expect(recovery).toBeVisible();
    const operationId = await page.evaluate((key) => sessionStorage.getItem(key), storageKey); expect(operationId).toBeTruthy();
    await page.unroute("**/data-tes/token"); await page.reload(); recovery = page.getByRole("dialog", { name: "Hasil pembuatan belum pasti" }); await expect(recovery).toBeVisible();
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Permintaan diamankan");
    expect((await client.query("SELECT result,token_id FROM exam_token_issue_operations WHERE operation_id=$1::uuid", [operationId])).rows[0]).toEqual({ result: "cancelled", token_id: null });
    await recovery.getByRole("button", { name: "Tutup dan muat ulang status" }).click(); await expect(recovery).toBeHidden();
    if (!captured) throw new Error("Permintaan lama tidak tertangkap.");
    const old = captured as { body: Buffer; action: string; contentType: string };
    const response = await page.request.post("/data-tes/token", { headers: { "next-action": old.action, "content-type": old.contentType, origin: "http://127.0.0.1:3100" }, data: old.body, failOnStatusCode: false });
    expect(await response.text()).toContain("Permintaan ini sudah diselesaikan");
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(0);
    // Setelah pemuatan ulang pun, pemeriksaan ulang UUID yang sama tetap aman.
    await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [storageKey, operationId!]); await page.reload(); recovery = page.getByRole("dialog", { name: "Hasil pembuatan belum pasti" }); await expect(recovery).toBeVisible();
    await recovery.getByRole("button", { name: "Periksa dan amankan" }).click(); await expect(recovery).toContainText("Permintaan diamankan");
    expect((await client.query("SELECT count(*)::int AS count FROM exam_token_issue_operations WHERE operation_id=$1::uuid", [operationId])).rows[0].count).toBe(1);
  } finally { await page.unroute("**/data-tes/token"); await cleanupTokens(client, before, []); await client.end(); }
});

test("pembuatan ditutup bila penyimpanan sesi browser tidak dapat diakses", async ({ page }) => {
  await loginAsAdmin(page);
  await page.addInitScript(() => { Object.defineProperty(window, "sessionStorage", { get() { throw new Error("blocked for test"); } }); });
  await page.goto("/data-tes/token"); await expect(page.getByRole("alert").filter({ hasText: "Pembuatan token belum tersedia" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buat token", exact: true })).toBeDisabled();
});
