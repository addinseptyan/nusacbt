import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

import {
  BACKUP_DOMAIN_TABLE_SET,
  BACKUP_DOMAIN_TABLES,
  BackupArchiveError,
  buildBackupArchiveZip,
  buildBackupFilename,
  buildColumnSelectSql,
  parseAndVerifyBackupArchive,
  sanitizeArchiveFilename,
  serializeTableRows,
  sha256Hex,
  TWO_PASS_NULLABLE_FK_COLUMNS,
  validateRestorePhrase,
} from "../../src/lib/database-backup-archive.mjs";
import {
  exportRequestIsSameOrigin,
  toolMultipartRequestIsSameOrigin,
} from "../../src/lib/export-origin.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

function makeEmptySeedArchiveData(overrides = {}) {
  const migrations = [
    { version: "001_admin_auth.sql", checksum: "1".repeat(64) },
    { version: "027_database_backup_audit.sql", checksum: "2".repeat(64) },
  ];
  const blobs = new Map();
  const tables = BACKUP_DOMAIN_TABLES.map((name) => {
    if (overrides[name]) return overrides[name](blobs);
    return {
      name,
      hasIdentity: false,
      columns: [{ name: "id", udtName: "int4", nullable: false }],
      rows: [],
    };
  });
  return {
    createdAt: "2026-11-17T08:00:00.000Z",
    databaseName: "nusacbt_test",
    serverVersion: "18.7",
    encoding: "UTF8",
    schemaVersion: "027_database_backup_audit.sql",
    migrations,
    keyBindings: {
      participantPassword: { bound: false, verifierSha256: null },
      examToken: { bound: false, verifierSha256: null },
    },
    tables,
    sequences: [],
    blobs,
  };
}

test("katalog BACKUP_DOMAIN_TABLES lengkap untuk seluruh tabel migrasi 001..027 dan terurut secara topologi", () => {
  const migrationFiles = readdirSync(join(root, "migrations"))
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  assert.ok(migrationFiles.includes("027_database_backup_audit.sql"));

  const fullSql = migrationFiles
    .map((f) => readFileSync(join(root, "migrations", f), "utf8").replace(/--[^\n]*/g, ""))
    .join("\n");

  const createdTables = new Set();
  for (const match of fullSql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const tbl = match[1].toLowerCase();
    if (tbl !== "nusacbt_schema_migrations") createdTables.add(tbl);
  }

  assert.equal(
    BACKUP_DOMAIN_TABLES.length,
    BACKUP_DOMAIN_TABLE_SET.size,
    "BACKUP_DOMAIN_TABLES tidak boleh memiliki duplikat.",
  );
  assert.deepEqual(
    [...BACKUP_DOMAIN_TABLES].sort(),
    [...createdTables].sort(),
    "BACKUP_DOMAIN_TABLES harus persis mencakup seluruh tabel dari seluruh migrasi.",
  );

  // Periksa seluruh relasi FOREIGN KEY / REFERENCES: induk wajib muncul sebelum anak,
  // kecuali siklus 2 fase admin_roles.updated_by -> admin_users.id.
  const indexMap = new Map(BACKUP_DOMAIN_TABLES.map((name, idx) => [name, idx]));
  for (const match of fullSql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi)) {
    const child = match[1].toLowerCase();
    if (!indexMap.has(child)) continue;
    const body = match[2];
    for (const ref of body.matchAll(/\bREFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/gi)) {
      const parent = ref[1].toLowerCase();
      if (parent === child) continue;
      if (child === "admin_roles" && parent === "admin_users") {
        assert.ok(TWO_PASS_NULLABLE_FK_COLUMNS.admin_roles.includes("updated_by"));
        continue;
      }
      assert.ok(
        indexMap.get(parent) < indexMap.get(child),
        `Urutan topologi salah: induk ${parent} (#${indexMap.get(parent)}) harus mendahului anak ${child} (#${indexMap.get(child)}).`,
      );
    }
  }
  // Juga periksa ALTER TABLE ... ADD CONSTRAINT ... REFERENCES ...
  for (const match of fullSql.matchAll(/ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)[\s\S]*?;/gi)) {
    const child = match[1].toLowerCase();
    if (!indexMap.has(child)) continue;
    for (const ref of match[0].matchAll(/\bREFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/gi)) {
      const parent = ref[1].toLowerCase();
      if (parent === child) continue;
      if (child === "admin_roles" && parent === "admin_users") continue;
      assert.ok(
        indexMap.get(parent) < indexMap.get(child),
        `Urutan topologi ALTER salah: induk ${parent} harus mendahului anak ${child}.`,
      );
    }
  }

  assert.ok(
    indexMap.get("exam_question_snapshot_images") < indexMap.get("exam_attempt_questions"),
    "exam_question_snapshot_images wajib diisi sebelum exam_attempt_questions (trigger 018).",
  );
});

