import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

async function expectExamNavigation(page: Page, title: string) {
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(title);
  await expect(breadcrumb.getByRole("link", { name: "Daftar Tes" })).toHaveAttribute("href", "/data-tes/daftar");
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar.getByRole("button", { name: "Data Tes", exact: true })).toHaveAttribute("data-active", "true");
  const parent = sidebar.getByRole("link", { name: "Daftar Tes", exact: true });
  await expect(parent).toHaveAttribute("data-active", "true");
  await expect(parent).toHaveAttribute("aria-current", "location");
}

test("tooltip, breadcrumb, dan sidebar mengenali kelompok serta pelaksanaan", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  try {
    await loginAsAdmin(page);
    await page.goto("/data-tes/daftar");
    const groupLink = page.getByRole("link", { name: "Atur kelompok sesi" });
    await groupLink.scrollIntoViewIfNeeded(); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); await groupLink.focus();
    await expect(page.locator('[data-slot="tooltip-content"]').filter({ hasText: "Bagi siswa ke kelompok tetap per periode" })).toBeVisible();
    await expect(groupLink).toHaveAttribute("aria-describedby", /.+/);
    await groupLink.click();
    await expect(page).toHaveURL(/\/data-tes\/daftar\/sesi$/);
    await expectExamNavigation(page, "Kelompok Sesi");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Data Tes");

    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Daftar Tes" }).click();
    await page.getByLabel("Cari tes").fill(f.activeName);
    const runLink = page.getByRole("link", { name: `Pelaksanaan tes ${f.activeTest}` });
    await runLink.scrollIntoViewIfNeeded(); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); await runLink.focus();
    await expect(page.locator('[data-slot="tooltip-content"]').filter({ hasText: "Atur jadwal, peserta, dan rilis tes ini" })).toBeVisible();
    await expect(runLink).toHaveAttribute("aria-describedby", /.+/);
    await runLink.click();
    await expect(page).toHaveURL(new RegExp(`/data-tes/daftar/${f.activeTest}$`));
    await expectExamNavigation(page, "Pelaksanaan Tes");

    // Rute dengan ID tidak valid tetap menjelaskan lokasi dan tidak menampilkan Dashboard.
    await page.goto("/data-tes/daftar/bukan-id");
    await expect(page.getByRole("alert").filter({ hasText: "Pelaksanaan belum dapat dimuat" })).toContainText("Identitas tes tidak valid");
    await expectExamNavigation(page, "Pelaksanaan Tes");

    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).locator('[aria-current="page"]')).toHaveText("Kelompok Sesi");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.getByRole("button", { name: "Buka atau tutup sidebar" }).click();
    const mobile = page.getByRole("dialog", { name: "Sidebar" });
    await expect(mobile.getByRole("button", { name: "Data Tes", exact: true })).toHaveAttribute("data-active", "true");
    await expect(mobile.getByRole("link", { name: "Daftar Tes", exact: true })).toHaveAttribute("aria-current", "location");
    await mobile.getByRole("link", { name: "Daftar Tes", exact: true }).click();
    await expect(mobile).toBeHidden();
    await expect(page).toHaveURL(/\/data-tes\/daftar$/);
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("badge draf dan dirilis berbeda, menghormati reduced motion, dan mengikuti perubahan rilis", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const label = `Draf UI ${f.suffix}`;
  try {
    const admin = (await client.query<{ id: string }>("SELECT id::text AS id FROM admin_users WHERE username=$1", [process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    const run = (await client.query<{ id: string }>(
      `INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by)
       VALUES($1,$2,'makeup',$3,'2044-01-01 00:00:00+00','WIB',90,$4) RETURNING id::text AS id`,
      [f.activeTest, f.periodA, label, admin],
    )).rows[0].id;
    await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,$3,'makeup',$4,$5)", [run, f.activeTest, f.periodA, f.studentA, f.placementA]);
    await loginAsAdmin(page); await page.goto(`/data-tes/daftar/${f.activeTest}`);
    const list = page.getByRole("list", { name: "Daftar pelaksanaan tes" });
    const draftRow = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `Susulan · ${label}` }) });
    const publishedRow = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Susulan · Jadwal fiktif" }) });
    const draft = draftRow.locator('[data-status="draft"]');
    const published = publishedRow.locator('[data-status="published"]');
    await expect(draft).toHaveText("Draf"); await expect(published).toHaveText("Dirilis");
    expect(await draft.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(await published.evaluate((el) => getComputedStyle(el).backgroundColor));
    const ping = draft.locator('[aria-hidden="true"] > span').first();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(ping).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(ping).toHaveCSS("animation-name", "ping");
    await expect(ping).toHaveCSS("animation-iteration-count", "3");
    await page.getByRole("button", { name: "Ganti tema" }).click();
    expect(await draft.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(await published.evaluate((el) => getComputedStyle(el).backgroundColor));

    await draftRow.getByRole("button", { name: `Rilis ${label}` }).click();
    const publish = page.getByRole("dialog", { name: "Rilis jadwal pelaksanaan?" });
    await publish.getByRole("button", { name: "Ya, rilis jadwal" }).click(); await expect(publish).toBeHidden();
    await expect(draftRow.locator('[data-status="published"]')).toHaveText("Dirilis");
    await draftRow.getByRole("button", { name: `Tarik rilis ${label}` }).click();
    const unpublish = page.getByRole("dialog", { name: "Tarik rilis jadwal?" });
    await unpublish.getByRole("button", { name: "Ya, tarik rilis" }).click(); await expect(unpublish).toBeHidden();
    await expect(draftRow.locator('[data-status="draft"]')).toHaveText("Draf");
  } finally { await cleanupLoginFixture(client, f); await client.end(); }
});

