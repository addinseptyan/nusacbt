import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { digestSixDigitToken } from "../../src/lib/exam-token-crypto.mjs";
import { digestExamToken } from "../../src/lib/exam-token.mjs";
import { loginAsAdmin } from "./helpers";
import { sessionDigest, suffix, testDatabase } from "./question-helpers";
import { cleanupTokens, confirmIssue, fixtureTokenKey, globalPanel, issueForm, makeTest, tokenBaseline, visibleCode } from "./token-helpers";

const BOUNDARY = "nusacbt-token-test-boundary";
function multipart(entries: Array<[string, string]>) { return Buffer.from(entries.map(([key, value]) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join("") + `--${BOUNDARY}--\r\n`); }
function change(entries: Array<[string, string]>, name: string, value: string, duplicate = false) {
  const result = entries.map((entry) => [...entry] as [string, string]); const i = result.findIndex(([key]) => key.endsWith(name)); if (i < 0) throw new Error(`Field ${name} tidak tertangkap.`);
  if (duplicate) result.splice(i + 1, 0, [result[i][0], value]); else result[i][1] = value; return result;
}

test("aksi token menolak asal asing, anonim, field ganda, durasi lain, penggantian tanpa konfirmasi, dan replay", async ({ page, browser }) => {
  test.setTimeout(90_000); const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); const key = await fixtureTokenKey();
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/token");
    await page.evaluate(() => {
      const w = window as Window & { capturedTokenFields?: Array<[string, string]> }; const original = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body instanceof FormData) w.capturedTokenFields = Array.from(init.body.entries()).map(([key, value]) => { if (typeof value !== "string") throw new Error("File tidak diharapkan."); return [key, value]; });
        return original(input, init);
      }) as typeof fetch;
    });
    const form = await issueForm(page); const requestPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-tes/token");
    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-tes/token");
    await confirmIssue(form); const request = await requestPromise; const response = await responsePromise; expect(response.headers()["cache-control"]).toContain("no-store");
    const code = await visibleCode(page); const entries = await page.evaluate(() => (window as Window & { capturedTokenFields?: Array<[string, string]> }).capturedTokenFields ?? []);
    expect(entries.length).toBeGreaterThan(4); expect(JSON.stringify(entries)).not.toContain(code);
    const action = request.headers()["next-action"]; if (!action) throw new Error("Identitas Server Action tidak tertangkap.");
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id;
    const headers = { "content-type": `multipart/form-data; boundary=${BOUNDARY}`, "next-action": action }; const origin = "http://127.0.0.1:3100";
    const foreign = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "https://attacker.invalid" }, data: multipart(entries), failOnStatusCode: false }); expect(foreign.status()).toBeGreaterThanOrEqual(400);
    const duplicate = await page.request.post("/data-tes/token", { headers: { ...headers, origin }, data: multipart(change(entries, "durationMinutes", "1440", true)), failOnStatusCode: false }); expect(await duplicate.text()).toContain("nilai ganda");
    for (const duration of ["4", "10", "1441", "5.5"]) { const invalid = await page.request.post("/data-tes/token", { headers: { ...headers, origin }, data: multipart(change(entries, "durationMinutes", duration)), failOnStatusCode: false }); expect(await invalid.text()).toContain("Pilih masa aktif yang tersedia"); }
    const oldForm = await page.request.post("/data-tes/token", { headers: { ...headers, origin }, data: multipart(change(entries, "formVersion", "access-token-v1")), failOnStatusCode: false }); expect(await oldForm.text()).toContain("Versi formulir tidak sesuai");
    const replay = await page.request.post("/data-tes/token", { headers: { ...headers, origin }, data: multipart(entries), failOnStatusCode: false }); expect(await replay.text()).toContain("Permintaan ini sudah diselesaikan");
    const fresh = change(entries, "operationId", randomUUID());
    const stale = await page.request.post("/data-tes/token", { headers: { ...headers, origin }, data: multipart(fresh), failOnStatusCode: false }); expect(await stale.text()).toContain("Status token sudah berubah");
    const withoutConfirm = await page.request.post("/data-tes/token", { headers: { ...headers, origin }, data: multipart(change(fresh, "expectedTokenId", id)), failOnStatusCode: false }); expect(await withoutConfirm.text()).toContain("Konfirmasi penggantian token aktif diperlukan");
    const anonymous = await browser.newContext(); try { await anonymous.request.post("http://127.0.0.1:3100/data-tes/token", { headers: { ...headers, origin }, data: multipart(entries), failOnStatusCode: false }); } finally { await anonymous.close(); }
    const rows = (await client.query("SELECT id::text AS id,revoked_at,token_hash FROM exam_access_tokens WHERE scope='global'")).rows;
    expect(rows).toHaveLength(1); expect(rows[0].id).toBe(id); expect(rows[0].revoked_at).toBeNull(); expect(rows[0].token_hash).toEqual(digestSixDigitToken(code, key));
    await globalPanel(page).getByRole("button", { name: `Cabut token ${id}` }).click(); await page.getByRole("dialog", { name: "Cabut token?" }).getByRole("button", { name: "Ya, cabut token" }).click(); await expect(globalPanel(page)).toContainText("Dicabut");
    const replayAfterRevoke = await page.request.post("/data-tes/token", { headers: { ...headers, origin }, data: multipart(entries), failOnStatusCode: false }); expect(await replayAfterRevoke.text()).toContain("Permintaan ini sudah diselesaikan");
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(1);
  } finally { key.fill(0); await cleanupTokens(client, before, []); await client.end(); }
});

