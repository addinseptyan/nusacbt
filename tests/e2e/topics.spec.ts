import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";

import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes topik hanya boleh memakai PGDATABASE=nusacbt_test.");
  return new pg.Client(postgresConfig());
}

function topicRow(page: Page, name: string) {
  return page.getByRole("list", { name: "Daftar topik dan mata pelajaran" }).getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

async function openEditor(page: Page, name?: string): Promise<Locator> {
  if (name) await topicRow(page, name).getByRole("button", { name: `Ubah topik ${name}`, exact: true }).click();
  else await page.getByRole("button", { name: "Tambah topik", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: name ? "Ubah topik / mata pelajaran" : "Tambah topik / mata pelajaran" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openDelete(page: Page, name: string): Promise<Locator> {
  await topicRow(page, name).getByRole("button", { name: `Hapus topik ${name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Hapus topik?" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function revokeCurrentSession(page: Page, client: pg.Client) {
  const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
  if (!cookie) throw new Error("Cookie sesi tes tidak ditemukan.");
  const digest = createHash("sha256").update(cookie.value).digest("hex");
  await client.query("DELETE FROM admin_sessions WHERE token_hash = $1", [digest]);
}

async function cleanup(client: pg.Client, suffix: string) {
  await client.query("DELETE FROM question_topics WHERE position(lower($1) in lower(name)) > 0", [suffix]);
}

test("admin menambah, mencari, mengubah dan menghapus kategori; server menolak duplikat serta asal asing", async ({ page, browser }) => {
  test.setTimeout(80_000);
  const suffix = randomBytes(5).toString("hex");
  const first = `Matematika Uji ${suffix}`;
  const second = `Aljabar Uji ${suffix}`;
  const renamed = `Geometri Uji ${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "Data Modul", exact: true }).click();
    await page.getByRole("link", { name: "Topik / Mata Pelajaran", exact: true }).click();
    await expect(page).toHaveURL(/\/data-modul\/topik$/);
    await expect(page.getByRole("heading", { name: "Topik / Mata Pelajaran", exact: true })).toBeVisible();
    await expect(page.getByText("Satu daftar fleksibel")).toBeVisible();
    await expect(page.getByText(/Gunakan nama mata pelajaran yang ringkas/)).toBeVisible();

    let editor = await openEditor(page);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(`  ${first}  `);
    const firstRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/data-modul/topik");
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    const captured = await firstRequest;
    const headers = captured.headers();
    const body = captured.postDataBuffer();
    if (!headers["next-action"] || !headers["content-type"] || !body) throw new Error("Request Server Action tidak dapat diperiksa.");
    await expect(editor).toBeHidden();
    await expect(topicRow(page, first)).toBeVisible();
    const inserted = await client.query<{ id: string; name: string }>("SELECT id::text AS id, name FROM question_topics WHERE name = $1", [first]);
    expect(inserted.rows).toHaveLength(1);
    const firstId = inserted.rows[0].id;

    editor = await openEditor(page);
    await editor.getByLabel("Nama topik / mata pelajaran").fill("   ");
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor.getByRole("alert")).toContainText("Nama wajib diisi");
    await editor.getByLabel("Nama topik / mata pelajaran").fill("x".repeat(101));
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor.getByRole("alert")).toContainText("maksimal 100 karakter");
    await editor.getByLabel("Nama topik / mata pelajaran").fill(first.toUpperCase());
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor.getByRole("alert")).toContainText("sudah digunakan");
    await editor.getByLabel("Nama topik / mata pelajaran").fill(second);
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor).toBeHidden();
    await expect(topicRow(page, second)).toBeVisible();
    expect((await client.query("SELECT id FROM question_topics WHERE position($1 in name) > 0", [suffix])).rowCount).toBe(2);

    editor = await openEditor(page, first);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(second.toUpperCase());
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor.getByRole("alert")).toContainText("sudah digunakan");
    await editor.getByLabel("Nama topik / mata pelajaran").fill(` ${renamed} `);
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor).toBeHidden();
    await expect(topicRow(page, renamed)).toBeVisible();
    expect((await client.query("SELECT name FROM question_topics WHERE id=$1", [firstId])).rows).toEqual([{ name: renamed }]);

    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill("  gEoMeTri  ");
    await expect(topicRow(page, renamed)).toBeVisible();
    await expect(topicRow(page, second)).toHaveCount(0);
    await expect(page.getByText("1 kategori ditemukan")).toBeVisible();
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(`TIDAK-ADA-${suffix}`);
    await expect(page.getByText("Topik tidak ditemukan")).toBeVisible();
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
    await expect(topicRow(page, second)).toBeVisible();
    await expect(topicRow(page, renamed)).toBeVisible();

    let confirmation = await openDelete(page, renamed);
    await expect(confirmation).toContainText(renamed);
    await confirmation.getByRole("button", { name: "Batal" }).click();
    await expect(confirmation).toBeHidden();
    await expect(topicRow(page, renamed)).toBeVisible();
    expect((await client.query("SELECT 1 FROM question_topics WHERE id=$1", [firstId])).rowCount).toBe(1);

    confirmation = await openDelete(page, renamed);
    let allowRequest = () => {};
    let markRequestStarted = () => {};
    const gate = new Promise<void>((resolve) => { allowRequest = resolve; });
    const started = new Promise<void>((resolve) => { markRequestStarted = resolve; });
    await page.route("**/data-modul/topik", async (route) => {
      if (route.request().method() === "POST") { markRequestStarted(); await gate; }
      await route.continue();
    });
    const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-modul/topik", { timeout: 10_000 });
    try {
      await confirmation.getByRole("button", { name: "Ya, hapus topik" }).click();
      await started;
      await expect(confirmation.getByRole("button", { name: "Menghapus..." })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(confirmation).toBeVisible();
      await expect(page.locator('ul[aria-label="Daftar topik dan mata pelajaran"] > li').filter({ hasText: renamed })).toHaveCount(1);
      expect((await client.query("SELECT 1 FROM question_topics WHERE id=$1", [firstId])).rowCount).toBe(1);
    } finally {
      allowRequest();
      await response.catch(() => {});
      await page.unroute("**/data-modul/topik");
    }
    expect((await response).ok()).toBe(true);
    await expect(confirmation).toBeHidden();
    await expect(topicRow(page, renamed)).toHaveCount(0);
    expect((await client.query("SELECT 1 FROM question_topics WHERE id=$1", [firstId])).rowCount).toBe(0);
    confirmation = await openDelete(page, second);
    await confirmation.getByRole("button", { name: "Ya, hapus topik" }).click();
    await expect(confirmation).toBeHidden();
    await expect(topicRow(page, second)).toHaveCount(0);

    // Pastikan body rekaman memang dapat membuat kembali data ketika sesi dan asal sah.
    const requestHeaders = { "content-type": headers["content-type"], "next-action": headers["next-action"] };
    const validReplay = await page.request.post("/data-modul/topik", { headers: { ...requestHeaders, origin: "http://127.0.0.1:3100" }, data: body, failOnStatusCode: false });
    expect(validReplay.ok()).toBe(true);
    expect((await client.query("SELECT 1 FROM question_topics WHERE name=$1", [first])).rowCount).toBe(1);
    await client.query("DELETE FROM question_topics WHERE name=$1", [first]);
    const foreignReplay = await page.request.post("/data-modul/topik", { headers: { ...requestHeaders, origin: "https://attacker.invalid" }, data: body, failOnStatusCode: false });
    expect(foreignReplay.status()).toBeGreaterThanOrEqual(400);
    expect((await client.query("SELECT 1 FROM question_topics WHERE name=$1", [first])).rowCount).toBe(0);
    const anonymous = await browser.newContext();
    try {
      const anonymousPage = await anonymous.newPage();
      await anonymousPage.goto("/data-modul/topik");
      await expect(anonymousPage).toHaveURL(/\/login$/);
      await anonymous.request.post("/data-modul/topik", { headers: { ...requestHeaders, origin: "http://127.0.0.1:3100" }, data: body, failOnStatusCode: false });
      expect((await client.query("SELECT 1 FROM question_topics WHERE name=$1", [first])).rowCount).toBe(0);
    } finally { await anonymous.close(); }
  } finally { await cleanup(client, suffix); await client.end(); }
});

