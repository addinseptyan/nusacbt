import { expect, test, type Request } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

test("kebijakan kategori menolak asal asing, sesi bukan admin, dan tab usang", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=true,revision=revision+1 WHERE NOT visible_to_participants");
  const f = await seedAttemptFixture(client, 0);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await seedAttemptToken(client, f, "global", "109876"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await startWithToken(page, f.runId, "109876");
    await loginAsAdmin(admin); const url = "/data-tes/pengaturan-pengerjaan"; await admin.goto(url);
    const stale = await adminContext.newPage(); await stale.goto(url);
    const section = admin.getByRole("region", { name: "Pengaturan nilai Susulan" });
    const staleSection = stale.getByRole("region", { name: "Pengaturan nilai Susulan" });
    await expect(staleSection).toContainText("Nilai peserta: ditampilkan");
    const initialRevision = (await client.query<{ revision: string }>("SELECT revision::text AS revision FROM exam_score_category_visibility WHERE kind='makeup'")).rows[0].revision;
    let captured: Request | undefined;
    await admin.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && new URL(req.url()).pathname === url) { captured = req; await route.abort(); }
      else await route.continue();
    });
    await section.getByRole("button", { name: "Sembunyikan nilai", exact: true }).click();
    const initial = admin.getByRole("dialog", { name: "Sembunyikan nilai peserta?" });
    await initial.getByRole("button", { name: "Ya, sembunyikan" }).click();
    await expect(initial.getByRole("alert")).toContainText("belum dapat dipastikan"); await admin.unrouteAll();
    if (!captured) throw new Error("Permintaan pengaturan tidak tertangkap.");
    const headers = captured.headers(), body = captured.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Format aksi pengaturan tidak dapat diperiksa.");
    const common = { "content-type": headers["content-type"], "next-action": headers["next-action"] };
    const crossOrigin = await admin.request.post(url, { headers: { ...common, origin: "https://attacker.invalid" }, data: body, failOnStatusCode: false, maxRedirects: 0 });
    expect(crossOrigin.status()).toBeGreaterThanOrEqual(400);
    const nonAdmin = await page.request.post(url, { headers: { ...common, origin: "http://127.0.0.1:3100" }, data: body, failOnStatusCode: false, maxRedirects: 0 });
    expect(nonAdmin.headers()["x-action-redirect"]).toContain("/login");
    expect((await client.query("SELECT visible_to_participants AS visible,revision::text AS revision FROM exam_score_category_visibility WHERE kind='makeup'")).rows[0]).toEqual({ visible: true, revision: initialRevision });

    // Walaupun kategori dibuka, attempt yang belum selesai tidak dikirim sebagai nilai.
    await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    await expect(page.getByRole("dialog", { name: "Nilai yang dibagikan" })).toContainText("Belum ada nilai yang dibagikan");
    await admin.reload(); await section.getByRole("button", { name: "Sembunyikan nilai", exact: true }).click();
    let dialog = admin.getByRole("dialog", { name: "Sembunyikan nilai peserta?" }); await dialog.getByRole("button", { name: "Ya, sembunyikan" }).click();
    await expect(section).toContainText("Nilai peserta: disembunyikan");
    await section.getByRole("button", { name: "Tampilkan nilai", exact: true }).click();
    dialog = admin.getByRole("dialog", { name: "Tampilkan nilai peserta?" }); await dialog.getByRole("button", { name: "Ya, tampilkan" }).click();
    await expect(section).toContainText("Nilai peserta: ditampilkan");
    await staleSection.getByRole("button", { name: "Sembunyikan nilai", exact: true }).click();
    const staleDialog = stale.getByRole("dialog", { name: "Sembunyikan nilai peserta?" }); await staleDialog.getByRole("button", { name: "Ya, sembunyikan" }).click();
    await expect(staleDialog.getByRole("alert")).toContainText("sudah berubah di tab atau oleh admin lain");
    expect((await client.query<{ visible: boolean; revision: string }>("SELECT visible_to_participants AS visible,revision::text AS revision FROM exam_score_category_visibility WHERE kind='makeup'")).rows[0]).toEqual({ visible: true, revision: String(BigInt(initialRevision) + BigInt(2)) });
    expect((await client.query<{ kind: string; visible: boolean }>("SELECT kind,visible_to_participants AS visible FROM exam_score_category_visibility ORDER BY kind")).rows).toEqual([
      { kind: "makeup", visible: true }, { kind: "regular", visible: true }, { kind: "remedial", visible: true },
    ]);
  } finally {
    await client.query("UPDATE exam_score_category_visibility SET visible_to_participants=true,revision=revision+1 WHERE NOT visible_to_participants");
    await adminContext.close(); await cleanupAttemptFixture(client, f); await client.end();
  }
});
