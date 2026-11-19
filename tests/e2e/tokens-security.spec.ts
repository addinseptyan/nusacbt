import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { digestExamToken } from "../../src/lib/exam-token.mjs";
import { loginAsAdmin } from "./helpers";
import { sessionDigest, suffix, testDatabase } from "./question-helpers";
import { cleanupTokens, finishIssue, issueForm, makeTest, tokenBaseline, tokenRow } from "./token-helpers";

const BOUNDARY = "nusacbt-token-test-boundary";
function multipart(entries: Array<[string, string]>) {
  return Buffer.from(entries.map(([key, value]) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join("") + `--${BOUNDARY}--\r\n`);
}
function change(entries: Array<[string, string]>, name: string, value: string, duplicate = false) {
  const result = entries.map((entry) => [...entry] as [string, string]);
  const i = result.findIndex(([key]) => key.endsWith(name)); if (i < 0) throw new Error(`Field ${name} tidak tertangkap.`);
  if (duplicate) result.splice(i + 1, 0, [result[i][0], value]); else result[i][1] = value;
  return result;
}

test("aksi token menolak asal asing, anonim, field ganda, penggantian tanpa konfirmasi, dan replay", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/token");
    await page.evaluate(() => {
      const w = window as Window & { capturedTokenFields?: Array<[string, string]> }; const original = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body instanceof FormData) w.capturedTokenFields = Array.from(init.body.entries()).map(([key, value]) => { if (typeof value !== "string") throw new Error("File tidak diharapkan."); return [key, value]; });
        return original(input, init);
      }) as typeof fetch;
    });
    const form = await issueForm(page);
    const requestPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-tes/token");
    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/data-tes/token");
    await form.getByRole("button", { name: "Buat token", exact: true }).click(); const request = await requestPromise; const response = await responsePromise;
    expect(response.headers()["cache-control"]).toContain("no-store");
    const issued = await finishIssue(page); const code = issued.code; await issued.result.getByRole("button", { name: "Saya sudah mencatat, tutup" }).click();
    const entries = await page.evaluate(() => (window as Window & { capturedTokenFields?: Array<[string, string]> }).capturedTokenFields ?? []);
    expect(entries.length).toBeGreaterThan(4); expect(JSON.stringify(entries)).not.toContain(code);
    const action = request.headers()["next-action"]; if (!action) throw new Error("Identitas Server Action tidak tertangkap.");
    const id = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rows[0].id;
    const headers = { "content-type": `multipart/form-data; boundary=${BOUNDARY}`, "next-action": action };
    const foreign = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "https://attacker.invalid" }, data: multipart(entries), failOnStatusCode: false }); expect(foreign.status()).toBeGreaterThanOrEqual(400);
    const duplicate = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(change(entries, "durationMinutes", "1440", true)), failOnStatusCode: false }); expect(await duplicate.text()).toContain("nilai ganda");
    for (const duration of ["4", "1441", "5.5"]) {
      const invalid = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(change(entries, "durationMinutes", duration)), failOnStatusCode: false }); expect(await invalid.text()).toContain("Masa aktif harus berupa menit bulat");
    }
    const oldForm = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(change(entries, "formVersion", "access-token-v0")), failOnStatusCode: false }); expect(await oldForm.text()).toContain("Versi formulir tidak sesuai");
    const replay = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(entries), failOnStatusCode: false }); expect(await replay.text()).toContain("Permintaan ini sudah diselesaikan");
    const fresh = change(entries, "operationId", randomUUID());
    const stale = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(fresh), failOnStatusCode: false }); expect(await stale.text()).toContain("Status token sudah berubah");
    const withoutConfirm = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(change(fresh, "expectedTokenId", id)), failOnStatusCode: false }); expect(await withoutConfirm.text()).toContain("Konfirmasi penggantian token aktif diperlukan");
    const anonymous = await browser.newContext(); try { await anonymous.request.post("http://127.0.0.1:3100/data-tes/token", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(entries), failOnStatusCode: false }); } finally { await anonymous.close(); }
    const rows = (await client.query("SELECT id::text AS id,revoked_at,token_hash FROM exam_access_tokens WHERE scope='global'")).rows;
    expect(rows).toHaveLength(1); expect(rows[0].id).toBe(id); expect(rows[0].revoked_at).toBeNull(); expect(rows[0].token_hash).toEqual(digestExamToken(code));
    await tokenRow(page, id).getByRole("button", { name: `Cabut token ${id}` }).click(); await page.getByRole("dialog", { name: "Cabut token?" }).getByRole("button", { name: "Ya, cabut token" }).click();
    await expect(tokenRow(page, id)).toContainText("Dicabut");
    const replayAfterRevoke = await page.request.post("/data-tes/token", { headers: { ...headers, origin: "http://127.0.0.1:3100" }, data: multipart(entries), failOnStatusCode: false }); expect(await replayAfterRevoke.text()).toContain("Permintaan ini sudah diselesaikan");
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(1);
  } finally { await cleanupTokens(client, before, []); await client.end(); }
});