test("database menjaga nama kategori dan keunikan tanpa membedakan kapitalisasi", async () => {
  const client = testDatabase(); await client.connect();
  const suffix = randomBytes(5).toString("hex");
  const name = `Db Topik ${suffix}`;
  try {
    await client.query("BEGIN");
    const inserted = await client.query("INSERT INTO question_topics(name) VALUES($1) RETURNING id,created_at,updated_at", [name]);
    expect(inserted.rowCount).toBe(1);
    expect(inserted.rows[0].created_at).toEqual(inserted.rows[0].updated_at);
    const checks: Array<{ value: string | null; code: string; constraint?: string }> = [
      { value: null, code: "23502" },
      { value: "", code: "23514", constraint: "question_topics_name_check" },
      { value: "   ", code: "23514", constraint: "question_topics_name_check" },
      { value: " Topik", code: "23514", constraint: "question_topics_name_check" },
      { value: "Topik ", code: "23514", constraint: "question_topics_name_check" },
      { value: "x".repeat(101), code: "23514", constraint: "question_topics_name_check" },
      { value: "Topik\nDasar", code: "23514", constraint: "question_topics_name_check" },
      { value: name.toUpperCase(), code: "23505", constraint: "question_topics_name_tags_ci_idx" },
    ];
    for (const { value, code, constraint } of checks) {
      await client.query("SAVEPOINT periksa_topik");
      try {
        await expect(client.query("INSERT INTO question_topics(name) VALUES($1)", [value])).rejects.toMatchObject({ code, ...(constraint ? { constraint } : {}) });
      } finally { await client.query("ROLLBACK TO SAVEPOINT periksa_topik"); }
    }
    await client.query("INSERT INTO question_topics(name) VALUES($1)", ["😀".repeat(100)]);
    expect((await client.query("SELECT 1 FROM question_topics WHERE name=$1", [name])).rowCount).toBe(1);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});

test("pembuatan bersamaan tetap unik ketika transaksi lain belum commit", async ({ page }) => {
  test.setTimeout(45_000);
  const suffix = randomBytes(5).toString("hex");
  const name = `Benturan Topik ${suffix}`;
  const client = testDatabase(); await client.connect();
  const blocker = testDatabase(); await blocker.connect();
  try {
    await loginAsAdmin(page); await page.goto("/data-modul/topik");
    const editor = await openEditor(page);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(name.toUpperCase());
    await blocker.query("BEGIN");
    await blocker.query("INSERT INTO question_topics(name) VALUES($1)", [name]);
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid <> pg_backend_pid()
       AND wait_event_type='Lock' AND query LIKE '%INSERT INTO question_topics(name, tags, tags_signature)%') AS waiting`,
    )).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await blocker.query("COMMIT");
    await expect(editor.getByRole("alert")).toContainText("sudah digunakan");
    expect((await client.query("SELECT name FROM question_topics WHERE lower(name)=lower($1)", [name])).rows).toEqual([{ name }]);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await blocker.end();
    await cleanup(client, suffix); await client.end();
  }
});

test("formulir usang tidak menimpa, menghapus, atau menghidupkan kembali perubahan sesi lain", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const original = `Awal Topik ${suffix}`;
  const changed = `Ubah Pertama ${suffix}`;
  const changedAgain = `Ubah Kedua ${suffix}`;
  const client = testDatabase(); await client.connect();
  let secondPage: Page | undefined;
  try {
    const id = (await client.query<{ id: string }>("INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id", [original])).rows[0].id;
    await loginAsAdmin(page); await page.goto("/data-modul/topik");
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
    secondPage = await page.context().newPage();
    await secondPage.goto("/data-modul/topik");
    await secondPage.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
    const firstEditor = await openEditor(page, original);
    const staleEditor = await openEditor(secondPage, original);
    await firstEditor.getByLabel("Nama topik / mata pelajaran").fill(changed);
    await firstEditor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(firstEditor).toBeHidden();
    await staleEditor.getByLabel("Nama topik / mata pelajaran").fill(`Jangan Menimpa ${suffix}`);
    await staleEditor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(staleEditor.getByRole("alert")).toContainText("Data sudah berubah atau sudah dihapus");
    expect((await client.query("SELECT name FROM question_topics WHERE id=$1", [id])).rows).toEqual([{ name: changed }]);
    await staleEditor.getByRole("button", { name: "Muat ulang daftar" }).click();
    await expect(staleEditor).toBeHidden();
    await expect(topicRow(secondPage, changed)).toBeVisible();

    const staleDelete = await openDelete(secondPage, changed);
    await client.query("UPDATE question_topics SET name=$1 WHERE id=$2", [changedAgain, id]);
    await staleDelete.getByRole("button", { name: "Ya, hapus topik" }).click();
    await expect(staleDelete.getByRole("alert")).toContainText("Data sudah berubah atau sudah dihapus");
    expect((await client.query("SELECT name FROM question_topics WHERE id=$1", [id])).rows).toEqual([{ name: changedAgain }]);
    await staleDelete.getByRole("button", { name: "Muat ulang daftar" }).click();
    await expect(staleDelete).toBeHidden();
    await expect(topicRow(secondPage, changedAgain)).toBeVisible();

    const deletedEditor = await openEditor(secondPage, changedAgain);
    await client.query("DELETE FROM question_topics WHERE id=$1", [id]);
    await deletedEditor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(deletedEditor.getByRole("alert")).toContainText("Data sudah berubah atau sudah dihapus");
    await deletedEditor.getByRole("button", { name: "Muat ulang daftar" }).click();
    await expect(deletedEditor).toBeHidden();
    await expect(topicRow(secondPage, changedAgain)).toHaveCount(0);
    expect((await client.query("SELECT 1 FROM question_topics WHERE id=$1", [id])).rowCount).toBe(0);
  } finally { await secondPage?.close(); await cleanup(client, suffix); await client.end(); }
});

test("formulir usang yang menunggu kunci baris tidak menimpa transaksi yang lebih dahulu commit", async ({ page }) => {
  test.setTimeout(45_000);
  const suffix = randomBytes(5).toString("hex");
  const original = `Sebelum Kunci ${suffix}`;
  const winner = `Pemenang Kunci ${suffix}`;
  const stale = `Tidak Menimpa ${suffix}`;
  const client = testDatabase(); await client.connect();
  const blocker = testDatabase(); await blocker.connect();
  try {
    const id = (await client.query<{ id: string }>("INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id", [original])).rows[0].id;
    await loginAsAdmin(page); await page.goto("/data-modul/topik");
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
    const editor = await openEditor(page, original);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(stale);
    await blocker.query("BEGIN");
    await blocker.query("UPDATE question_topics SET name=$1 WHERE id=$2", [winner, id]);
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid <> pg_backend_pid()
       AND wait_event_type='Lock' AND query LIKE '%UPDATE question_topics SET name%') AS waiting`,
    )).rows[0].waiting, { timeout: 10_000 }).toBe(true);
    await blocker.query("COMMIT");
    await expect(editor.getByRole("alert")).toContainText("Data sudah berubah atau sudah dihapus");
    expect((await client.query("SELECT name FROM question_topics WHERE id=$1", [id])).rows).toEqual([{ name: winner }]);
    await editor.getByRole("button", { name: "Muat ulang daftar" }).click();
    await expect(editor).toBeHidden();
    await expect(topicRow(page, winner)).toBeVisible();
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await blocker.end();
    await cleanup(client, suffix); await client.end();
  }
});

