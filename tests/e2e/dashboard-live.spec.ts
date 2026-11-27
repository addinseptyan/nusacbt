import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

import { postgresConfig } from "../../src/lib/postgres-config.mjs";
import { loginAsAdmin } from "./helpers";

function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") {
    throw new Error("Tes yang mengubah database hanya boleh memakai PGDATABASE=nusacbt_test.");
  }
  return new pg.Client(postgresConfig());
}

test("dashboard membaca ringkasan langsung dari PostgreSQL dan menampilkan kesiapan sistem", async ({ page }) => {
  const tag = randomBytes(4).toString("hex");
  const client = testDatabase();
  await client.connect();
  let topicId = "";
  let studentId = "";

  try {
    const topicRes = await client.query<{ id: string }>(
      "INSERT INTO question_topics (name) VALUES ($1) RETURNING id::text AS id",
      [`Topik Dashboard ${tag}`],
    );
    topicId = topicRes.rows[0].id;
    await client.query(
      `INSERT INTO question_bank (topic_id, prompt_text, option_a_text, option_b_text, option_c_text, option_d_text, option_e_text, correct_option)
       VALUES ($1, 'Soal dash', 'A', 'B', 'C', 'D', 'E', 'A')`,
      [topicId],
    );
    const studentRes = await client.query<{ id: string }>(
      "INSERT INTO school_students (name, nisn) VALUES ($1, $2) RETURNING id::text AS id",
      [`Siswa Dash ${tag}`, `99${Math.floor(10000000 + Math.random() * 89999999)}`],
    );
    studentId = studentRes.rows[0].id;

    await loginAsAdmin(page);
    await page.goto("/");

    await expect(page.getByText("TERHUBUNG", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kesiapan ujian" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Jadwal pelaksanaan berlangsung & mendatang" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pengaturan aplikasi" })).toHaveAttribute("href", "/pengaturan/aplikasi");

    // Jumlah bank soal dan siswa minimal 1 dari fixture nyata
    await expect(page.getByText("Bank soal", { exact: true })).toBeVisible();
    await expect(page.getByText("Peserta terdaftar", { exact: true })).toBeVisible();
    await expect(page.getByText("1 soal pada 1 mata pelajaran tersedia; mendukung impor dan ekspor Word (.docx).")).toBeVisible();
  } finally {
    if (topicId) {
      await client.query("DELETE FROM question_bank WHERE topic_id = $1", [topicId]);
      await client.query("DELETE FROM question_topics WHERE id = $1", [topicId]);
    }
    if (studentId) await client.query("DELETE FROM school_students WHERE id = $1", [studentId]);
    await client.end();
  }
});
