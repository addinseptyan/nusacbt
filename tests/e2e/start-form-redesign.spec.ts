import { expect, test } from "@playwright/test";

import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken } from "./exam-attempt-helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

test("modal token yang lebih bersih tetap aman untuk keyboard, koreksi, error server, tutup dan status pending", async ({ page }, testInfo) => {
  test.setTimeout(120_000); await page.setViewportSize({ width: 320, height: 568 });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  const route = "**/peserta"; let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await seedAttemptToken(client, f, "global", "001234");
    await loginParticipant(page, f.login.username, f.login.passwordA);
    const card = page.getByRole("listitem").filter({ hasText: f.login.activeName }); const trigger = card.getByRole("button", { name: "Mulai tes" });
    await trigger.click(); const dialog = page.getByRole("dialog", { name: "Masukkan token ujian" }); const token = dialog.getByLabel("Token tes");
    await expect(dialog).toBeVisible(); await expect(dialog).toContainText(f.login.activeName); await expect(token).toBeFocused();
    await expect(token).toHaveAttribute("inputmode", "numeric"); await expect(token).toHaveAttribute("autocomplete", "one-time-code");
    await expect(dialog).toContainText("0 / 6 angka"); await expect(dialog.getByTestId("token-slots").locator(":scope > span")).toHaveCount(6);
    const box = await dialog.boundingBox(); expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(568);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expect.poll(() => dialog.evaluate((el) => el.getAnimations().some((animation) => animation.playState === "running"))).toBe(false);
    const slotsBox = await dialog.getByTestId("token-slots").boundingBox(), footerBox = await dialog.locator('[data-slot="dialog-footer"]').boundingBox();
    expect(slotsBox!.y + slotsBox!.height).toBeLessThanOrEqual(footerBox!.y + 1); // Input tidak tertutup footer di 320×568.
    expect((await dialog.getByRole("button", { name: "Mulai pengerjaan" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await token.fill("00"); await token.press("a"); await expect(token).toHaveValue("00");
    await expect(dialog.getByRole("alert")).toContainText("angka");
    await dialog.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(dialog.getByRole("alert")).toContainText("tepat enam angka");
    await expect(token).toBeFocused(); await expect(token).toHaveAttribute("aria-invalid", "true");
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(0);
    await token.fill("123456"); const tokenBox = await token.boundingBox();
    await token.click({ position: { x: tokenBox!.width * 3.5 / 6, y: tokenBox!.height / 2 } });
    await token.press("Backspace"); await expect(token).toHaveValue("12456");
    await token.fill("001234");
    await token.evaluate((node: HTMLInputElement) => { node.setSelectionRange(2, 4); });
    await token.press("Backspace"); await expect(token).toHaveValue("0034");
    await token.evaluate((node: HTMLInputElement) => {
      const data = new DataTransfer(); data.setData("text/plain", "00 12 34");
      node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await expect(dialog.getByRole("alert")).toContainText("angka"); await expect(token).toHaveValue("0034");
    await token.evaluate((node: HTMLInputElement) => {
      const data = new DataTransfer(); data.setData("text/plain", "001235");
      node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await expect(token).toHaveValue("001235"); await expect(dialog).toContainText("6 / 6 angka"); await expect(token).toHaveAttribute("aria-invalid", "false");
    await dialog.getByRole("button", { name: "Mulai pengerjaan" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Token tidak cocok"); await expect(token).toHaveAttribute("aria-invalid", "true");
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(0);
    await dialog.getByRole("button", { name: "Batal" }).click(); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.click(); await expect(token).toHaveValue(""); await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
    await trigger.click(); await dialog.getByRole("button", { name: "Tutup", exact: true }).click(); await expect(dialog).toBeHidden();
    await trigger.click(); await token.fill("001234");
    await page.screenshot({ path: testInfo.outputPath("mobile-token-light.png"), animations: "disabled" });

    // Tahan request secara terkendali: modal, nilai input dan semua kontrol
    // tetap terkunci sampai hasil server diterima, lalu lanjut dengan token valid.
    await page.route(route, async (intercepted) => {
      if (intercepted.request().method() === "POST") { await gate; await intercepted.continue(); }
      else await intercepted.continue();
    });
    const sent = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/peserta");
    await dialog.getByRole("button", { name: "Mulai pengerjaan" }).click(); await sent;
    await expect(dialog.getByRole("status")).toContainText("Menyiapkan soal"); await expect(dialog.getByRole("status")).toBeInViewport();
    await expect(dialog.getByRole("alert")).toHaveCount(0); // Error token lama tidak kembali saat request baru.
    await expect(dialog.getByRole("button", { name: "Menyiapkan soal…" })).toBeDisabled(); await expect(token).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Batal" })).toBeDisabled(); await expect(dialog.getByRole("button", { name: "Tutup", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mobile-token-pending.png"), animations: "disabled" });
    release(); await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/); await expect(page.getByRole("heading", { name: /^Soal 1/ })).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_attempts WHERE run_id=$1", [f.runId])).rowCount).toBe(1);
  } finally { release(); await page.unroute(route).catch(() => {}); await cleanupAttemptFixture(client, f); await client.end(); }
});

test("modal token mendukung tema gelap dan reduced motion di halaman jadwal langsung", async ({ page }, testInfo) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 360, height: 640 }); await page.emulateMedia({ reducedMotion: "reduce" });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedAttemptFixture(client, 0);
  try {
    await seedAttemptToken(client, f, "global", "000456"); await loginParticipant(page, f.login.username, f.login.passwordA);
    await page.getByRole("button", { name: "Ganti tema" }).click(); await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await page.goto(`/peserta/jadwal/${f.runId}`); const dialog = page.getByRole("dialog", { name: "Masukkan token ujian" });
    const token = dialog.getByLabel("Token tes"); await expect(token).toBeFocused(); await expect(dialog).toContainText(f.login.activeName); await token.fill("000456");
    await expect(dialog.getByTestId("token-slots").locator(":scope > span")).toHaveText(["0", "0", "0", "4", "5", "6"]);
    expect(await dialog.getByTestId("token-caret").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.screenshot({ path: testInfo.outputPath("mobile-token-dark.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "Mulai pengerjaan" }).click(); await expect(page).toHaveURL(/\/peserta\/pengerjaan\/[1-9]\d*/);
  } finally { await cleanupAttemptFixture(client, f); await client.end(); }
});
