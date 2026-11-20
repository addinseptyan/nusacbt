import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, resetLoginGlobal, seedLoginFixture } from "./participant-login-helpers";
import { sessionDigest } from "./question-helpers";

test.use({actionTimeout:12_000});
const BOUNDARY="nusacbt-schedule-test-boundary";
type Entry=[string,string];
function multipart(entries:Entry[]) {
  return Buffer.from(entries.map(([key,value])=>`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join("")+`--${BOUNDARY}--\r\n`);
}
function changeData(entries:Entry[], fn:(data:Record<string,unknown>)=>void):Entry[] {
  const copy=entries.map((item)=>[...item] as Entry); const field=copy.find(([key])=>key.endsWith("data"));
  if(!field) throw new Error("Data action tidak tertangkap."); const data=JSON.parse(field[1]) as Record<string,unknown>; fn(data); field[1]=JSON.stringify(data); return copy;
}
function duplicateData(entries:Entry[]):Entry[] {
  const copy=entries.map((item)=>[...item] as Entry); const index=copy.findIndex(([key])=>key.endsWith("data"));
  if(index<0) throw new Error("Data action tidak tertangkap."); copy.splice(index+1,0,[...copy[index]] as Entry); return copy;
}

test("halaman privat dan aksi menolak asal asing, anonim, data palsu, serta operasi bertipe salah",async({page,browser})=>{
  test.setTimeout(90_000);
  const client=loginTestDatabase(); await client.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  const anonymous=await browser.newContext({baseURL:"http://127.0.0.1:3100"});
  let scriptDialog=false; page.on("dialog",(d)=>{scriptDialog=true;void d.dismiss();});
  try {
    const exam=(await client.query<{id:string}>("INSERT INTO exam_tests(period_id,name,starts_at,time_zone,duration_minutes) VALUES($1,$2,'2040-01-01 00:00Z','WIB',60) RETURNING id::text AS id",[f.periodA,`Keamanan sesi ${f.suffix}`])).rows[0].id;
    await client.query("INSERT INTO exam_test_questions(exam_test_id,question_id,position) VALUES($1,$2,1)",[exam,f.questionId]);
    const anonPage=await anonymous.newPage();
    for(const url of [`/data-tes/daftar/${exam}`,`/data-tes/daftar/sesi?periode=${f.periodA}`]) { await anonPage.goto(url); await expect(anonPage).toHaveURL(/\/login$/); }
    await loginAsAdmin(page); await page.setViewportSize({width:320,height:850});
    const response=await page.goto(`/data-tes/daftar/${exam}`);
    expect(response?.headers()["cache-control"]).toContain("no-store"); expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const sessionResponse=await page.request.get(`/data-tes/daftar/sesi?periode=${f.periodA}`); expect(sessionResponse.headers()["cache-control"]).toContain("no-store");
    await page.evaluate(()=>{
      const w=window as Window & { capturedScheduleFields?:Entry[] }; const original=window.fetch.bind(window);
      window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
        if(init?.body instanceof FormData) w.capturedScheduleFields=Array.from(init.body.entries()).map(([key,value])=>{
          if(typeof value!=="string") throw new Error("Berkas tidak diharapkan."); return [key,value];
        });
        return original(input,init);
      }) as typeof fetch;
    });
    const label=`<img src=x onerror=alert(1)> ${f.suffix}`;
    await page.getByRole("button",{name:"Tambah pelaksanaan"}).click(); const editor=page.getByRole("dialog",{name:"Tambah pelaksanaan"});
    await editor.getByLabel("Jenis pelaksanaan").selectOption("makeup"); await editor.getByLabel("Nama pelaksanaan").fill(label);
    await editor.getByLabel("Tanggal dan waktu mulai").fill("2040-01-01T08:00");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const saveRequest=page.waitForRequest((req)=>req.method()==="POST"&&new URL(req.url()).pathname===`/data-tes/daftar/${exam}`);
    await editor.getByRole("button",{name:"Simpan draf"}).click(); const savedRequest=await saveRequest; await expect(editor).toBeHidden();
    const saveAction=savedRequest.headers()["next-action"]; if(!saveAction) throw new Error("Action penyimpanan tidak tertangkap.");
    const saveEntries=await page.evaluate(()=>(window as Window & {capturedScheduleFields?:Entry[]}).capturedScheduleFields??[]);
    const runs=page.getByRole("list",{name:"Daftar pelaksanaan tes"}); await expect(runs).toContainText(label); expect(await runs.locator("img,script").count()).toBe(0); expect(scriptDialog).toBe(false);
    const headers={"content-type":`multipart/form-data; boundary=${BOUNDARY}`,"next-action":saveAction};
    const foreign=await page.request.post(`/data-tes/daftar/${exam}`,{headers:{...headers,origin:"https://penyerang.invalid"},data:multipart(saveEntries),failOnStatusCode:false});
    expect(foreign.status()).toBeGreaterThanOrEqual(400);
    const anonymousResponse=await anonymous.request.post(`/data-tes/daftar/${exam}`,{headers:{...headers,origin:"http://127.0.0.1:3100"},data:multipart(saveEntries),failOnStatusCode:false});
    expect(anonymousResponse.headers()["x-action-redirect"]??String(anonymousResponse.status())).toMatch(/login|3\d\d|401|403/);
    const duplicate=await page.request.post(`/data-tes/daftar/${exam}`,{headers:{...headers,origin:"http://127.0.0.1:3100"},data:multipart(duplicateData(saveEntries)),failOnStatusCode:false});
    expect(await duplicate.text()).toContain("Data pelaksanaan tidak valid");
    const malformed=changeData(saveEntries,(data)=>{data.runRevision="not-a-revision";});
    const wrongRevision=await page.request.post(`/data-tes/daftar/${exam}`,{headers:{...headers,origin:"http://127.0.0.1:3100"},data:multipart(malformed),failOnStatusCode:false});
    expect(await wrongRevision.text()).toContain("versi pelaksanaan tidak valid");
    const crossPeriod=changeData(saveEntries,(data)=>{data.participants=[{studentId:f.studentB,placementId:f.placementB}];});
    const badRoster=await page.request.post(`/data-tes/daftar/${exam}`,{headers:{...headers,origin:"http://127.0.0.1:3100"},data:multipart(crossPeriod),failOnStatusCode:false});
    expect(await badRoster.text()).toContain("Penempatan peserta berubah atau tidak aktif");
    expect((await client.query("SELECT id FROM exam_schedule_runs WHERE exam_test_id=$1",[exam])).rowCount).toBe(1);

    // Tangkap action rilis pada draf kosong. Array ["publish"] harus ditolak,
    // bukan diperlakukan sebagai cabang hapus oleh konversi tipe JavaScript.
    await page.getByRole("button",{name:`Rilis ${label}`}).click(); const dialog=page.getByRole("dialog",{name:"Rilis jadwal pelaksanaan?"});
    const changeRequest=page.waitForRequest((req)=>req.method()==="POST"&&new URL(req.url()).pathname===`/data-tes/daftar/${exam}`);
    await dialog.getByRole("button",{name:"Ya, rilis jadwal"}).click(); const requested=await changeRequest;
    await expect(dialog.getByRole("alert")).toContainText("Pilih setidaknya satu peserta");
    const action=requested.headers()["next-action"]; if(!action) throw new Error("Action rilis tidak tertangkap.");
    const entries=await page.evaluate(()=>(window as Window & {capturedScheduleFields?:Entry[]}).capturedScheduleFields??[]);
    const arrayOperation=changeData(entries,(data)=>{data.operation=["publish"];});
    const invalid=await page.request.post(`/data-tes/daftar/${exam}`,{headers:{"content-type":`multipart/form-data; boundary=${BOUNDARY}`,"next-action":action,origin:"http://127.0.0.1:3100"},data:multipart(arrayOperation),failOnStatusCode:false});
    expect(await invalid.text()).toContain("tindakan tidak valid");
    expect((await client.query("SELECT id FROM exam_schedule_runs WHERE exam_test_id=$1 AND published_at IS NULL",[exam])).rowCount).toBe(1);
  } finally { await anonymous.close(); await cleanupLoginFixture(client,f); await client.end(); }
});

test("pembagian usang ditolak atomik dan tidak deadlock dengan urutan kunci penempatan/impor",async({page})=>{
  test.setTimeout(75_000);
  const client=loginTestDatabase(),blocker=loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  try {
    const nisn=(await client.query<{nisn:string}>("SELECT nisn FROM school_students WHERE id=$1",[f.studentA])).rows[0].nisn;
    await loginAsAdmin(page); await page.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`);
    await page.getByLabel(`Pilih ${f.studentAName} ${nisn}`).check(); await page.getByRole("button",{name:"Acak pembagian"}).click();
    await page.getByRole("button",{name:"Simpan pembagian sesi"}).click(); const dialog=page.getByRole("dialog",{name:"Simpan pembagian sesi?"});
    // Kunci siswa dahulu seperti impor; mutasi sesi akan menunggu siswa sambil
    // memegang KEY SHARE periode, yang kompatibel dengan FOR SHARE impor.
    await blocker.query("BEGIN"); await blocker.query("SET LOCAL statement_timeout='5s'"); await blocker.query("SELECT id FROM school_students WHERE id=$1 FOR UPDATE",[f.studentA]);
    await dialog.getByRole("button",{name:"Ya, simpan pembagian"}).click();
    await expect.poll(async()=>(await client.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM school_students WHERE id=ANY%FOR SHARE%') AS waiting")).rows[0].waiting,{timeout:10_000}).toBe(true);
    await blocker.query("SELECT id FROM exam_periods WHERE id=$1 FOR SHARE",[f.periodA]);
    await blocker.query("UPDATE student_class_placements SET ended_at=GREATEST(clock_timestamp(),started_at) WHERE id=$1",[f.placementA]);
    await blocker.query("INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES($1,$2,$3,$4)",[f.studentA,f.periodA,f.classId,`X ${f.majorName}`]);
    await blocker.query("COMMIT");
    await expect(page.getByRole("alert").filter({hasText:"Pembagian belum disimpan"})).toContainText("Penempatan siswa berubah");
    expect((await client.query("SELECT 1 FROM exam_session_plans WHERE period_id=$1",[f.periodA])).rowCount).toBe(0);
    expect((await client.query("SELECT 1 FROM exam_session_assignments WHERE period_id=$1",[f.periodA])).rowCount).toBe(0);
  } finally { await blocker.query("ROLLBACK").catch(()=>{}); await blocker.end(); await cleanupLoginFixture(client,f); await client.end(); }
});

test("masa sesi admin yang habis saat menunggu membatalkan penyimpanan kelompok",async({page})=>{
  test.setTimeout(75_000);
  const client=loginTestDatabase(),blocker=loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  try {
    const nisn=(await client.query<{nisn:string}>("SELECT nisn FROM school_students WHERE id=$1",[f.studentA])).rows[0].nisn;
    await loginAsAdmin(page); await page.goto(`/data-tes/daftar/sesi?periode=${f.periodA}`);
    await page.getByLabel(`Pilih ${f.studentAName} ${nisn}`).check(); await page.getByRole("button",{name:"Acak pembagian"}).click();
    await page.getByRole("button",{name:"Simpan pembagian sesi"}).click(); const dialog=page.getByRole("dialog",{name:"Simpan pembagian sesi?"});
    const digest=await sessionDigest(page); await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE token_hash=$1",[digest]);
    await blocker.query("BEGIN"); await blocker.query("SELECT id FROM school_students WHERE id=$1 FOR UPDATE",[f.studentA]);
    await dialog.getByRole("button",{name:"Ya, simpan pembagian"}).click();
    await expect.poll(async()=>(await client.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM school_students WHERE id=ANY%FOR SHARE%') AS waiting")).rows[0].waiting,{timeout:10_000}).toBe(true);
    await expect.poll(async()=>(await client.query<{expired:boolean}>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1",[digest])).rows[0].expired,{timeout:10_000}).toBe(true);
    await blocker.query("COMMIT"); await expect(page.getByRole("alert").filter({hasText:"Pembagian belum disimpan"})).toContainText("Sesi admin berakhir");
    expect((await client.query("SELECT 1 FROM exam_session_plans WHERE period_id=$1",[f.periodA])).rowCount).toBe(0);
  } finally { await blocker.query("ROLLBACK").catch(()=>{}); await blocker.end(); await cleanupLoginFixture(client,f); await client.end(); }
});

test("sesi admin yang kedaluwarsa saat halaman kelompok atau pelaksanaan menunggu tidak menerima data privat",async({page})=>{
  test.setTimeout(90_000);
  const client=loginTestDatabase(),blocker=loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  try {
    const cases=[
      {table:"question_bank",url:`/data-tes/daftar/${f.activeTest}`,needle:"FROM question_bank q JOIN question_topics t",secret:f.questionSecret},
      {table:"exam_session_assignments",url:`/data-tes/daftar/sesi?periode=${f.periodA}`,needle:"exam_session_assignments WHERE period_id",secret:f.studentAName},
    ];
    for(const item of cases) {
      await loginAsAdmin(page); const digest=await sessionDigest(page);
      await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE token_hash=$1",[digest]);
      await blocker.query("BEGIN"); await blocker.query(`LOCK TABLE ${item.table} IN ACCESS EXCLUSIVE MODE`);
      const responsePromise=page.request.get(item.url,{maxRedirects:0,failOnStatusCode:false,timeout:30_000});
      await expect.poll(async()=>(await client.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND strpos(query,$1)>0) AS waiting",[item.needle])).rows[0].waiting,{timeout:10_000}).toBe(true);
      await expect.poll(async()=>(await client.query<{expired:boolean}>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1",[digest])).rows[0].expired,{timeout:10_000}).toBe(true);
      await blocker.query("COMMIT");
      const response=await responsePromise, body=await response.text();
      expect(body).not.toContain(item.secret);
      expect(response.status()>=300 && response.status()<400 || body.includes("/login")).toBe(true);
    }
  } finally { await blocker.query("ROLLBACK").catch(()=>{}); await blocker.end(); await cleanupLoginFixture(client,f); await client.end(); }
});

test("penghapusan periode dan penyimpanan kelompok bersamaan tidak meninggalkan kelompok yatim",async({page,browser})=>{
  test.setTimeout(75_000);
  const client=loginTestDatabase(),blocker=loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client);
  const other=await browser.newContext({baseURL:"http://127.0.0.1:3100"}); const second=await other.newPage(); let period="";
  try {
    const name=`Periode race kelompok ${f.suffix}`;
    period=(await client.query<{id:string}>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2049-01-01') RETURNING id::text AS id",[name])).rows[0].id;
    const admin=(await client.query<{id:string}>("SELECT id::text AS id FROM admin_users WHERE username=$1",[process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    await client.query("INSERT INTO exam_session_plans(period_id,updated_by) VALUES($1,$2)",[period,admin]);
    await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,30)",[period]);
    await Promise.all([loginAsAdmin(page),loginAsAdmin(second)]); await Promise.all([page.goto(`/data-tes/daftar/sesi?periode=${period}`),second.goto("/data-peserta/periode")]);
    await page.getByRole("button",{name:"Acak pembagian"}).click(); await page.getByRole("button",{name:"Simpan pembagian sesi"}).click();
    const groupDialog=page.getByRole("dialog",{name:"Simpan pembagian sesi?"});
    await second.getByRole("button",{name:`Hapus periode ${name}`}).click(); const deleteDialog=second.getByRole("dialog",{name:"Hapus periode?"});
    await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:exam-schedule:period:' || $1::text, 0))",[period]);
    await Promise.all([groupDialog.getByRole("button",{name:"Ya, simpan pembagian"}).click(),deleteDialog.getByRole("button",{name:"Ya, hapus periode"}).click()]);
    await expect.poll(async()=>(await client.query<{n:number}>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'")).rows[0].n,{timeout:10_000}).toBeGreaterThanOrEqual(2);
    await blocker.query("COMMIT"); await expect(deleteDialog).toBeHidden();
    await expect.poll(async()=>(await client.query<{n:number}>("SELECT count(*)::int AS n FROM exam_periods WHERE id=$1",[period])).rows[0].n).toBe(0);
    expect((await client.query("SELECT 1 FROM exam_session_plans WHERE period_id=$1",[period])).rowCount).toBe(0);
    expect((await client.query("SELECT 1 FROM exam_session_groups WHERE period_id=$1",[period])).rowCount).toBe(0);
  } finally {
    await blocker.query("ROLLBACK").catch(()=>{}); await blocker.end(); await other.close();
    if(period) { await client.query("DELETE FROM exam_session_groups WHERE period_id=$1",[period]); await client.query("DELETE FROM exam_session_plans WHERE period_id=$1",[period]); await client.query("DELETE FROM exam_periods WHERE id=$1",[period]); }
    await cleanupLoginFixture(client,f); await client.end();
  }
});

test("penghapusan periode tidak membersihkan kelompok jika sesi admin habis saat menunggu",async({page})=>{
  test.setTimeout(75_000);
  const client=loginTestDatabase(),blocker=loginTestDatabase(); await client.connect(); await blocker.connect(); await resetLoginGlobal(client); const f=await seedLoginFixture(client); let period="";
  try {
    const name=`Periode expiry kelompok ${f.suffix}`;
    period=(await client.query<{id:string}>("INSERT INTO exam_periods(name,start_date) VALUES($1,'2049-01-01') RETURNING id::text AS id",[name])).rows[0].id;
    const admin=(await client.query<{id:string}>("SELECT id::text AS id FROM admin_users WHERE username=$1",[process.env.TEST_ADMIN_USERNAME])).rows[0].id;
    await client.query("INSERT INTO exam_session_plans(period_id,updated_by) VALUES($1,$2)",[period,admin]); await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,30)",[period]);
    await loginAsAdmin(page); await page.goto("/data-peserta/periode"); await page.getByRole("button",{name:`Hapus periode ${name}`}).click();
    const dialog=page.getByRole("dialog",{name:"Hapus periode?"}),digest=await sessionDigest(page);
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE token_hash=$1",[digest]);
    await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:exam-schedule:period:' || $1::text, 0))",[period]);
    await dialog.getByRole("button",{name:"Ya, hapus periode"}).click();
    await expect.poll(async()=>(await client.query<{waiting:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%') AS waiting")).rows[0].waiting,{timeout:10_000}).toBe(true);
    await expect.poll(async()=>(await client.query<{expired:boolean}>("SELECT expires_at<=clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1",[digest])).rows[0].expired,{timeout:10_000}).toBe(true);
    await blocker.query("COMMIT"); await expect(dialog.getByRole("alert")).toContainText("Sesi admin sudah berakhir");
    expect((await client.query("SELECT 1 FROM exam_periods WHERE id=$1",[period])).rowCount).toBe(1);
    expect((await client.query("SELECT 1 FROM exam_session_plans WHERE period_id=$1",[period])).rowCount).toBe(1);
    expect((await client.query("SELECT 1 FROM exam_session_groups WHERE period_id=$1",[period])).rowCount).toBe(1);
  } finally {
    await blocker.query("ROLLBACK").catch(()=>{}); await blocker.end();
    if(period) { await client.query("DELETE FROM exam_session_groups WHERE period_id=$1",[period]); await client.query("DELETE FROM exam_session_plans WHERE period_id=$1",[period]); await client.query("DELETE FROM exam_periods WHERE id=$1",[period]); }
    await cleanupLoginFixture(client,f); await client.end();
  }
});
