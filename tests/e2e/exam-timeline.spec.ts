import { expect, test, type Locator } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

async function applyRange(timeline: Locator, start: string, end: string) {
  await timeline.getByLabel("Tanggal mulai").fill(start);
  await timeline.getByLabel("Tanggal akhir").fill(end);
  await timeline.getByRole("button", { name: "Terapkan rentang" }).click();
}

async function assertStickyFooter(dialog: Locator) {
  const footer = dialog.locator('[data-slot="dialog-footer"]');
  await expect(footer).toBeVisible();
  await expect.poll(() => dialog.evaluate((el) => el.getAnimations().some((animation) => animation.playState === "running"))).toBe(false);
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

async function visibleHours(viewport: Locator) {
  return viewport.evaluate((element) => {
    const scale = element.querySelector<HTMLElement>('[aria-label^="Skala jam 00 sampai 24"]')!;
    const header = scale.previousElementSibling as HTMLElement;
    const viewportRect = element.getBoundingClientRect(), scaleRect = scale.getBoundingClientRect();
    const pxPerHour = scaleRect.width / 24;
    return {
      first: (viewportRect.left + element.clientLeft + header.getBoundingClientRect().width - scaleRect.left) / pxPerHour,
      last: (viewportRect.left + element.clientLeft + element.clientWidth - scaleRect.left) / pxPerHour,
      scrollLeft: element.scrollLeft,
      canScrollX: element.scrollWidth > element.clientWidth,
      canScrollY: element.scrollHeight > element.clientHeight,
    };
  });
}

test("timeline harian membedakan pelaksanaan, bentrok, zona, dan jadwal lintas tengah malam", async ({ page }, testInfo) => {
  test.setTimeout(150_000); await page.setViewportSize({ width: 1600, height: 1050 });
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
    await client.query(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by) VALUES
      ($1,$2,'makeup','Pagi hari kedua','2030-01-02T00:00:00Z','WIB',30,$3),
      ($1,$2,'makeup','Sebentar lintas hari','2030-01-04T16:50:00Z','WIB',30,$3),
      ($1,$2,'makeup','Akhir tepat tengah malam','2030-01-05T16:00:00Z','WIB',60,$3),
      ($1,$2,'makeup','Pagi hari ketujuh','2030-01-07T02:00:00Z','WIB',30,$3)`, [f.activeTest, f.periodA, admin]);
    const baseName = `Rancangan dasar ${f.suffix}`;
    const base = (await client.query<{ id: string }>(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
      VALUES($1,$2,'2030-01-01T16:00:00Z','WIB',120) RETURNING id::text AS id`, [f.periodA, baseName])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [base, f.questionId]);

    await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    const timeline = page.getByLabel("Timeline tes", { exact: true }); const viewport = timeline.getByTestId("timeline-viewport");
    await applyRange(timeline, "2030-01-01", "2030-01-07");
    const days = viewport.getByTestId("timeline-day"); await expect(days).toHaveCount(7);
    for (let index = 0; index < 7; index++) await expect(days.nth(index)).toHaveAttribute("data-date", `2030-01-0${index + 1}`);
    await expect(days.nth(0)).toContainText("Selasa"); await expect(days.nth(2)).toContainText("Tidak ada jadwal pada hari ini");
    await expect(days.nth(0).getByTestId("timeline-event")).toHaveCount(4);
    await expect(days.nth(1).getByTestId("timeline-event")).toHaveCount(5);
    await expect(days.nth(3).getByTestId("timeline-event")).toHaveCount(1);
    await expect(days.nth(4).getByTestId("timeline-event")).toHaveCount(2);
    await expect(days.nth(5).getByTestId("timeline-event")).toHaveCount(0); // Akhir tepat 00:00 tidak menjadi hari berikutnya.
    await expect(days.nth(6).getByTestId("timeline-event")).toHaveCount(1);
    const overnight = (day: number, name: string) => days.nth(day).getByTestId("timeline-event").filter({ hasText: name });
    const regularDay1 = overnight(0, "Reguler bentrok"), remedialDay1 = overnight(0, "Remidi bentrok"), makeupDay1 = overnight(0, "Jadwal fiktif"), baseDay1 = overnight(0, baseName);
    await expect(baseDay1).toContainText("Rancangan dasar"); await expect(regularDay1).toContainText("Draf"); await expect(makeupDay1).toContainText("Dirilis");
    await expect(days.nth(0).getByTestId("timeline-event").filter({ hasText: f.activeName })).toHaveCount(3); // Tidak ada rancangan duplikat.
    const lanes = await days.nth(0).getByTestId("timeline-event").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-lane")));
    expect(new Set(lanes).size).toBe(4);
    await expect(regularDay1).toHaveAttribute("data-clipped-end", "true");
    await expect(overnight(1, "Reguler bentrok")).toHaveAttribute("data-clipped-start", "true");
    await expect(regularDay1.getByTestId("timeline-duration")).toHaveAttribute("style", /left: 93\.75%; width: 6\.25%/);
    await expect(overnight(1, "Reguler bentrok").getByTestId("timeline-duration")).toHaveAttribute("style", /left: 0%; width: 6\.25%/);
    await expect(overnight(3, "Sebentar lintas hari")).toHaveAttribute("data-clipped-end", "true");
    await expect(overnight(4, "Sebentar lintas hari")).toHaveAttribute("data-clipped-start", "true");

    // Area jam pertama adalah 06:00–18:00, bukan awal hari. Semua 24 jam
    // dan hari keempat–ketujuh tetap dapat dijangkau dengan scroll.
    await expect.poll(async () => (await visibleHours(viewport)).first).toBeCloseTo(6, 1);
    let hours = await visibleHours(viewport);
    expect(hours.last).toBeCloseTo(18, 1); expect(hours.canScrollX).toBe(true); expect(hours.canScrollY).toBe(true);
    const dayGeometry = await viewport.evaluate((element) => {
      const view = element.getBoundingClientRect(); const head = element.querySelector<HTMLElement>('[aria-label^="Skala jam"]')!.parentElement!.getBoundingClientRect();
      const rows = [...element.querySelectorAll<HTMLElement>('[data-testid="timeline-day"]')].map((row) => row.getBoundingClientRect());
      return { bottom: view.top + element.clientHeight, headBottom: head.bottom, rows: rows.map((r) => ({ top: r.top, bottom: r.bottom })) };
    });
    expect(dayGeometry.rows[0].top).toBeGreaterThanOrEqual(dayGeometry.headBottom - 1);
    expect(dayGeometry.rows[2].bottom).toBeLessThanOrEqual(dayGeometry.bottom + 1);
    expect(dayGeometry.rows[3].top).toBeGreaterThanOrEqual(dayGeometry.bottom - 12);
    await viewport.evaluate((el) => { el.scrollLeft = 0; }); hours = await visibleHours(viewport); expect(hours.first).toBeCloseTo(0, 1);
    await viewport.evaluate((el) => { el.scrollLeft = el.scrollWidth; }); hours = await visibleHours(viewport); expect(hours.last).toBeCloseTo(24, 1);
    const stickyBefore = await days.nth(0).locator(":scope > div").first().boundingBox();
    await viewport.evaluate((el) => { el.scrollLeft = 0; });
    const stickyAfter = await days.nth(0).locator(":scope > div").first().boundingBox();
    expect(Math.abs(stickyBefore!.x - stickyAfter!.x)).toBeLessThan(1);
    await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const finalDayInScrollArea = await days.nth(6).evaluate((row) => {
      const area = row.closest<HTMLElement>('[data-testid="timeline-viewport"]')!;
      const view = area.getBoundingClientRect(), bounds = row.getBoundingClientRect();
      return bounds.top >= view.top + 52 - 1 && bounds.bottom <= view.top + area.clientHeight + 1;
    });
    expect(finalDayInScrollArea).toBe(true);
    await viewport.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; });

    await timeline.getByRole("button", { name: "Remidi", exact: true }).click();
    await expect(remedialDay1).toHaveAttribute("data-dimmed", "false"); await expect(regularDay1).toHaveAttribute("data-dimmed", "true");
    await expect(makeupDay1).toHaveAttribute("data-dimmed", "true"); await expect(baseDay1).toHaveAttribute("data-dimmed", "true");
    await expect(days.nth(0).getByTestId("timeline-event")).toHaveCount(4);
    await timeline.getByLabel("Zona tampilan").selectOption("WIT");
    await expect(days.nth(0).getByTestId("timeline-event")).toHaveCount(0);
    const makeupDay2 = overnight(1, "Jadwal fiktif");
    await expect(makeupDay2).toHaveAttribute("data-clipped-start", "false");
    await expect(makeupDay2.getByTestId("timeline-duration")).toHaveAttribute("style", /left: 2\.0833/);
    const makeupLink = makeupDay2.getByRole("link", { name: /Jadwal fiktif/ });
    await expect(makeupLink).toHaveAttribute("aria-label", /2030-01-02 00:30–2030-01-02 03:30 WIT · asli 2030-01-01 22:30–2030-01-02 01:30 WIB/);
    await makeupLink.scrollIntoViewIfNeeded(); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await makeupLink.focus(); await expect(page.getByRole("tooltip").filter({ hasText: "Jadwal fiktif" })).toBeVisible();
    await timeline.getByText("Lihat daftar lengkap jadwal").click();
    await expect(timeline.getByLabel("Daftar lengkap jadwal per hari")).toContainText("Jadwal fiktif");
    await expect(timeline.getByLabel("Daftar lengkap jadwal per hari")).toContainText("asli 2030-01-01 22:30");
    await page.screenshot({ path: testInfo.outputPath("timeline-desktop.png") });

    // Rancangan tanpa pelaksanaan membuka editor, draf membuka editor yang
    // tepat dan pelaksanaan dirilis hanya membuka kartu pengelolaan.
    await overnight(1, baseName).getByRole("button", { name: new RegExp(baseName) }).click();
    let dialog = page.getByRole("dialog", { name: "Ubah rancangan tes" }); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Batal" }).click();
    await overnight(1, "Remidi bentrok").getByRole("link", { name: /Remidi bentrok/ }).click();
    await expect(page).toHaveURL(new RegExp(`/data-tes/daftar/${f.activeTest}\\?atur=${remedial}#pelaksanaan-${remedial}$`));
    dialog = page.getByRole("dialog", { name: "Ubah draf pelaksanaan" }); await expect(dialog.getByLabel("Nama pelaksanaan")).toHaveValue("Remidi bentrok");
    await dialog.getByRole("button", { name: "Batal" }).click(); await expect(page.locator(`#pelaksanaan-${remedial}`)).toBeAttached();
    await page.goto("/data-tes/daftar"); await applyRange(page.getByLabel("Timeline tes", { exact: true }), "2030-01-01", "2030-01-02");
    await page.getByTestId("timeline-day").first().getByTestId("timeline-event").filter({ hasText: "Jadwal fiktif" }).getByRole("link", { name: /Jadwal fiktif/ }).click();
    await expect(page).toHaveURL(new RegExp(`/data-tes/daftar/${f.activeTest}#pelaksanaan-${published}$`));
    await expect(page.locator(`#pelaksanaan-${published}`)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Ubah draf pelaksanaan" })).toHaveCount(0);
    expect(regular).not.toBe(remedial);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("rentang 1–7 hari inklusif, validasi, navigasi, batas tahun dan fallback daftar", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  const noJs = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100", javaScriptEnabled: false });
  try {
    await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    const timeline = page.getByLabel("Timeline tes", { exact: true }); const days = timeline.getByTestId("timeline-day");
    await expect(days).toHaveCount(7); // Default mulai hari ini.
    const todayWib = (await client.query<{ date: string }>("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS date")).rows[0].date;
    await expect(days.first()).toHaveAttribute("data-date", todayWib); await expect(days.first().getByTestId("timeline-now")).toHaveCount(1);
    await expect(timeline).toContainText("garis merah: perkiraan");
    await noJs.addCookies(await page.context().cookies()); const fallback = await noJs.newPage(); await fallback.goto("/data-tes/daftar");
    const fallbackTimeline = fallback.getByLabel("Timeline tes", { exact: true });
    await expect(fallbackTimeline.getByLabel("Tanggal mulai")).toBeDisabled();
    await expect(fallbackTimeline.locator("noscript p")).toBeVisible();
    await expect(fallbackTimeline.locator("noscript p")).toContainText("Pengaturan rentang dan zona memerlukan JavaScript");
    await fallbackTimeline.getByText("Lihat daftar lengkap jadwal").click(); await expect(fallbackTimeline.getByLabel("Daftar lengkap jadwal per hari")).toContainText(f.activeName);
    await applyRange(timeline, "2028-02-28", "2028-03-05"); await expect(days).toHaveCount(7);
    await expect(days.nth(1)).toHaveAttribute("data-date", "2028-02-29");
    await timeline.getByLabel("Tanggal akhir").fill("2028-03-06");
    await expect(timeline.getByRole("alert")).toContainText("1–7 hari");
    await expect(timeline.getByRole("button", { name: "Terapkan rentang" })).toBeDisabled();
    await expect(days.nth(6)).toHaveAttribute("data-date", "2028-03-05"); // Belum diterapkan.
    await timeline.getByLabel("Tanggal akhir").fill("2028-02-27"); await expect(timeline.getByRole("button", { name: "Terapkan rentang" })).toBeDisabled();
    await timeline.getByLabel("Tanggal akhir").fill(""); await expect(timeline.getByRole("button", { name: "Terapkan rentang" })).toBeDisabled();
    await applyRange(timeline, "2028-02-29", "2028-02-29"); await expect(days).toHaveCount(1);
    await expect(timeline.getByRole("status")).toContainText("Tidak ada jadwal pada rentang ini");
    await timeline.getByRole("button", { name: "Rentang berikutnya" }).click(); await expect(days.first()).toHaveAttribute("data-date", "2028-03-01");
    await timeline.getByRole("button", { name: "Rentang sebelumnya" }).click(); await expect(days.first()).toHaveAttribute("data-date", "2028-02-29");
    await applyRange(timeline, "2000-01-01", "2000-01-01"); await expect(timeline.getByRole("button", { name: "Rentang sebelumnya" })).toBeDisabled();
    await applyRange(timeline, "2100-12-31", "2100-12-31"); await expect(timeline.getByRole("button", { name: "Rentang berikutnya" })).toBeDisabled();
    await timeline.getByLabel("Zona tampilan").selectOption("WITA"); await timeline.getByRole("button", { name: "Hari ini" }).click();
    const current = (await client.query<{ date: string }>("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Makassar','YYYY-MM-DD') AS date")).rows[0].date;
    await expect(days.first()).toHaveAttribute("data-date", current); await expect(days).toHaveCount(1);
  } finally { await noJs.close(); await cleanupLoginFixture(client, f); await client.end(); }
});

