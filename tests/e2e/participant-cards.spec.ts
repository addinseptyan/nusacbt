import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type pg from "pg";

import { encryptParticipantPassword, readParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, seedLoginFixture, type LoginFixture } from "./participant-login-helpers";

const baseURL = "http://127.0.0.1:3100";
const endpoint = "/data-peserta/kartu/siapkan";
const sameOrigin = { Origin: baseURL, "Content-Type": "application/json", "X-NusaCBT-Cards": "1" };
test.use({ actionTimeout: 15_000 });

type Fixture = {
  login: LoginFixture; otherClassId: string; otherClassLabel: string;
  bIdentity: string; bPlacement: string; cStudent: string; cName: string; cIdentity: string;
  dStudent: string; dName: string; dPlacement: string; baseRun: string;
};
type Payload = { mode: "prepare" | "verify"; filters: string; candidates: Array<{ identityId: string; studentId: string; token: string }>; includePassword: boolean };

async function addRun(client: pg.Client, f: LoginFixture, testId: string, kind: "regular" | "makeup" | "remedial", published: boolean, participants: Array<[string, string]>) {
  const run = (await client.query<{ id: string }>(
    `INSERT INTO exam_schedule_runs(exam_test_id,period_id,kind,label,session_number,starts_at,time_zone,duration_minutes,created_by,published_at,published_by)
     SELECT e.id,e.period_id,$2::text,'Kartu fixture',CASE WHEN $2::text='regular' THEN 1 ELSE NULL END,
       e.starts_at,e.time_zone,e.duration_minutes,a.id,CASE WHEN $3::boolean THEN clock_timestamp() ELSE NULL END,
       CASE WHEN $3::boolean THEN a.id ELSE NULL END
     FROM exam_tests e CROSS JOIN (SELECT id FROM admin_users WHERE username=$4) a WHERE e.id=$1
     RETURNING id::text AS id`, [testId, kind, published, process.env.TEST_ADMIN_USERNAME],
  )).rows[0].id;
  for (const [studentId, placementId] of participants) await client.query(
    `INSERT INTO exam_schedule_participants(run_id,exam_test_id,period_id,kind,student_id,placement_id)
     SELECT id,exam_test_id,period_id,kind,$2,$3 FROM exam_schedule_runs WHERE id=$1`, [run, studentId, placementId],
  );
  return run;
}

