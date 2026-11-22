import { randomInt } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import { makeImportWorkbook } from '../helpers/import-workbook.mjs';
import { cleanupAttemptFixture, seedAttemptFixture, type AttemptFixture } from './exam-attempt-helpers';
import { loginAsAdmin } from './helpers';
import { loginParticipant, loginTestDatabase } from './participant-login-helpers';

test.use({ actionTimeout: 15_000 });
type Pupil = { id:string; name:string; nisn:string; classId:string; label:string };
async function setupRoster(client:pg.Client,f:AttemptFixture,target:string) {
  const a=f.login;
  const classes=(await client.query<{id:string;level:string}>("INSERT INTO school_classes(level,major_id) VALUES('XI',$1),('XII',$1) RETURNING id::text AS id,level",[a.majorId])).rows;
  const xi=classes.find((c)=>c.level==='XI')!.id,xii=classes.find((c)=>c.level==='XII')!.id;
  await client.query('UPDATE exam_periods SET academic_year_id=$2 WHERE id=$1',[a.periodB,target]);
  const base=randomInt(1_000_000,900_000_000),levels=['XI','XII','XII','X','X','X'];
  const pupils:Pupil[]=[];
  for(let i=0;i<levels.length;i++) {
    const name=`FIXTURE ${['XI NAIK','XII LULUS','XII KELUAR','TINGGAL','GANTI TUJUAN','SUDAH ADA'][i]} ${a.suffix}`;
    const nisn=String(base+i).padStart(10,'0'),classId=levels[i]==='XI'?xi:levels[i]==='XII'?xii:a.classId,label=`${levels[i]} ${a.majorName}`;
    const id=(await client.query<{id:string}>('INSERT INTO school_students(name,nisn) VALUES($1,$2) RETURNING id::text AS id',[name,nisn])).rows[0].id;
    await client.query("INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,$4,'active')",[a.yearId,id,classId,label]);
    await client.query('INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)',[id,a.periodA,classId,label]);
    pupils.push({id,name,nisn,classId,label});
  }
  await client.query("INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,$4,'active')",[a.yearId,a.studentA,a.classId,`X ${a.majorName}`]);
  await client.query("INSERT INTO academic_year_enrollments(academic_year_id,student_id,class_id,class_name_snapshot,status) VALUES($1,$2,$3,$4,'active'),($1,$5,$6,$7,'active')",[target,a.studentB,a.classId,`X ${a.majorName}`,pupils[5].id,xi,`XI ${a.majorName}`]);
  await client.query('INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)',[pupils[5].id,a.periodB,xi,`XI ${a.majorName}`]);
  const history=(await client.query<{id:string}>(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,started_at,deadline,question_count,completed_at,completion_reason,correct_count,answered_count)
    SELECT r.id,r.exam_test_id,r.period_id,r.kind,$2,$3,$4,i.participant_number,p.class_name_snapshot,t.name,r.label,'WIB',clock_timestamp()-interval '3 minutes',clock_timestamp()+interval '1 hour',1,clock_timestamp()-interval '2 minutes','submitted',1,1
    FROM exam_schedule_runs r JOIN exam_tests t ON t.id=r.exam_test_id JOIN participant_identities i ON i.id=$2 JOIN student_class_placements p ON p.id=$5 WHERE r.id=$1 RETURNING id::text AS id`,[f.runId,a.identityA,a.studentA,a.studentAName,a.placementA])).rows[0].id;
  await client.query("INSERT INTO exam_final_grade_settings(exam_test_id,method,revision,updated_by) SELECT $1,'highest',1,id FROM admin_users WHERE username=$2",[a.activeTest,process.env.TEST_ADMIN_USERNAME]);
  await client.query('INSERT INTO exam_final_grade_state(exam_test_id,participant_identity_id,period_id,finalized_at,finalized_by,revision,updated_by) SELECT $1,$2,$3,clock_timestamp(),id,1,id FROM admin_users WHERE username=$4',[a.activeTest,a.identityA,a.periodA,process.env.TEST_ADMIN_USERNAME]);
  return {pupils,xi,xii,history};
}
async function choosePlan(page:Page, source:string,target:string) {
  await page.getByLabel('Tahun asal').selectOption(source);await page.getByLabel('Tahun tujuan').selectOption(target);
  await page.getByRole('button',{name:'Buat pratinjau'}).click();
  await expect(page.getByText('Siswa yang sudah ada dipertahankan')).toBeVisible();
}
async function completeChoices(page:Page,pupils:Pupil[],xii:string) {
  const [promoted,graduated,left,repeated,changed]=pupils;
  await expect(page.getByLabel(`Keputusan ${promoted.name} ${promoted.nisn}`)).toHaveValue('promoted');
  await page.getByLabel(`Keputusan ${graduated.name} ${graduated.nisn}`).selectOption('graduated');
  await page.getByLabel(`Keputusan ${left.name} ${left.nisn}`).selectOption('left');
  await page.getByLabel(`Keputusan ${repeated.name} ${repeated.nisn}`).selectOption('repeated');
  await page.getByLabel(`Kelas tujuan ${changed.name} ${changed.nisn}`).selectOption(xii);
}
async function confirmRollover(page:Page) {
  await page.getByRole('button',{name:'Periksa dan simpan perpindahan'}).click();
  const dialog=page.getByRole('dialog',{name:'Simpan perpindahan siswa?'});await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Ya, simpan'}).click();await expect(dialog).toBeHidden();
}

test('pratinjau dan koreksi tahun, siswa baru, impor, pergantian tahun dan sesi tetap aman',async({page,browser})=>{
  test.setTimeout(240_000);
  const client=loginTestDatabase();const locker=loginTestDatabase();await client.connect();await locker.connect();
  const f=await seedAttemptFixture(client,0);const a=f.login;const extraNisns=[String(randomInt(1_000_000,900_000_000)).padStart(10,'0'),String(randomInt(1_000_000,900_000_000)).padStart(10,'0')];
  const participantContext=await browser.newContext({baseURL:'http://127.0.0.1:3100'});const participant=await participantContext.newPage();
  let target='',xi='',xii='',periodExtra='',pupils:Pupil[]=[];let lockerOpen=false;
  try {
    await loginAsAdmin(page);await page.goto('/data-peserta/tahun-ajaran');
    await page.getByLabel('Tahun ajaran baru').fill('2041/2042');await page.getByRole('button',{name:'Tambah tahun'}).click();
    await expect.poll(async()=>Number((await client.query("SELECT count(*)::int AS n FROM academic_years WHERE name='2041/2042'")).rows[0].n)).toBe(1);
    target=(await client.query<{id:string}>("SELECT id::text AS id FROM academic_years WHERE name='2041/2042'")).rows[0].id;
    const fixture=await setupRoster(client,f,target);({pupils,xi,xii}=fixture);
    const beforeAttempt=(await client.query('SELECT to_jsonb(a) AS row FROM exam_attempts a WHERE id=$1',[fixture.history])).rows[0].row;
    const beforePasswords=(await client.query('SELECT to_jsonb(p) AS row FROM participant_passwords p WHERE participant_identity_id=ANY($1::bigint[]) ORDER BY participant_identity_id',[[a.identityA,a.identityB]])).rows;
    await page.reload();await choosePlan(page,a.yearId,target);
    const existingRow=page.getByRole('row').filter({hasText:pupils[5].name});
    await expect(existingRow).toContainText('Data tujuan dipertahankan');
    await expect(existingRow).not.toContainText('Tidak ditempatkan');
    await expect(page.getByLabel(`Kelas tujuan ${a.studentAName} ${(await client.query('SELECT nisn FROM school_students WHERE id=$1',[a.studentA])).rows[0].nisn}`)).toHaveValue(xi);
    await completeChoices(page,pupils,xii);
    await client.query('UPDATE academic_year_enrollments SET updated_at=clock_timestamp() WHERE academic_year_id=$1 AND student_id=$2',[a.yearId,a.studentA]);
    await confirmRollover(page);
    await expect(page.getByRole('alert').filter({hasText:'Data berubah setelah pratinjau'})).toBeVisible();
    expect((await client.query('SELECT count(*)::int AS n FROM academic_year_enrollments WHERE academic_year_id=$1',[target])).rows[0].n).toBe(2);
    await page.getByRole('button',{name:'Buat pratinjau'}).click();await expect(page.getByText('Siswa yang sudah ada dipertahankan')).toBeVisible();
    await completeChoices(page,pupils,xii);await confirmRollover(page);
    await expect.poll(async()=>Number((await client.query('SELECT count(*)::int AS n FROM academic_year_enrollments WHERE academic_year_id=$1',[target])).rows[0].n)).toBe(8);
    const records=(await client.query<{student:string;status:string;klass:string;transition:string}>(`SELECT student_id::text AS student,status,class_id::text AS klass,transition FROM academic_year_enrollments WHERE academic_year_id=$1`,[target])).rows;
    const record=(id:string)=>records.find((r)=>r.student===id)!;
    expect(record(a.studentA)).toMatchObject({status:'active',klass:xi,transition:'promoted'});
    expect(record(pupils[0].id)).toMatchObject({status:'active',klass:xii,transition:'promoted'});
    expect(record(pupils[1].id)).toMatchObject({status:'graduated',klass:xii});
    expect(record(pupils[2].id)).toMatchObject({status:'left',klass:xii});
    expect(record(pupils[3].id)).toMatchObject({status:'active',klass:a.classId,transition:'repeated'});
    expect(record(pupils[4].id)).toMatchObject({status:'active',klass:xii});
    expect(record(pupils[5].id)).toMatchObject({status:'active',klass:xi,transition:'manual'});
    expect((await client.query('SELECT 1 FROM student_class_placements WHERE period_id=$1 AND student_id=ANY($2::bigint[]) AND ended_at IS NULL',[a.periodB,[pupils[1].id,pupils[2].id]])).rowCount).toBe(0);
    expect((await client.query('SELECT 1 FROM participant_identities WHERE period_id=$1 AND student_id=$2',[a.periodB,a.studentA])).rowCount).toBe(0);
    await page.goto(`/data-peserta/siswa?tahun=${target}`);await expect(page.getByRole('row').filter({hasText:pupils[1].name})).toContainText('Lulus');
    await page.getByRole('button',{name:'Tambah siswa baru'}).click();let dialog=page.getByRole('dialog',{name:'Tambah siswa baru'});
    await dialog.getByLabel('Nama siswa').fill(`Baru manual ${a.suffix}`);await dialog.getByLabel('NISN').fill(extraNisns[0]);await dialog.getByLabel('Kelas / rombel').selectOption(a.classId);
    await dialog.getByRole('button',{name:'Simpan',exact:true}).click();await expect(dialog).toBeHidden();
    await page.goto('/data-peserta/import');await page.getByRole('combobox',{name:'Tahun ajaran'}).click();await page.getByRole('option',{name:'2041/2042'}).click();
    const workbook=makeImportWorkbook({rows:[{cells:[1,`Baru impor ${a.suffix}`,extraNisns[1],`X ${a.majorName}`]}]});
    await page.getByLabel('File Excel').setInputFiles({name:'fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook});
    await page.getByRole('button',{name:'Periksa pratinjau'}).click();await expect(page.getByRole('heading',{name:'Hasil pratinjau'})).toBeVisible();
    await page.getByRole('button',{name:'Simpan hasil impor'}).click();dialog=page.getByRole('dialog',{name:'Simpan hasil impor?'});await dialog.getByRole('button',{name:'Ya, simpan impor'}).click();
    await expect(page.getByText('Impor selesai')).toBeVisible();
    const newRows=(await client.query<{id:string;nisn:string}>(`SELECT s.id::text AS id,s.nisn FROM school_students s JOIN academic_year_enrollments e ON e.student_id=s.id AND e.academic_year_id=$1 WHERE s.nisn=ANY($2::text[])`,[target,extraNisns])).rows;
    expect(newRows).toHaveLength(2);
    expect((await client.query('SELECT 1 FROM student_class_placements WHERE period_id=$1 AND student_id=ANY($2::bigint[]) AND ended_at IS NULL',[a.periodB,newRows.map((r)=>r.id)])).rowCount).toBe(2);
    await page.goto('/data-peserta/periode');await expect(page.getByRole('button',{name:`Aktifkan login ${a.periodBName}`})).toBeDisabled();
    await page.getByRole('button',{name:'Tambah periode'}).click();dialog=page.getByRole('dialog',{name:'Tambah periode'});
    await dialog.getByLabel('Tahun ajaran').selectOption(target);await dialog.getByLabel('Nama periode').fill(`Periode tambahan ${a.suffix}`);
    await dialog.getByLabel('Tanggal mulai').fill('2041-08-01');await dialog.getByRole('button',{name:'Simpan periode'}).click();await expect(dialog).toBeHidden();
    periodExtra=(await client.query<{id:string}>('SELECT id::text AS id FROM exam_periods WHERE name=$1',[`Periode tambahan ${a.suffix}`])).rows[0].id;
    expect((await client.query('SELECT 1 FROM student_class_placements WHERE period_id=$1 AND ended_at IS NULL',[periodExtra])).rowCount).toBe(8);
    expect((await client.query('SELECT 1 FROM participant_identities WHERE period_id=$1',[periodExtra])).rowCount).toBe(0);
    // Login mengambil SHARE pada pengaturan, lalu menunggu lock sandi.
    // Pergantian tahun harus menunggu login lalu menghapus sesi yang baru diterbitkan.
    await participant.goto('/peserta/login');await participant.getByLabel('Username peserta').fill(a.username);await participant.getByLabel('Kata sandi',{exact:true}).fill(a.passwordA);
    await page.goto('/data-peserta/tahun-ajaran');await page.getByRole('button',{name:'Aktifkan 2041/2042'}).click();
    dialog=page.getByRole('dialog',{name:'Aktifkan 2041/2042?'});await expect(dialog).toBeVisible();
    await locker.query('BEGIN');lockerOpen=true;await locker.query('SELECT participant_identity_id FROM participant_passwords WHERE participant_identity_id=$1 FOR UPDATE',[a.identityA]);
    const submitted=participant.getByRole('button',{name:'Masuk sebagai peserta'}).click();
    await expect.poll(async()=>(await client.query<{n:number}>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_passwords%' AND query LIKE '%FOR SHARE%'`)).rows[0].n,{timeout:12_000}).toBeGreaterThan(0);
    const switched=dialog.getByRole('button',{name:'Ya, lanjutkan'}).click();
    await expect.poll(async()=>(await client.query<{n:number}>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%participant_login_settings%' AND query LIKE '%FOR UPDATE%'`)).rows[0].n,{timeout:12_000}).toBeGreaterThan(0);
    await locker.query('COMMIT');lockerOpen=false;await Promise.allSettled([submitted,switched]);await expect(dialog).toBeHidden();
    await expect.poll(async()=>(await client.query<{id:string|null}>('SELECT active_year_id::text AS id FROM academic_year_settings WHERE id=1')).rows[0].id).toBe(target);
    expect((await client.query('SELECT period_id FROM participant_login_settings WHERE id=1')).rows[0].period_id).toBeNull();
    expect((await client.query('SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1',[a.identityA])).rowCount).toBe(0);
    await participant.goto('/peserta');await expect(participant).toHaveURL(/\/peserta\/login/);
    await page.goto('/data-peserta/kartu');await expect(page.getByText('Belum ada periode login aktif')).toBeVisible();
    await page.goto('/data-peserta/periode');await page.getByRole('button',{name:`Aktifkan login ${a.periodBName}`}).click();
    dialog=page.getByRole('dialog',{name:'Aktifkan periode login?'});await dialog.getByRole('button',{name:'Ya, aktifkan login'}).click();await expect(dialog).toBeHidden();
    await loginParticipant(participant,a.username,a.passwordB);await expect(participant.getByRole('heading',{name:`Halo, ${a.studentBName}!`})).toBeVisible();
    await page.goto('/data-peserta/tahun-ajaran');await page.getByRole('button',{name:'Nonaktifkan tahun'}).click();
    dialog=page.getByRole('dialog',{name:'Nonaktifkan tahun ajaran?'});await dialog.getByRole('button',{name:'Ya, lanjutkan'}).click();await expect(dialog).toBeHidden();
    expect((await client.query('SELECT period_id FROM participant_login_settings WHERE id=1')).rows[0].period_id).toBeNull();
    expect((await client.query('SELECT 1 FROM participant_sessions WHERE participant_identity_id=$1',[a.identityB])).rowCount).toBe(0);
    await participant.goto('/peserta');await expect(participant).toHaveURL(/\/peserta\/login/);
    expect((await client.query('SELECT to_jsonb(a) AS row FROM exam_attempts a WHERE id=$1',[fixture.history])).rows[0].row).toEqual(beforeAttempt);
    expect((await client.query('SELECT to_jsonb(p) AS row FROM participant_passwords p WHERE participant_identity_id=ANY($1::bigint[]) ORDER BY participant_identity_id',[[a.identityA,a.identityB]])).rows).toEqual(beforePasswords);
    expect((await client.query('SELECT 1 FROM exam_final_grade_state WHERE exam_test_id=$1 AND participant_identity_id=$2 AND finalized_at IS NOT NULL',[a.activeTest,a.identityA])).rowCount).toBe(1);
  } finally {
    if(lockerOpen)await locker.query('ROLLBACK').catch(()=>{});
    await participantContext.close().catch(()=>{});
    if(target) {
      await client.query('UPDATE participant_login_settings SET period_id=NULL WHERE id=1 AND period_id=ANY($1::bigint[])',[[a.periodA,a.periodB,periodExtra || '0']]);
      await client.query('UPDATE academic_year_settings SET active_year_id=NULL,revision=revision+1 WHERE id=1 AND active_year_id=ANY($1::bigint[])',[[a.yearId,target]]);
      await client.query('DELETE FROM academic_year_enrollments WHERE academic_year_id=ANY($1::bigint[])',[[a.yearId,target]]);
      if(periodExtra){await client.query('DELETE FROM student_class_placements WHERE period_id=$1',[periodExtra]);await client.query('DELETE FROM exam_periods WHERE id=$1',[periodExtra]);}
      if(pupils.length){await client.query('DELETE FROM student_class_placements WHERE student_id=ANY($1::bigint[])',[pupils.map((p)=>p.id)]);await client.query('DELETE FROM school_students WHERE id=ANY($1::bigint[])',[pupils.map((p)=>p.id)]);}
      await client.query('DELETE FROM student_class_placements WHERE student_id IN (SELECT id FROM school_students WHERE nisn=ANY($1::text[]))',[extraNisns]);
      await client.query('DELETE FROM school_students WHERE nisn=ANY($1::text[])',[extraNisns]);
      if(xi&&xii){await client.query('DELETE FROM student_class_placements WHERE class_id=ANY($1::bigint[])',[[xi,xii]]);await client.query('DELETE FROM school_classes WHERE id=ANY($1::bigint[])',[[xi,xii]]);}
    }
    await cleanupAttemptFixture(client,f);if(target)await client.query('DELETE FROM academic_years WHERE id=$1',[target]);
    await locker.end();await client.end();
  }
});

