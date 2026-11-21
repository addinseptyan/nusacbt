import { expect, test, type Request } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken, startWithToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

test("pengaturan nilai per tes menolak asal asing, sesi bukan admin, dan tab usang", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100" }); const admin = await adminContext.newPage();
  try {
    await seedAttemptToken(client, f, "global", "109876"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await startWithToken(page, f.runId, "109876");
    await loginAsAdmin(admin); const url = `/data-tes/monitoring?tes=${f.login.activeTest}`; await admin.goto(url);
    const stale = await adminContext.newPage(); await stale.goto(url);
    await expect(stale.getByText("Nilai peserta: disembunyikan")).toBeVisible();
    let captured: Request | undefined;
    await admin.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && new URL(req.url()).pathname === "/data-tes/monitoring") { captured = req; await route.abort(); }
      else await route.continue();
    });
    await admin.getByRole("button", { name: "Tampilkan nilai", exact: true }).click();
    const initial = admin.getByRole("dialog", { name: "Tampilkan nilai peserta?" });
    await initial.getByRole("button", { name: "Ya, tampilkan" }).click();
    await expect(initial.getByRole("alert")).toContainText("belum dapat dipastikan"); await admin.unrouteAll();
    if (!captured) throw new Error("Permintaan pengaturan tidak tertangkap.");
    const headers = captured.headers(), body = captured.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Format aksi pengaturan tidak dapat diperiksa.");
    const common = { "content-type": headers["content-type"], "next-action": headers["next-action"] };
    const crossOrigin = await admin.request.post(url, { headers: { ...common, origin: "https://attacker.invalid" }, data: body, failOnStatusCode: false, maxRedirects: 0 });
    expect(crossOrigin.status()).toBeGreaterThanOrEqual(400);
    const nonAdmin = await page.request.post(url, { headers: { ...common, origin: "http://127.0.0.1:3100" }, data: body, failOnStatusCode: false, maxRedirects: 0 });
    // Server Actions mengirim redirect di header RSC dengan status 200.
    expect(nonAdmin.headers()["x-action-redirect"]).toContain("/login");
    expect((await client.query("SELECT 1 FROM exam_score_visibility WHERE exam_test_id=$1", [f.login.activeTest])).rowCount).toBe(0);

    await admin.reload(); await admin.getByRole("button", { name: "Tampilkan nilai", exact: true }).click();
    let dialog = admin.getByRole("dialog", { name: "Tampilkan nilai peserta?" }); await dialog.getByRole("button", { name: "Ya, tampilkan" }).click();
    await expect(admin.getByText("Nilai peserta: ditampilkan")).toBeVisible();
    // Walaupun dibuka, pengerjaan yang belum selesai tidak memiliki nilai untuk dikirim.
    await page.goto("/peserta"); await page.getByRole("button", { name: "Nilai dibagikan" }).click();
    await expect(page.getByRole("dialog", { name: "Nilai yang dibagikan" })).toContainText("Belum ada nilai yang dibagikan");
    await admin.getByRole("button", { name: "Sembunyikan nilai", exact: true }).click();
    dialog = admin.getByRole("dialog", { name: "Sembunyikan nilai peserta?" }); await dialog.getByRole("button", { name: "Ya, sembunyikan" }).click();
    await expect(admin.getByText("Nilai peserta: disembunyikan")).toBeVisible();
    await stale.getByRole("button", { name: "Tampilkan nilai", exact: true }).click();
    const staleDialog = stale.getByRole("dialog", { name: "Tampilkan nilai peserta?" }); await staleDialog.getByRole("button", { name: "Ya, tampilkan" }).click();
    await expect(staleDialog.getByRole("alert")).toContainText("sudah berubah di tab atau oleh admin lain");
    expect((await client.query<{ visible: boolean; revision: string }>("SELECT visible_to_participants AS visible,revision::text AS revision FROM exam_score_visibility WHERE exam_test_id=$1", [f.login.activeTest])).rows[0]).toEqual({ visible: false, revision: "2" });

    const another = (await client.query<{ id: string }>(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
      VALUES($1,$2,clock_timestamp(),'WIB',60) RETURNING id::text AS id`, [f.login.periodA, `Tes terpisah ${f.login.suffix}`])).rows[0].id;
    await admin.goto(`/data-tes/monitoring?tes=${another}`); await expect(admin.getByText("Nilai peserta: disembunyikan")).toBeVisible();
    await admin.getByRole("button", { name: "Tampilkan nilai", exact: true }).click();
    dialog = admin.getByRole("dialog", { name: "Tampilkan nilai peserta?" }); await dialog.getByRole("button", { name: "Ya, tampilkan" }).click();
    await expect(admin.getByText("Nilai peserta: ditampilkan")).toBeVisible();
    const policies = (await client.query<{ id: string; visible: boolean }>("SELECT exam_test_id::text AS id,visible_to_participants AS visible FROM exam_score_visibility WHERE exam_test_id=ANY($1::bigint[]) ORDER BY exam_test_id", [[f.login.activeTest, another]])).rows;
    expect(policies).toEqual([{ id: f.login.activeTest, visible: false }, { id: another, visible: true }]);
  } finally { await adminContext.close(); await cleanupAttemptFixture(client, f); await client.end(); }
});
