import { randomInt } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type pg from "pg";

import { encryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { hashParticipantPassword } from "../../src/lib/password.mjs";
import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginParticipant, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";
import { cleanupTopics, createQuestion, createTopic } from "./question-helpers";
import { confirmIssue, issueForm, testPanel, visibleCode } from "./token-helpers";

test.use({ actionTimeout: 12_000 });

type Student = { id: string; name: string; nisn: string; placement: string; identity?: string; username?: string };

async function addClass(client: pg.Client, majorName: string) {
  const major = (await client.query<{ id: string }>("INSERT INTO school_majors(name) VALUES($1) RETURNING id::text AS id", [majorName])).rows[0].id;
  const klass = (await client.query<{ id: string }>("INSERT INTO school_classes(level,major_id) VALUES('XII',$1) RETURNING id::text AS id", [major])).rows[0].id;
  return { major, klass, label: `XII ${majorName}` };
}

async function addStudent(client: pg.Client, period: string, klass: { klass: string; label: string }, name: string, username?: string): Promise<Student> {
  const nisn = String(randomInt(1_000_000_000)).padStart(10, "0");
  const id = (await client.query<{ id: string }>("INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id", [name,nisn])).rows[0].id;
  const placement = (await client.query<{ id: string }>("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4) RETURNING id::text AS id", [id,period,klass.klass,klass.label])).rows[0].id;
  if (!username) return {id,name,nisn,placement};
  const identity = (await client.query<{ id: string }>("INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES($1,$2,$3,$4) RETURNING id::text AS id", [id,period,`N-${username}`,username])).rows[0].id;
  const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
  try {
    const encrypted=encryptParticipantPassword("SANDITST",key,{identityId:identity,periodId:period});
    await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES($1,$2,$3,$4,$5)", [identity,await hashParticipantPassword("SANDITST"),encrypted.nonce,encrypted.ciphertext,encrypted.authenticationTag]);
  } finally { key.fill(0); }
  return {id,name,nisn,placement,identity,username};
}

async function publish(page: Page, label: string) {
  await page.getByRole("button", {name:`Rilis ${label}`,exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"});
  await expect(dialog).toBeVisible(); await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).click();
  await expect(dialog).toBeHidden();
}

async function newRun(page: Page, kind: "regular"|"makeup"|"remedial", label: string, start: string) {
  await page.getByRole("button",{name:"Tambah pelaksanaan"}).click();
  const form=page.getByRole("dialog",{name:"Tambah pelaksanaan"}); await expect(form).toBeVisible();
  await form.getByLabel("Jenis pelaksanaan").selectOption(kind);
  await form.getByLabel("Nama pelaksanaan").fill(label);
  await form.getByLabel("Tanggal dan waktu mulai").fill(start);
  return form;
}
async function saveRun(form: Locator) {
  await form.getByRole("button",{name:"Simpan draf"}).click(); await expect(form).toBeHidden();
}

test("kelompok campuran tetap, rilis selektif, susulan/remidi, perubahan kelas, dan token induk", async ({page,browser}) => {
  test.setTimeout(180_000);
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client);
  const f=await seedLoginFixture(client); const students:Student[]=[]; const classes:Array<{major:string;klass:string;label:string}>=[]; const topics:string[]=[];
  const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({baseURL:"http://127.0.0.1:3100"})));
  const [a,b,excluded]=await Promise.all(contexts.map((context)=>context.newPage()));
  try {
    const tkr=await addClass(client,`TKR ${f.suffix}`); const rpl=await addClass(client,`RPL ${f.suffix}`); classes.push(tkr,rpl);
    students.push(await addStudent(client,f.periodA,tkr,`TKR Satu ${f.suffix}`));
    students.push(await addStudent(client,f.periodA,tkr,`TKR Dua ${f.suffix}`));
    students.push(await addStudent(client,f.periodA,tkr,`TKR Dikecualikan ${f.suffix}`,`x${f.suffix}`));
    students.push(await addStudent(client,f.periodA,rpl,`RPL Satu ${f.suffix}`,`r${f.suffix}`));
    students.push(await addStudent(client,f.periodA,rpl,`RPL Dua ${f.suffix}`));
    const [t1,t2,removed,r1,r2]=students;
    topics.push(await createTopic(client,`Soal sesi ${f.suffix}`));
    const alt1=await createQuestion(client,topics[0],`Rahasia reguler kedua ${f.suffix}`);
    const alt2=await createQuestion(client,topics[0],`Rahasia remidi lain ${f.suffix}`);
    const testName=`Tes Campuran ${f.suffix}`;
    const exam=(await client.query<{id:string}>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes,shuffle_questions,shuffle_options) VALUES($1,$2,'2024-01-01T00:00:00Z','WIB',60,true,true) RETURNING id::text AS id",[f.periodA,testName])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1),($1,$3,2)",[exam,f.questionId,alt1.id]);

    // Rancangan lama tidak bocor sebelum ada pelaksanaan.
    await loginParticipant(a,f.username,f.passwordA); await expect(a.getByText(testName,{exact:true})).toHaveCount(0);
    await loginParticipant(b,r1.username!,"SANDITST"); await expect(b.getByText(testName,{exact:true})).toHaveCount(0);
    await loginParticipant(excluded,removed.username!,"SANDITST");

    await loginAsAdmin(page); await page.goto("/data-tes/daftar");
    await page.getByRole("link",{name:"Atur kelompok sesi"}).click();
    await page.getByRole("combobox",{name:/^Periode/}).selectOption(f.periodA);
    await expect(page).toHaveURL(new RegExp(`periode=${f.periodA}$`));
    await page.getByLabel("Kapasitas sesi 1").fill("2"); await page.getByRole("button",{name:"Tambah sesi"}).click(); await page.getByLabel("Kapasitas sesi 2").fill("2");
    await page.getByLabel("Kelas untuk ditambahkan").selectOption(tkr.klass); await page.getByRole("button",{name:"Tambahkan kelas"}).click();
    await page.getByLabel("Kelas untuk ditambahkan").selectOption(rpl.klass); await page.getByRole("button",{name:"Tambahkan kelas"}).click();
    await page.getByLabel(`Pilih ${f.studentAName} ${(await client.query<{nisn:string}>("SELECT nisn FROM school_students WHERE id=$1",[f.studentA])).rows[0].nisn}`).check();
    await page.getByLabel(`Pilih ${removed.name} ${removed.nisn}`).uncheck();
    await expect(page.getByText("5 siswa dipilih")).toBeVisible();
    await page.getByRole("button",{name:"Acak pembagian"}).click();
    await expect(page.getByRole("alert").filter({hasText:"kapasitas sesi kurang"})).toBeVisible();
    expect((await client.query("SELECT 1 FROM exam_session_plans WHERE period_id=$1",[f.periodA])).rowCount).toBe(0);
    await page.getByLabel("Kapasitas sesi 1").fill("3"); await page.getByLabel("Kapasitas sesi 2").fill("3");
    await page.getByRole("button",{name:"Acak pembagian"}).click();
    const preview=page.getByRole("list",{name:"Pratinjau pembagian sesi"}); await expect(preview.getByRole("listitem")).toHaveCount(5);
    const fNisn=(await client.query<{nisn:string}>("SELECT nisn FROM school_students WHERE id=$1",[f.studentA])).rows[0].nisn;
    // Penyesuaian manual sengaja menjaga campuran dua jurusan pada dua sesi.
    for(const [name,nisn,session] of [[f.studentAName,fNisn,"1"],[t1.name,t1.nisn,"1"],[r2.name,r2.nisn,"1"],[t2.name,t2.nisn,"2"],[r1.name,r1.nisn,"2"]]) {
      await preview.getByLabel(`Sesi ${name} ${nisn}`).selectOption(session);
    }
    await page.getByRole("button",{name:"Simpan pembagian sesi"}).click();
    const confirmation=page.getByRole("dialog",{name:"Simpan pembagian sesi?"}); await expect(confirmation).toContainText("5 siswa");
    await confirmation.getByRole("button",{name:"Ya, simpan pembagian"}).click(); await expect(confirmation).toBeHidden();
    const assigned=(await client.query<{student:string;session:number}>('SELECT student_id::text AS student,session_number AS session FROM exam_session_assignments WHERE period_id=$1 ORDER BY student_id',[f.periodA])).rows;
    expect(assigned).toHaveLength(5); expect(assigned.find((x)=>x.student===f.studentA)?.session).toBe(1); expect(assigned.find((x)=>x.student===r1.id)?.session).toBe(2);
    expect(assigned.some((x)=>x.student===removed.id)).toBe(false);

    // Siswa baru dan perpindahan kelas tidak mengubah keanggotaan tersimpan.
    const newcomer=await addStudent(client,f.periodA,rpl,`Siswa Baru ${f.suffix}`); students.push(newcomer);
    await client.query("UPDATE student_class_placements SET ended_at=GREATEST(clock_timestamp(),started_at) WHERE id=$1",[f.placementA]);
    await client.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)",[f.studentA,f.periodA,rpl.klass,rpl.label]);
    await page.reload(); await expect(page.getByText("5 siswa dipilih")).toBeVisible();
    await expect(page.getByLabel(`Pilih ${newcomer.name} ${newcomer.nisn}`)).not.toBeChecked();
    await expect(page.getByLabel(`Pilih ${f.studentAName} ${fNisn}`)).toBeChecked();
    await a.goto("/peserta"); await expect(a).toHaveURL(/\/peserta\/login/); await loginParticipant(a,f.username,f.passwordA);

    await page.goto("/data-tes/daftar"); await page.getByRole("link",{name:`Pelaksanaan tes ${exam}`}).click();
    await expect(page.getByRole("heading",{name:"Pelaksanaan Tes"})).toBeVisible();
    let form=await newRun(page,"regular","Sesi 1","2040-07-01T07:00"); await form.getByRole("button",{name:"Pilih semua yang tersedia"}).click();
    await expect(form.getByText("3 dipilih / 3 tempat")).toBeVisible(); await saveRun(form);
    form=await newRun(page,"regular","Sesi 2","2040-07-01T09:00"); await form.getByLabel("Kelompok sesi periode").selectOption("2");
    await form.getByLabel("Nama pelaksanaan").fill("Sesi 2"); await form.getByRole("button",{name:"Pilih semua yang tersedia"}).click();
    await expect(form.getByText("2 dipilih / 3 tempat")).toBeVisible(); await saveRun(form);
    await a.reload(); await b.reload(); await expect(a.getByText(testName,{exact:true})).toHaveCount(0); await expect(b.getByText(testName,{exact:true})).toHaveCount(0);
    await publish(page,"Sesi 1"); await a.reload(); await b.reload(); await excluded.reload();
    await expect(a.getByText(testName,{exact:true})).toBeVisible(); await expect(a.getByText("Reguler · Sesi 1",{exact:true})).toBeVisible();
    await expect(b.getByText(testName,{exact:true})).toHaveCount(0); await expect(excluded.getByText(testName,{exact:true})).toHaveCount(0);
    await publish(page,"Sesi 2"); await b.reload(); await expect(b.getByText("Reguler · Sesi 2",{exact:true})).toBeVisible();
    await expect(a.getByText("Reguler · Sesi 2",{exact:true})).toHaveCount(0);

    // Tidak boleh ada reguler kedua untuk nomor sesi yang sama.
    form=await newRun(page,"regular","Duplikat sesi","2040-07-01T11:00"); await form.getByRole("button",{name:"Pilih semua yang tersedia"}).click();
    await form.getByRole("button",{name:"Simpan draf"}).click(); await expect(form.getByRole("alert")).toContainText("Sesi reguler ini sudah ada");
    await form.getByRole("button",{name:"Batal"}).click();
    // Rancangan dan penghapusan dilindungi ketika sudah ada pelaksanaan.
    await page.goto("/data-tes/daftar"); await page.getByRole("button",{name:`Ubah tes ${exam}`}).click();
    let dialog=page.getByRole("dialog",{name:"Ubah rancangan tes"}); await dialog.getByRole("button",{name:"Simpan rancangan"}).click();
    await expect(dialog.getByRole("alert")).toContainText("Tarik rilis semua pelaksanaan"); await dialog.getByRole("button",{name:"Batal"}).click();
    await page.getByRole("button",{name:`Hapus tes ${exam}`}).click(); dialog=page.getByRole("dialog",{name:"Hapus rancangan tes?"});
    await dialog.getByRole("button",{name:"Ya, hapus rancangan"}).click(); await expect(dialog.getByRole("alert")).toContainText("masih digunakan"); await dialog.getByRole("button",{name:"Batal"}).click();

    await page.goto(`/data-tes/daftar/${exam}`);
    form=await newRun(page,"makeup","Susulan bentrok","2040-07-01T07:30"); await form.getByLabel(`Peserta ${f.studentAName} ${fNisn}`).check(); await saveRun(form);
    await page.getByRole("button",{name:"Rilis Susulan bentrok"}).click(); dialog=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"});
    await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).click(); await expect(dialog.getByRole("alert")).toContainText("bertabrakan"); await dialog.getByRole("button",{name:"Batal"}).click();
    form=await newRun(page,"makeup","Susulan A","2040-07-02T07:00"); await form.getByLabel(`Peserta ${f.studentAName} ${fNisn}`).check(); await saveRun(form); await publish(page,"Susulan A");
    form=await newRun(page,"makeup","Susulan RPL","2040-07-02T09:00"); await form.getByLabel(`Peserta ${r1.name} ${r1.nisn}`).check(); await saveRun(form); await publish(page,"Susulan RPL");

    // Remidi khusus dibatasi jumlah soal, dan remidi lain dapat memakai default.
    form=await newRun(page,"remedial","Remidi khusus","2040-07-03T07:00"); await form.getByLabel(`Peserta ${f.studentAName} ${fNisn}`).check();
    await form.getByRole("radio",{name:"Pilih soal lain dari bank"}).check();
    for(const id of [f.questionId,alt1.id,alt2.id]) await form.getByLabel(`Pilih soal remidi ${id}`).check();
    await form.getByRole("button",{name:"Simpan draf"}).click(); await expect(form.getByRole("alert")).toContainText("tidak boleh melebihi");
    await form.getByLabel(`Pilih soal remidi ${f.questionId}`).uncheck(); await form.getByLabel(`Pilih soal remidi ${alt1.id}`).uncheck();
    await saveRun(form); await publish(page,"Remidi khusus");
    form=await newRun(page,"remedial","Remidi default","2040-07-03T09:00"); await form.getByLabel(`Peserta ${r1.name} ${r1.nisn}`).check(); await saveRun(form); await publish(page,"Remidi default");
    const kinds=(await client.query<{kind:string;mode:string;n:number}>(`SELECT r.kind,r.question_mode AS mode,count(q.question_id)::int AS n FROM exam_schedule_runs r
      LEFT JOIN exam_schedule_custom_questions q ON q.run_id=r.id WHERE r.exam_test_id=$1 AND r.kind='remedial' GROUP BY r.id ORDER BY r.label`,[exam])).rows;
    expect(kinds).toHaveLength(2); expect(kinds.map((x)=>[x.mode,x.n]).sort()).toEqual([["custom",1],["inherit",0]]);
    await a.reload(); await b.reload(); await excluded.reload();
    await expect(a.getByText("Susulan · Susulan A",{exact:true})).toBeVisible(); await expect(a.getByText("Remidi · Remidi khusus",{exact:true})).toBeVisible();
    await expect(b.getByText("Susulan · Susulan RPL",{exact:true})).toBeVisible(); await expect(b.getByText("Remidi · Remidi default",{exact:true})).toBeVisible();
    await expect(excluded.getByText(testName,{exact:true})).toHaveCount(0);
    for(const secret of [f.questionSecret,`Rahasia reguler kedua ${f.suffix}`,`Rahasia remidi lain ${f.suffix}`,r1.name,removed.name]) expect(await a.content()).not.toContain(secret);

    // Kelompok yang sudah dirilis tidak dapat dipindah diam-diam.
    await page.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`); await page.getByRole("button",{name:"Acak pembagian"}).click();
    await page.getByRole("list",{name:"Pratinjau pembagian sesi"}).getByLabel(`Sesi ${f.studentAName} ${fNisn}`).selectOption("2");
    await page.getByRole("button",{name:"Simpan pembagian sesi"}).click();
    await page.getByRole("dialog",{name:"Simpan pembagian sesi?"}).getByRole("button",{name:"Ya, simpan pembagian"}).click();
    await expect(page.getByRole("alert").filter({hasText:"Pembagian belum disimpan"})).toContainText("sudah memiliki jadwal reguler dirilis");
    expect((await client.query<{n:number}>("SELECT session_number AS n FROM exam_session_assignments WHERE period_id=$1 AND student_id=$2",[f.periodA,f.studentA])).rows[0].n).toBe(1);

    // Jadwal dasar sudah lampau, tetapi token tetap dapat dibuat untuk sesi di
    // masa depan dan satu token yang sama ditampilkan untuk susulan.
    await page.goto("/data-tes/token?tanggal=2040-07-01"); await expect(testPanel(page,exam)).toContainText("Sesi 1");
    await confirmIssue(await issueForm(page,`tes ${exam}`)); const code=await visibleCode(page,`tes ${exam}`);
    await page.goto("/data-tes/token?tanggal=2040-07-02"); await expect(testPanel(page,exam)).toContainText("Susulan A");
    expect(await visibleCode(page,`tes ${exam}`)).toBe(code);
    await a.reload(); expect(await a.content()).not.toContain(code);
  } finally {
    await Promise.all(contexts.map((c)=>c.close()));
    const identities=students.flatMap((s)=>s.identity ? [s.identity] : []);
    if(identities.length) {
      await client.query("DELETE FROM participant_sessions WHERE participant_identity_id=ANY($1::bigint[])",[identities]);
      await client.query("DELETE FROM participant_password_audit WHERE participant_identity_id=ANY($1::bigint[])",[identities]);
      await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])",[identities]);
      await client.query("DELETE FROM participant_identities WHERE id=ANY($1::bigint[])",[identities]);
    }
    await cleanupLoginFixture(client,f,students.flatMap((s)=>s.username ? [{period:f.periodA,username:s.username}] : []));
    await cleanupTopics(client,topics);
    if(students.length) await client.query("DELETE FROM school_students WHERE id=ANY($1::bigint[])",[students.map((s)=>s.id)]);
    if(classes.length) { await client.query("DELETE FROM school_classes WHERE id=ANY($1::bigint[])",[classes.map((c)=>c.klass)]); await client.query("DELETE FROM school_majors WHERE id=ANY($1::bigint[])",[classes.map((c)=>c.major)]); }
    await client.end();
  }
});

test("dua rilis bersamaan untuk siswa yang sama di periode berbeda tidak dapat bentrok", async ({page,browser}) => {
  test.setTimeout(90_000);
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  const other=await browser.newContext({baseURL:"http://127.0.0.1:3100"}); const second=await other.newPage();
  try {
    const placementB=(await client.query<{id:string}>("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4) RETURNING id::text AS id",[f.studentA,f.periodB,f.classId,`X ${f.majorName}`])).rows[0].id;
    const tests=(await client.query<{id:string;period:string}>(`INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes)
      VALUES($1,$3,'2041-01-01 00:00:00+00','WIB',60),($2,$4,'2041-01-01 00:00:00+00','WIB',60)
      RETURNING id::text AS id,period_id::text AS period`,[f.periodA,f.periodB,`Balapan A ${f.suffix}`,`Balapan B ${f.suffix}`])).rows;
    for(const row of tests) await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)",[row.id,f.questionId]);
    const admin=(await client.query<{id:string}>("SELECT id::text AS id FROM admin_users WHERE username=$1",[process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    const ids:string[]=[];
    for(const [i,row] of tests.entries()) {
      const run=(await client.query<{id:string}>(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,starts_at,time_zone,duration_minutes,created_by)
        VALUES($1,$2,'makeup',$3,'2041-01-01 00:00:00+00','WIB',60,$4) RETURNING id::text AS id`,[row.id,row.period,`Balapan ${i+1}`,admin])).rows[0].id; ids.push(run);
      await client.query("INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id) VALUES($1,$2,$3,'makeup',$4,$5)",[run,row.id,row.period,f.studentA,row.period===f.periodA?f.placementA:placementB]);
    }
    await Promise.all([loginAsAdmin(page),loginAsAdmin(second)]); await Promise.all([page.goto(`/data-tes/daftar/${tests[0].id}`),second.goto(`/data-tes/daftar/${tests[1].id}`)]);
    await Promise.all([page.getByRole("button",{name:"Rilis Balapan 1"}).click(),second.getByRole("button",{name:"Rilis Balapan 2"}).click()]);
    const d1=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"}),d2=second.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"});
    await Promise.all([d1.getByRole("button",{name:"Ya, rilis jadwal"}).click(),d2.getByRole("button",{name:"Ya, rilis jadwal"}).click()]);
    await expect.poll(async()=>(await client.query<{n:number}>("SELECT count(*)::int AS n FROM exam_schedule_runs WHERE id=ANY($1::bigint[]) AND published_at IS NOT NULL",[ids])).rows[0].n).toBe(1);
    const state=(await client.query<{id:string;published:boolean}>("SELECT id::text AS id,(published_at IS NOT NULL) AS published FROM exam_schedule_runs WHERE id=ANY($1::bigint[]) ORDER BY id",[ids])).rows;
    const loser=state.findIndex((s)=>!s.published); const loserPage=loser===0?page:second; const loserDialog=loser===0?d1:d2;
    await expect(loserDialog.getByRole("alert")).toContainText("bertabrakan"); await loserDialog.getByRole("button",{name:"Batal"}).click();
    // Sesi tepat setelah akhir sesi lain tidak dianggap bertabrakan.
    await loserPage.getByRole("button",{name:`Ubah pelaksanaan Balapan ${loser+1}`}).click();
    const editor=loserPage.getByRole("dialog",{name:"Ubah draf pelaksanaan"}); await editor.getByLabel("Tanggal dan waktu mulai").fill("2041-01-01T08:00");
    await saveRun(editor); await publish(loserPage,`Balapan ${loser+1}`);
    expect((await client.query<{n:number}>("SELECT count(*)::int AS n FROM exam_schedule_runs WHERE id=ANY($1::bigint[]) AND published_at IS NOT NULL",[ids])).rows[0].n).toBe(2);
  } finally { await other.close(); await cleanupLoginFixture(client,f); await client.end(); }
});
