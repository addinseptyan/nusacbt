import { expect, test } from "@playwright/test";

import { cleanupLoginFixture, loginParticipant, loginTestDatabase, openParticipantLogin, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test("sandi yang dihapus atau diubah tanpa memperbarui cap waktu tidak membuat sesi lama tetap sah", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await loginParticipant(page, f.periodA, f.username, f.passwordA);
    // Mensimulasikan kerusakan/perubahan langsung di luar aplikasi: digest hash
    // juga diperiksa, tidak hanya updated_at.
    const old = (await client.query<{ hash: string }>("SELECT password_hash AS hash FROM participant_passwords WHERE participant_identity_id=$1", [f.identityA])).rows[0].hash;
    const different = old.slice(0, -1) + (old.endsWith("A") ? "B" : "A");
    await client.query("UPDATE participant_passwords SET password_hash=$2 WHERE participant_identity_id=$1", [f.identityA, different]);
    await page.reload(); await expect(page).toHaveURL(/sesi=berakhir/);
    await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=$1", [f.identityA]);
    await openParticipantLogin(page, f.periodA, f.username, f.passwordA);
    await expect(page.getByRole("alert").filter({ hasText: "Periode, username, atau kata sandi" })).toBeVisible();
    await page.goto("/peserta"); await expect(page).toHaveURL(/sesi=berakhir/);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