test('periode lama dipetakan secara eksplisit dan konflik kelas tidak ditimpa',async({page})=>{
  test.setTimeout(100_000);
  const client=loginTestDatabase();await client.connect();const f=await seedAttemptFixture(client,0);const a=f.login;
  let xi='',legacy='';
  try {
    xi=(await client.query<{id:string}>("INSERT INTO school_classes(level,major_id) VALUES('XI',$1) RETURNING id::text AS id",[a.majorId])).rows[0].id;
    await client.query('UPDATE participant_login_settings SET period_id=NULL WHERE id=1');
    await client.query('UPDATE exam_periods SET academic_year_id=NULL WHERE id=ANY($1::bigint[])',[[a.periodA,a.periodB]]);
    legacy=(await client.query<{id:string}>('INSERT INTO exam_periods(name,start_date) VALUES($1,$2) RETURNING id::text AS id',[`Legacy bentrok ${a.suffix}`,'2026-07-01'])).rows[0].id;
    await client.query('INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)',[a.studentA,legacy,xi,`XI ${a.majorName}`]);
    await loginAsAdmin(page);await page.goto('/data-peserta/periode');
    async function attach(name:string, expectConflict=false) {
      await page.getByRole('button',{name:`Ubah periode ${name}`}).click();const editor=page.getByRole('dialog',{name:'Ubah periode'});
      await editor.getByLabel('Tahun ajaran').selectOption(a.yearId);await editor.getByRole('button',{name:'Simpan periode'}).click();
      if(expectConflict){await expect(editor.getByRole('alert')).toContainText('kelas/status berbeda');await editor.getByRole('button',{name:'Batal'}).click();}
      else await expect(editor).toBeHidden();
    }
    await attach(a.periodAName);
    expect((await client.query('SELECT academic_year_id::text AS id FROM exam_periods WHERE id=$1',[a.periodA])).rows[0].id).toBe(a.yearId);
    expect((await client.query('SELECT class_id::text AS id FROM academic_year_enrollments WHERE academic_year_id=$1 AND student_id=$2',[a.yearId,a.studentA])).rows[0].id).toBe(a.classId);
    await page.reload();await attach(`Legacy bentrok ${a.suffix}`,true);
    expect((await client.query('SELECT academic_year_id FROM exam_periods WHERE id=$1',[legacy])).rows[0].academic_year_id).toBeNull();
    expect((await client.query('SELECT ended_at FROM student_class_placements WHERE id=$1',[a.placementA])).rows[0].ended_at).toBeNull();
    await page.goto(`/data-peserta/siswa?tahun=${a.yearId}`);
    await page.getByRole('row').filter({hasText:a.studentAName}).getByRole('button',{name:'Kelas / status'}).click();
    const student=page.getByRole('dialog',{name:`Kelas / status ${a.studentAName}`});await student.getByLabel('Kelas / rombel').selectOption(xi);
    page.once('dialog',(confirmation)=>confirmation.accept());await student.getByRole('button',{name:'Simpan',exact:true}).click();await expect(student).toBeHidden();
    expect((await client.query('SELECT ended_at FROM student_class_placements WHERE id=$1',[a.placementA])).rows[0].ended_at).not.toBeNull();
    expect((await client.query('SELECT placement_id::text AS id FROM exam_schedule_participants WHERE run_id=$1 AND student_id=$2',[f.runId,a.studentA])).rows[0].id).toBe(a.placementA);
    await page.goto('/data-peserta/periode');await attach(`Legacy bentrok ${a.suffix}`);
    expect((await client.query('SELECT academic_year_id::text AS id FROM exam_periods WHERE id=$1',[legacy])).rows[0].id).toBe(a.yearId);
    expect((await client.query('SELECT count(*)::int AS n FROM academic_year_enrollments WHERE academic_year_id=$1 AND student_id=$2',[a.yearId,a.studentA])).rows[0].n).toBe(1);
  } finally {
    await client.query('DELETE FROM academic_year_enrollments WHERE academic_year_id=$1',[a.yearId]);
    if(legacy){await client.query('DELETE FROM student_class_placements WHERE period_id=$1',[legacy]);await client.query('DELETE FROM exam_periods WHERE id=$1',[legacy]);}
    if(xi){await client.query('DELETE FROM student_class_placements WHERE class_id=$1',[xi]);await client.query('DELETE FROM school_classes WHERE id=$1',[xi]);}
    await cleanupAttemptFixture(client,f);await client.end();
  }
});
