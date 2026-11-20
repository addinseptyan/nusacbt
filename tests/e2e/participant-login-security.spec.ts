import { expect, test } from "@playwright/test";

import { participantAttemptBucket } from "../../src/lib/participant-login-validation.mjs";
import { cleanupLoginFixture, loginParticipant, loginTestDatabase, openParticipantLogin, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

const loginError = (page: import("@playwright/test").Page) => page.getByRole("alert").filter({ hasText: "Username atau kata sandi" });

test("lima kegagalan membatasi akun dan username asing tanpa membocorkan keberadaan akun", async ({ page }) => {
  test.setTimeout(60_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const missing = `${f.username}missing`;
  try {
    let firstMessage = "";
    for (let index = 0; index < 5; index += 1) {
      await openParticipantLogin(page, index % 2 ? f.username.toUpperCase() : f.username, "sandi-salah-fiktif");
      const error = loginError(page); await expect(error).toBeVisible();
      firstMessage ||= (await error.innerText()); expect(await error.innerText()).toBe(firstMessage);
    }
    const bucket = participantAttemptBucket(f.periodA, f.username);
    const locked = (await client.query<{ failed: number; locked: boolean }>("SELECT failed_attempts AS failed,locked_until > clock_timestamp() AS locked FROM participant_login_attempts WHERE bucket_hash=$1", [bucket])).rows[0];
    expect(locked).toEqual({ failed: 5, locked: true });
    await openParticipantLogin(page, f.username, f.passwordA); await expect(loginError(page)).toHaveText(firstMessage);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(0);
    await openParticipantLogin(page, missing, "sandi-salah-fiktif"); await expect(loginError(page)).toHaveText(firstMessage);
    const missingBucket = participantAttemptBucket(f.periodA, missing);
    expect((await client.query<{ failed: number }>("SELECT failed_attempts AS failed FROM participant_login_attempts WHERE bucket_hash=$1", [missingBucket])).rows[0].failed).toBe(1);
    await client.query("UPDATE participant_login_attempts SET locked_until=clock_timestamp()-interval '1 second' WHERE bucket_hash=$1", [bucket]);
    await loginParticipant(page, f.username, f.passwordA);
    const reset = (await client.query<{ failed: number; locked: Date | null }>("SELECT failed_attempts AS failed,locked_until AS locked FROM participant_login_attempts WHERE bucket_hash=$1", [bucket])).rows[0];
    expect(reset).toEqual({ failed: 0, locked: null });
  } finally { await cleanupLoginFixture(client, f, [{ period: f.periodA, username: missing }]); await client.end(); }
});

test("batas global bekerja lintas akun dan jendela baru dapat menerima login kembali", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await client.query("UPDATE participant_login_global_limit SET attempts=180,window_started_at=clock_timestamp() WHERE id=1");
    await openParticipantLogin(page, f.username, f.passwordA); await expect(loginError(page)).toBeVisible();
    expect((await client.query<{ attempts: number }>("SELECT attempts FROM participant_login_global_limit WHERE id=1")).rows[0].attempts).toBe(181);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(0);
    await client.query("UPDATE participant_login_global_limit SET window_started_at=clock_timestamp()-interval '61 seconds' WHERE id=1");
    await loginParticipant(page, f.username, f.passwordA);
    expect((await client.query<{ attempts: number }>("SELECT attempts FROM participant_login_global_limit WHERE id=1")).rows[0].attempts).toBe(1);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("cookie palsu tidak memberi akses dan permintaan login lintas asal ditolak", async ({ page, browser }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const attacker = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  try {
    await attacker.addCookies([{ name: "nusacbt_participant_session", value: "A".repeat(43), domain: "127.0.0.1", path: "/peserta", httpOnly: true, sameSite: "Strict" }]);
    const attackerPage = await attacker.newPage();
    await attackerPage.goto("/peserta"); await expect(attackerPage).toHaveURL(/sesi=berakhir/);
    const image = await attackerPage.request.get(`/api/admin/soal/${f.questionId}/prompt?versi=1`); expect(image.status()).toBe(401);

    await page.goto("/peserta/login");
    await page.getByLabel("Username peserta").fill(f.username); await page.getByLabel("Kata sandi", { exact: true }).fill(f.passwordA);
    const outgoing = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/peserta/login");
    await page.getByRole("button", { name: "Masuk sebagai peserta" }).click(); const original = await outgoing;
    await expect(page).toHaveURL(/\/peserta$/);
    const before = (await client.query<{ token_hash: Buffer }>("SELECT token_hash FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rows[0].token_hash;
    const headers = original.headers(); const body = original.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Aksi login tidak dapat diperiksa.");
    const boundary = headers["content-type"].match(/boundary=(?:\"([^\"]+)\"|([^;]+))/)?.slice(1).find(Boolean);
    if (!boundary) throw new Error("Boundary multipart tidak ditemukan.");
    const serialized = body.toString("utf8");
    const nextField = `--${boundary}\r\nContent-Disposition: form-data; name="_1_password"`;
    if (!serialized.includes('name="_1_username"') || !serialized.includes(nextField)) throw new Error("Format formulir aksi berubah.");
    const duplicatePart = `--${boundary}\r\nContent-Disposition: form-data; name="_1_username"\r\n\r\n${f.username}x\r\n`;
    // React mengurai bagian FormData yang berawalan sama secara berurutan;
    // sisipkan duplikat di dalam kelompok itu, bukan setelah field metadata.
    const tampered = serialized.replace(nextField, duplicatePart + nextField);
    const globalBefore = (await client.query<{ attempts: number }>("SELECT attempts FROM participant_login_global_limit WHERE id=1")).rows[0].attempts;
    const duplicate = await page.request.post("/peserta/login", { headers: { origin: "http://127.0.0.1:3100", "content-type": headers["content-type"], "next-action": headers["next-action"] }, data: Buffer.from(tampered), failOnStatusCode: false, maxRedirects: 0 });
    const duplicateText = await duplicate.text();
    const globalAfter = (await client.query<{ attempts: number }>("SELECT attempts FROM participant_login_global_limit WHERE id=1")).rows[0].attempts;
    expect(duplicate.status()).toBe(200); expect(duplicateText).toContain("Username atau kata sandi");
    expect(globalAfter).toBe(globalBefore);
    const replay = await page.request.post("/peserta/login", { headers: { origin: "https://attacker.invalid", "content-type": headers["content-type"], "next-action": headers["next-action"] }, data: body, failOnStatusCode: false });
    expect(replay.status()).toBeGreaterThanOrEqual(400);
    const after = (await client.query<{ token_hash: Buffer }>("SELECT token_hash FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rows[0].token_hash;
    expect(after.equals(before)).toBe(true);
    await page.goto("/data-tes/token/riwayat"); await expect(page).toHaveURL(/\/login$/);
  } finally { await attacker.close(); await cleanupLoginFixture(client, f); await client.end(); }
});
