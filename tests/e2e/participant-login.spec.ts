import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { digestSixDigitToken, encryptSixDigitToken, examTokenKeyVerifier } from "../../src/lib/exam-token-crypto.mjs";
import { cleanupLoginFixture, loginParticipant, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test("peserta masuk per periode dan hanya melihat identitas serta jadwal periode sendiri", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    if (!process.env.NUSACBT_EXAM_TOKEN_KEY_FILE) throw new Error("Kunci token fiktif diperlukan.");
    const tokenKey = Buffer.from((await readFile(process.env.NUSACBT_EXAM_TOKEN_KEY_FILE, "utf8")).trim(), "base64");
    const code = "730419";
    try {
      const verifier = examTokenKeyVerifier(tokenKey);
      await client.query("INSERT INTO exam_token_key_binding(id,verifier) VALUES(1,$1) ON CONFLICT(id) DO NOTHING", [verifier]);
      if (!(await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id=1")).rows[0].verifier.equals(verifier)) throw new Error("Kunci token uji tidak cocok.");
      const id = (await client.query<{ id: string }>("SELECT nextval(pg_get_serial_sequence('exam_access_tokens','id'))::text AS id")).rows[0].id;
      const encrypted = encryptSixDigitToken(code, tokenKey, { id, scope: "test" });
      await client.query(`WITH t AS (SELECT clock_timestamp() AS issued) INSERT INTO exam_access_tokens(id,scope,exam_test_id,test_name_snapshot,token_hash,duration_minutes,issued_at,expires_at,code_version,code_nonce,code_ciphertext,code_tag)
        OVERRIDING SYSTEM VALUE SELECT $1::bigint,'test',$2::bigint,$3,$4,15,issued,issued+interval '15 minutes',2,$5,$6,$7 FROM t`,
      [id, f.activeTest, f.activeName, digestSixDigitToken(code, tokenKey), encrypted.nonce, encrypted.ciphertext, encrypted.tag]);
    } finally { tokenKey.fill(0); }
    await page.goto("/peserta"); await expect(page).toHaveURL(/\/peserta\/login\?sesi=berakhir$/);
    await page.goto("/login"); await page.getByRole("link", { name: "Masuk sebagai peserta" }).click();
    await expect(page).toHaveURL(/\/peserta\/login$/);
    await loginParticipant(page, f.periodA, f.username.toUpperCase(), f.passwordA);
    await expect(page.getByRole("heading", { name: `Halo, ${f.studentAName}!` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Identitas peserta" })).toBeVisible();
    await expect(page.getByText(f.periodAName, { exact: true })).toBeVisible();
    await expect(page.getByText(f.activeName, { exact: true })).toBeVisible();
    await expect(page.getByText(f.futureName, { exact: true })).toBeVisible();
    await expect(page.getByText(f.pastName, { exact: true })).toBeVisible();
    await expect(page.getByText(f.hiddenName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(f.studentBName, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Mulai tes/i })).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(f.passwordA); expect(html).not.toContain(f.questionSecret); expect(html).not.toContain("Jawaban rahasia"); expect(html).not.toContain(code);
    const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_participant_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/peserta" });
    if (!cookie) throw new Error("Cookie peserta tidak ada.");
    const digest = createHash("sha256").update(cookie.value).digest();
    const row = (await client.query<{ token_hash: Buffer }>("SELECT token_hash FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rows[0];
    expect(row.token_hash.equals(digest)).toBe(true);
    expect(row.token_hash.equals(Buffer.from(cookie.value))).toBe(false);
    const response = await page.request.get("/peserta");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    await page.goto(`/peserta?periode=${f.periodB}`); await expect(page.getByText(f.hiddenName, { exact: true })).toHaveCount(0);
    await page.goto("/data-peserta/sandi"); await expect(page).toHaveURL(/\/login$/);
    await page.goto("/peserta"); await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/peserta\/login$/);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(0);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
