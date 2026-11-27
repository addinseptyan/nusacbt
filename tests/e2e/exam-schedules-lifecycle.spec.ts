import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginParticipant, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";
import { cleanupTopics, createQuestion, createTopic } from "./question-helpers";

test.use({actionTimeout:12_000});

test("dua tab pembagian menolak versi usang tanpa menimpa hasil pemenang",async({page,browser})=>{
  test.setTimeout(60_000);
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  const other=await browser.newContext({baseURL:"http://127.0.0.1:3100"}); const second=await other.newPage();
  try {
    const nisn=(await client.query<{nisn:string}>("SELECT nisn FROM school_students WHERE id=$1",[f.studentA])).rows[0].nisn;
    await Promise.all([loginAsAdmin(page),loginAsAdmin(second)]); await Promise.all([page.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`),second.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`)]);
    for(const tab of [page,second]) {
      await tab.getByRole("button",{name:`Tampilkan atau sembunyikan siswa kelas X ${f.majorName}`}).click();
      await tab.getByLabel(`Pilih ${f.studentAName} ${nisn}`).check(); await tab.getByRole("button",{name:"Acak pembagian"}).click();
      await tab.getByRole("button",{name:"Simpan pembagian sesi"}).click();
    }
    await page.getByRole("dialog",{name:"Simpan pembagian sesi?"}).getByRole("button",{name:"Ya, simpan pembagian"}).click();
    await expect(page.getByRole("dialog",{name:"Simpan pembagian sesi?"})).toBeHidden();
    await second.getByRole("dialog",{name:"Simpan pembagian sesi?"}).getByRole("button",{name:"Ya, simpan pembagian"}).click();
    await expect(second.getByRole("alert").filter({hasText:"Pembagian belum disimpan"})).toContainText("telah berubah di tab lain");
    expect((await client.query<{revision:string}>("SELECT revision::text FROM exam_session_plans WHERE period_id=$1",[f.periodA])).rows[0].revision).toBe("1");
    expect((await client.query("SELECT 1 FROM exam_session_assignments WHERE period_id=$1 AND student_id=$2",[f.periodA,f.studentA])).rowCount).toBe(1);
    await page.getByRole("button",{name:"Acak pembagian"}).click();
    await page.getByRole("button",{name:`Tampilkan atau sembunyikan siswa kelas X ${f.majorName}`}).click();
    await expect(page.getByLabel(`Sesi ${f.studentAName} ${nisn}`)).toHaveValue("1");
  } finally { await other.close(); await cleanupLoginFixture(client,f); await client.end(); }
});

