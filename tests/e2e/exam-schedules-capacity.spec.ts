import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";

test.use({ actionTimeout: 60_000 });

test("batas 5.000 siswa dapat dibagi, disimpan, dan dirilis tanpa daftar parsial", async ({ page }) => {
  test.setTimeout(180_000);
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  let period=""; let studentIds:string[]=[];
  try {
    period=(await client.query<{id:string}>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2048-01-01') RETURNING id::text AS id",[`Periode kapasitas ${f.suffix}`])).rows[0].id;
    const base=randomInt(1_000_000_000,8_000_000_000);
    const inserted=(await client.query<{id:string}>(`INSERT INTO school_students(name,nisn)
      SELECT $1::text || ' ' || n,($2::bigint+n)::text FROM generate_series(1,5000) n RETURNING id::text AS id`,[`Siswa kapasitas ${f.suffix}`,base])).rows;
    studentIds=inserted.map((row)=>row.id); expect(studentIds).toHaveLength(5000);
    await client.query(`INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot)
      SELECT x,$2::bigint,$3::bigint,$4 FROM unnest($1::bigint[]) AS x`,[studentIds,period,f.classId,`X ${f.majorName}`]);
    const exam=(await client.query<{id:string}>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2048-01-01 00:00Z','WIB',60) RETURNING id::text AS id",[period,`Tes kapasitas ${f.suffix}`])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)",[exam,f.questionId]);
    await loginAsAdmin(page); await page.goto(`/data-tes/daftar/sesi?periode=${period}`);
    await page.getByLabel("Kapasitas sesi 1").fill("5000"); await page.getByLabel(`Pilih kelas X ${f.majorName}`).check();
    await expect(page.getByText("5000 siswa dipilih")).toBeVisible();
    await page.getByRole("button",{name:"Acak pembagian"}).click();
    await page.getByRole("button",{name:`Tampilkan atau sembunyikan siswa kelas X ${f.majorName}`}).click();
    await expect(page.getByRole("list",{name:`Daftar siswa kelas X ${f.majorName}`}).getByRole("listitem")).toHaveCount(25);
    await page.getByRole("button",{name:"Simpan pembagian sesi"}).click(); let dialog=page.getByRole("dialog",{name:"Simpan pembagian sesi?"});
    await expect(dialog).toContainText("5000 siswa"); await dialog.getByRole("button",{name:"Ya, simpan pembagian"}).click(); await expect(dialog).toBeHidden({timeout:60_000});
    expect((await client.query<{n:number}>("SELECT count(*)::int AS n FROM exam_session_assignments WHERE period_id=$1",[period])).rows[0].n).toBe(5000);
    await page.goto(`/data-tes/daftar/${exam}`); await page.getByRole("button",{name:"Tambah pelaksanaan"}).click();
    const editor=page.getByRole("dialog",{name:"Tambah pelaksanaan"}); await editor.getByLabel("Nama pelaksanaan").fill("Sesi kapasitas");
    await editor.getByLabel("Tanggal dan waktu mulai").fill("2048-01-01T08:00"); await editor.getByRole("button",{name:"Pilih semua yang tersedia"}).click();
    await expect(editor.getByText("5000 dipilih / 5000 tempat")).toBeVisible(); await editor.getByRole("button",{name:"Simpan draf"}).click(); await expect(editor).toBeHidden({timeout:60_000});
    expect((await client.query<{n:number}>("SELECT count(*)::int AS n FROM exam_schedule_participants WHERE exam_test_id=$1",[exam])).rows[0].n).toBe(5000);
    await page.getByRole("button",{name:"Rilis Sesi kapasitas"}).click(); dialog=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"});
    await expect(dialog).toContainText("5000 peserta"); await expect(dialog).toContainText("Semua siswa dalam kelompok sesi ini tercantum");
    await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).click(); await expect(dialog).toBeHidden({timeout:60_000});
    expect((await client.query<{n:number}>("SELECT count(*)::int AS n FROM exam_schedule_runs WHERE exam_test_id=$1 AND published_at IS NOT NULL",[exam])).rows[0].n).toBe(1);
  } finally {
    if(period) {
      await client.query("DELETE FROM exam_schedule_runs WHERE period_id=$1",[period]);
      await client.query("DELETE FROM exam_tests WHERE period_id=$1",[period]);
      await client.query("DELETE FROM exam_session_assignments WHERE period_id=$1",[period]);
      await client.query("DELETE FROM exam_session_groups WHERE period_id=$1",[period]);
      await client.query("DELETE FROM exam_session_plans WHERE period_id=$1",[period]);
      await client.query("DELETE FROM student_class_placements WHERE period_id=$1",[period]);
      if(studentIds.length) await client.query("DELETE FROM school_students WHERE id=ANY($1::bigint[])",[studentIds]);
      await client.query("DELETE FROM exam_periods WHERE id=$1",[period]);
    }
    await cleanupLoginFixture(client,f); await client.end();
  }
});