async function seed(client: pg.Client): Promise<Fixture> {
  const f = await seedLoginFixture(client);
  try {
    await client.query("BEGIN");
    const otherClassId = (await client.query<{ id: string }>("INSERT INTO school_classes(level,major_id) VALUES('XI',$1) RETURNING id::text AS id", [f.majorId])).rows[0].id;
    const otherClassLabel = `XI ${f.majorName}`;
    const cName = `Peserta C ${f.suffix}`; const dName = `Peserta D ${f.suffix}`;
    const base = randomInt(0, 999_999_997);
    const extras = (await client.query<{ id: string; name: string }>(
      "INSERT INTO school_students(name,nisn) VALUES($1,$2),($3,$4) RETURNING id::text AS id,name",
      [cName, String(base).padStart(10, "0"), dName, String(base + 1).padStart(10, "0")],
    )).rows;
    const cStudent = extras.find((s) => s.name === cName)!.id; const dStudent = extras.find((s) => s.name === dName)!.id;
    const placements = (await client.query<{ id: string; student: string }>(
      `INSERT INTO student_class_placements(student_id,period_id,class_id,class_name_snapshot) VALUES
       ($1,$4,$5,$6),($2,$4,$5,$6),($3,$4,$7,$8) RETURNING id::text AS id,student_id::text AS student`,
      [f.studentB, cStudent, dStudent, f.periodA, f.classId, `X ${f.majorName}`, otherClassId, otherClassLabel],
    )).rows;
    const bPlacement = placements.find((p) => p.student === f.studentB)!.id;
    const cPlacement = placements.find((p) => p.student === cStudent)!.id;
    const dPlacement = placements.find((p) => p.student === dStudent)!.id;
    const identities = (await client.query<{ id: string; student: string }>(
      `INSERT INTO participant_identities(student_id,period_id,participant_number,username) VALUES
       ($1,$3,$4,$5),($2,$3,$6,$7) RETURNING id::text AS id,student_id::text AS student`,
      [f.studentB, cStudent, f.periodA, `CARD-B-${f.suffix}`, `card-b-${f.suffix}`, `CARD-C-${f.suffix}`, `card-c-${f.suffix}`],
    )).rows;
    const bIdentity = identities.find((i) => i.student === f.studentB)!.id;
    const cIdentity = identities.find((i) => i.student === cStudent)!.id;
    const hash = (await client.query<{ hash: string }>("SELECT password_hash AS hash FROM participant_passwords WHERE participant_identity_id=$1", [f.identityB])).rows[0].hash;
    const key = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, process.cwd());
    try {
      const encrypted = encryptParticipantPassword(f.passwordB, key, { identityId: bIdentity, periodId: f.periodA });
      await client.query("INSERT INTO participant_passwords(participant_identity_id,password_hash,nonce,ciphertext,authentication_tag) VALUES($1,$2,$3,$4,$5)",
        [bIdentity, hash, encrypted.nonce, encrypted.ciphertext, encrypted.authenticationTag]);
    } finally { key.fill(0); }
    await client.query(`INSERT INTO exam_session_plans(period_id,updated_by) SELECT $1,id FROM admin_users WHERE username=$2`, [f.periodA, process.env.TEST_ADMIN_USERNAME]);
    await client.query("INSERT INTO exam_session_groups(period_id,session_number,capacity) VALUES($1,1,100)", [f.periodA]);
    await client.query("INSERT INTO exam_session_assignments(period_id,student_id,session_number,placement_id) VALUES($1,$2,1,$3),($1,$4,1,$5)",
      [f.periodA, f.studentA, f.placementA, f.studentB, bPlacement]);
    const baseRun = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_schedule_runs WHERE exam_test_id=$1 AND kind='makeup'", [f.activeTest])).rows[0].id;
    await addRun(client, f, f.activeTest, "regular", true, [[f.studentA, f.placementA], [f.studentB, bPlacement]]);
    await addRun(client, f, f.activeTest, "remedial", true, [[f.studentA, f.placementA]]);
    await addRun(client, f, f.activeTest, "makeup", false, [[cStudent, cPlacement]]);
    const future = (await client.query<{ id: string }>("SELECT id::text AS id FROM exam_tests WHERE period_id=$1 AND name=$2", [f.periodA, f.futureName])).rows[0].id;
    await addRun(client, f, future, "remedial", true, [[f.studentB, bPlacement]]);
    await client.query("COMMIT");
    return { login: f, otherClassId, otherClassLabel, bIdentity, bPlacement, cStudent, cName, cIdentity, dStudent, dName, dPlacement, baseRun };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); await cleanupLoginFixture(client, f); throw error; }
}

async function cleanup(client: pg.Client, f: Fixture) {
  await client.query("DELETE FROM participant_password_audit WHERE participant_identity_id=ANY($1::bigint[])", [[f.bIdentity, f.cIdentity]]);
  await client.query("DELETE FROM participant_passwords WHERE participant_identity_id=ANY($1::bigint[])", [[f.bIdentity, f.cIdentity]]);
  await client.query("DELETE FROM participant_identities WHERE id=ANY($1::bigint[])", [[f.bIdentity, f.cIdentity]]);
  await client.query("DELETE FROM student_class_placements WHERE id=$1", [f.dPlacement]);
  await client.query("DELETE FROM school_classes WHERE id=$1", [f.otherClassId]);
  await cleanupLoginFixture(client, f.login);
  await client.query("DELETE FROM school_students WHERE id=ANY($1::bigint[])", [[f.cStudent, f.dStudent]]);
}

