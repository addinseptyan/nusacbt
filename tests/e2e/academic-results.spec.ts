import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import type pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { cleanupAttemptFixture, seedAttemptFixture, type AttemptFixture } from './exam-attempt-helpers';
import { loginAsAdmin } from './helpers';
import { loginTestDatabase } from './participant-login-helpers';

test.use({ actionTimeout: 15_000 });

type Extra = { identity: string; placement: string; regular: string; language: string };
async function run(client: pg.Client, f: AttemptFixture, testId: string, kind: 'regular' | 'makeup' | 'remedial', label: string, started: string | null) {
  return (await client.query<{id:string}>(`INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,session_number,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
    SELECT t.id,t.period_id,$2,$3,CASE WHEN $2='regular' THEN 1 ELSE NULL END,COALESCE($4::timestamptz,clock_timestamp()-interval '5 minutes'),'WIB',120,a.id,clock_timestamp(),a.id
    FROM exam_tests t CROSS JOIN (SELECT id FROM admin_users WHERE username=$5) a WHERE t.id=$1 RETURNING id::text AS id`, [testId,kind,label,started,process.env.TEST_ADMIN_USERNAME])).rows[0].id;
}
async function register(client: pg.Client, runId: string, student: string, placement: string) {
  await client.query(`INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
    SELECT id,exam_test_id,period_id,kind,$2,$3 FROM exam_schedule_runs WHERE id=$1`,[runId,student,placement]);
}
async function attempt(client: pg.Client, f: AttemptFixture, runId: string, student: string, identity: string, name: string,
  correct: number | null, when: 'historical' | 'current' | 'waiting', questions = 10) {
  const times = when === 'historical'
    ? ["2026-03-02T16:20:00Z", "2026-03-02T17:20:00Z", "2026-03-02T16:30:00Z"]
    : when === 'waiting' ? ["now() - interval '10 minutes'", "now() - interval '1 minute'", null]
    : ["now() - interval '2 minutes'", "now() + interval '1 hour'", correct === null ? null : "now() - interval '1 minute'"];
  const timeSql = (v: string | null) => v === null ? 'NULL' : v.startsWith('now()') ? v : `'${v}'::timestamptz`;
  return (await client.query<{id:string}>(`INSERT INTO exam_attempts(run_id,exam_test_id,period_id,kind,participant_identity_id,student_id,student_name_snapshot,participant_number_snapshot,class_name_snapshot,test_name_snapshot,run_label_snapshot,time_zone_snapshot,started_at,deadline,question_count,completed_at,completion_reason,correct_count,answered_count)
    SELECT r.id,r.exam_test_id,r.period_id,r.kind,$2,$3,$4,i.participant_number,pl.class_name_snapshot,t.name,r.label,'WIB',
      ${timeSql(times[0])},${timeSql(times[1])},$5,${timeSql(times[2])},CASE WHEN $6::int IS NULL THEN NULL ELSE 'submitted' END,$6::int,$6::int
    FROM exam_schedule_runs r JOIN exam_tests t ON t.id=r.exam_test_id JOIN participant_identities i ON i.id=$2
    JOIN student_class_placements pl ON pl.student_id=$3 AND pl.period_id=r.period_id AND pl.ended_at IS NULL
    WHERE r.id=$1 RETURNING id::text AS id`,[runId,identity,student,name,questions,correct])).rows[0].id;
}
async function seed(client: pg.Client, f: AttemptFixture): Promise<Extra> {
  const a=f.login;
  await client.query("UPDATE exam_tests SET name='Matematika X' WHERE id=$1",[a.activeTest]);
  await client.query("UPDATE exam_schedule_runs SET starts_at='2026-03-01 16:30:00+00' WHERE id=$1",[f.runId]);
  await client.query("INSERT INTO exam_session_plans(period_id,updated_by) SELECT $1,id FROM admin_users WHERE username=$2",[a.periodA,process.env.TEST_ADMIN_USERNAME]);
  await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,100)",[a.periodA]);
  const placement=(await client.query<{id:string}>("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4) RETURNING id::text AS id",[a.studentB,a.periodA,a.classId,`X ${a.majorName}`])).rows[0].id;
  const identity=(await client.query<{id:string}>("INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES($1,$2,$3,$4) RETURNING id::text AS id",[a.studentB,a.periodA,`R-${a.suffix}`,`r${a.suffix}`])).rows[0].id;
  const regular=await run(client,f,a.activeTest,'regular','Reguler matematika','2026-03-01T16:30:00Z');
  for(const [student,pl] of [[a.studentA,a.placementA],[a.studentB,placement]]) { await register(client,regular,student,pl); }
  await register(client,f.runId,a.studentB,placement);
  await attempt(client,f,regular,a.studentA,a.identityA,a.studentAName,8,'historical');
  await attempt(client,f,regular,a.studentA,a.identityA,a.studentAName,6,'historical');
  await attempt(client,f,f.runId,a.studentB,identity,a.studentBName,7,'historical');
  const work=await run(client,f,a.activeTest,'remedial','Remidi sedang berlangsung',null);
  await register(client,work,a.studentA,a.placementA);
  await attempt(client,f,work,a.studentA,a.identityA,a.studentAName,null,'current');
  const waiting=await run(client,f,a.activeTest,'makeup','Susulan menunggu',null);
  await register(client,waiting,a.studentA,a.placementA);
  await attempt(client,f,waiting,a.studentA,a.identityA,a.studentAName,null,'waiting');
  await client.query("INSERT INTO exam_final_grade_settings(exam_test_id,method,revision,updated_by) SELECT $1,'average',1,id FROM admin_users WHERE username=$2",[a.activeTest,process.env.TEST_ADMIN_USERNAME]);
  const language=(await client.query<{id:string}>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,'Bahasa Indonesia',clock_timestamp()-interval '5 minutes','WIB',120) RETURNING id::text AS id",[a.periodA])).rows[0].id;
  for(const [kind,label,correct] of [['regular','Reguler bahasa',9],['makeup','Susulan bahasa',5],['remedial','Remidi bahasa',2]] as const) {
    const r=await run(client,f,language,kind,label,null);await register(client,r,a.studentA,a.placementA);
    await attempt(client,f,r,a.studentA,a.identityA,a.studentAName,correct,'current');
  }
  return {identity,placement,regular,language};
}
function sheets(data: Buffer) { const zip=unzipSync(data); return {summary:strFromU8(zip['xl/worksheets/sheet1.xml']),details:strFromU8(zip['xl/worksheets/sheet2.xml']),info:zip['xl/worksheets/sheet3.xml'] ? strFromU8(zip['xl/worksheets/sheet3.xml']) : '',styles:strFromU8(zip['xl/styles.xml']),zip}; }

