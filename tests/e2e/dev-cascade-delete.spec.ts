import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

import { hashPassword } from "../../src/lib/password.mjs";
import { loginAsAdmin } from "./helpers";
import { cleanupAttemptFixture, seedAttemptFixture } from "./exam-attempt-helpers";
import { loginTestDatabase } from "./participant-login-helpers";

test.describe("Mode Dev dan penghapusan berdependensi", () => {
  test("tombol cascade hanya muncul di Mode Dev untuk Superadmin, blokir saat ujian aktif, dan hapus atomik jika aman", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const client = loginTestDatabase();
    await client.connect();
    const f = await seedAttemptFixture(client, 0);
    const suffix = randomBytes(4).toString("hex");
    const extraTopicName = `Cascade Topik ${suffix}`;
    const roleName = `Admin Topik ${suffix}`;
    const opUsername = `op_cascade_${suffix}`;
    const opPassword = "Sandi-Operator-Cascade-2026!";

    let extraTopicId = "";
    let extraQuestionId = "";
    let extraTestId = "";
    let activeAttemptId = "";
    let prevAppMode = "production";

    try {
      prevAppMode =
        (
          await client.query<{ app_mode: string }>(
            "SELECT app_mode FROM app_settings WHERE id = 1",
          )
        ).rows[0]?.app_mode ?? "production";

      // Siapkan topik + soal + tes rancangan draf (belum dimulai) untuk diuji hapus berantai
      extraTopicId = (
        await client.query<{ id: string }>(
          "INSERT INTO question_topics(name, tags) VALUES($1, ARRAY['DevTag']) RETURNING id::text AS id",
          [extraTopicName],
        )
      ).rows[0].id;
      extraQuestionId = (
        await client.query<{ id: string }>(
          `INSERT INTO question_bank(topic_id, prompt_text, option_a_text, option_b_text, option_c_text, option_d_text, option_e_text, correct_option)
           VALUES($1::bigint, $2, 'A', 'B', 'C', 'D', 'E', 'A') RETURNING id::text AS id`,
          [extraTopicId, `Soal Cascade ${suffix}`],
        )
      ).rows[0].id;
      extraTestId = (
        await client.query<{ id: string }>(
          `INSERT INTO exam_tests(period_id, name, starts_at, time_zone, duration_minutes)
           VALUES($1::bigint, $2, now() + interval '5 days', 'WIB', 60) RETURNING id::text AS id`,
          [f.login.periodA, `Tes Draft Cascade ${suffix}`],
        )
      ).rows[0].id;
      await client.query(
        "INSERT INTO exam_test_questions(exam_test_id, question_id, position) VALUES($1::bigint, $2::bigint, 1)",
        [extraTestId, extraQuestionId],
      );

      // Siapkan role + operator non-superadmin yang punya izin hapus topik
      const roleId = (
        await client.query<{ id: string }>(
          "INSERT INTO admin_roles(slug, name, description, is_system) VALUES($1, $2, 'Uji operator topik', false) RETURNING id::text AS id",
          [`op_topik_${suffix}`, roleName],
        )
      ).rows[0].id;
      await client.query(
        "INSERT INTO admin_role_permissions(role_id, permission_key) VALUES($1::bigint, 'topics.manage')",
        [roleId],
      );
      await client.query(
        `INSERT INTO admin_users(username, full_name, password_hash, role_id, is_superuser, is_active)
         VALUES($1, 'Operator Topik', $2, $3::bigint, false, true)`,
        [opUsername, await hashPassword(opPassword), roleId],
      );

      // Siapkan 1 pengerjaan peserta yang sedang berlangsung aktif pada f.login.activeTest
      activeAttemptId = (
        await client.query<{ id: string }>(
          `INSERT INTO exam_attempts(
             run_id, exam_test_id, period_id, kind, participant_identity_id, student_id,
             student_name_snapshot, participant_number_snapshot, class_name_snapshot,
             test_name_snapshot, run_label_snapshot, time_zone_snapshot,
             started_at, deadline, question_count
           )
           SELECT r.id, r.exam_test_id, r.period_id, r.kind, $2::bigint, $3::bigint,
             $4, i.participant_number, pl.class_name_snapshot,
             t.name, r.label, 'WIB',
             now() - interval '2 minutes', now() + interval '40 minutes', 1
           FROM exam_schedule_runs r
           JOIN exam_tests t ON t.id = r.exam_test_id
           JOIN participant_identities i ON i.id = $2::bigint
           JOIN student_class_placements pl ON pl.id = $5::bigint
           WHERE r.id = $1::bigint
           RETURNING id::text AS id`,
          [f.runId, f.login.identityA, f.login.studentA, f.login.studentAName, f.login.placementA],
        )
      ).rows[0].id;

      // 1. Dalam Mode Production, Superadmin TIDAK melihat tombol cascade delete
      await client.query("UPDATE app_settings SET app_mode = 'production', revision = revision + 1 WHERE id = 1");
      await loginAsAdmin(page);
      await page.goto("/data-modul/topik");
      await page.getByLabel("Cari mata pelajaran atau tag").fill(extraTopicName);
      await page.getByRole("button", { name: `Hapus mata pelajaran ${extraTopicName}`, exact: true }).click();
      let delDialog = page.getByRole("dialog", { name: "Hapus mata pelajaran?" });
      await expect(delDialog).toBeVisible();
      await expect(delDialog.getByRole("button", { name: "Hapus beserta dependensi (Mode Dev)" })).toHaveCount(0);
      await delDialog.getByRole("button", { name: "Batal" }).click();

      // 2. Aktifkan Mode Dev -> non-superadmin tetap TIDAK melihat tombol cascade delete
      await client.query("UPDATE app_settings SET app_mode = 'dev', revision = revision + 1 WHERE id = 1");
      const opCtx = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
      try {
        const opPage = await opCtx.newPage();
        await opPage.goto("/login");
        await opPage.getByLabel("Username admin").fill(opUsername);
        await opPage.getByLabel("Kata sandi").fill(opPassword);
        await opPage.getByRole("button", { name: "Masuk ke panel admin" }).click();
        await expect(opPage).toHaveURL(/\/$/);
        await opPage.goto("/data-modul/topik");
        await opPage.getByLabel("Cari mata pelajaran atau tag").fill(extraTopicName);
        await opPage.getByRole("button", { name: `Hapus mata pelajaran ${extraTopicName}`, exact: true }).click();
        const opDelDialog = opPage.getByRole("dialog", { name: "Hapus mata pelajaran?" });
        await expect(opDelDialog).toBeVisible();
        await expect(opDelDialog.getByRole("button", { name: "Hapus beserta dependensi (Mode Dev)" })).toHaveCount(0);
      } finally {
        await opCtx.close();
      }

      // 3. Superadmin di Mode Dev: blokir penghapusan periode yang punya ujian berlangsung aktif
      await page.goto("/data-peserta/periode");
      await page.getByRole("button", { name: `Hapus periode ${f.login.periodAName}`, exact: true }).click();
      const periodDeleteDialog = page.getByRole("dialog", { name: "Hapus periode?" });
      await expect(periodDeleteDialog.getByRole("button", { name: "Hapus beserta dependensi (Mode Dev)" })).toBeVisible();
      await periodDeleteDialog.getByRole("button", { name: "Hapus beserta dependensi (Mode Dev)" }).click();

      const blockedCascade = page.getByRole("dialog", { name: "Hapus beserta dependensi (Mode Dev)" });
      await expect(blockedCascade.getByText("Tidak dapat dihapus saat ujian aktif")).toBeVisible();
      await expect(blockedCascade.getByRole("button", { name: "Lanjutkan ke konfirmasi akhir" })).toHaveCount(0);
      await blockedCascade.getByRole("button", { name: "Batal" }).click();

      // 4. Superadmin di Mode Dev: cascade delete topik berdependensi (tanpa ujian aktif) berhasil dengan konfirmasi 2 tahap
      await page.goto("/data-modul/topik");
      await page.getByLabel("Cari mata pelajaran atau tag").fill(extraTopicName);
      await page.getByRole("button", { name: `Hapus mata pelajaran ${extraTopicName}`, exact: true }).click();
      delDialog = page.getByRole("dialog", { name: "Hapus mata pelajaran?" });
      await delDialog.getByRole("button", { name: "Hapus beserta dependensi (Mode Dev)" }).click();

      const cascadeDialog = page.getByRole("dialog", { name: "Hapus beserta dependensi (Mode Dev)" });
      await expect(cascadeDialog).toContainText("Konfirmasi Tahap 1 dari 2");
      await expect(cascadeDialog).toContainText("Soal pada bank soal");
      await cascadeDialog.getByRole("checkbox").check();
      await cascadeDialog.getByRole("button", { name: "Lanjutkan ke konfirmasi akhir" }).click();

      await expect(cascadeDialog).toContainText("Konfirmasi Tahap 2 dari 2");
      const confirmBtn = cascadeDialog.getByRole("button", { name: "Ya, hapus permanen semua" });
      await expect(confirmBtn).toBeDisabled();
      await cascadeDialog.getByLabel("Frasa konfirmasi").fill("salah");
      await expect(confirmBtn).toBeDisabled();
      await cascadeDialog.getByLabel("Frasa konfirmasi").fill("HAPUS PERMANEN");
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();

      await expect(cascadeDialog).toBeHidden();
      expect((await client.query("SELECT 1 FROM question_topics WHERE id = $1::bigint", [extraTopicId])).rowCount).toBe(0);
      expect((await client.query("SELECT 1 FROM question_bank WHERE id = $1::bigint", [extraQuestionId])).rowCount).toBe(0);
      expect((await client.query("SELECT 1 FROM exam_test_questions WHERE exam_test_id = $1::bigint", [extraTestId])).rowCount).toBe(0);

      // 5. Setelah ujian selesai (completed_at diisi), periode tersebut sekarang BOLEH dihapus cascade beserta seluruh riwayat attempt!
      await client.query(
        `UPDATE exam_attempts SET completed_at = now(), completion_reason = 'submitted', answered_count = 0, correct_count = 0 WHERE id = $1::bigint`,
        [activeAttemptId],
      );
      await page.goto("/data-peserta/periode");
      await page.getByRole("button", { name: `Hapus periode ${f.login.periodAName}`, exact: true }).click();
      await page.getByRole("dialog", { name: "Hapus periode?" }).getByRole("button", { name: "Hapus beserta dependensi (Mode Dev)" }).click();
      const periodCascade = page.getByRole("dialog", { name: "Hapus beserta dependensi (Mode Dev)" });
      await expect(periodCascade).toContainText("Riwayat pengerjaan & jawaban siswa");
      await periodCascade.getByRole("checkbox").check();
      await periodCascade.getByRole("button", { name: "Lanjutkan ke konfirmasi akhir" }).click();
      await periodCascade.getByLabel("Frasa konfirmasi").fill("HAPUS PERMANEN");
      await periodCascade.getByRole("button", { name: "Ya, hapus permanen semua" }).click();
      await expect(periodCascade).toBeHidden();
      expect((await client.query("SELECT 1 FROM exam_periods WHERE id = $1::bigint", [f.login.periodA])).rowCount).toBe(0);
      expect((await client.query("SELECT 1 FROM exam_attempts WHERE id = $1::bigint", [activeAttemptId])).rowCount).toBe(0);
    } finally {
      if (activeAttemptId) await client.query("DELETE FROM exam_attempts WHERE id = $1::bigint", [activeAttemptId]).catch(() => {});
      if (extraTestId) {
        await client.query("DELETE FROM exam_test_questions WHERE exam_test_id = $1::bigint", [extraTestId]).catch(() => {});
        await client.query("DELETE FROM exam_tests WHERE id = $1::bigint", [extraTestId]).catch(() => {});
      }
      if (extraQuestionId) await client.query("DELETE FROM question_bank WHERE id = $1::bigint", [extraQuestionId]).catch(() => {});
      if (extraTopicId) await client.query("DELETE FROM question_topics WHERE id = $1::bigint", [extraTopicId]).catch(() => {});
      await client.query("DELETE FROM admin_user_audit WHERE target_username_snapshot = $1 OR actor_username_snapshot = $1", [opUsername]).catch(() => {});
      await client.query("DELETE FROM admin_users WHERE username = $1", [opUsername]).catch(() => {});
      await client.query("DELETE FROM admin_roles WHERE name = $1", [roleName]).catch(() => {});
      await client.query("UPDATE app_settings SET app_mode = $1, revision = revision + 1 WHERE id = 1", [prevAppMode]).catch(() => {});
      await cleanupAttemptFixture(client, f);
      await client.end();
    }
  });
});
