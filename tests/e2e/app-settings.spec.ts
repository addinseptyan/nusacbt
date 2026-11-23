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

test("pengaturan aplikasi menyimpan identitas, palet, logo, kop surat, serta tampil di login, peserta, dan kartu", async ({ page }) => {
  const tag = randomBytes(4).toString("hex");
  const client = testDatabase();
  await client.connect();
  const logoPng = await sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 30, g: 64, b: 175 } },
  })
    .png()
    .toBuffer();
  const letterheadPng = await sharp({
    create: { width: 800, height: 180, channels: 3, background: { r: 220, g: 235, b: 252 } },
  })
    .png()
    .toBuffer();

  let majorId = "";
  let classId = "";
  let periodId = "";
  let studentId = "";

  try {
    // Siapkan 1 siswa pada periode login aktif agar pratinjau kartu peserta dapat diuji
    majorId = (await client.query<{ id: string }>("INSERT INTO school_majors(name) VALUES($1) RETURNING id::text AS id", [`JURUSAN APP ${tag}`])).rows[0].id;
    classId = (await client.query<{ id: string }>("INSERT INTO school_classes(level, major_id) VALUES('XII', $1) RETURNING id::text AS id", [majorId])).rows[0].id;
    periodId = (await client.query<{ id: string }>(
      "INSERT INTO exam_periods(name, start_date, end_date) VALUES($1, '2026-01-01', '2026-12-31') RETURNING id::text AS id",
      [`Periode App ${tag}`],
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

    await page.getByLabel(/Nama aplikasi/).fill("CBT Harapan");
    await page.getByLabel("Nama sekolah").fill("SMA Harapan Nusantara");
    await page.getByLabel("Keterangan aplikasi").fill("Platform Ujian Resmi");
    await page.getByLabel("Informasi untuk peserta").fill("Peserta dilarang membawa alat komunikasi ke ruang ujian.");
    await page.getByRole("radio", { name: /Indigo/i }).check({ force: true });

    await page.locator("#logo-file").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: logoPng,
    });
    await page.locator("#letterhead-file").setInputFiles({
      name: "kop.png",
      mimeType: "image/png",
      buffer: letterheadPng,
    });

    await page.getByRole("button", { name: "Simpan pengaturan aplikasi" }).click();
    await expect(page.getByText("Pengaturan aplikasi berhasil disimpan.")).toBeVisible();

    // Palet & nama aplikasi memperbarui HTML, sidebar, dan header admin
    await expect(page.locator("html")).toHaveAttribute("data-palette", "indigo");
    await expect(page.locator("header")).toContainText("CBT Harapan");
    await expect(page.getByRole("link", { name: /CBT Harapan, ke dashboard/ })).toBeVisible();

    // Verifikasi gambar branding tersaji aman dari /api/branding/*
    const logoResp = await page.request.get("/api/branding/logo");
    expect(logoResp.status()).toBe(200);
    expect(logoResp.headers()["content-type"]).toBe("image/png");
    expect(logoResp.headers()["x-content-type-options"]).toBe("nosniff");

    const letterResp = await page.request.get("/api/branding/letterhead");
    expect(letterResp.status()).toBe(200);
    expect(letterResp.headers()["content-type"]).toBe("image/png");

    // Halaman kartu peserta menampilkan kop surat, logo, dan nama sekolah pada kartu
    await page.goto("/data-peserta/kartu");
    await page.getByLabel(new RegExp(`Siswa App ${tag}`)).check();
    await page.getByRole("button", { name: "Pratinjau kartu" }).click();
    const card = page.getByTestId("participant-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByAltText("Kop surat sekolah")).toBeVisible();
    await expect(card.getByAltText("Logo SMA Harapan Nusantara")).toBeVisible();
    await expect(card).toContainText("SMA Harapan Nusantara");
    await page.getByRole("button", { name: "Tutup" }).click();

    // Halaman login peserta menampilkan logo, palet, dan informasi peserta
    await page.goto("/peserta/login");
    await expect(page.locator("html")).toHaveAttribute("data-palette", "indigo");
    await expect(page.getByTestId("participant-login-info")).toContainText(
      "Peserta dilarang membawa alat komunikasi ke ruang ujian.",
    );
    await expect(page.getByText("SMA Harapan Nusantara", { exact: true })).toBeVisible();

    // Hapus logo saat ini dan simpan
    await page.goto("/pengaturan/aplikasi");
    await page.getByRole("button", { name: "Hapus logo saat ini" }).click();
    await page.getByRole("button", { name: "Simpan pengaturan aplikasi" }).click();
    await expect(page.getByText("Pengaturan aplikasi berhasil disimpan.")).toBeVisible();
    expect((await page.request.get("/api/branding/logo")).status()).toBe(404);
  } finally {
    try {
      await client.query("UPDATE participant_login_settings SET period_id = NULL WHERE id = 1");
      if (periodId) {
        await client.query("DELETE FROM participant_identities WHERE period_id = $1", [periodId]);
        await client.query("DELETE FROM student_class_placements WHERE period_id = $1", [periodId]);
        await client.query("DELETE FROM exam_periods WHERE id = $1", [periodId]);
      }
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
             logo_image = NULL,
             logo_image_mime = NULL,
             letterhead_image = NULL,
             letterhead_image_mime = NULL,
             revision = revision + 1
         WHERE id = 1`,
      );
      await client.end();
    }
  }
});