test("nama kategori diperlakukan sebagai teks, bukan markup atau perintah SQL", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const name = `<img src=x onerror=alert(1)> ' OR 1=1 -- ${suffix}`;
  const client = testDatabase(); await client.connect();
  let openedAlert = false;
  page.on("dialog", (dialog) => { openedAlert = true; void dialog.dismiss(); });
  try {
    await loginAsAdmin(page); await page.goto("/data-modul/topik");
    const editor = await openEditor(page);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(name);
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor).toBeHidden();
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
    await expect(topicRow(page, name)).toBeVisible();
    await expect(topicRow(page, name).locator("img")).toHaveCount(0);
    expect(openedAlert).toBe(false);
    expect((await client.query("SELECT name FROM question_topics WHERE name=$1", [name])).rows).toEqual([{ name }]);
    await page.reload();
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
    await expect(topicRow(page, name)).toBeVisible();
    expect(openedAlert).toBe(false);
  } finally { await cleanup(client, suffix); await client.end(); }
});

test("kategori yang direferensikan foreign key pembatas tidak dapat dihapus", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const name = `Referensi Topik ${suffix}`;
  // Nama tabel hanya berasal dari hex acak dan dipakai dalam database uji.
  const referenceTable = `e2e_topic_reference_${suffix}`;
  const client = testDatabase(); await client.connect();
  let referenceTableCreated = false;
  try {
    const id = (await client.query<{ id: string }>("INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id", [name])).rows[0].id;
    await client.query(`CREATE TABLE "${referenceTable}" (topic_id bigint NOT NULL REFERENCES question_topics(id) ON DELETE RESTRICT)`);
    referenceTableCreated = true;
    await client.query(`INSERT INTO "${referenceTable}" (topic_id) VALUES($1)`, [id]);
    await expect(client.query("DELETE FROM question_topics WHERE id=$1", [id])).rejects.toMatchObject({
      code: expect.stringMatching(/^(23503|23001)$/), constraint: `${referenceTable}_topic_id_fkey`,
    });
    await loginAsAdmin(page); await page.goto("/data-modul/topik");
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
    const confirmation = await openDelete(page, name);
    await confirmation.getByRole("button", { name: "Ya, hapus topik" }).click();
    await expect(confirmation.getByRole("alert")).toContainText("masih digunakan oleh data lain");
    expect((await client.query("SELECT 1 FROM question_topics WHERE id=$1", [id])).rowCount).toBe(1);
    expect((await client.query(`SELECT 1 FROM "${referenceTable}" WHERE topic_id=$1`, [id])).rowCount).toBe(1);
    await client.query(`DELETE FROM "${referenceTable}" WHERE topic_id=$1`, [id]);
    await confirmation.getByRole("button", { name: "Ya, hapus topik" }).click();
    await expect(confirmation).toBeHidden();
    await expect(topicRow(page, name)).toHaveCount(0);
    expect((await client.query("SELECT 1 FROM question_topics WHERE id=$1", [id])).rowCount).toBe(0);
  } finally {
    if (referenceTableCreated) await client.query(`DROP TABLE "${referenceTable}"`);
    await cleanup(client, suffix); await client.end();
  }
});

