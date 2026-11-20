import { randomBytes, randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";

import { participantSessionDigest } from "../../src/lib/participant-login-validation.mjs";
import { encryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { hashParticipantPassword } from "../../src/lib/password.mjs";
import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test("simulasi 30 sesi fiktif memulai dan menyimpan serentak lewat HTTP tanpa menduplikasi snapshot", async ({ page }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0); const studentIds: string[] = [], identityIds: string[] = [];
  const sessions: { identity: string; token: string }[] = [];
  const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
  try {
    await seedAttemptToken(client, f, "global", "998866");
    const hash = await hashParticipantPassword("ABCDEFGH");
    // Sesi ini diterbitkan langsung sebagai fixture, bukan uji login serentak.
    // Nama/NISN/identitas dan sandi semuanya fiktif, satu periode aktif.
    await client.query("BEGIN");
    try {
      for (let i = 0; i < 30; i += 1) {
        let student = "";
        for (let attempt = 0; attempt < 5 && !student; attempt += 1) {
          const nisn = String(randomInt(1_000_000_000, 2_000_000_000));
          const inserted = await client.query<{ id: string }>("INSERT INTO school_students(name,nisn) VALUES($1,$2) ON CONFLICT (nisn) DO NOTHING RETURNING id::text AS id", [`PESERTA UJI ${f.login.suffix} ${i}`, nisn]);
          student = inserted.rows[0]?.id ?? "";
        }
        if (!student) throw new Error("NISN fixture bertabrakan.");
        studentIds.push(student);
        const placement = (await client.query<{ id: string }>(
          "INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4) RETURNING id::text AS id",
          [student, f.login.periodA, f.login.classId, `X ${f.login.majorName}`],
        )).rows[0].id;
        const identity = (await client.query<{ id: string }>(
          "INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES($1,$2,$3,$4) RETURNING id::text AS id",
          [student, f.login.periodA, `N-${f.login.suffix}-${i}`, `x${f.login.suffix}${i}`],
        )).rows[0].id;
        identityIds.push(identity);
        const encrypted = encryptParticipantPassword("ABCDEFGH", key, { identityId: identity, periodId: f.login.periodA });
        await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES($1,$2,$3,$4,$5)", [identity, hash, encrypted.nonce, encrypted.ciphertext, encrypted.authenticationTag]);
        await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,$3,'makeup',$4,$5)", [f.runId, f.login.activeTest, f.login.periodA, student, placement]);
        const token = randomBytes(32).toString("base64url");
        await client.query(`INSERT INTO participant_sessions(token_hash,participant_identity_id,placement_id,username_snapshot,identity_revision,password_revision,password_hash_digest,expires_at)
          SELECT $1,i.id,$2,i.username,i.updated_at,pw.updated_at,sha256(convert_to(pw.password_hash,'UTF8')),clock_timestamp()+interval '8 hours'
          FROM participant_identities i JOIN participant_passwords pw ON pw.participant_identity_id=i.id WHERE i.id=$3`, [participantSessionDigest(token), placement, identity]);
        sessions.push({ identity, token });
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }

    await loginParticipant(page, f.login.username, f.login.passwordA);
    const startRequest = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === `/peserta/jadwal/${f.runId}`);
    const exampleAttempt = await startWithToken(page, f.runId, "998866");
    const start = await startRequest; const startBody = start.postDataBuffer(), startHeaders = start.headers();
    if (!startBody || !startHeaders["next-action"] || !startHeaders["content-type"]) throw new Error("Format aksi mulai tidak tersedia.");
    const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3100";
    const send = async (path: string, token: string, action: string, contentType: string, body: Buffer) => {
      const response = await fetch(`${base}${path}`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(60_000),
        headers: { "content-type": contentType, "next-action": action, origin: base, cookie: `nusacbt_participant_session=${token}` }, body: new Uint8Array(body) });
      const text = await response.text();
      return { status: response.status, text };
    };
    const startResults = await Promise.all(sessions.map((s) => send(`/peserta/jadwal/${f.runId}`, s.token, startHeaders["next-action"], startHeaders["content-type"], startBody)));
    expect(startResults.map((r) => r.status)).toEqual(Array(30).fill(200));
    for (const response of startResults) { expect(response.text).not.toContain("Hasil mulai tes belum dapat dipastikan"); expect(response.text).not.toContain("correct_option"); }
    const attempts = (await client.query<{ id: string; identity: string }>("SELECT id::text AS id,participant_identity_id::text AS identity FROM exam_attempts WHERE run_id=$1 AND participant_identity_id=ANY($2::bigint[])", [f.runId, identityIds])).rows;
    expect(attempts).toHaveLength(30);
    expect((await client.query<{ n: number }>("SELECT count(*)::int AS n FROM exam_question_snapshots WHERE source_question_id=$1", [f.login.questionId])).rows[0].n).toBe(1);
    expect((await client.query<{ n: number }>("SELECT count(*)::int AS n FROM exam_attempt_questions WHERE attempt_id=ANY($1::bigint[])", [attempts.map((a) => a.id)])).rows[0].n).toBe(30);
    // Bahkan peserta lain pada periode dan pelaksanaan yang sama tidak boleh
    // membaca soal maupun gambar dari attempt milik orang lain.
    const target = attempts.find((a) => a.identity === sessions[1].identity)?.id;
    if (!target) throw new Error("Attempt pembanding tidak ditemukan.");
    const foreignHeaders = { cookie: `nusacbt_participant_session=${sessions[0].token}` };
    const foreignPage = await fetch(`${base}/peserta/pengerjaan/${target}`, { headers: foreignHeaders, redirect: "manual" });
    expect(foreignPage.status).toBe(404); expect(await foreignPage.text()).not.toContain(f.login.questionSecret);
    expect((await fetch(`${base}/peserta/pengerjaan/${target}/gambar/1/prompt`, { headers: foreignHeaders, redirect: "manual" })).status).toBe(404);

    const answerRequest = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === `/peserta/pengerjaan/${exampleAttempt}`);
    await page.locator('input[type="radio"][value="D"]').check(); const saved = await answerRequest;
    await expect(page.getByText("Tersimpan di server", { exact: true })).toBeVisible();
    const body = saved.postDataBuffer(), headers = saved.headers();
    if (!body || !headers["next-action"] || !headers["content-type"]) throw new Error("Format aksi jawaban tidak tersedia.");
    const serialized = body.toString("utf8");
    const matches = [...serialized.matchAll(/name="([^"]*attemptId)"\r\n\r\n([0-9]+)\r\n/g)];
    if (matches.length !== 1 || matches[0][2] !== exampleAttempt) throw new Error("Field identitas aksi jawaban berubah.");
    const field = matches[0][0];
    const attemptsByIdentity = new Map(attempts.map((a) => [a.identity, a.id]));
    const answers = await Promise.all(sessions.map((s) => {
      const attempt = attemptsByIdentity.get(s.identity); if (!attempt) throw new Error("Attempt fixture tidak lengkap.");
      const replaced = serialized.replace(field, field.replace(`\r\n\r\n${exampleAttempt}\r\n`, `\r\n\r\n${attempt}\r\n`));
      return send(`/peserta/pengerjaan/${attempt}`, s.token, headers["next-action"], headers["content-type"], Buffer.from(replaced, "utf8"));
    }));
    expect(answers.map((r) => r.status)).toEqual(Array(30).fill(200));
    for (const response of answers) expect(response.text).not.toContain("belum dapat dipastikan tersimpan");
    const count = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM exam_attempt_questions WHERE attempt_id=ANY($1::bigint[]) AND answer='D' AND answer_revision=1", [attempts.map((a) => a.id)])).rows[0].n;
    expect(count).toBe(30);
  } finally {
    key.fill(0);
    await client.query("ROLLBACK").catch(() => {});
    await client.query("DELETE FROM participant_sessions WHERE participant_identity_id=ANY($1::bigint[])", [identityIds]);
    await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])", [identityIds]);
    await cleanupAttemptFixture(client, f);
    await client.query("DELETE FROM school_students WHERE id=ANY($1::bigint[])", [studentIds]);
    await client.end();
  }
});