test("banyak pelaksanaan bertumpuk tetap dapat dijangkau tanpa membuat viewport tak terbatas", async ({ page }) => {
  test.setTimeout(90_000); await page.setViewportSize({ width: 1280, height: 800 });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  try {
    const admin = (await client.query<{ id: string }>("SELECT id::text AS id FROM admin_users WHERE username=$1", [process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    await client.query(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by)
      SELECT $1,$2,'makeup','Bersamaan ke-' || n,'2032-05-04T03:00:00Z','WIB',60,$3 FROM generate_series(1,25) n`, [f.activeTest, f.periodA, admin]);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar"); const timeline = page.getByLabel("Timeline tes", { exact: true });
    await applyRange(timeline, "2032-05-04", "2032-05-04");
    const viewport = timeline.getByTestId("timeline-viewport"), events = viewport.getByTestId("timeline-event"); await expect(events).toHaveCount(25);
    expect(new Set(await events.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-lane")))).size).toBe(25);
    const height = (await viewport.boundingBox())!.height; expect(height).toBeLessThanOrEqual(640 + 1);
    expect(await viewport.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await viewport.evaluate((el) => { const event = el.querySelectorAll<HTMLElement>('[data-testid="timeline-event"]')[24]; el.scrollTop = event.offsetTop - 80; });
    const reachable = await events.last().evaluate((event) => {
      const area = event.closest<HTMLElement>('[data-testid="timeline-viewport"]')!, view = area.getBoundingClientRect(), bounds = event.getBoundingClientRect();
      return bounds.top >= view.top + 52 && bounds.bottom <= view.top + area.clientHeight;
    });
    expect(reachable).toBe(true);
    await timeline.getByText("Lihat daftar lengkap jadwal").click(); await expect(timeline.getByLabel("Daftar lengkap jadwal per hari").getByRole("link")).toHaveCount(25);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("ponsel: timeline tetap terjangkau lewat scroll, tema gelap, daftar lengkap dan editor", async ({ page }, testInfo) => {
  test.setTimeout(120_000); await page.setViewportSize({ width: 320, height: 568 });
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f = await seedLoginFixture(client);
  try {
    const baseName = `Editor panjang ${f.suffix}`;
    const base = (await client.query<{ id: string }>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2031-04-01T03:00:00Z','WIB',120) RETURNING id::text AS id", [f.periodA, baseName])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)", [base, f.questionId]);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    const timeline = page.getByLabel("Timeline tes", { exact: true });
    await applyRange(timeline, "2031-04-01", "2031-04-07");
    await timeline.getByRole("heading", { name: "Timeline tes" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("timeline-mobile-controls.png"), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const viewport = timeline.getByTestId("timeline-viewport"); await expect(viewport.getByTestId("timeline-day")).toHaveCount(7);
    // Pembulatan scroll ke piksel pada viewport sempit dapat bergeser
    // beberapa menit, tetapi tetap dalam satu-dua piksel dari 06:00–18:00.
    await expect.poll(async () => Math.abs((await visibleHours(viewport)).first - 6)).toBeLessThan(0.1);
    expect(Math.abs((await visibleHours(viewport)).last - 18)).toBeLessThan(0.1);
    await page.setViewportSize({ width: 375, height: 667 });
    await expect.poll(async () => Math.abs((await visibleHours(viewport)).first - 6)).toBeLessThan(0.1);
    expect(Math.abs((await visibleHours(viewport)).last - 18)).toBeLessThan(0.1);
    await page.setViewportSize({ width: 320, height: 568 });
    await expect.poll(async () => Math.abs((await visibleHours(viewport)).first - 6)).toBeLessThan(0.1);
    const tickBounds = await viewport.getByLabel("Skala jam 00 sampai 24 WIB").locator("span").evaluateAll((ticks) => ticks.filter((tick) => getComputedStyle(tick).display !== "none").map((tick) => { const rect = tick.getBoundingClientRect(); return { text: tick.textContent, left: rect.left, right: rect.right }; }));
    expect(tickBounds.map((tick) => tick.text)).toContain("06:00"); expect(tickBounds.map((tick) => tick.text)).toContain("18:00");
    for (let index = 1; index < tickBounds.length; index++) expect(tickBounds[index - 1].right).toBeLessThanOrEqual(tickBounds[index].left + 1);
    await viewport.focus(); const initial = await viewport.evaluate((el) => el.scrollLeft); await page.keyboard.press("ArrowRight");
    await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(initial);
    await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const lastDayVisible = await viewport.getByTestId("timeline-day").last().evaluate((row) => {
      const area = row.closest<HTMLElement>('[data-testid="timeline-viewport"]')!;
      const view = area.getBoundingClientRect(), bounds = row.getBoundingClientRect();
      return bounds.top >= view.top + 52 - 1 && bounds.bottom <= view.top + area.clientHeight + 1;
    });
    expect(lastDayVisible).toBe(true);
    await viewport.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; });
    const theme = page.getByRole("button", { name: "Ganti tema" }); await theme.click(); await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await timeline.getByText("Lihat daftar lengkap jadwal").click();
    const list = timeline.getByLabel("Daftar lengkap jadwal per hari"); await expect(list).toContainText(baseName); await expect(list).toContainText("10:00–2031-04-01 12:00 WIB");
    await timeline.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("timeline-mobile-dark.png") });
    await list.getByRole("button", { name: new RegExp(baseName) }).click();
    const dialog = page.getByRole("dialog", { name: "Ubah rancangan tes" }); await expect(dialog).toBeVisible();
    await assertStickyFooter(dialog); await page.screenshot({ path: testInfo.outputPath("mobile-editor-footer.png") });
    await dialog.getByRole("button", { name: "Batal" }).click(); await expect(dialog).toBeHidden();
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});