test("tambah, ubah, dan hapus menolak sesi admin yang dicabut", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = randomBytes(5).toString("hex");
  const name = `Sesi Topik ${suffix}`;
  const attempted = `Ditolak Topik ${suffix}`;
  const client = testDatabase(); await client.connect();
  try {
    const id = (await client.query<{ id: string }>("INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id", [name])).rows[0].id;
    for (const operation of ["create", "update", "delete"] as const) {
      await loginAsAdmin(page); await page.goto("/data-modul/topik");
      await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
      const dialog = operation === "delete" ? await openDelete(page, name) : await openEditor(page, operation === "update" ? name : undefined);
      if (operation !== "delete") await dialog.getByLabel("Nama topik / mata pelajaran").fill(attempted);
      await revokeCurrentSession(page, client);
      const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === "/data-modul/topik");
      await dialog.getByRole("button", { name: operation === "delete" ? "Ya, hapus topik" : "Simpan topik" }).click();
      await response;
      await expect(page).toHaveURL(/\/login$/);
      expect((await client.query("SELECT name FROM question_topics WHERE id=$1", [id])).rows).toEqual([{ name }]);
      expect((await client.query("SELECT 1 FROM question_topics WHERE name=$1", [attempted])).rowCount).toBe(0);
    }
  } finally { await cleanup(client, suffix); await client.end(); }
});