async function auditCount(client: pg.Client, f: Fixture) {
  return (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM participant_password_audit WHERE participant_identity_id=ANY($1::bigint[]) AND event='reveal'", [[f.login.identityA, f.bIdentity, f.cIdentity]])).rows[0].count;
}
async function openCards(page: Page, f: Fixture, query: Record<string, string> = {}) {
  const params = new URLSearchParams({ periode: f.login.periodA, ...query });
  const response = await page.goto(`/data-peserta/kartu?${params}`);
  await expect(page.getByRole("heading", { name: "Cetak Kartu Peserta", exact: true })).toBeVisible();
  return response;
}
function choose(page: Page, name: string) { return page.getByRole("checkbox", { name: new RegExp(`^Pilih ${name} NISN`) }); }
async function prepareWithoutPassword(page: Page) {
  const wait = page.waitForResponse((response) => response.url().includes(endpoint) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Pratinjau kartu" }).click();
  const response = await wait;
  await expect(page.getByRole("dialog", { name: /Pratinjau/ })).toBeVisible();
  return { response, payload: response.request().postDataJSON() as Payload };
}

// Semua data dan kunci dalam pengujian ini adalah fixture khusus, bukan data sekolah.
test("hanya kelas dan pencarian; kartu selalu memakai periode login aktif", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); const f = await seed(client);
  try {
    await loginAsAdmin(page);
    await page.goto("/data-peserta/kartu");
    const list = page.getByRole("list", { name: "Daftar peserta untuk kartu" });
    await expect(page.getByText(f.login.periodAName).first()).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(4);
    await expect(choose(page, f.dName)).toBeDisabled();
    await expect(choose(page, f.cName)).toBeEnabled();
    await expect(list).toContainText("Belum bersandi"); await expect(list).toContainText("Belum beridentitas");
    await expect(page.getByLabel("Tes dirilis")).toHaveCount(0);
    await expect(page.getByLabel("Kategori pelaksanaan")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Periode", exact: true })).toHaveCount(0);
    await openCards(page, f, { kelas: f.otherClassId });
    await expect(list.getByRole("listitem")).toHaveCount(1); await expect(list).toContainText(f.dName);
    await openCards(page, f, { siswa: f.login.studentBName });
    await expect(list.getByRole("listitem")).toHaveCount(1); await expect(list).toContainText(f.login.studentBName);
    await openCards(page, f, { siswa: `card-b-${f.login.suffix}` });
    await expect(list.getByRole("listitem")).toHaveCount(1); await expect(list).toContainText(f.login.studentBName);
    await page.goto(`/data-peserta/kartu?tes=${f.login.activeTest}&kategori=regular`);
    await expect(page.getByText("Filter tidak valid")).toBeVisible();
    await client.query("UPDATE participant_login_settings SET period_id=$1 WHERE id=1", [f.login.periodB]);
    await page.goto("/data-peserta/kartu");
    await expect(page.getByText(f.login.periodBName).first()).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(1); await expect(list).toContainText(f.login.studentBName);
    await page.goto(`/data-peserta/kartu?periode=${f.login.periodA}`);
    await expect(page.getByText("Periode login berubah")).toBeVisible();
    await client.query("UPDATE participant_login_settings SET period_id=NULL WHERE id=1");
    await page.goto("/data-peserta/kartu");
    await expect(page.getByText("Belum ada periode login aktif")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pratinjau kartu" })).toHaveCount(0);
    expect(await auditCount(client, f)).toBe(0);
  } finally { await cleanup(client, f); await client.end(); }
});

test("pratinjau tanpa sandi tidak mendekripsi, Ctrl+P diblokir, dan tombol cetak memeriksa ulang", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); const f = await seed(client);
  try {
    await loginAsAdmin(page); const initial = await openCards(page, f);
    expect(initial?.headers()["cache-control"]).toContain("no-store");
    expect(await initial?.text()).not.toContain(f.login.passwordA);
    expect(await page.content()).not.toContain(f.login.passwordA);
    await choose(page, f.login.studentAName).check(); await choose(page, f.login.studentBName).check();
    await expect(page.getByRole("checkbox", { name: /Sertakan sandi pada kartu/ })).not.toBeChecked();
    const first = await prepareWithoutPassword(page);
    expect(first.response.headers()["cache-control"]).toContain("no-store");
    expect(first.response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(first.payload.includePassword).toBe(false);
    const json = await first.response.json(); expect(json.result.cards).toHaveLength(2);
    expect(json.result.cards.every((card: { password: null }) => card.password === null)).toBe(true);
    const dialog = page.getByRole("dialog", { name: /Pratinjau/ });
    await expect(dialog.getByTestId("participant-card")).toHaveCount(2);
    await expect(dialog).toContainText("Tidak disertakan"); await expect(dialog).not.toContainText(f.login.passwordA);
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(dialog).toHaveAttribute("data-print-blocked", "true");
    await page.emulateMedia({ media: "print" });
    await expect(dialog.locator(".participant-card-print-grid")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Dialog cetak ditutup")).toBeVisible();

    await prepareWithoutPassword(page);
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.setAttribute("data-print-test", "called");
        window.dispatchEvent(new Event("beforeprint"));
        document.documentElement.setAttribute("data-print-blocked-test", document.querySelector(".participant-card-preview-dialog")?.getAttribute("data-print-blocked") ?? "no");
        window.dispatchEvent(new Event("afterprint"));
      };
    });
    const verify = page.waitForResponse((response) => response.url().includes(endpoint) && response.request().postDataJSON()?.mode === "verify");
    await dialog.getByRole("button", { name: "Cetak / Simpan PDF" }).click();
    const checked = await verify; expect(checked.status()).toBe(200); expect(await checked.json()).toEqual({ ok: true });
    await expect(page.locator("html")).toHaveAttribute("data-print-test", "called");
    await expect(page.locator("html")).toHaveAttribute("data-print-blocked-test", "no");
    await expect(dialog).toBeHidden(); expect(await auditCount(client, f)).toBe(0);
  } finally { await cleanup(client, f); await client.end(); }
});

