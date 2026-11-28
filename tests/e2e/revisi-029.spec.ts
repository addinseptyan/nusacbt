import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { cleanupAttemptFixture, seedAttemptFixture, seedAttemptToken } from "./exam-attempt-helpers";
import { loginAsAdmin } from "./helpers";
import { loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.use({ actionTimeout: 15_000 });

test("9 revisi UI & fitur: sticky ringkasan, theme spin, pagination riwayat, timeline 1-7 hari, pengaturan sejajar, monitoring combobox+today, dashboard live token, rekap drawer <=2 tes, sidebar accordion", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1366, height: 768 });

  const client = loginTestDatabase();
  await client.connect();
  await resetLoginGlobal(client);
  const f = await seedAttemptFixture(client, 0);

  try {
    const adminRow = (
      await client.query<{ id: string }>("SELECT id::text AS id FROM admin_users WHERE username = $1", [
        process.env.TEST_ADMIN_USERNAME,
      ])
    ).rows[0];

    // Seed 7 audit rows for Riwayat tindakan akun & sandi pagination
    for (let i = 0; i < 7; i += 1) {
      await client.query(
        `INSERT INTO participant_password_audit(participant_identity_id, admin_id, event, occurred_at)
         VALUES($1, $2, 'unlock_login', clock_timestamp() + ($3 * interval '1 second'))`,
        [f.login.identityA, adminRow.id, i],
      );
    }

    // Seed 1 live global token and 1 live test token for Dashboard Live Token table
    await seedAttemptToken(client, f, "global", "112233");
    await seedAttemptToken(client, f, "test", "445566");

    // Seed 3 additional tests + completed attempts (total 4 tests) for Rekap Hasil Tes drawer check
    await client.query("INSERT INTO exam_session_plans(period_id, updated_by) VALUES($1, $2) ON CONFLICT DO NOTHING", [
      f.login.periodA,
      adminRow.id,
    ]);
    await client.query("INSERT INTO exam_session_groups(period_id, session_number, capacity) VALUES($1, 1, 100) ON CONFLICT DO NOTHING", [
      f.login.periodA,
    ]);
    const extraTestIds: string[] = [];
    for (const [idx, title] of ["Fisika", "Kimia", "Biologi"].entries()) {
      const testId = (
        await client.query<{ id: string }>(
          `INSERT INTO exam_tests(period_id, name, tags, tags_signature, starts_at, time_zone, duration_minutes)
           VALUES($1, $2, $3::text[], $4, clock_timestamp() - interval '10 minutes', 'WIB', 120)
           RETURNING id::text AS id`,
          [f.login.periodA, `${title} ${f.login.suffix}`, [`Tag-${title}`, "Kelas-XI"], `kelas-xi\x1ftag-${title.toLowerCase()}`],
        )
      ).rows[0].id;
      extraTestIds.push(testId);
      const runId = (
        await client.query<{ id: string }>(
          `INSERT INTO exam_schedule_runs(exam_test_id, period_id, kind, label, session_number, starts_at, time_zone, duration_minutes, created_by, published_at, published_by)
           VALUES($1, $2, 'regular', $3, 1, clock_timestamp() - interval '10 minutes', 'WIB', 120, $4, clock_timestamp(), $4)
           RETURNING id::text AS id`,
          [testId, f.login.periodA, `Reguler ${title}`, adminRow.id],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO exam_schedule_participants(run_id, exam_test_id, period_id, kind, student_id, placement_id)
         VALUES($1, $2, $3, 'regular', $4, $5)`,
        [runId, testId, f.login.periodA, f.login.studentA, f.login.placementA],
      );
      await client.query(
        `INSERT INTO exam_attempts(run_id, exam_test_id, period_id, kind, participant_identity_id, student_id,
          student_name_snapshot, participant_number_snapshot, class_name_snapshot, test_name_snapshot, run_label_snapshot,
          time_zone_snapshot, started_at, deadline, question_count, completed_at, completion_reason, correct_count, answered_count)
         SELECT $1, $2, $3, 'regular', $4, $5, $6, i.participant_number, pl.class_name_snapshot, t.name, 'Reguler',
          'WIB', clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '1 hour', 10,
          clock_timestamp() - interval '1 minute' + ($8 * interval '1 second'), 'submitted', $7, 10
         FROM participant_identities i
         JOIN student_class_placements pl ON pl.student_id = i.student_id AND pl.period_id = i.period_id AND pl.ended_at IS NULL
         JOIN exam_tests t ON t.id = $2
         WHERE i.id = $4`,
        [runId, testId, f.login.periodA, f.login.identityA, f.login.studentA, f.login.studentAName, 6 + idx, idx + 2],
      );
    }
    // Completed attempt on the main activeTest so total tests = 4
    await client.query(
      `INSERT INTO exam_attempts(run_id, exam_test_id, period_id, kind, participant_identity_id, student_id,
        student_name_snapshot, participant_number_snapshot, class_name_snapshot, test_name_snapshot, run_label_snapshot,
        time_zone_snapshot, started_at, deadline, question_count, completed_at, completion_reason, correct_count, answered_count)
       SELECT $1, $2, $3, 'makeup', $4, $5, $6, i.participant_number, pl.class_name_snapshot, t.name, 'Susulan',
        'WIB', clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '1 hour', 10,
        clock_timestamp() - interval '2 minutes', 'submitted', 9, 10
       FROM participant_identities i
       JOIN student_class_placements pl ON pl.student_id = i.student_id AND pl.period_id = i.period_id AND pl.ended_at IS NULL
       JOIN exam_tests t ON t.id = $2
       WHERE i.id = $4`,
      [f.runId, f.login.activeTest, f.login.periodA, f.login.identityA, f.login.studentA, f.login.studentAName],
    );

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await loginAsAdmin(page);

    // 7. DASHBOARD: Live Token table (ping khusus badge LIVE, tidak berdenyut per baris) + Monitoring pelaksanaan tes
    await expect(page.getByRole("heading", { name: "Token Live" })).toBeVisible();
    await expect(page.getByTestId("live-token-ping")).toBeVisible();
    await expect(page.getByTestId("live-token-ping").locator(".animate-ping")).toHaveCSS("animation-name", "ping");
    const tokenTable = page.getByRole("table", { name: "Tabel token live" });
    await expect(tokenTable).toBeVisible();
    await expect(tokenTable).toContainText("112233");
    await expect(tokenTable).toContainText("445566");
    await expect(tokenTable.locator(".animate-ping")).toHaveCount(0);

    const monitoringTable = page.getByRole("table", { name: "Monitoring pelaksanaan tes" });
    await expect(monitoringTable).toBeVisible();
    await expect(monitoringTable).toContainText(`Fisika ${f.login.suffix}`);
    await expect(
      monitoringTable.locator("tr").filter({ hasText: `Fisika ${f.login.suffix}` }).getByRole("link", { name: "Detail" }),
    ).toHaveAttribute("href", `/data-tes/monitoring?tes=${extraTestIds[0]}`);

    // 2. UI ADMIN: Theme toggle animasi cepat (140ms) dan rotasi berlawanan ikon matahari/bulan
    const themeButton = page.getByRole("button", { name: "Ganti tema" });
    await themeButton.click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(themeButton.locator(".theme-toggle-icon")).toHaveCount(2);
    await expect(themeButton.locator(".theme-toggle-icon").first()).toHaveCSS("transition-duration", "0.2s");
    await expect(page.locator("html")).not.toHaveClass(/\btheme-changing\b/, { timeout: 3000 });
    await themeButton.click();
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

    // 9. UI ADMIN SIDEBAR: Single-open accordion & Mata Pelajaran terpadu
    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await sidebar.getByRole("button", { name: "Data Modul", exact: true }).click();
    await expect(sidebar.getByRole("link", { name: "Mata Pelajaran", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Manajemen Soal", exact: true })).toHaveCount(0);
    await sidebar.getByRole("button", { name: "Data Peserta", exact: true }).click();
    await expect(sidebar.getByRole("link", { name: "Akun Peserta", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Mata Pelajaran", exact: true })).toBeHidden();
    await sidebar.getByRole("button", { name: "Data Tes", exact: true }).click();
    await expect(sidebar.getByRole("link", { name: "Daftar Tes", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Akun Peserta", exact: true })).toBeHidden();

    // 1. MENU PENGATURAN APLIKASI: Sticky Ringkasan Tampilan card on scroll at 1366x768
    await page.goto("/pengaturan/aplikasi");
    const summaryHeading = page.getByRole("heading", { name: "Ringkasan Tampilan" });
    const saveButton = page.getByRole("button", { name: "Simpan pengaturan aplikasi" });
    await expect(summaryHeading).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(summaryHeading).toBeInViewport();
    await expect(saveButton).toBeInViewport();
    const stickyPosition = await summaryHeading
      .locator("xpath=ancestor::div[contains(@class, 'xl:sticky')]")
      .evaluate((el) => getComputedStyle(el).position);
    expect(stickyPosition).toBe("sticky");

    // 3. MENU AKUN PESERTA: Pagination pada Riwayat tindakan akun
    await page.goto(`/data-peserta/akun?periode=${f.login.periodA}`);
    const auditList = page.getByRole("list", { name: "Riwayat tindakan akun" });
    await expect(auditList.getByRole("listitem")).toHaveCount(5);
    await expect(page.getByText("Menampilkan 1–5 dari 7 tindakan (hal. 1/2)")).toBeVisible();
    const auditCard = auditList.locator("xpath=ancestor::div[@data-slot='card']");
    await auditCard.getByRole("button", { name: "Berikutnya" }).click();
    await expect(auditList.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("Menampilkan 6–7 dari 7 tindakan (hal. 2/2)")).toBeVisible();
    await auditCard.getByRole("button", { name: "Sebelumnya" }).click();
    await expect(auditList.getByRole("listitem")).toHaveCount(5);

    // Menu Sandi Peserta juga mempaginasi Riwayat tindakan sandi (5 per halaman)
    await page.goto(`/data-peserta/sandi?periode=${f.login.periodA}`);
    const pwdAuditList = page.getByRole("list", { name: "Riwayat tindakan sandi" });
    await expect(pwdAuditList.getByRole("listitem")).toHaveCount(5);
    await expect(page.getByText("Menampilkan 1–5 dari 7 tindakan (hal. 1/2)")).toBeVisible();
    const pwdAuditCard = pwdAuditList.locator("xpath=ancestor::div[@data-slot='card']");
    await pwdAuditCard.getByRole("button", { name: "Berikutnya" }).click();
    await expect(pwdAuditList.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("Menampilkan 6–7 dari 7 tindakan (hal. 2/2)")).toBeVisible();

    // 4. MENU DAFTAR TES - TIMELINE TES: Atur maksimal 1 hari dan persisten saat pindah menu
    await page.goto("/data-tes/daftar");
    const timeline = page.getByLabel("Timeline tes", { exact: true });
    await timeline.getByLabel("Maksimal hari timeline").selectOption("1");
    await expect(page.getByText("Maksimal rentang timeline disimpan menjadi 1 hari.")).toBeVisible();
    await expect(timeline.getByTestId("timeline-day")).toHaveCount(1);
    await expect(timeline).toContainText("Rentang tanggal · maksimal 1 hari");

    // Pindah ke menu lain lalu kembali ke Daftar Tes -> tetap 1 hari
    await page.goto("/data-tes/monitoring");
    // 6. MENU MONITORING TES: Default combobox Semua tes + tanggal dari/sampai = today
    const todayWib = (
      await client.query<{ d: string }>("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS d")
    ).rows[0].d;
    const testCombobox = page.getByRole("combobox", { name: "Nama tes" });
    await expect(testCombobox).toContainText("Semua tes");
    await expect(page.locator("#monitor-from")).toHaveValue(todayWib);
    await expect(page.locator("#monitor-to")).toHaveValue(todayWib);

    // Pilih salah satu tes lewat combobox shadcn UI (multi kata)
    await testCombobox.click();
    await page.getByPlaceholder("Cari nama, tag, atau periode (multi kata)...").fill("Fisika");
    await page.getByRole("option", { name: new RegExp(`Fisika ${f.login.suffix}`) }).click();
    await expect(testCombobox).toContainText(`Fisika ${f.login.suffix}`);
    await page.getByRole("button", { name: "Terapkan", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`tes=${extraTestIds[0]}`));
    await expect(page.getByTestId("monitor-row").first()).toContainText("Tag-Fisika");

    // Kembali ke Daftar Tes -> Timeline tetap 1 hari
    await page.goto("/data-tes/daftar");
    const timelineAfterNav = page.getByLabel("Timeline tes", { exact: true });
    await expect(timelineAfterNav.getByLabel("Maksimal hari timeline")).toHaveValue("1");
    await expect(timelineAfterNav.getByTestId("timeline-day")).toHaveCount(1);
    await expect(timelineAfterNav).toContainText("Rentang tanggal · maksimal 1 hari");

    // Coba paksa 2 hari saat maxDays = 1 -> ditolak
    const fromDay = await timelineAfterNav.locator("#timeline-from").inputValue();
    const nextDay = new Date(Date.parse(`${fromDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await timelineAfterNav.locator("#timeline-to").fill(nextDay);
    await expect(timelineAfterNav.getByText("Pilih tanggal awal dan akhir yang valid, dengan rentang 1–1 hari.")).toBeVisible();
    await expect(timelineAfterNav.getByRole("button", { name: "Terapkan rentang" })).toBeDisabled();

    // Kembalikan ke 7 hari
    await timelineAfterNav.getByLabel("Maksimal hari timeline").selectOption("7");
    await expect(timelineAfterNav.getByTestId("timeline-day")).toHaveCount(7);

    // 5. MENU PENGATURAN PENGERJAAN: Berjajar horizontal >= 1366px tanpa horizontal scrollbar
    await page.goto("/data-tes/pengaturan-pengerjaan");
    const cardSubmission = page.locator('[data-slot="card"]').filter({ hasText: "Pengumpulan tes" }).first();
    const cardVisibility = page.locator('[data-slot="card"]').filter({ hasText: "Visibilitas nilai peserta" }).first();
    const boxA = await cardSubmission.boundingBox();
    const boxB = await cardVisibility.boundingBox();
    expect(boxA && boxB).toBeTruthy();
    expect(boxB!.x).toBeGreaterThan(boxA!.x + boxA!.width - 1);
    expect(Math.abs(boxA!.y - boxB!.y)).toBeLessThan(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // 8. MENU REKAP HASIL TES: Maksimal 2 kolom tes, sisanya di shadcn Drawer saat klik baris, 0 horizontal scrollbar di 1366px
    await page.goto(`/laporan/rekap?tahun=${f.login.yearId}&periode=${f.login.periodA}&gabung=1`);
    await expect(page.getByText(/Tabel menampilkan maksimal/)).toContainText("2 tes");
    const matrixHeaders = page.locator('[data-testid="matrix-table-container"] thead th');
    // Kolom: No, Nama/NISN, Grup/kelas, Rata-rata, Tes 1, Tes 2, Detail => total 7 header th
    await expect(matrixHeaders).toHaveCount(7);
    expect(
      await page.getByTestId("matrix-table-container").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // Klik baris matriks -> shadcn Drawer terbuka menampilkan seluruh 4 tes
    await page.getByTestId("matrix-row").first().click();
    const drawer = page.locator('[data-slot="drawer-content"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("drawer-test-item")).toHaveCount(4);
    await expect(drawer).toContainText(`Fisika ${f.login.suffix}`);
    await expect(drawer).toContainText("Tag-Fisika");
    await expect(drawer).toContainText(`Kimia ${f.login.suffix}`);
    await expect(drawer).toContainText(`Biologi ${f.login.suffix}`);
    await drawer.getByRole("button", { name: "Tutup", exact: true }).click();
    await expect(drawer).toBeHidden();

    // Keyboard Enter pada baris matriks juga membuka shadcn Drawer
    await page.getByTestId("matrix-row").first().focus();
    await page.keyboard.press("Enter");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("drawer-test-item")).toHaveCount(4);
    await drawer.getByRole("button", { name: "Tutup detail hasil" }).click();
    await expect(drawer).toBeHidden();

    // Excel export tetap memuat seluruh 4 tes beserta kolom Tag tes
    const excelResp = await page.request.get(`/laporan/rekap/unduh?tahun=${f.login.yearId}&periode=${f.login.periodA}&gabung=1`);
    expect(excelResp.status()).toBe(200);
    const excelFiles = unzipSync(await excelResp.body());
    const excelSummary = strFromU8(excelFiles["xl/worksheets/sheet1.xml"]);
    const excelAttempts = strFromU8(excelFiles["xl/worksheets/sheet2.xml"]);
    expect(excelSummary).toContain(`Biologi ${f.login.suffix}`);
    expect(excelSummary).toContain("Tag-Biologi, Kelas-XI");
    expect(excelAttempts).toContain("Tag tes");
    expect(excelAttempts).toContain("Tag-Fisika, Kelas-XI");

    // Ekspor Monitoring juga menyertakan kolom Tag tes
    const monExcelResp = await page.request.get(`/data-tes/monitoring/unduh?semua=1&tes=${extraTestIds[0]}`);
    expect(monExcelResp.status()).toBe(200);
    const monSheet = strFromU8(unzipSync(await monExcelResp.body())["xl/worksheets/sheet1.xml"]);
    expect(monSheet).toContain("Tag tes");
    expect(monSheet).toContain("Tag-Fisika, Kelas-XI");
  } finally {
    await cleanupAttemptFixture(client, f);
    await client.end();
  }
});