test('monitoring menampilkan belum mulai, seluruh pengulangan, filter zona dan ekspor', async ({page,browser}) => {
  test.setTimeout(120_000);
  const client=loginTestDatabase();await client.connect();const f=await seedAttemptFixture(client,0);
  try {
    await seed(client,f); await page.setViewportSize({width:1366,height:900});await loginAsAdmin(page);
    await page.goto(`/data-tes/monitoring?tes=${f.login.activeTest}&urut=score_desc`);
    await expect(page.getByRole('heading',{name:'Hasil / Monitoring Tes'})).toBeVisible();
    const rows=page.getByTestId('monitor-row');await expect(rows).toHaveCount(7);
    const all=await rows.allTextContents();
    expect(all.some((x)=>x.includes('Belum mulai'))).toBe(true);
    expect(all.some((x)=>x.includes('Mengerjakan'))).toBe(true);
    expect(all.some((x)=>x.includes('Menunggu penyelesaian'))).toBe(true);
    expect(all.some((x)=>x.includes('Pengerjaan ke-2'))).toBe(true);
    expect(all[0]).toContain('80,00');expect(all[1]).toContain('70,00');expect(all[2]).toContain('60,00');
    expect(await page.getByTestId('monitor-table-container').evaluate((el)=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(page.getByTestId('final-grade-row').filter({hasText:f.login.studentAName})).toContainText('70,00');
    const before=await page.request.get(`/data-tes/monitoring/unduh?tes=${f.login.activeTest}&urut=score_desc`);
    expect(before.status()).toBe(200);expect(before.headers()['cache-control']).toContain('no-store');
    const excel=sheets(await before.body());expect((excel.summary.match(/<row r=/g)??[]).length).toBe(8);
    for(const value of ['Belum mulai','Mengerjakan','Menunggu penyelesaian','Reguler','Susulan','Remidi','Matematika X']) expect(excel.summary).toContain(value);
    expect(excel.summary).toContain('<v>80</v>');expect(excel.summary).not.toMatch(/<f(?:\s|>)/);
    for(const contents of Object.values(excel.zip)) expect(strFromU8(contents)).not.toContain(f.login.questionSecret);
    await page.goto(`/data-tes/monitoring?tes=${f.login.activeTest}&kategori=regular&status=submitted&dari=2026-03-01&sampai=2026-03-01&zona=WIB&urut=score_asc`);
    await expect(rows).toHaveCount(2);const asc=await rows.allTextContents();expect(asc[0]).toContain('60,00');expect(asc[1]).toContain('80,00');
    await page.goto(`/data-tes/monitoring?tes=${f.login.activeTest}&dari=2026-03-01&sampai=2026-03-01&zona=WITA`);
    await expect(rows).toHaveCount(0); // 16:30 UTC adalah 00:30 WITA hari berikutnya.
    await page.goto(`/data-tes/monitoring?tes=${f.login.activeTest}&dari=2026-03-02&sampai=2026-03-02&zona=WITA`);
    await expect(rows).toHaveCount(5);
    const testCombobox = page.getByRole('combobox', { name: 'Nama tes' });
    await testCombobox.click();
    await page.getByPlaceholder('Cari nama tes atau periode...').fill('Matematika X');
    await page.getByRole('option', { name: /Matematika X/ }).first().click();
    await page.getByLabel('Kategori tes').selectOption('makeup');await page.getByRole('button',{name:'Terapkan',exact:true}).click();
    await expect(page).toHaveURL(/kategori=makeup/);await expect(rows).toHaveCount(2);
    await page.setViewportSize({width:390,height:820});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    const anonymous=await browser.newContext({baseURL:'http://127.0.0.1:3100'});
    try { expect((await anonymous.request.get('/data-tes/monitoring/unduh')).status()).toBe(401); }
    finally { await anonymous.close(); }
    expect((await page.request.get('/data-tes/monitoring/unduh?tes=1&tes=2')).status()).toBe(400);
  } finally { await cleanupAttemptFixture(client,f); await client.end(); }
});

test('matriks memisahkan kategori, menggabungkan Susulan, menandai bentrok dan mengekspor angka', async ({page,browser},testInfo) => {
  test.setTimeout(120_000);
  const client=loginTestDatabase();await client.connect();const f=await seedAttemptFixture(client,0);
  try {
    const extra=await seed(client,f);await loginAsAdmin(page);
    const query=new URLSearchParams({tahun:f.login.yearId,gabung:'1'});
    await page.goto(`/laporan/rekap?${query}`);
    const rows=page.getByTestId('matrix-row');await expect(rows).toHaveCount(2);
    const nanda=rows.filter({hasText:f.login.studentAName}),roni=rows.filter({hasText:f.login.studentBName});
    await expect(nanda).toContainText('Periksa');await expect(nanda).toContainText('70,00');
    await expect(roni).toContainText('70,00');await expect(roni).toContainText('Susulan');
    await expect(nanda.getByRole('link',{name:'Periksa'})).toHaveAttribute('href',`/data-tes/monitoring?tes=${extra.language}`);
    const beforeState=(await client.query("SELECT count(*)::int AS n FROM exam_final_grade_state WHERE exam_test_id=$1",[extra.language])).rows[0].n;
    const response=await page.request.get(`/laporan/rekap/unduh?${query}`);
    expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');
    const body=await response.body();await writeFile(testInfo.outputPath('rekap-fixture.xlsx'),body);
    const excel=sheets(body);
    for(const value of ['REKAPITULASI HASIL TES','Grup','Rentang waktu selesai','Jumlah tes','Matematika X','Bahasa Indonesia','Periksa']) expect(excel.summary).toContain(value);
    expect(excel.summary).toMatch(/s="3"><v>70<\/v>/);expect(excel.summary).toMatch(/t="inlineStr" s="4"/);
    expect(excel.details).toContain('Reguler');expect(excel.details).toContain('Susulan');expect(excel.details).not.toContain('Remidi');
    expect(excel.styles).toContain('FFDDEBF7');expect(excel.styles).toContain('FFFFE0DE');
    for(const contents of Object.values(excel.zip)) {const xml=strFromU8(contents);expect(xml).not.toMatch(/<f(?:\s|>)/);expect(xml).not.toContain(f.login.questionSecret);}
    expect((await client.query("SELECT count(*)::int AS n FROM exam_final_grade_state WHERE exam_test_id=$1",[extra.language])).rows[0].n).toBe(beforeState);
    await page.goto(`/laporan/rekap?tahun=${f.login.yearId}&kategori=regular`);await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('80,00'); // rata-rata 70 matematika dan 90 bahasa.
    await page.goto(`/laporan/rekap?tahun=${f.login.yearId}&kategori=makeup`);await expect(rows).toHaveCount(2);
    await expect(rows.filter({hasText:f.login.studentAName})).toContainText('50,00');
    await page.goto(`/laporan/rekap?tahun=${f.login.yearId}&kategori=remedial`);await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('20,00');
    await page.goto(`/laporan/rekap?tes=${f.login.activeTest}&gabung=1&dari=2026-03-02&sampai=2026-03-02&zona=WIB`);await expect(rows).toHaveCount(2);
    await page.goto(`/laporan/rekap?tes=${f.login.activeTest}&gabung=1&dari=2026-03-02&sampai=2026-03-02&zona=WITA`);await expect(rows).toHaveCount(0);
    await page.goto(`/laporan/rekap?tahun=${f.login.yearId}&gabung=1`);
    await page.getByLabel('Jenis ujian').selectOption('makeup');await expect(page.getByLabel('Gabungkan nilai Reguler + Susulan')).toBeDisabled();
    await expect(page.getByLabel('Gabungkan nilai Reguler + Susulan')).not.toBeChecked();
    await page.setViewportSize({width:390,height:820});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    const anon=await browser.newContext({baseURL:'http://127.0.0.1:3100'});try{expect((await anon.request.get(`/laporan/rekap/unduh?${query}`)).status()).toBe(401);}finally{await anon.close();}
    expect((await page.request.get('/laporan/rekap/unduh?kategori=remedial&gabung=1')).status()).toBe(400);
  } finally { await cleanupAttemptFixture(client,f); await client.end(); }
});

test('monitoring dan rekap memakai default cerdas saat dibuka tanpa parameter dan menyediakan Tampilkan semua serta Reset', async ({page}) => {
  test.setTimeout(90_000);
  const client=loginTestDatabase();await client.connect();const f=await seedAttemptFixture(client,0);
  try {
    await seed(client,f);await loginAsAdmin(page);

    // 1. Monitoring tanpa query params memakai tahun aktif + Nama tes kosong (Semua tes) + tanggal hari ini (WIB)
    const todayWib = (await client.query<{ d: string }>("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS d")).rows[0].d;
    await page.goto('/data-tes/monitoring');
    await expect(page.getByText(/Filter otomatis:/)).toBeVisible();
    await expect(page.locator('#monitor-year')).toHaveValue(f.login.yearId);
    await expect(page.getByRole('combobox', { name: 'Nama tes' })).toContainText('Semua tes');
    await expect(page.locator('#monitor-from')).toHaveValue(todayWib);
    await expect(page.locator('#monitor-to')).toHaveValue(todayWib);

    // Klik Tampilkan semua -> ?semua=1 menonaktifkan filter otomatis dan mereset tahun/tes/tanggal
    await page.getByRole('link',{name:'Tampilkan semua'}).click();
    await expect(page).toHaveURL(/\/data-tes\/monitoring\?semua=1$/);
    await expect(page.getByText(/Filter otomatis:/)).toHaveCount(0);
    await expect(page.locator('#monitor-year')).toHaveValue('');
    await expect(page.locator('#monitor-from')).toHaveValue('');
    await expect(page.locator('#monitor-to')).toHaveValue('');

    // Klik Reset -> kembali ke default cerdas (tahun aktif, Semua tes, hari ini)
    await page.getByRole('link',{name:'Reset'}).click();
    await expect(page).toHaveURL(/\/data-tes\/monitoring$/);
    await expect(page.getByText(/Filter otomatis:/)).toBeVisible();
    await expect(page.locator('#monitor-year')).toHaveValue(f.login.yearId);
    await expect(page.getByRole('combobox', { name: 'Nama tes' })).toContainText('Semua tes');
    await expect(page.locator('#monitor-from')).toHaveValue(todayWib);
    await expect(page.locator('#monitor-to')).toHaveValue(todayWib);

    // 2. Rekap tanpa query params memakai tahun aktif + periode aktif
    await page.goto('/laporan/rekap');
    await expect(page.getByText(/Filter otomatis:/)).toBeVisible();
    await expect(page.locator('#matrix-year')).toHaveValue(f.login.yearId);
    await expect(page.locator('#matrix-period')).toHaveValue(f.login.periodA);

    await page.getByRole('link',{name:'Tampilkan semua'}).click();
    await expect(page).toHaveURL(/\/laporan\/rekap\?semua=1$/);
    await expect(page.getByText(/Filter otomatis:/)).toHaveCount(0);
    await expect(page.locator('#matrix-year')).toHaveValue('');
    await expect(page.locator('#matrix-period')).toHaveValue('');

    await page.getByRole('link',{name:'Reset'}).click();
    await expect(page).toHaveURL(/\/laporan\/rekap$/);
    await expect(page.getByText(/Filter otomatis:/)).toBeVisible();
    await expect(page.locator('#matrix-year')).toHaveValue(f.login.yearId);
    await expect(page.locator('#matrix-period')).toHaveValue(f.login.periodA);
  } finally { await cleanupAttemptFixture(client,f); await client.end(); }
});
