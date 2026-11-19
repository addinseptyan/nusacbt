import { expect, test } from "@playwright/test";

import { cleanupLoginFixture, loginParticipant, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test("keluar yang gagal tidak mengklaim sesi berakhir dan dapat dicoba ulang", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client); const trigger = `e2e_logout_${f.suffix}`; const fn = `${trigger}_fn`;
  try {
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    const cookie = (await page.context().cookies()).find((c) => c.name === "nusacbt_participant_session");
    await client.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.participant_identity_id = ${f.identityA} THEN RAISE EXCEPTION 'synthetic logout failure'; END IF; RETURN OLD; END $$`);
    await client.query(`CREATE TRIGGER ${trigger} BEFORE DELETE ON participant_sessions FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/peserta\/login\?error=logout$/);
    await expect(page.getByRole("alert").filter({ hasText: "Sesi belum berhasil diakhiri" })).toBeVisible();
    expect((await page.context().cookies()).find((c) => c.name === "nusacbt_participant_session")?.value).toBe(cookie?.value);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(1);
    await client.query(`DROP TRIGGER ${trigger} ON participant_sessions`); await client.query(`DROP FUNCTION ${fn}()`);
    await page.getByRole("button", { name: "Coba keluar lagi" }).click();
    await expect(page).toHaveURL(/\/peserta\/login$/);
    expect((await client.query("SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1", [f.identityA])).rowCount).toBe(0);
    expect((await page.context().cookies()).find((c) => c.name === "nusacbt_participant_session")).toBeUndefined();
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON participant_sessions`); await client.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    await cleanupLoginFixture(client, f); await client.end();
  }
});