test("constraint database menegakkan durasi, hubungan, hash, status, dan satu slot per cakupan", async () => {
  const client = testDatabase(); await client.connect();
  try {
    await client.query("BEGIN"); const tag = suffix(); const data = await makeTest(client, tag);
    const insert = `INSERT INTO exam_access_tokens(scope,exam_test_id,test_name_snapshot,token_hash,duration_minutes,issued_at,expires_at)
      VALUES($1,$2,$3,$4,$5,'2026-01-01T00:00Z',$6::timestamptz)`;
    await client.query(insert, ["global", null, null, digestExamToken("ABCD-EFGH-JK23"), 5, "2026-01-01T00:05Z"]);
    const specific = (await client.query<{ id: string }>(`${insert} RETURNING id::text AS id`, ["test", data.testId, `Tes Token ${tag}`, digestExamToken("ABCD-EFGH-JK24"), 5, "2026-01-01T00:05Z"])).rows[0].id;
    const cases: Array<[string, unknown[], string]> = [
      [insert, ["global", null, null, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23505"],
      [insert, ["test", data.testId, `Tes Token ${tag}`, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23505"],
      [insert, ["global", data.testId, null, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23514"],
      [insert, ["test", data.testId, null, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23514"],
      [insert, ["invalid", null, null, digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23514"],
      [insert, ["test", "9223372036854775807", "Tidak ada", digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:05Z"], "23503"],
      [insert, ["test", data.testId, "Durasi", digestExamToken("ABCD-EFGH-JK25"), 4, "2026-01-01T00:04Z"], "23514"],
      [insert, ["test", data.testId, "Durasi", digestExamToken("ABCD-EFGH-JK25"), 1441, "2026-01-02T00:01Z"], "23514"],
      [insert, ["test", data.testId, "Akhir", digestExamToken("ABCD-EFGH-JK25"), 5, "2026-01-01T00:06Z"], "23514"],
      [insert, ["test", data.testId, "Hash", Buffer.alloc(31), 5, "2026-01-01T00:05Z"], "23514"],
      ["UPDATE exam_access_tokens SET revoked_at=clock_timestamp() WHERE id=$1", [specific], "23514"],
      ["UPDATE exam_access_tokens SET issued_at='infinity',expires_at='infinity' WHERE id=$1", [specific], "23514"],
    ];
    for (const [sql, params, code] of cases) { await client.query("SAVEPOINT guard_token"); try { await expect(client.query(sql, params)).rejects.toMatchObject({ code }); } finally { await client.query("ROLLBACK TO SAVEPOINT guard_token"); } }
    await client.query("DELETE FROM exam_tests WHERE id=$1", [data.testId]);
    expect((await client.query("SELECT scope,exam_test_id,test_name_snapshot FROM exam_access_tokens WHERE id=$1", [specific])).rows[0]).toEqual({ scope: "test", exam_test_id: null, test_name_snapshot: `Tes Token ${tag}` });
    expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL")).rowCount).toBe(1);
  } finally { await client.query("ROLLBACK").catch(() => {}); await client.end(); }
});

test("sesi admin yang dicabut tidak dapat menerbitkan token", async ({ page }) => {
  const client = testDatabase(); await client.connect(); const before = await tokenBaseline(client);
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/token"); const form = await issueForm(page); const digest = await sessionDigest(page);
    await client.query("DELETE FROM admin_sessions WHERE token_hash=$1", [digest]); await form.getByRole("button", { name: "Buat token", exact: true }).click();
    await page.goto("/data-tes/token"); await expect(page).toHaveURL(/\/login$/); expect((await client.query("SELECT id FROM exam_access_tokens WHERE scope='global'")).rowCount).toBe(0);
  } finally { await cleanupTokens(client, before, []); await client.end(); }
});