test("sandi hanya disiapkan setelah pilihan dan konfirmasi, diaudit tiap peserta, dan dibersihkan", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); const f = await seed(client);
  try {
    await loginAsAdmin(page); await openCards(page, f);
    await choose(page, f.login.studentAName).check(); await choose(page, f.login.studentBName).check();
    await page.getByRole("checkbox", { name: /Sertakan sandi pada kartu/ }).check();
    await choose(page, f.login.studentBName).uncheck();
    await expect(page.getByRole("checkbox", { name: /Sertakan sandi pada kartu/ })).not.toBeChecked();
    await choose(page, f.login.studentBName).check();
    await page.getByRole("checkbox", { name: /Sertakan sandi pada kartu/ }).check();
    await page.getByRole("button", { name: "Pratinjau kartu" }).click();
    let confirm = page.getByRole("dialog", { name: "Tampilkan sandi pada kartu?" });
    await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "Batal" }).click();
    expect(await auditCount(client, f)).toBe(0); expect(await page.content()).not.toContain(f.login.passwordA);
    await page.getByRole("button", { name: "Pratinjau kartu" }).click(); confirm = page.getByRole("dialog", { name: "Tampilkan sandi pada kartu?" });
    const responsePromise = page.waitForResponse((response) => response.url().includes(endpoint) && response.request().method() === "POST");
    await confirm.getByRole("button", { name: "Ya, tampilkan sandi" }).click();
    const response = await responsePromise; expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.json(); expect(body.result.cards.map((row: { password: string }) => row.password).sort()).toEqual([f.login.passwordA, f.login.passwordB].sort());
    const dialog = page.getByRole("dialog", { name: /Pratinjau/ });
    await expect(dialog).toContainText(f.login.passwordA); await expect(dialog).toContainText(f.login.passwordB);
    expect(await auditCount(client, f)).toBe(2); expect(page.url()).not.toContain(f.login.passwordA);
    expect(await page.evaluate((password) => JSON.stringify({ local: localStorage, session: sessionStorage }).includes(password), f.login.passwordA)).toBe(false);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    });
    await expect(dialog).toBeHidden(); await expect(page.locator("[data-participant-card-secret]")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Sertakan sandi pada kartu/ })).not.toBeChecked();
    expect(await page.content()).not.toContain(f.login.passwordA);
  } finally { await cleanup(client, f); await client.end(); }
});

