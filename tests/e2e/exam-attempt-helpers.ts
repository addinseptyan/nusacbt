import { expect, type Page } from "@playwright/test";
import type pg from "pg";

import { digestSixDigitToken, encryptSixDigitToken, examTokenKeyVerifier } from "../../src/lib/exam-token-crypto.mjs";
import { cleanupLoginFixture, seedLoginFixture, type LoginFixture } from "./participant-login-helpers";
import { fixtureTokenKey } from "./token-helpers";

export type AttemptFixture = { login: LoginFixture; runId: string; questionIds: string[]; tokenIds: string[] };
export const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aS0AAAAASUVORK5CYII=", "base64");

export async function seedAttemptFixture(client: pg.Client, additionalQuestions = 2): Promise<AttemptFixture> {
  const login = await seedLoginFixture(client);
  const f: AttemptFixture = { login, runId: "", questionIds: [login.questionId], tokenIds: [] };
  try {
    f.runId = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_schedule_runs WHERE exam_test_id=$1", [login.activeTest])).rows[0].id;
    await client.query("UPDATE exam_tests SET shuffle_questions=true,shuffle_options=true WHERE id=$1", [login.activeTest]);
    await client.query("UPDATE question_bank SET prompt_image=$2,prompt_image_mime='image/png',updated_at=clock_timestamp() WHERE id=$1", [login.questionId, PIXEL_PNG]);
    for (let index = 0; index < additionalQuestions; index += 1) {
      const id = (await client.query<{ id: string }>(
        `INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option)
         VALUES($1,$2,'Opsi satu','Opsi dua','Opsi tiga','Opsi empat','Opsi lima',$3) RETURNING id::text AS id`,
        [login.topicId, `Soal tambahan ${index + 1} ${login.suffix}`, index === 0 ? "A" : "B"],
      )).rows[0].id;
      f.questionIds.push(id);
      await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,$3)", [login.activeTest, id, index + 2]);
    }
    await client.query("UPDATE exam_start_token_global_limit SET failed_attempts=0,window_started_at=clock_timestamp()-interval '2 minutes' WHERE id=1");
    return f;
  } catch (error) { await cleanupAttemptFixture(client, f); throw error; }
}

/** Token fiktif dibuat dengan kunci fixture yang sama seperti proses aplikasi. */
export async function seedAttemptToken(client: pg.Client, f: AttemptFixture, scope: "global" | "test", code: string) {
  const key = await fixtureTokenKey();
  try {
    if (scope === "global") {
      const existing = await client.query("SELECT 1 FROM exam_access_tokens WHERE scope='global' AND revoked_at IS NULL");
      if (existing.rowCount) throw new Error("Slot global sudah terisi; jangan menjalankan tes pada database yang dipakai bersama.");
    }
    await client.query("INSERT INTO exam_token_key_binding(id,verifier) VALUES(1,$1) ON CONFLICT(id) DO NOTHING", [examTokenKeyVerifier(key)]);
    const verifier = (await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id=1")).rows[0].verifier;
    if (!verifier.equals(examTokenKeyVerifier(key))) throw new Error("Kunci token fixture berbeda dari database uji.");
    const id = (await client.query<{ id: string }>("SELECT nextval(pg_get_serial_sequence('exam_access_tokens','id'))::text AS id")).rows[0].id;
    const encrypted = encryptSixDigitToken(code, key, { id, scope });
    await client.query(
      `WITH m AS (SELECT clock_timestamp() AS issued)
       INSERT INTO exam_access_tokens(id,scope,exam_test_id,test_name_snapshot,token_hash,duration_minutes,issued_at,expires_at,code_version,code_nonce,code_ciphertext,code_tag)
       OVERRIDING SYSTEM VALUE SELECT $1,$2,$3::bigint,$4,$5,15,issued,issued+interval '15 minutes',2,$6,$7,$8 FROM m`,
      [id, scope, scope === "test" ? f.login.activeTest : null, scope === "test" ? f.login.activeName : null,
        digestSixDigitToken(code, key), encrypted.nonce, encrypted.ciphertext, encrypted.tag],
    );
    f.tokenIds.push(id); return id;
  } finally { key.fill(0); }
}

export async function cleanupAttemptFixture(client: pg.Client, f: AttemptFixture) {
  const periods = [f.login.periodA, f.login.periodB];
  await client.query("DELETE FROM exam_retake_operations WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE period_id=ANY($1::bigint[]))", [periods]);
  await client.query("DELETE FROM exam_retake_permissions WHERE run_id IN (SELECT id FROM exam_schedule_runs WHERE period_id=ANY($1::bigint[]))", [periods]);
  await client.query("DELETE FROM exam_attempt_questions WHERE attempt_id IN (SELECT id FROM exam_attempts WHERE period_id=ANY($1::bigint[]))", [periods]);
  await client.query("DELETE FROM exam_attempts WHERE period_id=ANY($1::bigint[])", [periods]);
  await client.query("DELETE FROM exam_question_snapshots WHERE source_question_id=ANY($1::bigint[])", [f.questionIds]);
  await client.query("DELETE FROM exam_access_tokens WHERE id=ANY($1::bigint[])", [f.tokenIds]);
  const extras = f.questionIds.filter((id) => id !== f.login.questionId);
  await client.query("DELETE FROM exam_test_questions WHERE question_id=ANY($1::bigint[])", [extras]);
  await client.query("DELETE FROM question_bank WHERE id=ANY($1::bigint[])", [extras]);
  await client.query("DELETE FROM exam_start_token_attempts WHERE participant_identity_id=ANY($1::bigint[])", [[f.login.identityA, f.login.identityB]]);
  await client.query("UPDATE exam_start_token_global_limit SET failed_attempts=0,window_started_at=clock_timestamp()-interval '2 minutes' WHERE id=1");
  await cleanupLoginFixture(client, f.login);
}

export async function openStart(page: Page, runId: string) {
  await page.goto(`/peserta/jadwal/${runId}`);
  await expect(page.getByLabel("Token tes")).toBeVisible();
}
export async function startWithToken(page: Page, runId: string, code: string) {
  await openStart(page, runId);
  await page.getByLabel("Token tes").fill(code);
  await page.getByRole("button", { name: "Mulai pengerjaan" }).click();
  await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /^Soal 1/ })).toBeVisible({ timeout: 20_000 });
  return page.url().match(/\/pengerjaan\/([1-9]\d*)/)![1];
}
