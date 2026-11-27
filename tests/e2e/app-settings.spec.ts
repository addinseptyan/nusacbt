import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") {
    throw new Error("Tes yang mengubah database hanya boleh memakai PGDATABASE=nusacbt_test.");
  }
  return new pg.Client(postgresConfig());
}

test("pengaturan aplikasi menyimpan identitas, zona waktu bawaan, palet, logo, serta tampil di login, peserta, kartu, dan jadwal", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const tag = randomBytes(4).toString("hex");
  const client = testDatabase();
  await client.connect();
  const logoPng = await sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 30, g: 64, b: 175 } },
  })
    .png()
    .toBuffer();

  let majorId = "";
  let classId = "";
  let yearId = "";
  let prevYearId: string | null = null;
  let periodId = "";
  let studentId = "";

  try {
    prevYearId = (await client.query<{ active_year_id: string | null }>("SELECT active_year_id::text FROM academic_year_settings WHERE id = 1")).rows[0]?.active_year_id ?? null;
    await client.query("UPDATE exam_periods SET is_active = false WHERE is_active = true");
    yearId = (await client.query<{ id: string }>(
      "INSERT INTO academic_years(name) VALUES($1) RETURNING id::text AS id",
      [`TA App ${tag}`],
    )).rows[0].id;
    await client.query("UPDATE academic_year_settings SET active_year_id = $1::bigint WHERE id = 1", [yearId]);

    // Siapkan 1 siswa pada periode aktif di tahun ajaran aktif agar pratinjau kartu peserta dapat diuji
    majorId = (await client.query<{ id: string }>("INSERT INTO school_majors(name) VALUES($1) RETURNING id::text AS id", [`JURUSAN APP ${tag}`])).rows[0].id;
    classId = (await client.query<{ id: string }>("INSERT INTO school_classes(level, major_id) VALUES('XII', $1) RETURNING id::text AS id", [majorId])).rows[0].id;
    periodId = (await client.query<{ id: string }>(
      "INSERT INTO exam_periods(name, start_date, end_date, academic_year_id, is_active) VALUES($1, '2026-01-01', '2026-12-31', $2::bigint, true) RETURNING id::text AS id",
      [`Periode App ${tag}`, yearId],
    )).rows[0].id;
    studentId = (await client.query<{ id: string }>(
      "INSERT INTO school_students(name, nisn) VALUES($1, $2) RETURNING id::text AS id",
      [`Siswa App ${tag}`, `88${Math.floor(10000000 + Math.random() * 89999999)}`],
    )).rows[0].id;
    await client.query(
      "INSERT INTO student_class_placements(student_id, period_id, class_id, class_name_snapshot) VALUES($1, $2, $3, $4)",
      [studentId, periodId, classId, `XII JURUSAN APP ${tag}`],
    );
    await client.query(
      "INSERT INTO participant_identities(student_id, period_id, participant_number, username) VALUES($1, $2, $3, $4)",
      [studentId, periodId, `APP${tag}`, `peserta_app_${tag}`],
    );
    await client.query("UPDATE participant_login_settings SET period_id = $1 WHERE id = 1", [periodId]);

    await loginAsAdmin(page);
    await page.goto("/pengaturan/aplikasi");
    await expect(page.getByRole("heading", { name: "Pengaturan Aplikasi" })).toBeVisible();
    await expect(page).toHaveTitle("Pengaturan Aplikasi — NusaCBT");
    await expect(page.locator("#letterhead-file")).toHaveCount(0);

    // Favicon default tersedia pada <head> dan rute aset statis merespons 200
    const defaultIcons = await page.locator('head link[rel="icon"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")),
    );
    expect(defaultIcons).toContain("/icon.svg");
    expect(defaultIcons).toContain("/favicon.ico");
    expect((await page.request.get("/icon.svg")).status()).toBe(200);
    expect((await page.request.get("/favicon.ico")).status()).toBe(200);
    expect((await page.request.get("/apple-icon.png")).status()).toBe(200);

    await page.getByLabel(/Nama aplikasi/).fill("CBT Harapan");
    await page.getByLabel("Nama sekolah").fill("SMA Harapan Nusantara");
    await page.getByLabel("Keterangan aplikasi").fill("Platform Ujian Resmi");
    await page.getByLabel("Informasi untuk peserta").fill("Peserta dilarang membawa alat komunikasi ke ruang ujian.");
    await page.getByLabel("Zona waktu standar").selectOption("WITA");
    await page.getByRole("radio", { name: /Indigo/i }).check({ force: true });

    await page.locator("#logo-file").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: logoPng,
    });

    await page.getByRole("button", { name: "Simpan pengaturan aplikasi" }).click();
    await expect(page.getByText("Pengaturan aplikasi berhasil disimpan.")).toBeVisible();

    // Palet & nama aplikasi memperbarui HTML, sidebar, dan header admin
    await expect(page.locator("html")).toHaveAttribute("data-palette", "indigo");
    await expect(page.locator("header")).toContainText("CBT Harapan");
    await expect(page.getByRole("link", { name: /CBT Harapan, ke dashboard/ })).toBeVisible();

    // Verifikasi gambar branding tersaji aman dari /api/branding/logo dan rute letterhead mengembalikan 404
    const logoResp = await page.request.get("/api/branding/logo");
    expect(logoResp.status()).toBe(200);
    expect(logoResp.headers()["content-type"]).toBe("image/png");
    expect(logoResp.headers()["x-content-type-options"]).toBe("nosniff");
    expect((await page.request.get("/api/branding/letterhead")).status()).toBe(404);

    // Zona waktu terpusat diterapkan pada halaman token & daftar tes; title tab & favicon mengikuti branding terbaru
    await page.goto("/data-tes/token");
    await expect(page.getByText("Zona WITA")).toBeVisible();
    await expect(page).toHaveTitle("Token — CBT Harapan");
    await page.goto("/data-tes/daftar");
    await expect(page.getByLabel("Timeline tes", { exact: true })).toContainText("Zona WITA");
    await expect(page).toHaveTitle("Daftar Tes — CBT Harapan");
    const customIcons = await page.locator('head link[rel="icon"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")),
    );
    expect(customIcons.some((href) => typeof href === "string" && href.startsWith("/api/branding/logo?v="))).toBe(true);

    // Halaman kartu peserta menampilkan logo dan nama sekolah pada kartu (tanpa kop surat)
    await page.goto("/data-peserta/kartu");
    await page.getByLabel(new RegExp(`Siswa App ${tag}`)).check();
    await page.getByRole("button", { name: "Pratinjau kartu" }).click();
    const card = page.getByTestId("participant-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByAltText("Logo SMA Harapan Nusantara")).toBeVisible();
    await expect(card.getByAltText("Kop surat sekolah")).toHaveCount(0);
    await expect(card).toContainText("SMA Harapan Nusantara");
    await page.getByRole("button", { name: "Tutup" }).click();

    // Halaman login peserta menampilkan logo, palet, informasi peserta, title tab, dan favicon
    await page.goto("/peserta/login");
    await expect(page.locator("html")).toHaveAttribute("data-palette", "indigo");
    await expect(page).toHaveTitle("Masuk Peserta — CBT Harapan");
    const participantIcons = await page.locator('head link[rel="icon"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")),
    );
    expect(participantIcons.some((href) => typeof href === "string" && href.startsWith("/api/branding/logo?v="))).toBe(true);
    await expect(page.getByTestId("participant-login-info")).toContainText(
      "Peserta dilarang membawa alat komunikasi ke ruang ujian.",
    );
    await expect(page.getByText("SMA Harapan Nusantara", { exact: true })).toBeVisible();

    // Hapus logo saat ini dan aktifkan Mode Dev dengan konfirmasi bertingkat
    await page.goto("/pengaturan/aplikasi");
    await page.getByRole("button", { name: "Hapus logo saat ini" }).click();
    await page.getByRole("radio", { name: /Dev \(Pengembangan/i }).check({ force: true });
    await page.getByRole("button", { name: "Simpan pengaturan aplikasi" }).click();
    const devDialog = page.getByRole("dialog", { name: /Aktifkan Mode Dev\?/ });
    await expect(devDialog).toBeVisible();
    await devDialog.getByRole("button", { name: "Ya, aktifkan Mode Dev" }).click();
    await expect(page.getByText("Pengaturan aplikasi berhasil disimpan.")).toBeVisible();
    await expect(page.getByTestId("dev-mode-header-pill")).toContainText("Mode Dev");
    expect((await page.request.get("/api/branding/logo")).status()).toBe(404);
    await page.reload();
    const restoredIcons = await page.locator('head link[rel="icon"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")),
    );
    expect(restoredIcons).toContain("/icon.svg");
  } finally {
    try {
      await client.query("UPDATE participant_login_settings SET period_id = NULL WHERE id = 1");
      await client.query("UPDATE academic_year_settings SET active_year_id = $1::bigint WHERE id = 1", [prevYearId]);
      if (periodId) {
        await client.query("DELETE FROM participant_identities WHERE period_id = $1", [periodId]);
        await client.query("DELETE FROM student_class_placements WHERE period_id = $1", [periodId]);
        await client.query("DELETE FROM exam_periods WHERE id = $1", [periodId]);
      }
      if (yearId) await client.query("DELETE FROM academic_years WHERE id = $1::bigint", [yearId]);
      if (studentId) await client.query("DELETE FROM school_students WHERE id = $1", [studentId]);
      if (classId) await client.query("DELETE FROM school_classes WHERE id = $1", [classId]);
      if (majorId) await client.query("DELETE FROM school_majors WHERE id = $1", [majorId]);
    } finally {
      await client.query(
        `UPDATE app_settings
         SET app_name = 'NusaCBT',
             app_description = 'Platform ujian sekolah',
             school_name = '',
             participant_info = '',
             color_palette = 'emerald',
             default_time_zone = 'WIB',
             app_mode = 'production',
             logo_image = NULL,
             logo_image_mime = NULL,
             revision = revision + 1
         WHERE id = 1`,
      );
      await client.end();
    }
  }
});