test("kelompok sesi menggabungkan langkah 2, pengelompokan kelas, multiselect kelas auto-centang, dan penyesuaian sesi per kelas maupun siswa", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f = await seedLoginFixture(client);
  const extraMajors: string[] = [];
  const extraClasses: string[] = [];
  const extraStudents: string[] = [];

  try {
    const majorIpa = (await client.query<{ id: string }>("INSERT INTO school_majors(name) VALUES($1) RETURNING id::text AS id", [`IPA ${f.suffix}`])).rows[0].id;
    const majorIps = (await client.query<{ id: string }>("INSERT INTO school_majors(name) VALUES($1) RETURNING id::text AS id", [`IPS ${f.suffix}`])).rows[0].id;
    extraMajors.push(majorIpa, majorIps);
    const classIpa = (await client.query<{ id: string }>("INSERT INTO school_classes(major_id, level) VALUES($1, 'XI') RETURNING id::text AS id", [majorIpa])).rows[0].id;
    const classIps = (await client.query<{ id: string }>("INSERT INTO school_classes(major_id, level) VALUES($1, 'XI') RETURNING id::text AS id", [majorIps])).rows[0].id;
    extraClasses.push(classIpa, classIps);
    const labelIpa = `XI IPA ${f.suffix}`;
    const labelIps = `XI IPS ${f.suffix}`;

    const createStudent = async (name: string, classId: string, classLabel: string) => {
      const nisn = String(randomInt(100_000_000, 999_999_999)).padStart(10, "0");
      const id = (await client.query<{ id: string }>("INSERT INTO school_students(name, nisn) VALUES($1, $2) RETURNING id::text AS id", [name, nisn])).rows[0].id;
      await client.query("INSERT INTO student_class_placements(student_id, period_id, class_id, class_name_snapshot) VALUES($1, $2, $3, $4)", [id, f.periodA, classId, classLabel]);
      extraStudents.push(id);
      return { id, name, nisn };
    };

    const ipa1 = await createStudent(`Siswa IPA Satu ${f.suffix}`, classIpa, labelIpa);
    const ipa2 = await createStudent(`Siswa IPA Dua ${f.suffix}`, classIpa, labelIpa);
    const ips1 = await createStudent(`Siswa IPS Satu ${f.suffix}`, classIps, labelIps);
    const ips2 = await createStudent(`Siswa IPS Dua ${f.suffix}`, classIps, labelIps);

    await loginAsAdmin(page);
    await page.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`);

    // Hanya ada 2 langkah: langkah 2 & 3 lama sudah digabung menjadi "2. Pilih siswa dan sesuaikan"
    await expect(page.getByRole("heading", { name: "1. Jumlah dan kapasitas sesi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "2. Pilih siswa dan sesuaikan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /3\. Periksa/ })).toHaveCount(0);

    // Tambah Sesi 2
    await page.getByLabel("Kapasitas sesi 1").fill("5");
    await page.getByRole("button", { name: "Tambah sesi" }).click();
    await page.getByLabel("Kapasitas sesi 2").fill("5");

    // Siswa dikelompokkan per kelas: centang kelas XI IPA -> seluruh siswa di bawahnya auto tercentang
    const ipaGroupList = page.getByRole("list", { name: `Daftar siswa kelas ${labelIpa}` });
    await expect(ipaGroupList.getByLabel(`Pilih ${ipa1.name} ${ipa1.nisn}`)).not.toBeChecked();
    await expect(ipaGroupList.getByLabel(`Pilih ${ipa2.name} ${ipa2.nisn}`)).not.toBeChecked();
    await page.getByLabel(`Pilih kelas ${labelIpa}`).check();
    await expect(ipaGroupList.getByLabel(`Pilih ${ipa1.name} ${ipa1.nisn}`)).toBeChecked();
    await expect(ipaGroupList.getByLabel(`Pilih ${ipa2.name} ${ipa2.nisn}`)).toBeChecked();

    // Ubah sesi satu kelas penuh (XI IPA -> Sesi 2)
    await page.getByLabel(`Sesi kelas ${labelIpa}`).selectOption("2");
    await expect(ipaGroupList.getByLabel(`Sesi ${ipa1.name} ${ipa1.nisn}`)).toHaveValue("2");
    await expect(ipaGroupList.getByLabel(`Sesi ${ipa2.name} ${ipa2.nisn}`)).toHaveValue("2");

    // Ubah satu siswa saja di XI IPA ke Sesi 1 -> status sesi kelas menjadi Campuran (mixed)
    await ipaGroupList.getByLabel(`Sesi ${ipa1.name} ${ipa1.nisn}`).selectOption("1");
    await expect(page.getByLabel(`Sesi kelas ${labelIpa}`)).toHaveValue("mixed");

    // Pilih sesi langsung di dropdown kelas XI IPS tanpa centang manual dulu -> auto-centang seluruh siswa XI IPS ke Sesi 2
    const ipsGroupList = page.getByRole("list", { name: `Daftar siswa kelas ${labelIps}` });
    await page.getByLabel(`Sesi kelas ${labelIps}`).selectOption("2");
    await expect(page.getByLabel(`Pilih kelas ${labelIps}`)).toBeChecked();
    await expect(ipsGroupList.getByLabel(`Pilih ${ips1.name} ${ips1.nisn}`)).toBeChecked();
    await expect(ipsGroupList.getByLabel(`Pilih ${ips2.name} ${ips2.nisn}`)).toBeChecked();
    await expect(ipsGroupList.getByLabel(`Sesi ${ips1.name} ${ips1.nisn}`)).toHaveValue("2");
    await expect(ipsGroupList.getByLabel(`Sesi ${ips2.name} ${ips2.nisn}`)).toHaveValue("2");

    // Hapus centang satu siswa di XI IPS -> checkbox kelas menjadi indeterminate
    await ipsGroupList.getByLabel(`Pilih ${ips2.name} ${ips2.nisn}`).uncheck();
    expect(await page.getByLabel(`Pilih kelas ${labelIps}`).evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);

    // Simpan langsung tanpa harus menekan Acak pembagian -> tersimpan persisten di database
    await page.getByRole("button", { name: "Simpan pembagian sesi" }).click();
    const dialog = page.getByRole("dialog", { name: "Simpan pembagian sesi?" });
    await expect(dialog).toContainText("3 siswa");
    await dialog.getByRole("button", { name: "Ya, simpan pembagian" }).click();
    await expect(dialog).toBeHidden();

    const saved = (
      await client.query<{ studentId: string; sessionNumber: number }>(
        'SELECT student_id::text AS "studentId", session_number AS "sessionNumber" FROM exam_session_assignments WHERE period_id=$1',
        [f.periodA],
      )
    ).rows;
    expect(saved).toHaveLength(3);
    expect(saved.find((r) => r.studentId === ipa1.id)?.sessionNumber).toBe(1);
    expect(saved.find((r) => r.studentId === ipa2.id)?.sessionNumber).toBe(2);
    expect(saved.find((r) => r.studentId === ips1.id)?.sessionNumber).toBe(2);
    expect(saved.some((r) => r.studentId === ips2.id)).toBe(false);
  } finally {
    await client.query("DELETE FROM exam_session_assignments WHERE period_id=$1", [f.periodA]);
    await client.query("DELETE FROM exam_session_groups WHERE period_id=$1", [f.periodA]);
    await client.query("DELETE FROM exam_session_plans WHERE period_id=$1", [f.periodA]);
    await client.query("DELETE FROM student_class_placements WHERE period_id=$1 AND student_id=ANY($2::bigint[])", [f.periodA, extraStudents]);
    if (extraStudents.length) await client.query("DELETE FROM school_students WHERE id=ANY($1::bigint[])", [extraStudents]);
    if (extraClasses.length) await client.query("DELETE FROM school_classes WHERE id=ANY($1::bigint[])", [extraClasses]);
    if (extraMajors.length) await client.query("DELETE FROM school_majors WHERE id=ANY($1::bigint[])", [extraMajors]);
    await cleanupLoginFixture(client, f);
    await client.end();
  }
});