test("constraint database menegakkan scope, masa, ciphertext, hash, dan satu slot per cakupan", async () => {
  const client = testDatabase(); await client.connect();
  try {
    await client.query("BEGIN"); const tag = suffix(); const data = await makeTest(client, tag); const other = await makeTest(client, `${tag}-other`);
    const insert = `INSERT INTO exam_access_tokens(scope,exam_test_id,test_name_snapshot,token_hash,duration_minutes,issued_at,expires_at)
      VALUES($1,$2,$3,$4,$5,'2026-01-01T00:00Z',$6::timestamptz)`;
    await client.query(insert, ["global", null, null, digestExamToken("ABCD-EFGH-JK23"), 5, "2026-01-01T00:05Z"]);
    const specific = (await client.query<{ id: string }>(`${insert} RETURNING id::text AS id`, ["test", data.testId, `Tes Token ${tag}`, digestExamToken("ABCD-EFGH-JK24"), 5, "2026-01-01T00:05Z"])).rows[0].id;
    const cases: Array<[string, unknown[], string]> = [
      [insert, ["global", null, null, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23505"],
      [insert, ["test", data.testId, `Tes Token ${tag}`, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23505"],
      [insert, ["test", other.testId, "Hash sama", digestExamToken("ABCD-EFGH-JK23"), 5, "2026-01-01T00:05Z"], "23505"],
      [insert, ["global", data.testId, null, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23514"],
      [insert, ["test", data.testId, null, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23514"],
      [insert, ["invalid", null, null, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23514"],
      [insert, ["test", "9223372036854775807", "Tidak ada", digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23503"],
      [insert, ["test", data.testId, "Durasi", digestExamToken("ABCD-EFGH-JK25"), 4, "2026-01-01T00:04Z"], "23514"],
      [insert, ["test", data.testId, "Akhir", digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:06Z"], "23514"],
      [insert, ["test", data.testId, "Hash", Buffer.alloc(31), 5, "2026-01-01T00:05Z"], "23514"],
      ["UPDATE exam_access_tokens SET revoked_at=clock_timestamp() WHERE id=$1", [specific], "23514"],
      ["UPDATE exam_access_tokens SET issued_at='infinity',expires_at='infinity' WHERE id=$1", [specific], "23514"],
      ["UPDATE exam_access_tokens SET code_version=2 WHERE id=$1", [specific], "23514"],
      ["UPDATE exam_access_tokens SET code_version=2,code_nonce=$2,code_ciphertext=$3,code_tag=$4,duration_minutes=10,expires_at=issued_at+interval '10 minutes' WHERE id=$1", [specific, Buffer.alloc(12), Buffer.alloc(6), Buffer.alloc(16)], "23514"],
    ];
    for (const [sql, params, code] of cases) { await client.query("SAVEPOINT guard_token"); try { await expect(client.query(sql, params)).rejects.toMatchObject({ code }); } finally { await client.query("ROLLBACK TO SAVEPOINT guard_token"); } }
    await client.query("DELETE FROM exam_tests WHERE id=$1", [data.testId]); expect((await client.query("SELECT scope,exam_test_id,test_name_snapshot FROM exam_access_tokens WHERE id=$1", [specific])).rows[0]).toEqual({ scope: "test", exam_test_id: null, test_name_snapshot: `Tes Token ${tag}` });
  } finally { await client.query("ROLLBACK").catch(() => {}); await client.end(); }
});

test("sesi admin yang dicabut tidak dapat menerbitkan token", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  try { await loginAsAdmin(page); await page.goto("/data-tes/token"); const form = await issueForm(page); const digest = await sessionDigest(page);
    await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [digest]); await form.getByRole("button", { name: "Ya, aktifkan token" }).click();
    await page.goto("/data-tes/token"); await expect(page).toHaveURL(/\/login$/); expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(0);
  } finally { await cleanupTokens(client, before, []); await client.end(); }
});

test("ciphertext atau hash yang diubah tidak ditampilkan sebagai kode valid", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/token"); await confirmIssue(await issueForm(page)); const code = await visibleCode(page);
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id;
    await client.query("UPDATE exam_access_tokens SET code_tag=set_byte(code_tag,0,get_byte(code_tag,0) # 1) WHERE id=$1", [id]);
    await page.reload(); await expect(globalPanel(page)).toContainText("Data token tidak dapat dibuka"); await expect(globalPanel(page)).not.toContainText(code);
    await client.query("UPDATE exam_access_tokens SET code_tag=set_byte(code_tag,0,get_byte(code_tag,0) # 1),token_hash=set_byte(token_hash,0,get_byte(token_hash,0) # 1) WHERE id=$1", [id]);
    await page.reload(); await expect(globalPanel(page)).toContainText("Data token tidak dapat dibuka"); await expect(globalPanel(page)).not.toContainText(code);
  } finally { await cleanupTokens(client, before, []); await client.end(); }
});

test("kunci salah atau binding hilang tidak membuka kode dan tidak dapat membuat token baru", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client); let verifier: Buffer | undefined;
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/token"); const form = await issueForm(page); await confirmIssue(form); const code = await visibleCode(page);
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id;
    verifier = (await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id=1")).rows[0].verifier;
    await client.query("UPDATE exam_token_key_binding SET verifier=decode(repeat('00',32),'hex') WHERE id=1"); await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "Kunci token perlu diperiksa" })).toContainText("tidak cocok"); await expect(globalPanel(page)).not.toContainText(code);
    await expect(page.getByRole("button", { name: "Ganti token global" })).toBeDisabled();
    await client.query("DELETE FROM exam_token_key_binding WHERE id=1"); await page.reload(); await expect(page.getByRole("alert").filter({ hasText: "Kunci token perlu diperiksa" })).toContainText("Pengikat kunci token database hilang");
    await globalPanel(page).getByRole("button", { name: `Cabut token ${id}` }).click(); await page.getByRole("dialog", { name: "Cabut token?" }).getByRole("button", { name: "Ya, cabut token" }).click();
    await expect(globalPanel(page)).toContainText("Dicabut"); expect((await client.query("SELECT revoked_reason FROM exam_access_tokens WHERE id=$1", [id])).rows[0].revoked_reason).toBe("manual");
  } finally {
    if (verifier) await client.query("INSERT INTO exam_token_key_binding(id,verifier) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET verifier=EXCLUDED.verifier", [verifier]);
    await cleanupTokens(client, before, []); await client.end();
  }
});