test("batch atomik menolak sandi hilang, kandidat duplikat, origin asing dan sesi anonim", async ({ page, browser }) => {
  const client = loginTestDatabase(); await client.connect(); const f = await seed(client);
  try {
    await loginAsAdmin(page); await openCards(page, f);
    await choose(page, f.login.studentAName).check(); await choose(page, f.cName).check();
    const { payload } = await prepareWithoutPassword(page);
    await page.getByRole("dialog", { name: /Pratinjau/ }).getByRole("button", { name: "Tutup" }).click();
    const missing = await page.request.post(endpoint, { headers: sameOrigin, data: { ...payload, includePassword: true } });
    expect(missing.status()).toBe(409); expect(await missing.text()).toContain("belum memiliki sandi");
    expect(await auditCount(client, f)).toBe(0);
    const duplicate = await page.request.post(endpoint, { headers: sameOrigin, data: { ...payload, candidates: [payload.candidates[0], payload.candidates[0]], includePassword: true } });
    expect(duplicate.status()).toBe(409); expect(await duplicate.text()).not.toContain(f.login.passwordA);
    const cross = await page.request.post(endpoint, { headers: { ...sameOrigin, Origin: "http://evil.example" }, data: { ...payload, includePassword: true } });
    expect(cross.status()).toBe(403); expect(cross.headers()["cache-control"]).toContain("no-store");
    const simple = await page.request.post(endpoint, { headers: { Origin: baseURL, "Content-Type": "text/plain" }, data: "{}" }); expect(simple.status()).toBe(403);
    const huge = await page.request.post(endpoint, { headers: sameOrigin, data: { ...payload, extra: "x".repeat(70_000) } }); expect(huge.status()).toBe(413);
    const anonymous = await browser.newContext({ baseURL });
    try { const response = await anonymous.request.post(endpoint, { headers: sameOrigin, data: { ...payload, includePassword: true } }); expect(response.status()).toBe(401); expect(await response.text()).not.toContain(f.login.passwordA); }
    finally { await anonymous.close(); }
    expect(await auditCount(client, f)).toBe(0);
  } finally { await cleanup(client, f); await client.end(); }
});

test("kegagalan audit satu peserta membatalkan batch sandi secara keseluruhan", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); const f = await seed(client);
  const functionName = `card_batch_fail_${f.login.suffix}`; const triggerName = `card_batch_trigger_${f.login.suffix}`;
  try {
    await loginAsAdmin(page); await openCards(page, f);
    await choose(page, f.login.studentAName).check(); await choose(page, f.login.studentBName).check();
    const { payload } = await prepareWithoutPassword(page);
    await page.getByRole("dialog", { name: /Pratinjau/ }).getByRole("button", { name: "Tutup" }).click();
    await client.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.participant_identity_id=${f.bIdentity}::bigint AND NEW.event='reveal' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON participant_password_audit FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    const response = await page.request.post(endpoint, { headers: sameOrigin, data: { ...payload, includePassword: true } });
    expect(response.status()).toBe(503); const text = await response.text();
    expect(text).not.toContain(f.login.passwordA); expect(text).not.toContain(f.login.passwordB);
    expect(await auditCount(client, f)).toBe(0);
  } finally {
    await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON participant_password_audit`).catch(() => {});
    await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => {});
    await cleanup(client, f); await client.end();
  }
});

test("kartu periode login aktif dan filter kelas tetap dapat digunakan pada layar ponsel", async ({ page }) => {
  const client = loginTestDatabase(); await client.connect(); const f = await seed(client);
  try {
    await page.setViewportSize({ width: 375, height: 812 }); await loginAsAdmin(page);
    await page.goto("/data-peserta/kartu");
    await expect(page.getByText(f.login.periodAName).first()).toBeVisible();
    await page.getByLabel("Kelas / rombel").selectOption(f.login.classId);
    await expect(page.getByText("Filter berubah; terapkan")).toBeVisible();
    await expect(choose(page, f.login.studentAName)).toBeDisabled();
    await page.getByRole("button", { name: "Terapkan" }).click();
    await expect(page.getByRole("list", { name: "Daftar peserta untuk kartu" }).getByRole("listitem")).toHaveCount(3);
    await page.getByRole("checkbox", { name: "Pilih semua yang beridentitas pada halaman ini" }).check();
    await prepareWithoutPassword(page);
    const dialog = page.getByRole("dialog", { name: /Pratinjau/ });
    await expect(dialog.getByTestId("participant-card")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Cetak / Simpan PDF" })).toBeVisible();
  } finally { await cleanup(client, f); await client.end(); }
});