test("superadmin di Mode Dev dapat mereset database operasional sambil mempertahankan akun admin dan RBAC", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const tag = randomBytes(4).toString("hex");
  const client = testDatabase();
  await client.connect();
  try {
    await client.query("UPDATE app_settings SET app_mode = 'production', revision = revision + 1 WHERE id = 1");
    await client.query("INSERT INTO question_topics(name) VALUES($1)", [`Reset Topik ${tag}`]);
    await client.query(
      "INSERT INTO school_students(name, nisn) VALUES($1, $2)",
      [`Reset Siswa ${tag}`, `77${Math.floor(10000000 + Math.random() * 89999999)}`],
    );

    await loginAsAdmin(page);
    await page.goto("/pengaturan/aplikasi");

    // Di mode production, tombol Reset Database belum muncul
    await expect(page.getByRole("button", { name: "Reset Database" })).toHaveCount(0);

    // Aktifkan Mode Dev
    await page.getByRole("radio", { name: /Dev \(Pengembangan/i }).check({ force: true });
    await page.getByRole("button", { name: "Simpan pengaturan aplikasi" }).click();
    const devDialog = page.getByRole("dialog", { name: /Aktifkan Mode Dev\?/ });
    await devDialog.getByRole("button", { name: "Ya, aktifkan Mode Dev" }).click();
    await expect(page.getByTestId("dev-mode-header-pill")).toBeVisible();

    // Klik Reset Database & verifikasi guard frasa RESET DATABASE
    await page.getByRole("button", { name: "Reset Database" }).click();
    const resetDialog = page.getByRole("dialog", { name: "Konfirmasi Reset Database" });
    await expect(resetDialog).toBeVisible();
    const confirmReset = resetDialog.getByRole("button", { name: "Ya, reset database sekarang" });
    await expect(confirmReset).toBeDisabled();

    await resetDialog.getByRole("checkbox").check();
    await resetDialog.getByLabel(/Ketik RESET DATABASE/).fill("reset");
    await expect(confirmReset).toBeDisabled();

    await resetDialog.getByLabel(/Ketik RESET DATABASE/).fill("RESET DATABASE");
    await expect(confirmReset).toBeEnabled();
    await confirmReset.click();
    await expect(resetDialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByText(/Seluruh data operasional berhasil direset/)).toBeVisible();

    // Data operasional terhapus, sedangkan akun admin & mode kembali production & singleton tetap utuh
    expect((await client.query("SELECT count(*)::int AS n FROM question_topics")).rows[0].n).toBe(0);
    expect((await client.query("SELECT count(*)::int AS n FROM school_students")).rows[0].n).toBe(0);
    expect((await client.query("SELECT count(*)::int AS n FROM admin_users")).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await client.query("SELECT count(*)::int AS n FROM admin_roles")).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await client.query("SELECT app_mode FROM app_settings WHERE id = 1")).rows[0].app_mode).toBe("production");
    expect((await client.query("SELECT count(*)::int AS n FROM exam_work_settings")).rows[0].n).toBe(1);
    expect((await client.query("SELECT count(*)::int AS n FROM exam_score_category_visibility")).rows[0].n).toBe(3);

    // Sesi admin masih aktif setelah reset
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Selamat datang di NusaCBT/ })).toBeVisible();
  } finally {
    await client.query("DELETE FROM question_topics WHERE name = $1", [`Reset Topik ${tag}`]).catch(() => {});
    await client.query("DELETE FROM school_students WHERE name = $1", [`Reset Siswa ${tag}`]).catch(() => {});
    await client.query(
      `UPDATE app_settings
       SET app_name = 'NusaCBT',
           app_description = 'Platform ujian sekolah',
           school_name = '',
           participant_info = '',
           color_palette = 'emerald',
           default_time_zone = 'WIB',
           app_mode = 'production',
           logo_image = NULL,
           logo_image_mime = NULL,
           revision = revision + 1
       WHERE id = 1`,
    );
    await client.end();
  }
});
