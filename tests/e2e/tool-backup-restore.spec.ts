import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";

import { hashPassword } from "../../src/lib/password.mjs";
import {
  cleanupAttemptFixture,
  PIXEL_PNG,
  seedAttemptFixture,
  seedAttemptToken,
  startWithToken,
} from "./exam-attempt-helpers";
import { loginAsAdmin } from "./helpers";
import { loginParticipant, loginTestDatabase, resetLoginGlobal } from "./participant-login-helpers";

test.describe("Tool Backup & Pemulihan Database", () => {
  test("RBAC, header keamanan privat, dan penolakan lintas-origin pada /tool/backup dan /tool/pemulihan", async ({
    page,
    browser,
  }) => {
    const client = loginTestDatabase();
    await client.connect();
    const tag = randomBytes(4).toString("hex");
    let noToolRoleId: string | null = null;
    let toolRoleId: string | null = null;
    let noToolUserId: string | null = null;
    let toolUserId: string | null = null;

    const opPassword = `OpTool-Uji-${tag}!123`;
    const noToolUsername = `op_notool_${tag}`;
    const toolUsername = `op_tool_${tag}`;

    try {
      const hash = await hashPassword(opPassword);

      noToolRoleId = (
        await client.query<{ id: string }>(
          "INSERT INTO admin_roles(slug, name, description, is_system) VALUES($1, $2, 'Tanpa izin tools', false) RETURNING id::text AS id",
          [`notool_${tag}`, `Role Tanpa Tool ${tag}`],
        )
      ).rows[0].id;
      await client.query(
        "INSERT INTO admin_role_permissions(role_id, permission_key) VALUES($1::bigint, 'topics.manage')",
        [noToolRoleId],
      );
      noToolUserId = (
        await client.query<{ id: string }>(
          "INSERT INTO admin_users(username, full_name, password_hash, is_superuser, is_active, role_id) VALUES($1, 'Operator Tanpa Tool', $2, false, true, $3::bigint) RETURNING id::text AS id",
          [noToolUsername, hash, noToolRoleId],
        )
      ).rows[0].id;

      toolRoleId = (
        await client.query<{ id: string }>(
          "INSERT INTO admin_roles(slug, name, description, is_system) VALUES($1, $2, 'Dengan izin tools', false) RETURNING id::text AS id",
          [`withtool_${tag}`, `Role Tool ${tag}`],
        )
      ).rows[0].id;
      await client.query(
        "INSERT INTO admin_role_permissions(role_id, permission_key) VALUES($1::bigint, 'tools.manage')",
        [toolRoleId],
      );
      toolUserId = (
        await client.query<{ id: string }>(
          "INSERT INTO admin_users(username, full_name, password_hash, is_superuser, is_active, role_id) VALUES($1, 'Operator Tool', $2, false, true, $3::bigint) RETURNING id::text AS id",
          [toolUsername, hash, toolRoleId],
        )
      ).rows[0].id;

      // 1. Belum login -> redirect /login
      await page.goto("/tool/backup");
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/tool/pemulihan");
      await expect(page).toHaveURL(/\/login$/);

      // 2. Superadmin melihat menu Tool, header privat, & dapat mengakses halaman
      await loginAsAdmin(page);
      await page.getByRole("button", { name: "Tool", exact: true }).click();
      await expect(page.getByRole("link", { name: "Backup Database" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Upload Database" })).toBeVisible();

      const backupPageRes = await page.goto("/tool/backup");
      expect(backupPageRes?.headers()["cache-control"]).toContain("no-store");
      expect(backupPageRes?.headers()["referrer-policy"]).toBe("no-referrer");
      expect(backupPageRes?.headers()["x-robots-tag"]).toContain("noindex");
      await expect(page.getByRole("heading", { name: "Backup Database" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Unduh backup database (.zip)" })).toBeVisible();

      const restorePageRes = await page.goto("/tool/pemulihan");
      expect(restorePageRes?.headers()["cache-control"]).toContain("no-store");
      await expect(page.getByRole("heading", { name: "Upload Database" })).toBeVisible();

      // Uji tampilan mobile tanpa horizontal overflow pada /tool/backup dan /tool/pemulihan
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/tool/backup");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.goto("/tool/pemulihan");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 1280, height: 720 });

      // Permintaan lintas origin ditolak 403
      const alienDownload = await page.request.post("/tool/backup/unduh", {
        headers: {
          origin: "https://attacker.invalid",
          "content-type": "application/json",
          "x-nusacbt-export": "1",
        },
        data: {},
        failOnStatusCode: false,
      });
      expect(alienDownload.status()).toBe(403);

      // 3. Operator tanpa tools.manage -> 403 di UI & endpoint API
      const ctxNoTool = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" });
      try {
        const opNoToolPage = await ctxNoTool.newPage();
        await opNoToolPage.goto("/login");
        await opNoToolPage.getByLabel("Username admin").fill(noToolUsername);
        await opNoToolPage.getByLabel("Kata sandi").fill(opPassword);
        await opNoToolPage.getByRole("button", { name: "Masuk ke panel admin" }).click();
        await expect(opNoToolPage).toHaveURL(/\/$/);

        await opNoToolPage.goto("/tool/backup");
        await expect(opNoToolPage.getByText("403 · Akses dibatasi")).toBeVisible();
        await opNoToolPage.goto("/tool/pemulihan");
        await expect(opNoToolPage.getByText("403 · Akses dibatasi")).toBeVisible();

        const noPermDownload = await opNoToolPage.request.post("/tool/backup/unduh", {
          headers: {
            origin: "http://127.0.0.1:3100",
            "content-type": "application/json",
            "x-nusacbt-export": "1",
          },
          data: {},
          failOnStatusCode: false,
        });
        expect(noPermDownload.status()).toBe(403);

        const noPermPreview = await opNoToolPage.request.post("/tool/pemulihan/pratinjau", {
          headers: {
            origin: "http://127.0.0.1:3100",
            "x-nusacbt-tool": "1",
          },
          multipart: {
            file: { name: "dummy.zip", mimeType: "application/zip", buffer: Buffer.from("PK") },
          },
          failOnStatusCode: false,
        });
        expect(noPermPreview.status()).toBe(403);
      } finally {
        await ctxNoTool.close();
      }

      // 4. Operator dengan tools.manage dapat membuka halaman Backup & Pemulihan
      const ctxTool = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" });
      try {
        const opToolPage = await ctxTool.newPage();
        await opToolPage.goto("/login");
        await opToolPage.getByLabel("Username admin").fill(toolUsername);
        await opToolPage.getByLabel("Kata sandi").fill(opPassword);
        await opToolPage.getByRole("button", { name: "Masuk ke panel admin" }).click();
        await expect(opToolPage).toHaveURL(/\/$/);

        await opToolPage.goto("/tool/backup");
        await expect(opToolPage.getByRole("button", { name: "Unduh backup database (.zip)" })).toBeVisible();
        await opToolPage.goto("/tool/pemulihan");
        await expect(opToolPage.getByRole("button", { name: "Periksa pratinjau cadangan" })).toBeDisabled();
      } finally {
        await ctxTool.close();
      }
    } finally {
      if (noToolUserId) {
        await client.query("DELETE FROM admin_sessions WHERE admin_id = $1::bigint", [noToolUserId]);
        await client.query("DELETE FROM admin_users WHERE id = $1::bigint", [noToolUserId]);
      }
      if (toolUserId) {
        await client.query("DELETE FROM admin_sessions WHERE admin_id = $1::bigint", [toolUserId]);
        await client.query("DELETE FROM admin_users WHERE id = $1::bigint", [toolUserId]);
      }
      if (noToolRoleId) {
        await client.query("DELETE FROM admin_role_permissions WHERE role_id = $1::bigint", [noToolRoleId]);
        await client.query("DELETE FROM admin_roles WHERE id = $1::bigint", [noToolRoleId]);
      }
      if (toolRoleId) {
        await client.query("DELETE FROM admin_role_permissions WHERE role_id = $1::bigint", [toolRoleId]);
        await client.query("DELETE FROM admin_roles WHERE id = $1::bigint", [toolRoleId]);
      }
      await client.end();
    }
  });

  test("backup .zip menjaga data dan gambar, menolak arsip yang diubah, dan pemulihan mengembalikan state + sequence secara atomik", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const client = loginTestDatabase();
    await client.connect();
    const tag = randomBytes(4).toString("hex");
    const preTopicName = `Topik Pra-Backup ${tag}`;
    const postTopicName = `Topik Pasca-Backup ${tag}`;
    const seqCheckTopicName = `Topik Sequence ${tag}`;

    let preTopicId: string | null = null;
    let preQuestionId: string | null = null;
    let originalSchoolName: string | null = null;

    try {
      const appRow = (await client.query<{ school_name: string }>("SELECT school_name FROM app_settings WHERE id = 1")).rows[0];
      originalSchoolName = appRow?.school_name ?? "";
      const preSchoolName = `SMA Cadangan ${tag}`;
      await client.query("UPDATE app_settings SET school_name = $1, revision = revision + 1 WHERE id = 1", [preSchoolName]);

      preTopicId = (
        await client.query<{ id: string }>(
          "INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id",
          [preTopicName],
        )
      ).rows[0].id;
      preQuestionId = (
        await client.query<{ id: string }>(
          `INSERT INTO question_bank(topic_id, prompt_text, prompt_image, prompt_image_mime, option_a_text, option_b_text, option_c_text, option_d_text, option_e_text, correct_option)
           VALUES($1::bigint, $2, $3, 'image/png', 'A', 'B', 'C', 'D', 'E', 'A') RETURNING id::text AS id`,
          [preTopicId, `Soal gambar cadangan ${tag}`, PIXEL_PNG],
        )
      ).rows[0].id;

      await loginAsAdmin(page);
      await page.goto("/tool/backup");

      // 1. Unduh arsip .zip backup
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Unduh backup database (.zip)" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^backup-nusacbt-\d{8}-\d{6}\.zip$/);
      expect(await download.failure()).toBeNull();

      const archiveStream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of archiveStream) chunks.push(Buffer.from(chunk));
      const archiveBytes = Buffer.concat(chunks);
      const zipContents = unzipSync(archiveBytes);

      expect(zipContents["manifest.json"]).toBeDefined();
      const manifest = JSON.parse(new TextDecoder("utf-8").decode(zipContents["manifest.json"]));
      expect(manifest.format).toBe("nusacbt-backup-v1");
      expect(manifest.summary.blobCount).toBeGreaterThanOrEqual(1);

      await expect(page.getByText("Cadangan siap disimpan")).toBeVisible();

      // 2. Uji penolakan arsip yang diubah (checksum SHA-256 tidak cocok)
      const tamperedEntries = { ...zipContents };
      tamperedEntries["tables/question_topics.json"] = Buffer.from(
        new TextDecoder("utf-8").decode(zipContents["tables/question_topics.json"]).replace(preTopicName, `Rusak ${tag}`),
        "utf8",
      );
      const tamperedZip = Buffer.from(zipSync(tamperedEntries));

      await page.goto("/tool/pemulihan");
      await page.locator("#backup-archive-input").setInputFiles({
        name: "cadangan-rusak.zip",
        mimeType: "application/zip",
        buffer: tamperedZip,
      });
      await page.getByRole("button", { name: "Periksa pratinjau cadangan" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /SHA-256/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Pulihkan database/ })).toHaveCount(0);

      // 3. Mutasi DB setelah backup: hapus soal pra-backup, tambah topik pasca-backup, ubah nama sekolah
      await client.query("DELETE FROM question_bank WHERE id = $1::bigint", [preQuestionId]);
      await client.query("INSERT INTO question_topics(name) VALUES($1)", [postTopicName]);
      await client.query("UPDATE app_settings SET school_name = $1, revision = revision + 1 WHERE id = 1", [`SMA Mutasi ${tag}`]);

      // 4. Unggah arsip valid -> Pratinjau -> Konfirmasi PULIHKAN -> Pulihkan!
      await page.locator("#backup-archive-input").setInputFiles({
        name: download.suggestedFilename(),
        mimeType: "application/zip",
        buffer: archiveBytes,
      });
      await page.getByRole("button", { name: "Periksa pratinjau cadangan" }).click();

      await expect(page.getByText("Siap dipulihkan")).toBeVisible();
      await expect(page.getByText(/Skema cocok persis/)).toBeVisible();

      await page.getByRole("button", { name: /Pulihkan database/ }).click();
      const dialog = page.getByRole("dialog", { name: "Konfirmasi pemulihan database" });
      await expect(dialog).toBeVisible();

      const confirmBtn = dialog.getByRole("button", { name: "Ya, pulihkan database" });
      await expect(confirmBtn).toBeDisabled();
      await dialog.getByLabel(/Ketik/).fill("pulihkan");
      await expect(confirmBtn).toBeDisabled();
      await dialog.getByLabel(/Ketik/).fill("PULIHKAN");
      await expect(confirmBtn).toBeEnabled();

      await confirmBtn.click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page.getByText("Pemulihan berhasil")).toBeVisible({ timeout: 20_000 });

      // 5. Verifikasi isi database persis kembali ke kondisi sebelum mutasi
      const postTopicCheck = await client.query("SELECT 1 FROM question_topics WHERE name = $1", [postTopicName]);
      expect(postTopicCheck.rowCount).toBe(0);

      const restoredQuestion = (
        await client.query<{ prompt_text: string; prompt_image: Buffer }>(
          "SELECT prompt_text, prompt_image FROM question_bank WHERE id = $1::bigint",
          [preQuestionId],
        )
      ).rows[0];
      expect(restoredQuestion).toBeTruthy();
      expect(restoredQuestion.prompt_text).toBe(`Soal gambar cadangan ${tag}`);
      expect(restoredQuestion.prompt_image.equals(PIXEL_PNG)).toBe(true);

      const restoredSchool = (await client.query<{ school_name: string }>("SELECT school_name FROM app_settings WHERE id = 1")).rows[0];
      expect(restoredSchool.school_name).toBe(preSchoolName);

      // Sequence tetap terjaga setelah pemulihan (insert baru langsung berjalan mulus)
      const seqInsert = await client.query<{ id: string }>(
        "INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id",
        [seqCheckTopicName],
      );
      expect(Number(seqInsert.rows[0].id)).toBeGreaterThan(Number(preTopicId));

      // Audit restore tercatat
      const auditRes = await client.query<{ action: string }>(
        "SELECT action FROM database_backup_audit ORDER BY id DESC LIMIT 1",
      );
      expect(auditRes.rows[0]?.action).toBe("restore");
    } finally {
      await client.query("DELETE FROM question_bank WHERE id = $1::bigint", [preQuestionId]).catch(() => {});
      await client
        .query("DELETE FROM question_topics WHERE name = ANY($1::text[])", [[preTopicName, postTopicName, seqCheckTopicName]])
        .catch(() => {});
      await client.query("DELETE FROM database_backup_audit WHERE detail LIKE '%Cadangan%' OR detail LIKE '%Pemulihan%'").catch(() => {});
      if (originalSchoolName !== null) {
        await client.query("UPDATE app_settings SET school_name = $1, revision = revision + 1 WHERE id = 1", [originalSchoolName]).catch(() => {});
      }
      await client.end();
    }
  });

  test("pemulihan diblokir saat masih ada pengerjaan ujian yang berlangsung", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const client = loginTestDatabase();
    await client.connect();
    await resetLoginGlobal(client);
    const f = await seedAttemptFixture(client, 0);
    const studentCtx = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" });

    try {
      await seedAttemptToken(client, f, "global", "778899");
      const studentPage = await studentCtx.newPage();
      await loginParticipant(studentPage, f.login.username, f.login.passwordA);
      await startWithToken(studentPage, f.runId, "778899");

      await loginAsAdmin(page);
      await page.goto("/tool/backup");
      await expect(page.getByText("Sedang ada ujian berlangsung")).toBeVisible();

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Unduh backup database (.zip)" }).click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.from(c));
      const archiveBytes = Buffer.concat(chunks);

      const manifest = JSON.parse(new TextDecoder("utf-8").decode(unzipSync(archiveBytes)["manifest.json"]));
      expect(manifest.format).toBe("nusacbt-backup-v1");

      await page.goto("/tool/pemulihan");
      await expect(page.getByText("Pemulihan diblokir saat ujian berlangsung")).toBeVisible();

      await page.locator("#backup-archive-input").setInputFiles({
        name: download.suggestedFilename(),
        mimeType: "application/zip",
        buffer: archiveBytes,
      });
      await page.getByRole("button", { name: "Periksa pratinjau cadangan" }).click();

      await expect(page.getByText("Tidak dapat dipulihkan")).toBeVisible();
      await expect(page.getByRole("button", { name: /Pulihkan database/ })).toBeDisabled();

      // Panggilan API langsung juga harus ditolak HTTP 409
      const { createHash } = await import("node:crypto");
      const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
      const blockedRes = await page.request.post("/tool/pemulihan/jalankan", {
        headers: {
          origin: "http://127.0.0.1:3100",
          "x-nusacbt-tool": "1",
        },
        multipart: {
          file: { name: download.suggestedFilename(), mimeType: "application/zip", buffer: archiveBytes },
          expectedArchiveSha256: sha256,
          confirmPhrase: "PULIHKAN",
        },
        failOnStatusCode: false,
      });
      expect(blockedRes.status()).toBe(409);
      const blockedJson = await blockedRes.json();
      expect(blockedJson.error).toContain("pengerjaan ujian aktif");
    } finally {
      await studentCtx.close();
      await cleanupAttemptFixture(client, f);
      await client.query("DELETE FROM database_backup_audit WHERE detail LIKE '%Cadangan%' OR detail LIKE '%Pemulihan%'").catch(() => {});
      await client.end();
    }
  });

  test("pemulihan memulihkan snapshot pengerjaan + gambar + siklus FK admin_roles, membersihkan sesi peserta, dan mengarahkan ke /login bila sesi tidak ada di cadangan", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const client = loginTestDatabase();
    await client.connect();
    await resetLoginGlobal(client);
    const f = await seedAttemptFixture(client, 0);
    const tag = randomBytes(4).toString("hex");
    let customRoleId: string | null = null;
    const studentCtx = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" });

    try {
      // Buat role dengan updated_by mengacu pada admin_users (menguji siklus FK 2 fase admin_roles <-> admin_users)
      const adminRow = (
        await client.query<{ id: string }>("SELECT id::text AS id FROM admin_users WHERE username = $1", [
          process.env.TEST_ADMIN_USERNAME,
        ])
      ).rows[0];
      customRoleId = (
        await client.query<{ id: string }>(
          "INSERT INTO admin_roles(slug, name, description, is_system, updated_by) VALUES($1, $2, 'Uji siklus FK', false, $3::bigint) RETURNING id::text AS id",
          [`siklus_${tag}`, `Role Siklus ${tag}`, adminRow.id],
        )
      ).rows[0].id;

      // Mulai pengerjaan peserta (membuat snapshot, snapshot image, participant_session), lalu selesaikan agar tidak memblokir restore
      await seedAttemptToken(client, f, "global", "445566");
      const studentPage = await studentCtx.newPage();
      await loginParticipant(studentPage, f.login.username, f.login.passwordA);
      const attemptId = await startWithToken(studentPage, f.runId, "445566");
      await client.query(
        "UPDATE exam_attempts SET completed_at = clock_timestamp(), completion_reason = 'submitted', correct_count = 0, answered_count = 0 WHERE id = $1::bigint",
        [attemptId],
      );

      // Login sesi admin #1 dan buat backup
      await loginAsAdmin(page);
      await page.goto("/tool/backup");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Unduh backup database (.zip)" }).click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.from(c));
      const archiveBytes = Buffer.concat(chunks);

      // Buka sesi admin #2 yang BELUM ada di cadangan (karena dibuat setelah backup)
      const freshAdminCtx = await browser.newContext({ baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100" });
      try {
        const freshAdminPage = await freshAdminCtx.newPage();
        await loginAsAdmin(freshAdminPage);

        await freshAdminPage.goto("/tool/pemulihan");
        await freshAdminPage.locator("#backup-archive-input").setInputFiles({
          name: download.suggestedFilename(),
          mimeType: "application/zip",
          buffer: archiveBytes,
        });
        await freshAdminPage.getByRole("button", { name: "Periksa pratinjau cadangan" }).click();
        await expect(freshAdminPage.getByText("Siap dipulihkan")).toBeVisible();

        await freshAdminPage.getByRole("button", { name: /Pulihkan database/ }).click();
        const dialog = freshAdminPage.getByRole("dialog", { name: "Konfirmasi pemulihan database" });
        await dialog.getByLabel(/Ketik/).fill("PULIHKAN");
        await dialog.getByRole("button", { name: "Ya, pulihkan database" }).click();

        // Sesi #2 tidak ada di cadangan -> cookie dihapus & redirect ke /login?sesi=pemulihan
        await expect(freshAdminPage).toHaveURL(/\/login\?sesi=pemulihan$/, { timeout: 20_000 });
        await expect(freshAdminPage.getByText(/Pemulihan database selesai/)).toBeVisible();
      } finally {
        await freshAdminCtx.close();
      }

      // Verifikasi seluruh data sensitif pasca-restore
      const roleAfter = (
        await client.query<{ updated_by: string | null }>("SELECT updated_by::text AS updated_by FROM admin_roles WHERE id = $1::bigint", [
          customRoleId,
        ])
      ).rows[0];
      expect(roleAfter.updated_by).toBe(adminRow.id);

      const snapImgAfter = (
        await client.query<{ data: Buffer }>(
          `SELECT i.data FROM exam_question_snapshot_images i
           JOIN exam_attempt_questions q ON q.snapshot_id = i.snapshot_id
           WHERE q.attempt_id = $1::bigint AND i.slot = 'prompt'`,
          [attemptId],
        )
      ).rows[0];
      expect(snapImgAfter.data.equals(PIXEL_PNG)).toBe(true);

      const sessionCount = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM participant_sessions")).rows[0].n;
      expect(sessionCount).toBe(0);
    } finally {
      await studentCtx.close();
      if (customRoleId) {
        await client.query("DELETE FROM admin_roles WHERE id = $1::bigint", [customRoleId]).catch(() => {});
      }
      await cleanupAttemptFixture(client, f);
      await client.query("DELETE FROM database_backup_audit WHERE detail LIKE '%Cadangan%' OR detail LIKE '%Pemulihan%'").catch(() => {});
      await client.end();
    }
  });
});