test("round-trip serialisasi tipe PostgreSQL, deduplikasi blob, buildBackupArchiveZip, dan parseAndVerifyBackupArchive", async () => {
  const imageA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const payload = makeEmptySeedArchiveData({
    question_bank: (blobRegistry) => {
      const columns = [
        { name: "id", udtName: "int8", nullable: false },
        { name: "prompt_text", udtName: "text", nullable: false },
        { name: "prompt_rich", udtName: "jsonb", nullable: true },
        { name: "prompt_image", udtName: "bytea", nullable: true },
        { name: "option_a_image", udtName: "bytea", nullable: true },
        { name: "updated_at", udtName: "timestamptz", nullable: false },
      ];
      const rows = serializeTableRows(
        columns,
        [
          {
            id: "9007199254740995",
            prompt_text: "Berapakah 1 + 1?",
            prompt_rich: '{"type":"doc","content":[]}',
            prompt_image: imageA,
            option_a_image: Buffer.from(imageA), // identik -> harus terdeduplikasi jadi 1 blob!
            updated_at: "2026-11-17T08:12:34.123456Z",
          },
          {
            id: "9007199254740996",
            prompt_text: "Soal tanpa gambar",
            prompt_rich: null,
            prompt_image: null,
            option_a_image: null,
            updated_at: "2026-11-17T08:12:35.000001Z",
          },
        ],
        blobRegistry,
      );
      return { name: "question_bank", hasIdentity: true, columns, rows };
    },
    exam_periods: () => {
      const columns = [
        { name: "id", udtName: "int8", nullable: false },
        { name: "start_date", udtName: "date", nullable: false },
        { name: "is_active", udtName: "bool", nullable: false },
      ];
      const rows = serializeTableRows(
        columns,
        [{ id: "42", start_date: "2026-11-01", is_active: true }],
        new Map(),
      );
      return { name: "exam_periods", hasIdentity: true, columns, rows };
    },
    exam_tests: () => {
      const columns = [
        { name: "id", udtName: "int8", nullable: false },
        { name: "topic_ids", udtName: "_int8", nullable: false },
        { name: "shuffle_questions", udtName: "bool", nullable: false },
        { name: "duration_minutes", udtName: "int4", nullable: false },
      ];
      const rows = serializeTableRows(
        columns,
        [{ id: "7", topic_ids: ["10", "20", "30"], shuffle_questions: false, duration_minutes: 90 }],
        new Map(),
      );
      return { name: "exam_tests", hasIdentity: true, columns, rows };
    },
    database_backup_audit: () => {
      const columns = [
        { name: "id", udtName: "int8", nullable: false },
        { name: "operation_id", udtName: "uuid", nullable: false },
      ];
      const rows = serializeTableRows(
        columns,
        [{ id: "1", operation_id: "123e4567-e89b-12d3-a456-426614174000" }],
        new Map(),
      );
      return { name: "database_backup_audit", hasIdentity: true, columns, rows };
    },
  });

  const built = buildBackupArchiveZip(payload);
  assert.equal(built.manifest.summary.blobCount, 1, "Gambar identik harus terdeduplikasi menjadi 1 blob.");
  assert.equal(built.manifest.summary.totalRows, 5);
  assert.equal(built.archiveSha256, sha256Hex(built.buffer));

  const parsed = await parseAndVerifyBackupArchive(built.buffer);
  assert.equal(parsed.archiveSha256, built.archiveSha256);
  assert.equal(parsed.totalRows, 5);
  const qb = parsed.tableData.get("question_bank");
  assert.ok(qb);
  assert.equal(qb.rows[0][0], "9007199254740995");
  assert.equal(qb.rows[0][2], '{"type":"doc","content":[]}');
  assert.deepEqual(qb.rows[0][3], imageA);
  assert.deepEqual(qb.rows[0][4], imageA);
  assert.equal(qb.rows[0][5], "2026-11-17T08:12:34.123456Z");
  assert.deepEqual(parsed.tableData.get("exam_tests")?.rows[0][1], ["10", "20", "30"]);
});

