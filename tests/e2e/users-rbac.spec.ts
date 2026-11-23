import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

import { hashPassword } from "../../src/lib/password.mjs";
import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") {
    throw new Error("Tes yang mengubah database hanya boleh memakai PGDATABASE=nusacbt_test.");
  }
  return new pg.Client(postgresConfig());
}

async function loginWithCredentials(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username admin").fill(username);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk ke panel admin" }).click();
}

test("RBAC penuh: manajemen peran & pengguna, pembatasan modul & unduhan, anti-eskalasi, dan pencabutan sesi seketika", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const tag = randomBytes(4).toString("hex");
  const roleName = `Penguji E2E ${tag}`;
  const updatedRoleName = `Penguji Aktif ${tag}`;
  const subRoleName = `SubAdmin E2E ${tag}`;
  const opUsername = `op_e2e_${tag}`;
  const opPassword1 = "Sandi-Operator-E2E-2026!";
  const opPassword2 = "Sandi-Baru-Operator-2026!";
  const lockedUsername = `lock_e2e_${tag}`;
  const subUsername = `sub_e2e_${tag}`;
  const subPassword = "Sandi-SubAdmin-E2E-2026!";

  const client = testDatabase();
  await client.connect();

  let periodId = "";
  let prevLoginPeriodId: string | null = null;
  let testId = "";
  let topicId = "";

  try {
    prevLoginPeriodId = (
      await client.query<{ period_id: string | null }>(
        "SELECT period_id::text AS period_id FROM participant_login_settings WHERE id = 1",
      )
    ).rows[0]?.period_id ?? null;
    // Siapkan periode + tes minimal agar halaman /data-tes/monitoring?tes=... menampilkan FinalGradePanel.
    periodId = (
      await client.query<{ id: string }>(
        "INSERT INTO exam_periods (name, start_date, end_date) VALUES ($1, '2026-11-01', '2026-11-30') RETURNING id::text AS id",
        [`Periode RBAC ${tag}`],
      )
    ).rows[0].id;
    await client.query("UPDATE participant_login_settings SET period_id = $1::bigint WHERE id = 1", [periodId]);
    topicId = (
      await client.query<{ id: string }>(
        "INSERT INTO question_topics (name) VALUES ($1) RETURNING id::text AS id",
        [`Topik RBAC ${tag}`],
      )
    ).rows[0].id;
    const qId = (
      await client.query<{ id: string }>(
        `INSERT INTO question_bank (topic_id, prompt_text, option_a_text, option_b_text, option_c_text, option_d_text, option_e_text, correct_option)
         VALUES ($1::bigint, 'Soal RBAC', 'A', 'B', 'C', 'D', 'E', 'A') RETURNING id::text AS id`,
        [topicId],
      )
    ).rows[0].id;
    testId = (
      await client.query<{ id: string }>(
        `INSERT INTO exam_tests (name, period_id, starts_at, duration_minutes, time_zone)
         VALUES ($1, $2::bigint, '2026-11-10T01:00:00Z', 60, 'WIB') RETURNING id::text AS id`,
        [`Tes RBAC ${tag}`, periodId],
      )
    ).rows[0].id;
    await client.query(
      "INSERT INTO exam_test_questions (exam_test_id, question_id, position) VALUES ($1::bigint, $2::bigint, 1)",
      [testId, qId],
    );

    // 1. Login sebagai Superadmin bawaan
    await loginAsAdmin(page);
    await expect(page.getByTestId("header-user-info")).toContainText("Superadmin");

    // 2. Buat peran kustom pada /pengaturan/hak-akses dan atur matriks izinnya
    await page.goto("/pengaturan/hak-akses");
    await expect(page.getByRole("heading", { name: "Pengaturan Hak Akses" })).toBeVisible();
    // Peran bawaan tidak memiliki tombol Hapus peran
    await page.getByTestId("role-item-operator_ujian").click();
    await expect(page.getByRole("button", { name: "Hapus peran" })).toHaveCount(0);

    await page.getByRole("button", { name: "Tambah" }).click();
    const roleDialog = page.getByRole("dialog");
    await roleDialog.getByLabel("Nama peran").fill(roleName);
    await roleDialog.getByLabel("Keterangan").fill("Peran sementara uji E2E");
    await roleDialog.getByRole("button", { name: "Buat peran" }).click();
    await expect(page.getByText(`Peran "${roleName}" berhasil dibuat.`)).toBeVisible();

    await page.getByRole("button", { name: new RegExp(roleName) }).click();
    await page.getByLabel("Nama peran").fill(updatedRoleName);
    await page.getByLabel(/Akun Peserta \(Identitas & Buka Kunci\)/).check();
    await page.getByLabel(/Cetak Kartu Peserta \(Tanpa Sandi\)/).check();
    await page.getByLabel(/Monitoring Hasil Tes & Ekspor Excel/).check();
    await page.getByRole("button", { name: "Simpan hak akses" }).click();
    await expect(page.getByText(`Hak akses peran "${updatedRoleName}" berhasil disimpan.`)).toBeVisible();
    await expect(page.getByText("Revisi #2")).toBeVisible();

    // Buat juga peran SubAdmin untuk menguji anti-eskalasi non-superadmin
    await page.getByRole("button", { name: "Tambah" }).click();
    await roleDialog.getByLabel("Nama peran").fill(subRoleName);
    await roleDialog.getByLabel("Keterangan").fill("Sub-admin hanya mengelola user");
    await roleDialog.getByRole("button", { name: "Buat peran" }).click();
    await expect(page.getByText(`Peran "${subRoleName}" berhasil dibuat.`)).toBeVisible();
    await page.getByRole("button", { name: new RegExp(subRoleName) }).click();
    await page.getByLabel(/Pengaturan User/).check();
    await page.getByLabel(/Pengaturan Hak Akses/).check();
    await page.getByLabel(/Monitoring Hasil Tes & Ekspor Excel/).check();
    await page.getByRole("button", { name: "Simpan hak akses" }).click();
    await expect(page.getByText(`Hak akses peran "${subRoleName}" berhasil disimpan.`)).toBeVisible();

    // 3. Buat pengguna operator di /pengaturan/user & buka kunci akun terkunci
    await client.query(
      `INSERT INTO admin_users (username, full_name, password_hash, is_superuser, is_active, failed_attempts, locked_until)
       VALUES ($1, $2, $3, false, true, 5, now() + interval '15 minutes')`,
      [lockedUsername, `Akun Uji ${tag}`, await hashPassword(opPassword1)],
    );

    await page.goto("/pengaturan/user");
    await expect(page.getByRole("heading", { name: "Pengaturan User" })).toBeVisible();
    await page.getByRole("button", { name: "Tambah pengguna" }).click();
    const userDialog = page.getByRole("dialog");
    await userDialog.getByLabel("Username", { exact: true }).fill(opUsername);
    await userDialog.getByLabel("Nama lengkap").fill("Petugas Ujian E2E");
    await userDialog.getByLabel("Pilih peran pengguna baru").click();
    await page.getByRole("option", { name: new RegExp(updatedRoleName) }).click();
    await userDialog.getByLabel("Kata sandi awal").fill(opPassword1);
    await userDialog.getByLabel("Konfirmasi sandi").fill(opPassword1);
    await userDialog.getByRole("button", { name: "Simpan pengguna" }).click();
    await expect(page.getByText(`Pengguna ${opUsername} berhasil ditambahkan.`)).toBeVisible();

    // Tambah user SubAdmin
    await page.getByRole("button", { name: "Tambah pengguna" }).click();
    await userDialog.getByLabel("Username", { exact: true }).fill(subUsername);
    await userDialog.getByLabel("Nama lengkap").fill("SubAdmin E2E");
    await userDialog.getByLabel("Pilih peran pengguna baru").click();
    await page.getByRole("option", { name: new RegExp(subRoleName) }).click();
    await userDialog.getByLabel("Kata sandi awal").fill(subPassword);
    await userDialog.getByLabel("Konfirmasi sandi").fill(subPassword);
    await userDialog.getByRole("button", { name: "Simpan pengguna" }).click();
    await expect(page.getByText(`Pengguna ${subUsername} berhasil ditambahkan.`)).toBeVisible();

    // Buka kunci akun yang terkunci
    const lockedRow = page.getByTestId(`user-row-${lockedUsername}`);
    await expect(lockedRow).toContainText("Terkunci");
    await lockedRow.getByRole("button", { name: "Buka kunci" }).click();
    await expect(page.getByText(`Penguncian login akun ${lockedUsername} berhasil dibuka.`)).toBeVisible();
    await expect(lockedRow.getByRole("button", { name: "Buka kunci" })).toHaveCount(0);
    await expect(lockedRow).not.toContainText("Terkunci");

    // 4. Sesi Operator terbatas pada konteks browser terpisah
    const opContext = await browser.newContext();
    const opPage = await opContext.newPage();
    try {
      await loginWithCredentials(opPage, opUsername, opPassword1);
      await expect(opPage).toHaveURL(/\/$/);
      await expect(opPage.getByTestId("header-user-info")).toContainText("Petugas Ujian E2E");
      await expect(opPage.getByTestId("header-user-info")).toContainText(updatedRoleName);

      // Tautan Pengaturan aplikasi tidak boleh tampil bagi non-superadmin tanpa izin app_settings.manage
      await expect(opPage.getByRole("link", { name: "Pengaturan aplikasi" })).toHaveCount(0);

      // Sidebar hanya memuat grup dan tautan yang diizinkan
      const sidebar = opPage.locator('[data-sidebar="sidebar"]');
      await expect(sidebar.getByRole("button", { name: "Data Modul" })).toHaveCount(0);
      await expect(sidebar.getByRole("button", { name: "Laporan" })).toHaveCount(0);
      await expect(sidebar.getByRole("button", { name: "Tool" })).toHaveCount(0);
      await expect(sidebar.getByRole("button", { name: "Pengaturan" })).toHaveCount(0);

      await sidebar.getByRole("button", { name: "Data Peserta" }).click();
      await expect(sidebar.getByRole("link", { name: "Akun Peserta" })).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "Cetak Kartu Peserta" })).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "Data Siswa" })).toHaveCount(0);

      await sidebar.getByRole("button", { name: "Data Tes" }).click();
      await expect(sidebar.getByRole("link", { name: "Hasil / Monitoring Tes" })).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "Daftar Tes" })).toHaveCount(0);
      await expect(sidebar.getByRole("link", { name: "Token" })).toHaveCount(0);

      // Halaman tanpa izin mengembalikan UI 403 Akses dibatasi
      for (const deniedPath of [
        "/pengaturan/user",
        "/pengaturan/hak-akses",
        "/pengaturan/aplikasi",
        "/data-modul/soal",
        "/data-peserta/sandi",
        "/laporan/rekap",
        "/tool/backup",
      ]) {
        await opPage.goto(deniedPath);
        await expect(opPage.getByText("403 · Akses dibatasi")).toBeVisible();
      }

      // Pemisahan Akun vs Sandi Peserta pada /data-peserta/akun
      await opPage.goto("/data-peserta/akun");
      await expect(opPage.getByRole("button", { name: "Buat identitas otomatis" })).toBeVisible();
      await expect(opPage.getByRole("button", { name: "Buat sandi otomatis" })).toHaveCount(0);

      // Pemisahan Cetak Kartu Tanpa Sandi vs Bersandi
      await opPage.goto("/data-peserta/kartu");
      await expect(opPage.getByText("Cetak kartu tanpa sandi")).toBeVisible();
      await expect(opPage.getByText("Sertakan sandi pada kartu")).toHaveCount(0);
      const cardWithPasswordRes = await opPage.request.post("/data-peserta/kartu/siapkan", {
        headers: { origin: "http://127.0.0.1:3100", "content-type": "application/json", "X-NusaCBT-Cards": "1" },
        data: { mode: "prepare", filters: `periode=${periodId}`, candidates: [], includePassword: true },
        failOnStatusCode: false,
      });
      expect(cardWithPasswordRes.status()).toBe(403);
      expect(await cardWithPasswordRes.text()).toContain("menyertakan sandi peserta");

      // Ekspor tanpa izin ditolak 403, sedangkan monitoring.view diizinkan 200
      const exportSoalRes = await opPage.request.post("/data-modul/export-soal/unduh", {
        headers: { origin: "http://127.0.0.1:3100", "content-type": "application/json" },
        data: { questionIds: [] },
        failOnStatusCode: false,
      });
      expect(exportSoalRes.status()).toBe(403);
      const rekapRes = await opPage.request.get("/laporan/rekap/unduh", { failOnStatusCode: false });
      expect(rekapRes.status()).toBe(403);
      const monitorExportRes = await opPage.request.get("/data-tes/monitoring/unduh", { failOnStatusCode: false });
      expect(monitorExportRes.status()).toBe(200);

      // Monitoring tanpa grading_overrides.manage menyembunyikan tombol ubah metode nilai akhir
      await opPage.goto(`/data-tes/monitoring?tes=${testId}`);
      await expect(opPage.getByRole("heading", { name: new RegExp(`Nilai akhir · Tes RBAC ${tag}`) })).toBeVisible();
      await expect(opPage.getByRole("button", { name: /Ubah metode/ })).toHaveCount(0);

      // 5. Superadmin mencabut monitoring.view -> langsung berlaku pada permintaan opPage berikutnya!
      await page.goto("/pengaturan/hak-akses");
      await page.getByRole("button", { name: new RegExp(updatedRoleName) }).click();
      await page.getByLabel(/Monitoring Hasil Tes & Ekspor Excel/).uncheck();
      await page.getByRole("button", { name: "Simpan hak akses" }).click();
      await expect(page.getByText(`Hak akses peran "${updatedRoleName}" berhasil disimpan.`)).toBeVisible();

      await opPage.goto(`/data-tes/monitoring?tes=${testId}`);
      await expect(opPage.getByText("403 · Akses dibatasi")).toBeVisible();
      const revokedExportRes = await opPage.request.get("/data-tes/monitoring/unduh", { failOnStatusCode: false });
      expect(revokedExportRes.status()).toBe(403);

      // 6. Superadmin reset sandi operator -> sesi operator langsung dicabut
      await page.goto("/pengaturan/user");
      const opRow = page.getByTestId(`user-row-${opUsername}`);
      await opRow.getByRole("button", { name: "Reset sandi" }).click();
      await page.getByLabel("Kata sandi baru").fill(opPassword2);
      await page.getByLabel("Konfirmasi sandi baru").fill(opPassword2);
      await page.getByRole("button", { name: "Simpan sandi baru" }).click();
      await expect(page.getByText(new RegExp(`Kata sandi ${opUsername} telah diatur ulang`))).toBeVisible();

      await opPage.goto("/data-peserta/akun");
      await expect(opPage).toHaveURL(/\/login$/);

      // Operator masuk kembali dengan sandi baru
      await loginWithCredentials(opPage, opUsername, opPassword2);
      await expect(opPage).toHaveURL(/\/$/);

      // 7. Superadmin menonaktifkan operator -> sesi aktif langsung berakhir dan login ulang ditolak
      await opRow.getByRole("button", { name: "Nonaktifkan" }).click();
      await expect(page.getByText(`Akun ${opUsername} telah dinonaktifkan dan sesinya dicabut.`)).toBeVisible();

      await opPage.goto("/data-peserta/akun");
      await expect(opPage).toHaveURL(/\/login$/);

      await loginWithCredentials(opPage, opUsername, opPassword2);
      await expect(opPage.getByRole("alert").filter({ hasText: "Username atau kata sandi salah" })).toBeVisible();
      await expect(opPage).toHaveURL(/\/login$/);
    } finally {
      await opContext.close();
    }

    // 8. Uji anti-eskalasi oleh operator SubAdmin pada konteks terpisah
    const subContext = await browser.newContext();
    const subPage = await subContext.newPage();
    try {
      await loginWithCredentials(subPage, subUsername, subPassword);
      await expect(subPage).toHaveURL(/\/$/);

      await subPage.goto("/pengaturan/user");
      const superRow = subPage.getByTestId(`user-row-${process.env.TEST_ADMIN_USERNAME!}`);
      await expect(superRow.getByRole("button", { name: "Edit" })).toBeDisabled();
      await expect(superRow.getByRole("button", { name: "Reset sandi" })).toBeDisabled();
      await expect(superRow.getByRole("button", { name: "Nonaktifkan" })).toBeDisabled();

      // Saat tambah pengguna, SubAdmin tidak bisa memilih Jadikan Superadmin atau peran dengan izin di atasnya
      await subPage.getByRole("button", { name: "Tambah pengguna" }).click();
      await expect(subPage.getByText("Jadikan Superadmin")).toHaveCount(0);
      await subPage.getByLabel("Pilih peran pengguna baru").click();
      await expect(subPage.getByRole("option", { name: /Pembuat Soal/ })).toHaveCount(0);
      await expect(subPage.getByRole("option", { name: new RegExp(subRoleName) })).toBeVisible();
      await subPage.keyboard.press("Escape");
      await subPage.getByRole("button", { name: "Batal" }).click();

      // Pada /pengaturan/hak-akses, peran yang punya izin di atas SubAdmin (atau perannya sendiri) hanya-baca
      await subPage.goto("/pengaturan/hak-akses");
      await subPage.getByTestId("role-item-pengawas").click();
      await expect(subPage.getByText("Matriks hanya-baca")).toBeVisible();
      await expect(subPage.getByRole("button", { name: "Simpan hak akses" })).toBeDisabled();

      await subPage.getByRole("button", { name: new RegExp(subRoleName) }).click();
      await expect(subPage.getByText("Matriks hanya-baca")).toBeVisible();
      await expect(subPage.getByRole("button", { name: "Simpan hak akses" })).toBeDisabled();
    } finally {
      await subContext.close();
    }
  } finally {
    await client.query("DELETE FROM admin_user_audit WHERE target_username_snapshot = ANY($1) OR actor_username_snapshot = ANY($1)", [
      [opUsername, lockedUsername, subUsername],
    ]);
    await client.query("DELETE FROM admin_users WHERE username = ANY($1)", [[opUsername, lockedUsername, subUsername]]);
    await client.query("DELETE FROM admin_roles WHERE name = ANY($1)", [[roleName, updatedRoleName, subRoleName]]);
    if (testId) {
      await client.query("DELETE FROM exam_test_questions WHERE exam_test_id = $1::bigint", [testId]);
      await client.query("DELETE FROM exam_tests WHERE id = $1::bigint", [testId]);
    }
    if (topicId) {
      await client.query("DELETE FROM question_bank WHERE topic_id = $1::bigint", [topicId]);
      await client.query("DELETE FROM question_topics WHERE id = $1::bigint", [topicId]);
    }
    if (periodId) {
      await client.query("UPDATE participant_login_settings SET period_id = $1::bigint WHERE id = 1", [prevLoginPeriodId]);
      await client.query("DELETE FROM exam_periods WHERE id = $1::bigint", [periodId]);
    }
    await client.end();
  }
});
