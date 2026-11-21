import { expect, test, type Locator } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

async function assertStickyFooter(dialog: Locator) {
  const footer = dialog.locator('[data-slot="dialog-footer"]');
  await expect(footer).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const first = await footer.boundingBox(); const container = await dialog.boundingBox();
  expect(first && container).toBeTruthy();
  expect(first!.y).toBeGreaterThanOrEqual(container!.y);
  expect(first!.y + first!.height).toBeLessThanOrEqual(container!.y + container!.height + 2);
  await dialog.evaluate((el) => { el.scrollTop = Math.floor(el.scrollHeight / 2); });
  const middle = await footer.boundingBox();
  expect(Math.abs(middle!.y - first!.y)).toBeLessThanOrEqual(3);
  await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const bottom = await footer.boundingBox();
  expect(Math.abs(bottom!.y - first!.y)).toBeLessThanOrEqual(3);
  await expect(footer.getByRole("button", { name: "Batal" })).toBeInViewport();
}

test("timeline membedakan pelaksanaan dan dasar, menyorot tanpa menghapus, menyelaraskan zona dan melewati tengah malam", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  try {
    const admin = (await client.query<{ id: string }>("SELECT id::text AS id FROM admin_users WHERE username=$1", [process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    await client.query("INSERT INTO exam_session_plans(period_id,updated_by) VALUES($1,$2)", [f.periodA, admin]);
    await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,30)", [f.periodA]);
    const published = (await client.query<{ id: string }>("UPDATE exam_schedule_runs SET starts_at='2030-01-01T15:30:00Z',duration_minutes=180 WHERE exam_test_id=$1 RETURNING id::text AS id", [f.activeTest])).rows[0].id;
    const regular = (await client.query<{ id: string }>(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,session_number,starts_at,time_zone,duration_minutes,created_by)
      VALUES($1,$2,'regular','Reguler bentrok',1,'2030-01-01T15:30:00Z','WITA',180,$3) RETURNING id::text AS id`, [f.activeTest, f.periodA, admin])).rows[0].id;
    const remedial = (await client.query<{ id: string }>(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by)
      VALUES($1,$2,'remedial','Remidi bentrok','2030-01-01T15:30:00Z','WIT',180,$3) RETURNING id::text AS id`, [f.activeTest, f.periodA, admin])).rows[0].id;
    const baseName = `Rancangan dasar ${f.suffix}`;
    const base = (await client.query<{ id: string }>(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
      VALUES($1,$2,'2030-01-01T16:00:00Z','WIB',120) RETURNING id::text AS id`, [f.periodA, baseName])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [base, f.questionId]);

    await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    const timeline = page.getByLabel("Timeline tes", { exact: true });
    await timeline.getByLabel("Mulai tanggal").fill("2030-01-02");
    const rows = timeline.getByTestId("timeline-row"); await expect(rows).toHaveCount(4);
    const regularRow = rows.filter({ hasText: "Reguler bentrok" }); const remedialRow = rows.filter({ hasText: "Remidi bentrok" });
    const makeupRow = rows.filter({ hasText: "Jadwal fiktif" }); const baseRow = rows.filter({ hasText: baseName });
    await expect(baseRow).toContainText("Rancangan dasar · belum berkategori");
    await expect(rows.filter({ hasText: f.activeName })).toHaveCount(3); // Tidak ada baris dasar duplikat.
    await expect(regularRow).toContainText("Draf"); await expect(makeupRow).toContainText("Dirilis");
    // Ketiga pelaksanaan dimulai pada instant yang sama; bagian setelah tengah malam sama.
    const barPosition = async (row: Locator) => row.locator('[aria-hidden="true"]').first().getAttribute("style");
    expect(await barPosition(regularRow)).toContain("left: 0px"); expect(await barPosition(makeupRow)).toContain("left: 0px");
    expect(await barPosition(remedialRow)).toContain("width: 36px");
    const scale = timeline.getByRole("region", { name: /Garis waktu tes/ });
    await expect(scale.getByLabel("Skala jam 00 sampai 24 WIB")).toHaveCount(7);
    await expect(scale.getByLabel("Skala jam 00 sampai 24 WIB").first()).toContainText("00");
    await expect(scale.getByLabel("Skala jam 00 sampai 24 WIB").first()).toContainText("24");
    await timeline.getByRole("button", { name: "Remidi", exact: true }).click();
    await expect(remedialRow).toHaveAttribute("data-dimmed", "false"); await expect(regularRow).toHaveAttribute("data-dimmed", "true");
    await expect(makeupRow).toHaveAttribute("data-dimmed", "true"); await expect(baseRow).toHaveAttribute("data-dimmed", "true"); await expect(rows).toHaveCount(4);
    await timeline.getByLabel("Zona tampilan").selectOption("WIT");
    expect(await barPosition(remedialRow)).toContain("left: 12px");
    await expect(makeupRow).toContainText("asli");
    await page.screenshot({ path: testInfo.outputPath("timeline-desktop.png") });

    // Rancangan tanpa run membuka editor rancangan, bukan mengarang kategori.
    await baseRow.getByRole("button", { name: new RegExp(baseName) }).click();
    let dialog = page.getByRole("dialog", { name: "Ubah rancangan tes" }); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Batal" }).click();
    // Draf membuka editor pelaksanaan yang tepat.
    await remedialRow.getByRole("link", { name: /Remidi bentrok/ }).click();
    await expect(page).toHaveURL(new RegExp(`/data-tes/daftar/${f.activeTest}\\?atur=${remedial}#pelaksanaan-${remedial}$`));
    dialog = page.getByRole("dialog", { name: "Ubah draf pelaksanaan" }); await expect(dialog.getByLabel("Nama pelaksanaan")).toHaveValue("Remidi bentrok");
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(page.locator(`#pelaksanaan-${remedial}`)).toBeAttached();

    // Pelaksanaan rilis hanya menuju kartu pelaksanaan, tidak melewati aturan edit.
    await page.goto("/data-tes/daftar"); await page.getByLabel("Mulai tanggal").fill("2030-01-02");
    await page.getByTestId("timeline-row").filter({ hasText: "Jadwal fiktif" }).getByRole("link", { name: /Jadwal fiktif/ }).click();
    await expect(page).toHaveURL(new RegExp(`/data-tes/daftar/${f.activeTest}#pelaksanaan-${published}$`));
    await expect(page.locator(`#pelaksanaan-${published}`)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Ubah draf pelaksanaan" })).toHaveCount(0);
    expect(regular).not.toBe(remedial);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("ponsel: timeline bergeser mendatar, editor panjang menyimpan aksi di bawah saat menggulir", async ({ page }, testInfo) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 320, height: 568 });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  try {
    const baseName = `Editor panjang ${f.suffix}`;
    const base = (await client.query<{ id: string }>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2031-04-01T03:00:00Z','WIB',120) RETURNING id::text AS id", [f.periodA, baseName])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [base, f.questionId]);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar"); await page.getByLabel("Mulai tanggal").fill("2031-04-01");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const scroll = page.getByRole("region", { name: /Garis waktu tes/ });
    expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await scroll.evaluate((el) => { el.scrollLeft = 400; }); expect(await scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const row = page.getByTestId("timeline-row").filter({ hasText: baseName });
    await row.getByRole("button", { name: new RegExp(baseName) }).click();
    const dialog = page.getByRole("dialog", { name: "Ubah rancangan tes" }); await expect(dialog).toBeVisible();
    await assertStickyFooter(dialog);
    await page.screenshot({ path: testInfo.outputPath("mobile-editor-footer.png") });
    await dialog.getByRole("button", { name: "Batal" }).click(); await expect(dialog).toBeHidden();
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