test("sesi yang kedaluwarsa saat menunggu transaksi membatalkan perubahan", async ({ page }) => {
  test.setTimeout(70_000);
  const suffix = randomBytes(5).toString("hex");
  const name = `Kedaluwarsa Topik ${suffix}`;
  const attempted = `Tidak Tersimpan ${suffix}`;
  const client = testDatabase(); await client.connect();
  const blocker = testDatabase(); await blocker.connect();
  try {
    const id = (await client.query<{ id: string }>("INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id", [name])).rows[0].id;
    await loginAsAdmin(page); await page.goto("/data-modul/topik");
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
    const editor = await openEditor(page, name);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(attempted);
    const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
    if (!cookie) throw new Error("Cookie sesi tes tidak ditemukan.");
    const digest = createHash("sha256").update(cookie.value).digest("hex");
    await client.query("UPDATE admin_sessions SET expires_at=clock_timestamp() + interval '8 seconds' WHERE token_hash=$1", [digest]);
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM question_topics WHERE id=$1 FOR UPDATE", [id]);
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect.poll(async () => (await client.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid <> pg_backend_pid()
       AND wait_event_type='Lock' AND query LIKE '%UPDATE question_topics SET name%') AS waiting`,
    )).rows[0].waiting, { timeout: 6_000 }).toBe(true);
    await expect.poll(async () => (await client.query<{ expired: boolean }>(
      "SELECT expires_at <= clock_timestamp() AS expired FROM admin_sessions WHERE token_hash=$1", [digest],
    )).rows[0]?.expired, { timeout: 12_000 }).toBe(true);
    await blocker.query("COMMIT");
    await expect(editor.getByRole("alert")).toContainText("Sesi admin sudah berakhir");
    expect((await client.query("SELECT name FROM question_topics WHERE id=$1", [id])).rows).toEqual([{ name }]);
    expect((await client.query("SELECT 1 FROM question_topics WHERE name=$1", [attempted])).rowCount).toBe(0);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); await blocker.end();
    await cleanup(client, suffix); await client.end();
  }
});

test("pencarian dan paginasi bekerja pada daftar lebih dari satu halaman", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const prefix = `Daftar ${suffix}`;
  const names = Array.from({ length: 25 }, (_, index) => `${prefix} ${String(index + 1).padStart(2, "0")}`);
  const client = testDatabase(); await client.connect();
  try {
    await client.query("INSERT INTO question_topics(name) SELECT unnest($1::text[])", [names]);
    await loginAsAdmin(page); await page.goto("/data-modul/topik");
    const search = page.getByLabel("Cari topik, mata pelajaran, atau tag");
    await search.fill(prefix.toUpperCase());
    await expect(page.getByText("25 kategori ditemukan")).toBeVisible();
    await expect(page.getByText("Halaman 1 dari 3 · 25 kategori")).toBeVisible();
    await expect(topicRow(page, names[0])).toBeVisible();
    await expect(topicRow(page, names[12])).toHaveCount(0);
    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    await expect(page.getByText("Halaman 2 dari 3 · 25 kategori")).toBeVisible();
    await expect(topicRow(page, names[12])).toBeVisible();
    await page.getByRole("button", { name: "Halaman berikutnya" }).click();
    await expect(page.getByText("Halaman 3 dari 3 · 25 kategori")).toBeVisible();
    const confirmation = await openDelete(page, names[24]);
    await confirmation.getByRole("button", { name: "Ya, hapus topik" }).click();
    await expect(confirmation).toBeHidden();
    await expect(page.getByText("Halaman 2 dari 2 · 24 kategori")).toBeVisible();
    await expect(topicRow(page, names[23])).toBeVisible();
    await page.getByRole("button", { name: "Halaman sebelumnya" }).click();
    await expect(topicRow(page, names[0])).toBeVisible();
    await search.fill(`${prefix} 25`);
    await expect(page.getByText("Topik tidak ditemukan")).toBeVisible();
    await search.fill("%_");
    await expect(page.getByText("Topik tidak ditemukan")).toBeVisible();
  } finally { await cleanup(client, suffix); await client.end(); }
});

test.describe("topik pada layar kecil", () => {
  test.use({ viewport: { width: 390, height: 640 } });

  test("navigasi, mode gelap, nama panjang, dan dialog pendek tanpa overflow", async ({ page }) => {
    const suffix = randomBytes(5).toString("hex");
    const name = `Topik${suffix}${"P".repeat(85)}`;
    const client = testDatabase(); await client.connect();
    try {
      await client.query("INSERT INTO question_topics(name) VALUES($1)", [name]);
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Ganti tema" }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await page.getByRole("button", { name: "Buka atau tutup sidebar" }).click();
      const sidebar = page.getByRole("dialog");
      await sidebar.getByRole("button", { name: "Data Modul", exact: true }).click();
      await sidebar.getByRole("link", { name: "Topik / Mata Pelajaran", exact: true }).click();
      await expect(page).toHaveURL(/\/data-modul\/topik$/);
      await expect(sidebar).toBeHidden();
      await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(suffix);
      await expect(topicRow(page, name)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 360, height: 320 });
      const editor = await openEditor(page, name);
      await expect.poll(async () => {
        const box = await editor.boundingBox();
        return Boolean(box && box.y >= 0 && box.y + box.height <= 320);
      }).toBe(true);
      await editor.getByRole("button", { name: "Batal" }).scrollIntoViewIfNeeded();
      await expect(editor.getByRole("button", { name: "Batal" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await editor.getByRole("button", { name: "Batal" }).click();
      await expect(editor).toBeHidden();
    } finally { await cleanup(client, suffix); await client.end(); }
  });
});

test("nama mata pelajaran sama boleh dibuat dengan tag berbeda, sedangkan kombinasi nama dan tag identik ditolak", async ({ page }) => {
  const suffix = randomBytes(5).toString("hex");
  const subjectName = `Matematika Tag ${suffix}`;
  const tagX = `Kelas X ${suffix}`;
  const tagXI = `Kelas XI ${suffix}`;
  const client = testDatabase();
  await client.connect();
  try {
    await loginAsAdmin(page);
    await page.goto("/data-modul/topik");

    // 1. Buat topik pertama: nama + tag Kelas X + Ganjil
    let editor = await openEditor(page);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(subjectName);
    await editor.getByLabel("Tag pengelompokan (opsional)").fill(`${tagX}, Ganjil`);
    await editor.getByRole("button", { name: "Tambah tag" }).click();
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor).toBeHidden();

    // 2. Buat topik kedua dengan nama yang SAMA persis tetapi tag berbeda (Kelas XI) -> BERHASIL
    editor = await openEditor(page);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(subjectName);
    await editor.getByLabel("Tag pengelompokan (opsional)").fill(tagXI);
    await editor.getByRole("button", { name: "Tambah tag" }).click();
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor).toBeHidden();

    const stored = await client.query<{ id: string; tags: string[]; tags_signature: string }>(
      "SELECT id::text AS id, tags, tags_signature FROM question_topics WHERE name = $1 ORDER BY id",
      [subjectName],
    );
    expect(stored.rows).toHaveLength(2);

    // 3. Buat topik dengan nama dan kombinasi tag sama (beda urutan & kapitalisasi) -> DITOLAK
    editor = await openEditor(page);
    await editor.getByLabel("Nama topik / mata pelajaran").fill(subjectName.toLowerCase());
    await editor.getByLabel("Tag pengelompokan (opsional)").fill(`GANJIL, ${tagX.toLowerCase()}`);
    await editor.getByRole("button", { name: "Tambah tag" }).click();
    await editor.getByRole("button", { name: "Simpan topik" }).click();
    await expect(editor.getByRole("alert")).toContainText("sudah digunakan");
    await editor.getByRole("button", { name: "Batal" }).click();

    // 4. Filter tag & pencarian berdasarkan tag bekerja akurat di /data-modul/topik
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill(tagXI);
    await expect(page.getByText("1 kategori ditemukan")).toBeVisible();
    await expect(topicRow(page, subjectName)).toHaveCount(1);
    await expect(topicRow(page, subjectName)).toContainText(tagXI);
    await page.getByLabel("Cari topik, mata pelajaran, atau tag").fill("");
    await page.locator("[aria-label='Filter menurut tag']")
      .getByRole("button", { name: tagX, exact: true })
      .click();
    await expect(page.getByText("1 kategori ditemukan")).toBeVisible();
    await expect(topicRow(page, subjectName)).toHaveCount(1);
    await expect(topicRow(page, subjectName)).toContainText(tagX);

    // 5. SearchableCombobox di /data-modul/soal membedakan kedua topik dan mendukung pencarian tag
    await page.goto("/data-modul/soal");
    const combo = page.getByLabel("Filter kategori");
    const listId = await combo.getAttribute("aria-controls");
    await combo.click();
    const listbox = page.locator(`[id="${listId}"]`);
    await expect(listbox).toBeVisible();
    await page.getByPlaceholder("Cari nama mata pelajaran atau tag...").fill(tagXI);
    await expect(listbox.getByRole("option")).toHaveCount(1);
    await expect(listbox.getByRole("option").first()).toContainText(subjectName);
    await expect(listbox.getByRole("option").first()).toContainText(tagXI);
  } finally {
    await cleanup(client, suffix);
    await client.end();
  }
});