test("induk dan draf menjaga jumlah soal, durasi, periode; rilis dapat ditarik lalu dihapus",async({page,browser})=>{
  test.setTimeout(100_000);
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client); const topics:string[]=[];
  const participant=await browser.newContext({baseURL:"http://127.0.0.1:3100"}); const p=await participant.newPage();
  try {
    topics.push(await createTopic(client,`Topik lifecycle ${f.suffix}`)); const q=await createQuestion(client,topics[0],`Kedua ${f.suffix}`);
    const name=`Tes lifecycle ${f.suffix}`;
    const exam=(await client.query<{id:string}>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2040-02-01 00:00Z','WIB',60) RETURNING id::text AS id",[f.periodA,name])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1),($1,$3,2)",[exam,f.questionId,q.id]);
    const admin=(await client.query<{id:string}>("SELECT id::text AS id FROM admin_users WHERE username=$1",[process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    const runs=(await client.query<{id:string;kind:string}>(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,question_mode,created_by)
      VALUES($1,$2,'makeup','Susulan lifecycle',(date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Jakarta') +
        CASE WHEN (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::time < time '12:00' THEN interval '15 hours' ELSE interval '3 hours' END) AT TIME ZONE 'Asia/Jakarta','WIB',60,'inherit',$3),
        ($1,$2,'remedial','Remidi lifecycle','2040-02-02 00:00Z','WIB',45,'custom',$3)
      RETURNING id::text AS id,kind`,[exam,f.periodA,admin])).rows;
    const makeup=runs.find((r)=>r.kind==="makeup")!.id,remedial=runs.find((r)=>r.kind==="remedial")!.id;
    await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,$3,'makeup',$4,$5),($6,$2,$3,'remedial',$4,$5)",[makeup,exam,f.periodA,f.studentA,f.placementA,remedial]);
    await client.query("INSERT INTO exam_schedule_custom_questions(run_id,question_id,position) VALUES($1,$2,1),($1,$3,2)",[remedial,f.questionId,q.id]);
    await loginParticipant(p,f.username,f.passwordA); await expect(p.getByText(name,{exact:true})).toHaveCount(0);
    await loginAsAdmin(page); await page.goto("/data-tes/daftar"); await page.getByRole("button",{name:`Ubah tes ${exam}`}).click();
    let editor=page.getByRole("dialog",{name:"Ubah rancangan tes"}); await editor.getByRole("button",{name:`Lepas soal ${q.id}`}).click();
    await editor.getByRole("button",{name:"Simpan rancangan"}).click(); await expect(editor.getByRole("alert")).toContainText("tidak boleh lebih sedikit daripada soal remidi");
    await editor.getByRole("button",{name:"Batal"}).click();
    await page.getByRole("button",{name:`Ubah tes ${exam}`}).click(); editor=page.getByRole("dialog",{name:"Ubah rancangan tes"});
    await editor.getByLabel("Periode ujian").selectOption(f.periodB); await editor.getByRole("button",{name:"Simpan rancangan"}).click();
    await expect(editor.getByRole("alert")).toContainText("Periode tidak dapat diubah"); await editor.getByRole("button",{name:"Batal"}).click();
    await page.getByRole("button",{name:`Ubah tes ${exam}`}).click(); editor=page.getByRole("dialog",{name:"Ubah rancangan tes"});
    await editor.getByLabel("Durasi (menit)").fill("90"); await editor.getByRole("button",{name:"Simpan rancangan"}).click(); await expect(editor).toBeHidden();
    const values=(await client.query<{kind:string;minutes:number}>("SELECT kind,duration_minutes AS minutes FROM exam_schedule_runs WHERE id=ANY($1::bigint[]) ORDER BY kind",[[makeup,remedial]])).rows;
    expect(values).toEqual([{kind:"makeup",minutes:90},{kind:"remedial",minutes:45}]);
    await page.goto(`/data-tes/daftar/${exam}`); await page.getByRole("button",{name:"Rilis Susulan lifecycle"}).click();
    let dialog=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"}); await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).click(); await expect(dialog).toBeHidden();
    await p.reload(); await expect(p.getByText("Susulan · Susulan lifecycle",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Tarik rilis Susulan lifecycle"}).click(); dialog=page.getByRole("dialog",{name:"Tarik rilis jadwal?"});
    await dialog.getByRole("button",{name:"Ya, tarik rilis"}).click(); await expect(dialog).toBeHidden(); await p.reload(); await expect(p.getByText(name,{exact:true})).toHaveCount(0);
    for(const label of ["Susulan lifecycle","Remidi lifecycle"]) {
      await page.getByRole("button",{name:`Hapus pelaksanaan ${label}`}).click(); dialog=page.getByRole("dialog",{name:"Hapus draf pelaksanaan?"});
      await dialog.getByRole("button",{name:"Ya, hapus draf"}).click(); await expect(dialog).toBeHidden();
    }
    expect((await client.query("SELECT id FROM exam_schedule_runs WHERE exam_test_id=$1",[exam])).rowCount).toBe(0);
    await page.goto("/data-tes/daftar"); await page.getByRole("button",{name:`Hapus tes ${exam}`}).click(); dialog=page.getByRole("dialog",{name:"Hapus rancangan tes?"});
    await dialog.getByRole("button",{name:"Ya, hapus rancangan"}).click(); await expect(dialog).toBeHidden();
    expect((await client.query("SELECT id FROM question_bank WHERE id=ANY($1::bigint[])",[[f.questionId,q.id]])).rowCount).toBe(2);
  } finally { await participant.close(); await cleanupLoginFixture(client,f); await cleanupTopics(client,topics); await client.end(); }
});

test("perubahan kelompok membatalkan simpan dan rilis usang; peserta tertinggal diperingatkan",async({page,browser})=>{
  test.setTimeout(75_000);
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  const other=await browser.newContext({baseURL:"http://127.0.0.1:3100"}); const second=await other.newPage(); let extraId="";
  try {
    const nisn=String(randomInt(1_000_000_000)).padStart(10,"0"),extraName=`Siswa baru grup ${f.suffix}`;
    extraId=(await client.query<{id:string}>("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id",[extraName,nisn])).rows[0].id;
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)",[extraId,f.periodA,f.classId,`X ${f.majorName}`]);
    const admin=(await client.query<{id:string}>("SELECT id::text AS id FROM admin_users WHERE username=$1",[process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    await client.query("INSERT INTO exam_session_plans(period_id,updated_by) VALUES($1,$2)",[f.periodA,admin]);
    await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,5)",[f.periodA]);
    await client.query("INSERT INTO exam_session_assignments(period_id,student_id,session_number,placement_id) VALUES($1,$2,1,$3)",[f.periodA,f.studentA,f.placementA]);
    const exam=(await client.query<{id:string}>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2042-01-01 00:00Z','WIB',60) RETURNING id::text AS id",[f.periodA,`Rilis usang ${f.suffix}`])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)",[exam,f.questionId]);
    const run=(await client.query<{id:string}>(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,session_number,starts_at,time_zone,duration_minutes,created_by)
      VALUES($1,$2,'regular','Sesi lama',1,'2042-01-01 00:00Z','WIB',60,$3) RETURNING id::text AS id`,[exam,f.periodA,admin])).rows[0].id;
    await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,$3,'regular',$4,$5)",[run,exam,f.periodA,f.studentA,f.placementA]);
    await Promise.all([loginAsAdmin(page),loginAsAdmin(second)]); await page.goto(`/data-tes/daftar/${exam}`);
    await page.getByRole("button",{name:"Tambah pelaksanaan"}).click();
    const editor=page.getByRole("dialog",{name:"Tambah pelaksanaan"});
    await editor.getByLabel("Nama pelaksanaan").fill("Draf usang");
    await editor.getByRole("button",{name:"Pilih semua yang tersedia"}).click();
    await second.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`);
    await second.getByRole("button",{name:`Tampilkan atau sembunyikan siswa kelas X ${f.majorName}`}).click();
    await second.getByLabel(`Pilih ${extraName} ${nisn}`).check();
    await second.getByRole("button",{name:"Acak pembagian"}).click(); await second.getByRole("button",{name:"Simpan pembagian sesi"}).click();
    const confirmation=second.getByRole("dialog",{name:"Simpan pembagian sesi?"}); await confirmation.getByRole("button",{name:"Ya, simpan pembagian"}).click(); await expect(confirmation).toBeHidden();
    await editor.getByRole("button",{name:"Simpan draf"}).click(); await expect(editor.getByRole("alert")).toContainText("Kelompok sesi telah berubah");
    expect((await client.query("SELECT 1 FROM exam_schedule_runs WHERE exam_test_id=$1 AND label='Draf usang'",[exam])).rowCount).toBe(0);
    await editor.getByRole("button",{name:"Batal"}).click();
    await page.getByRole("button",{name:"Rilis Sesi lama"}).click(); let dialog=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"});
    await expect(dialog).toContainText("Semua siswa dalam kelompok sesi ini tercantum");
    await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).click(); await expect(dialog.getByRole("alert")).toContainText("Kelompok sesi telah berubah");
    expect((await client.query<{published:boolean}>("SELECT published_at IS NOT NULL AS published FROM exam_schedule_runs WHERE id=$1",[run])).rows[0].published).toBe(false);
    await dialog.getByRole("button",{name:"Muat ulang"}).click(); await expect(dialog).toBeHidden();
    await page.getByRole("button",{name:"Rilis Sesi lama"}).click(); dialog=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"});
    await expect(dialog).toContainText("1 siswa lain dalam kelompok sesi ini tidak dipilih");
    await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).click(); await expect(dialog).toBeHidden();
    expect((await client.query("SELECT 1 FROM exam_schedule_participants WHERE run_id=$1 AND student_id=$2",[run,extraId])).rowCount).toBe(0);
  } finally { await other.close(); await cleanupLoginFixture(client,f); if(extraId) await client.query("DELETE FROM school_students WHERE id=$1",[extraId]); await client.end(); }
});

test("periode dengan kelompok terpakai terlindungi; kelompok kosong ikut terhapus hanya bila penghapusan periode berhasil",async({page})=>{
  test.setTimeout(75_000);
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  let emptyPeriod="";
  try {
    const admin=(await client.query<{id:string}>("SELECT id::text AS id FROM admin_users WHERE username=$1",[process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    const name=`Periode kosong ${f.suffix}`;
    emptyPeriod=(await client.query<{id:string}>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2049-01-01') RETURNING id::text AS id",[name])).rows[0].id;
    for(const period of [f.periodB,emptyPeriod]) {
      await client.query("INSERT INTO exam_session_plans(period_id,updated_by) VALUES($1,$2)",[period,admin]);
      await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,30)",[period]);
    }
    await client.query("INSERT INTO exam_session_assignments(period_id,student_id,session_number,placement_id) VALUES($1,$2,1,$3)",[f.periodB,f.studentB,f.placementB]);
    await loginAsAdmin(page); await page.goto("/data-peserta/periode");
    await page.getByRole("button",{name:`Hapus periode ${f.periodBName}`}).click();
    let dialog=page.getByRole("dialog",{name:"Hapus periode?"}); await expect(dialog).toContainText("Kelompok sesi yang kosong ikut dihapus");
    await dialog.getByRole("button",{name:"Ya, hapus periode"}).click(); await expect(dialog.getByRole("alert")).toContainText("masih digunakan");
    expect((await client.query("SELECT 1 FROM exam_session_assignments WHERE period_id=$1",[f.periodB])).rowCount).toBe(1);
    // Tanpa siswa kelompok pun, kegagalan karena data lain harus rollback
    // pembersihan plan dan kapasitas: tidak boleh hilang sebagian.
    await client.query("DELETE FROM exam_session_assignments WHERE period_id=$1",[f.periodB]);
    await dialog.getByRole("button",{name:"Ya, hapus periode"}).click(); await expect(dialog.getByRole("alert")).toContainText("masih digunakan");
    expect((await client.query("SELECT 1 FROM exam_session_plans WHERE period_id=$1",[f.periodB])).rowCount).toBe(1);
    expect((await client.query("SELECT 1 FROM exam_session_groups WHERE period_id=$1",[f.periodB])).rowCount).toBe(1);
    await dialog.getByRole("button",{name:"Batal"}).click();
    await page.getByRole("button",{name:`Hapus periode ${name}`}).click(); dialog=page.getByRole("dialog",{name:"Hapus periode?"});
    await dialog.getByRole("button",{name:"Ya, hapus periode"}).click(); await expect(dialog).toBeHidden();
    expect((await client.query("SELECT 1 FROM exam_periods WHERE id=$1",[emptyPeriod])).rowCount).toBe(0);
    expect((await client.query("SELECT 1 FROM exam_session_plans WHERE period_id=$1",[emptyPeriod])).rowCount).toBe(0);
    expect((await client.query("SELECT 1 FROM exam_session_groups WHERE period_id=$1",[emptyPeriod])).rowCount).toBe(0);
  } finally {
    if(emptyPeriod) {
      await client.query("DELETE FROM exam_session_groups WHERE period_id=$1",[emptyPeriod]);
      await client.query("DELETE FROM exam_session_plans WHERE period_id=$1",[emptyPeriod]);
      await client.query("DELETE FROM exam_periods WHERE id=$1",[emptyPeriod]);
    }
    await cleanupLoginFixture(client,f); await client.end();
  }
});

test("kelompok dan pelaksanaan dapat diatur pada layar kecil, termasuk kapasitas yang dikurangi",async({page})=>{
  test.setTimeout(90_000); await page.setViewportSize({width:360,height:640});
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  let extraId="";
  try {
    const nisn=String(randomInt(1_000_000_000)).padStart(10,"0"), extraName=`Tambahan ${f.suffix}`, longName=`Peserta ${f.suffix} ${"S".repeat(65)}`;
    await client.query("UPDATE school_students SET name=$2 WHERE id=$1",[f.studentA,longName]);
    const firstNisn=(await client.query<{nisn:string}>("SELECT nisn FROM school_students WHERE id=$1",[f.studentA])).rows[0].nisn;
    extraId=(await client.query<{id:string}>("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id",[extraName,nisn])).rows[0].id;
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)",[extraId,f.periodA,f.classId,`X ${f.majorName}`]);
    await loginAsAdmin(page); await page.getByRole("button",{name:"Ganti tema"}).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await page.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`);
    await page.getByLabel("Kapasitas sesi 1").fill("2"); await page.getByRole("button",{name:"Tambah sesi"}).click(); await page.getByLabel("Kapasitas sesi 2").fill("1");
    await page.getByRole("button",{name:`Tampilkan atau sembunyikan siswa kelas X ${f.majorName}`}).click();
    await page.getByLabel(`Pilih ${longName} ${firstNisn}`).check(); await page.getByLabel(`Pilih ${extraName} ${nisn}`).check();
    await page.getByRole("button",{name:"Acak pembagian"}).click();
    await page.getByLabel(`Sesi ${longName} ${firstNisn}`).selectOption("1"); await page.getByLabel(`Sesi ${extraName} ${nisn}`).selectOption("1");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.getByRole("button",{name:"Simpan pembagian sesi"}).click(); let dialog=page.getByRole("dialog",{name:"Simpan pembagian sesi?"});
    await dialog.getByRole("button",{name:"Ya, simpan pembagian"}).click(); await expect(dialog).toBeHidden();
    await expect(page.getByLabel("Kapasitas sesi 1")).toHaveValue("2");
    await page.getByLabel("Kapasitas sesi 1").fill("1");
    await expect(page.getByRole("alert").filter({hasText:"melebihi kapasitas"})).toBeVisible();
    await expect(page.getByRole("button",{name:"Simpan pembagian sesi"})).toBeDisabled();
    await page.getByRole("button",{name:`Tampilkan atau sembunyikan siswa kelas X ${f.majorName}`}).click();
    await page.getByLabel(`Sesi ${extraName} ${nisn}`).selectOption("2");
    await page.getByRole("button",{name:"Simpan pembagian sesi"}).click(); dialog=page.getByRole("dialog",{name:"Simpan pembagian sesi?"});
    await dialog.getByRole("button",{name:"Ya, simpan pembagian"}).click(); await expect(dialog).toBeHidden();
    const assigned=(await client.query<{student:string;session:number}>("SELECT student_id::text AS student,session_number AS session FROM exam_session_assignments WHERE period_id=$1 ORDER BY student_id",[f.periodA])).rows;
    expect(assigned.find((r)=>r.student===f.studentA)?.session).toBe(1); expect(assigned.find((r)=>r.student===extraId)?.session).toBe(2);
    await page.goto(`/data-tes/daftar/${f.activeTest}`); await page.setViewportSize({width:360,height:320});
    await page.getByRole("button",{name:"Tambah pelaksanaan"}).click(); const editor=page.getByRole("dialog",{name:"Tambah pelaksanaan"});
    const box=await editor.boundingBox(); expect(box).not.toBeNull(); if(!box) throw new Error("Dialog tidak terlihat.");
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y+box.height).toBeLessThanOrEqual(320);
    await editor.getByLabel("Nama pelaksanaan").fill("Sesi mobile"); await editor.getByLabel("Tanggal dan waktu mulai").fill("2044-01-01T08:00");
    await editor.getByRole("button",{name:"Pilih semua yang tersedia"}).click();
    await editor.getByRole("button",{name:"Simpan draf"}).scrollIntoViewIfNeeded();
    await editor.getByRole("button",{name:"Simpan draf"}).click(); await expect(editor).toBeHidden();
    await page.getByRole("button",{name:"Rilis Sesi mobile"}).click(); dialog=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"});
    await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).scrollIntoViewIfNeeded();
    await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).click(); await expect(dialog).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    expect((await client.query("SELECT 1 FROM exam_schedule_runs WHERE exam_test_id=$1 AND label='Sesi mobile' AND published_at IS NOT NULL",[f.activeTest])).rowCount).toBe(1);
  } finally { await cleanupLoginFixture(client,f); if(extraId) await client.query("DELETE FROM school_students WHERE id=$1",[extraId]); await client.end(); }
});