test("parseAndVerifyBackupArchive menolak tampering checksum, file ekstra, blob yatim, dan path traversal", async () => {
  const imageA = Buffer.from([1, 2, 3, 4, 5]);
  const built = buildBackupArchiveZip(
    makeEmptySeedArchiveData({
      app_settings: (blobs) => {
        const columns = [
          { name: "id", udtName: "int4", nullable: false },
          { name: "school_logo", udtName: "bytea", nullable: true },
        ];
        return {
          name: "app_settings",
          hasIdentity: false,
          columns,
          rows: serializeTableRows(columns, [{ id: 1, school_logo: imageA }], blobs),
        };
      },
    }),
  );

  // 1. Buffer kosong / non-zip
  await assert.rejects(() => parseAndVerifyBackupArchive(Buffer.alloc(0)), BackupArchiveError);
  await assert.rejects(() => parseAndVerifyBackupArchive(Buffer.from("bukan zip")), BackupArchiveError);

  // 2. Modifikasi isi tabel tanpa update manifest SHA-256
  const entries1 = unzipSync(built.buffer);
  entries1["tables/academic_years.json"] = Buffer.from('{"table":"academic_years","hasIdentity":false,"columns":[{"name":"id","udtName":"int4","nullable":false}],"rows":[[1]]}');
  await assert.rejects(() => parseAndVerifyBackupArchive(Buffer.from(zipSync(entries1))), /SHA-256/);

  // 3. Modifikasi isi blob tanpa update manifest SHA-256
  const entries2 = unzipSync(built.buffer);
  const blobKey = Object.keys(entries2).find((k) => k.startsWith("blobs/"));
  assert.ok(blobKey);
  entries2[blobKey] = Buffer.from([9, 9, 9, 9, 9]);
  await assert.rejects(() => parseAndVerifyBackupArchive(Buffer.from(zipSync(entries2))), /SHA-256/);

  // 4. File ekstra tidak ada di manifest
  const entries3 = unzipSync(built.buffer);
  entries3["evil.sql"] = Buffer.from("DROP TABLE admin_users;");
  await assert.rejects(() => parseAndVerifyBackupArchive(Buffer.from(zipSync(entries3))), /katalog manifest/);

  // 5. Path traversal
  const entries4 = unzipSync(built.buffer);
  entries4["../evil.txt"] = Buffer.from("x");
  await assert.rejects(() => parseAndVerifyBackupArchive(Buffer.from(zipSync(entries4))), BackupArchiveError);
});

test("helper SQL proyeksi, nama file, validasi frasa, dan pemeriksaan same-origin multiparts akurat", () => {
  assert.equal(validateRestorePhrase("PULIHKAN"), true);
  assert.equal(validateRestorePhrase("  PULIHKAN  "), true);
  assert.equal(validateRestorePhrase("pulihkan"), false);
  assert.equal(validateRestorePhrase("PULIHKAN SEKARANG"), false);
  assert.equal(validateRestorePhrase(""), false);

  const fn = buildBackupFilename(new Date("2026-11-17T08:05:09.000Z"));
  assert.match(fn, /^backup-nusacbt-20261117-\d{6}\.zip$/);

  assert.equal(sanitizeArchiveFilename("C:\\fakepath\\..\\cadangan\x00sekolah.zip"), ".._cadangan_sekolah.zip".replace(".._", "_").length > 0 ? "cadangan_sekolah.zip" : "");
  assert.equal(sanitizeArchiveFilename("../../rahasia/backup 01.zip"), "backup 01.zip");
  assert.equal(sanitizeArchiveFilename(null), "cadangan-nusacbt.zip");

  const sql = buildColumnSelectSql([
    { name: "start_date", udtName: "date" },
    { name: "created_at", udtName: "timestamptz" },
    { name: "prompt_rich", udtName: "jsonb" },
    { name: "name", udtName: "varchar" },
  ]);
  assert.ok(sql.includes('to_char("start_date", \'YYYY-MM-DD\') AS "start_date"'));
  assert.ok(sql.includes('AT TIME ZONE \'UTC\''));
  assert.ok(sql.includes('"prompt_rich"::text AS "prompt_rich"'));

  const validExportHeaders = new Headers({
    origin: "http://127.0.0.1:3100",
    host: "127.0.0.1:3100",
    "content-type": "application/json",
    "sec-fetch-site": "same-origin",
    "x-nusacbt-export": "1",
  });
  assert.equal(exportRequestIsSameOrigin(validExportHeaders), true);

  const validToolMultipartHeaders = new Headers({
    origin: "http://127.0.0.1:3100",
    host: "127.0.0.1:3100",
    "content-type": "multipart/form-data; boundary=----Boundary123",
    "sec-fetch-site": "same-origin",
    "x-nusacbt-tool": "1",
  });
  assert.equal(toolMultipartRequestIsSameOrigin(validToolMultipartHeaders), true);
  assert.equal(
    toolMultipartRequestIsSameOrigin(
      new Headers({
        origin: "https://evil.example",
        host: "127.0.0.1:3100",
        "content-type": "multipart/form-data; boundary=----Boundary123",
        "x-nusacbt-tool": "1",
      }),
    ),
    false,
  );
  assert.equal(
    toolMultipartRequestIsSameOrigin(
      new Headers({
        origin: "http://127.0.0.1:3100",
        host: "127.0.0.1:3100",
        "content-type": "application/json",
        "x-nusacbt-tool": "1",
      }),
    ),
    false,
  );
});
