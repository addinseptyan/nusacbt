import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { zipSync } from "fflate";
import { fromBufferPromise } from "yauzl";

export const BACKUP_FORMAT_ID = "nusacbt-backup-v1";
export const BACKUP_FORMAT_VERSION = 1;
export const MAX_BACKUP_UPLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_BACKUP_EXPANDED_BYTES = 256 * 1024 * 1024;
export const MAX_BACKUP_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_BACKUP_ENTRIES = 10_000;
export const RESTORE_CONFIRMATION_PHRASE = "PULIHKAN";

// Urutan topologi ketat parent-before-child untuk seluruh 51 tabel domain
// (tabel siklus admin_roles.updated_by -> admin_users.id diisi dalam 2 fase).
export const BACKUP_DOMAIN_TABLES = Object.freeze([
  "academic_years",
  "admin_roles",
  "exam_question_snapshots",
  "exam_start_token_global_limit",
  "exam_token_key_binding",
  "participant_login_attempts",
  "participant_login_global_limit",
  "participant_password_key_binding",
  "question_topics",
  "school_majors",
  "school_students",
  "academic_year_settings",
  "admin_role_permissions",
  "admin_users",
  "exam_periods",
  "exam_question_snapshot_images",
  "question_bank",
  "school_classes",
  "academic_year_enrollments",
  "admin_sessions",
  "admin_user_audit",
  "app_settings",
  "database_backup_audit",
  "exam_final_grade_operations",
  "exam_score_category_visibility",
  "exam_session_plans",
  "exam_tests",
  "exam_work_settings",
  "participant_identities",
  "participant_login_settings",
  "question_import_batches",
  "student_class_placements",
  "exam_access_tokens",
  "exam_final_grade_settings",
  "exam_final_grade_state",
  "exam_score_visibility",
  "exam_session_groups",
  "exam_start_token_attempts",
  "exam_test_questions",
  "global_token_auto_rotate",
  "participant_password_audit",
  "participant_passwords",
  "participant_sessions",
  "exam_schedule_runs",
  "exam_session_assignments",
  "exam_token_issue_operations",
  "exam_schedule_custom_questions",
  "exam_schedule_participants",
  "exam_attempts",
  "exam_attempt_questions",
  "exam_retake_permissions",
  "exam_retake_operations",
]);

export const BACKUP_DOMAIN_TABLE_SET = new Set(BACKUP_DOMAIN_TABLES);
export const TWO_PASS_NULLABLE_FK_COLUMNS = Object.freeze({
  admin_roles: Object.freeze(["updated_by"]),
});
export const TRANSIENT_TABLES_CLEARED_ON_RESTORE = new Set(["participant_sessions"]);

export class BackupArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupArchiveError";
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const INT_RE = /^-?\d{1,19}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const MIGRATION_FILE_RE = /^\d{3}_[a-z0-9_]+\.sql$/;

const SUPPORTED_UDT_TYPES = new Set([
  "int2",
  "int4",
  "int8",
  "_int8",
  "bool",
  "bytea",
  "date",
  "timestamptz",
  "uuid",
  "jsonb",
  "json",
  "text",
  "_text",
  "varchar",
  "bpchar",
]);

/** @param {string | Uint8Array | Buffer} input */
export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

/** @param {unknown} phrase */
export function validateRestorePhrase(phrase) {
  return typeof phrase === "string" && phrase.trim() === RESTORE_CONFIRMATION_PHRASE;
}

/** @param {Date} [date] */
export function buildBackupFilename(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, /** @type {Record<string, string>} */ ({}));
  const stamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
  return `backup-nusacbt-${stamp}.zip`;
}

/** @param {unknown} raw @param {string} [fallback] */
export function sanitizeArchiveFilename(raw, fallback = "cadangan-nusacbt.zip") {
  if (typeof raw !== "string") return fallback;
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
}

/**
 * Menghasilkan daftar ekspresi SELECT terproyeksi per kolom agar presisi date,
 * timestamptz (6 digit mikrodetik UTC), dan jsonb tidak tergeser driver JS.
 * @param {{ name: string, udtName: string }[]} columns
 */
export function buildColumnSelectSql(columns) {
  return columns
    .map((col) => {
      if (!IDENTIFIER_RE.test(col.name) || !SUPPORTED_UDT_TYPES.has(col.udtName)) {
        throw new BackupArchiveError(`Kolom atau tipe data tidak didukung: ${col.name} (${col.udtName})`);
      }
      const q = `"${col.name}"`;
      if (col.udtName === "date") return `to_char(${q}, 'YYYY-MM-DD') AS ${q}`;
      if (col.udtName === "timestamptz") {
        return `to_char(${q} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${q}`;
      }
      if (col.udtName === "jsonb" || col.udtName === "json") return `${q}::text AS ${q}`;
      return q;
    })
    .join(", ");
}

/**
 * Mengonversi nilai mentah hasil query ke tuple JSON-aman serta mendaftarkan blob biner terdeduplikasi.
 * @param {{ name: string, udtName: string, nullable: boolean }[]} columns
 * @param {Record<string, unknown>[]} rows
 * @param {Map<string, Buffer>} blobRegistry
 */
export function serializeTableRows(columns, rows, blobRegistry) {
  return rows.map((row) =>
    columns.map((col) => {
      const value = row[col.name];
      if (value === null || value === undefined) return null;
      if (col.udtName === "bytea") {
        const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(/** @type {Uint8Array} */ (value));
        const digest = sha256Hex(bytes);
        if (!blobRegistry.has(digest)) blobRegistry.set(digest, bytes);
        return { $blob: digest };
      }
      if (col.udtName === "int8") {
        const text = typeof value === "bigint" ? value.toString() : String(value);
        if (!INT_RE.test(text)) throw new BackupArchiveError(`Nilai bigint tidak valid pada kolom ${col.name}.`);
        return text;
      }
      if (col.udtName === "_int8") {
        if (!Array.isArray(value)) throw new BackupArchiveError(`Nilai array bigint tidak valid pada kolom ${col.name}.`);
        return value.map((item) => {
          const text = typeof item === "bigint" ? item.toString() : String(item);
          if (!INT_RE.test(text)) throw new BackupArchiveError(`Elemen bigint[] tidak valid pada kolom ${col.name}.`);
          return text;
        });
      }
      if (col.udtName === "_text") {
        if (!Array.isArray(value)) throw new BackupArchiveError(`Nilai array teks tidak valid pada kolom ${col.name}.`);
        return value.map((item) => String(item));
      }
      if (col.udtName === "int2" || col.udtName === "int4") {
        const num = typeof value === "number" ? value : Number(value);
        if (!Number.isInteger(num)) throw new BackupArchiveError(`Nilai integer tidak valid pada kolom ${col.name}.`);
        return num;
      }
      if (col.udtName === "bool") {
        if (typeof value !== "boolean") throw new BackupArchiveError(`Nilai boolean tidak valid pada kolom ${col.name}.`);
        return value;
      }
      if (col.udtName === "jsonb" || col.udtName === "json") {
        return typeof value === "string" ? value : JSON.stringify(value);
      }
      return String(value);
    }),
  );
}

/**
 * Validasi tipe & konversi tuple JSON ke parameter PostgreSQL terikat.
 * @param {string} tableName
 * @param {{ name: string, udtName: string, nullable: boolean }[]} columns
 * @param {unknown[]} rawRows
 * @param {Map<string, Buffer>} blobs
 * @param {Set<string>} referencedBlobs
 */
function decodeAndValidateTableRows(tableName, columns, rawRows, blobs, referencedBlobs) {
  if (!Array.isArray(rawRows)) {
    throw new BackupArchiveError(`Data baris tabel ${tableName} pada arsip tidak valid.`);
  }
  const decoded = new Array(rawRows.length);
  for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex += 1) {
    const rawRow = rawRows[rowIndex];
    if (!Array.isArray(rawRow) || rawRow.length !== columns.length) {
      throw new BackupArchiveError(`Struktur baris #${rowIndex + 1} pada tabel ${tableName} tidak sesuai.`);
    }
    const rowValues = new Array(columns.length);
    for (let colIndex = 0; colIndex < columns.length; colIndex += 1) {
      const col = columns[colIndex];
      const cell = rawRow[colIndex];
      if (cell === null) {
        if (!col.nullable) {
          throw new BackupArchiveError(`Kolom wajib ${tableName}.${col.name} bernilai null.`);
        }
        rowValues[colIndex] = null;
        continue;
      }
      switch (col.udtName) {
        case "bytea": {
          if (
            typeof cell !== "object" ||
            cell === null ||
            Array.isArray(cell) ||
            typeof /** @type {{ $blob?: unknown }} */ (cell).$blob !== "string"
          ) {
            throw new BackupArchiveError(`Referensi blob pada ${tableName}.${col.name} tidak valid.`);
          }
          const digest = /** @type {{ $blob: string }} */ (cell).$blob;
          if (!SHA256_RE.test(digest) || !blobs.has(digest)) {
            throw new BackupArchiveError(`Berkas biner ${digest} untuk ${tableName}.${col.name} hilang dari arsip.`);
          }
          referencedBlobs.add(digest);
          rowValues[colIndex] = blobs.get(digest);
          break;
        }
        case "int8": {
          if (typeof cell !== "string" || !INT_RE.test(cell)) {
            throw new BackupArchiveError(`Nilai bigint pada ${tableName}.${col.name} tidak valid.`);
          }
          rowValues[colIndex] = cell;
          break;
        }
        case "_int8": {
          if (!Array.isArray(cell)) {
            throw new BackupArchiveError(`Nilai bigint[] pada ${tableName}.${col.name} tidak valid.`);
          }
          rowValues[colIndex] = cell.map((entry) => {
            if (typeof entry !== "string" || !INT_RE.test(entry)) {
              throw new BackupArchiveError(`Elemen bigint[] pada ${tableName}.${col.name} tidak valid.`);
            }
            return entry;
          });
          break;
        }
        case "int2":
        case "int4": {
          if (typeof cell !== "number" || !Number.isInteger(cell)) {
            throw new BackupArchiveError(`Nilai integer pada ${tableName}.${col.name} tidak valid.`);
          }
          if (col.udtName === "int2" && (cell < -32768 || cell > 32767)) {
            throw new BackupArchiveError(`Nilai smallint pada ${tableName}.${col.name} di luar batas.`);
          }
          if (col.udtName === "int4" && (cell < -2147483648 || cell > 2147483647)) {
            throw new BackupArchiveError(`Nilai integer pada ${tableName}.${col.name} di luar batas.`);
          }
          rowValues[colIndex] = cell;
          break;
        }
        case "bool": {
          if (typeof cell !== "boolean") {
            throw new BackupArchiveError(`Nilai boolean pada ${tableName}.${col.name} tidak valid.`);
          }
          rowValues[colIndex] = cell;
          break;
        }
        case "date": {
          if (typeof cell !== "string" || !DATE_RE.test(cell)) {
            throw new BackupArchiveError(`Nilai tanggal pada ${tableName}.${col.name} tidak valid.`);
          }
          rowValues[colIndex] = cell;
          break;
        }
        case "timestamptz": {
          if (typeof cell !== "string" || !TIMESTAMPTZ_RE.test(cell)) {
            throw new BackupArchiveError(`Nilai waktu pada ${tableName}.${col.name} tidak valid.`);
          }
          rowValues[colIndex] = cell;
          break;
        }
        case "uuid": {
          if (typeof cell !== "string" || !UUID_RE.test(cell)) {
            throw new BackupArchiveError(`Nilai UUID pada ${tableName}.${col.name} tidak valid.`);
          }
          rowValues[colIndex] = cell;
          break;
        }
        case "jsonb":
        case "json": {
          if (typeof cell !== "string") {
            throw new BackupArchiveError(`Nilai JSON pada ${tableName}.${col.name} tidak valid.`);
          }
          try {
            JSON.parse(cell);
          } catch {
            throw new BackupArchiveError(`JSON rusak pada ${tableName}.${col.name}.`);
          }
          rowValues[colIndex] = cell;
          break;
        }
        case "text":
        case "varchar":
        case "bpchar": {
          if (typeof cell !== "string") {
            throw new BackupArchiveError(`Nilai teks pada ${tableName}.${col.name} tidak valid.`);
          }
          rowValues[colIndex] = cell;
          break;
        }
        case "_text": {
          if (!Array.isArray(cell)) {
            throw new BackupArchiveError(`Nilai text[] pada ${tableName}.${col.name} tidak valid.`);
          }
          rowValues[colIndex] = cell.map((entry) => {
            if (typeof entry !== "string") {
              throw new BackupArchiveError(`Elemen text[] pada ${tableName}.${col.name} tidak valid.`);
            }
            return entry;
          });
          break;
        }
        default:
          throw new BackupArchiveError(`Tipe data tidak didukung: ${col.udtName}`);
      }
    }
    decoded[rowIndex] = rowValues;
  }
  return decoded;
}

/**
 * Mengemas backup menjadi arsip .zip deterministik beserta manifest & SHA-256 tiap entri.
 * @param {{
 *   createdAt: string,
 *   databaseName: string,
 *   serverVersion: string,
 *   encoding: string,
 *   schemaVersion: string,
 *   migrations: { version: string, checksum: string }[],
 *   keyBindings: {
 *     participantPassword: { bound: boolean, verifierSha256: string | null },
 *     examToken: { bound: boolean, verifierSha256: string | null },
 *   },
 *   tables: {
 *     name: string,
 *     hasIdentity: boolean,
 *     columns: { name: string, udtName: string, nullable: boolean }[],
 *     rows: unknown[][],
 *   }[],
 *   sequences: {
 *     tableName: string,
 *     columnName: string,
 *     sequenceName: string,
 *     lastValue: string | null,
 *     isCalled: boolean,
 *   }[],
 *   blobs: Map<string, Buffer>,
 * }} payload
 */
export function buildBackupArchiveZip(payload) {
  /** @type {Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]>} */
  const zipEntries = {};
  const manifestTables = [];
  let totalRows = 0;

  const tableByName = new Map(payload.tables.map((t) => [t.name, t]));
  for (const tableName of BACKUP_DOMAIN_TABLES) {
    const table = tableByName.get(tableName);
    if (!table) {
      throw new BackupArchiveError(`Tabel domain ${tableName} hilang saat pembuatan cadangan.`);
    }
    const entryPath = `tables/${tableName}.json`;
    const jsonBytes = Buffer.from(
      JSON.stringify({
        table: table.name,
        hasIdentity: Boolean(table.hasIdentity),
        columns: table.columns,
        rows: table.rows,
      }),
      "utf8",
    );
    zipEntries[entryPath] = [jsonBytes, { level: 6 }];
    manifestTables.push({
      name: table.name,
      entryPath,
      sha256: sha256Hex(jsonBytes),
      byteSize: jsonBytes.byteLength,
      rowCount: table.rows.length,
    });
    totalRows += table.rows.length;
  }

  const manifestBlobs = [];
  let totalBlobBytes = 0;
  for (const digest of [...payload.blobs.keys()].sort()) {
    if (!SHA256_RE.test(digest)) throw new BackupArchiveError("Digest blob tidak valid.");
    const bytes = payload.blobs.get(digest);
    if (!bytes) continue;
    const entryPath = `blobs/${digest}.bin`;
    zipEntries[entryPath] = [bytes, { level: 0 }];
    manifestBlobs.push({
      sha256: digest,
      entryPath,
      byteSize: bytes.byteLength,
    });
    totalBlobBytes += bytes.byteLength;
  }

  const manifest = {
    format: BACKUP_FORMAT_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: payload.createdAt,
    databaseName: payload.databaseName,
    serverVersion: payload.serverVersion,
    encoding: payload.encoding,
    schemaVersion: payload.schemaVersion,
    migrations: payload.migrations,
    keyBindings: payload.keyBindings,
    tables: manifestTables,
    blobs: manifestBlobs,
    sequences: payload.sequences,
    summary: {
      tableCount: manifestTables.length,
      totalRows,
      blobCount: manifestBlobs.length,
      totalBlobBytes,
    },
  };

  zipEntries["manifest.json"] = [Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), { level: 6 }];

  const zipped = zipSync(zipEntries);
  const buffer = Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength);
  if (buffer.byteLength > MAX_BACKUP_UPLOAD_BYTES) {
    throw new BackupArchiveError(
      `Ukuran arsip cadangan (${Math.ceil(buffer.byteLength / (1024 * 1024))} MiB) melebihi batas maksimal 64 MiB.`,
    );
  }
  return {
    buffer,
    archiveSha256: sha256Hex(buffer),
    byteSize: buffer.byteLength,
    manifest,
  };
}

/**
 * Membaca dan memverifikasi integritas seluruh arsip cadangan .zip di memori.
 * Menolak zip-bomb, path traversal, symlink, file tambahan tak dikenal, maupun ketidakcocokan SHA-256.
 * @param {Buffer} inputBuffer
 */
export async function parseAndVerifyBackupArchive(inputBuffer) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.byteLength === 0) {
    throw new BackupArchiveError("Berkas cadangan kosong atau tidak terbaca.");
  }
  if (inputBuffer.byteLength > MAX_BACKUP_UPLOAD_BYTES) {
    throw new BackupArchiveError("Ukuran berkas cadangan melebihi batas maksimal 64 MiB.");
  }

  const archiveSha256 = sha256Hex(inputBuffer);
  let zip;
  try {
    zip = await fromBufferPromise(inputBuffer, { strictFileNames: true, validateEntrySizes: true });
  } catch {
    throw new BackupArchiveError("Berkas bukan arsip .zip cadangan NusaCBT yang valid atau rusak.");
  }

  /** @type {Map<string, Buffer>} */
  const entries = new Map();
  const loweredNames = new Set();
  let expandedBytes = 0;

  try {
    if (zip.entryCount > MAX_BACKUP_ENTRIES) {
      throw new BackupArchiveError("Jumlah entri di dalam arsip cadangan melebihi batas aman.");
    }
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      const lowered = name.toLowerCase();
      const fileTypeMode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (fileTypeMode === 0o120000) {
        throw new BackupArchiveError("Arsip cadangan mengandung symlink yang tidak diizinkan.");
      }
      if (
        !name ||
        name.length > 240 ||
        name.endsWith("/") ||
        name.includes("\0") ||
        name.includes("\\") ||
        name.startsWith("/") ||
        name.split("/").some((part) => part === ".." || part === ".") ||
        loweredNames.has(lowered) ||
        entry.isEncrypted() ||
        !entry.canDecodeFileData()
      ) {
        throw new BackupArchiveError("Arsip cadangan mengandung nama file, enkripsi, atau entri ganda yang tidak valid.");
      }
      loweredNames.add(lowered);
      if (entry.uncompressedSize > MAX_BACKUP_ENTRY_BYTES || expandedBytes + entry.uncompressedSize > MAX_BACKUP_EXPANDED_BYTES) {
        throw new BackupArchiveError("Ukuran arsip cadangan setelah dibuka melebihi batas 256 MiB.");
      }

      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      let readSize = 0;
      for await (const chunk of stream) {
        const buf = Buffer.from(chunk);
        readSize += buf.byteLength;
        if (
          readSize > entry.uncompressedSize ||
          readSize > MAX_BACKUP_ENTRY_BYTES ||
          expandedBytes + readSize > MAX_BACKUP_EXPANDED_BYTES
        ) {
          stream.destroy();
          throw new BackupArchiveError("Ukuran entri cadangan melebihi batas yang dideklarasikan.");
        }
        chunks.push(buf);
      }
      if (readSize !== entry.uncompressedSize) {
        throw new BackupArchiveError(`Entri ${name} terpotong atau tidak lengkap.`);
      }
      const data = Buffer.concat(chunks, readSize);
      if ((crc32(data) >>> 0) !== (entry.crc32 >>> 0)) {
        throw new BackupArchiveError(`Checksum CRC32 pada entri ${name} tidak cocok.`);
      }
      expandedBytes += readSize;
      entries.set(name, data);
    }
  } catch (error) {
    if (error instanceof BackupArchiveError) throw error;
    throw new BackupArchiveError("Arsip cadangan .zip tidak dapat dibaca atau rusak.");
  } finally {
    zip.close();
  }

  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) {
    throw new BackupArchiveError("Arsip cadangan bukan format NusaCBT karena manifest.json tidak ditemukan.");
  }

  /** @type {any} */
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    throw new BackupArchiveError("File manifest.json pada arsip cadangan rusak atau bukan JSON UTF-8.");
  }

  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.format !== BACKUP_FORMAT_ID ||
    manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
    !Array.isArray(manifest.migrations) ||
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.blobs) ||
    !Array.isArray(manifest.sequences) ||
    typeof manifest.createdAt !== "string" ||
    typeof manifest.schemaVersion !== "string"
  ) {
    throw new BackupArchiveError("Struktur manifest cadangan NusaCBT tidak dikenali atau versi format tidak didukung.");
  }

  for (const mig of manifest.migrations) {
    if (
      !mig ||
      typeof mig !== "object" ||
      typeof mig.version !== "string" ||
      !MIGRATION_FILE_RE.test(mig.version) ||
      typeof mig.checksum !== "string" ||
      !SHA256_RE.test(mig.checksum)
    ) {
      throw new BackupArchiveError("Daftar versi migrasi di dalam manifest tidak valid.");
    }
  }

  const expectedEntryPaths = new Set(["manifest.json"]);
  if (manifest.tables.length !== BACKUP_DOMAIN_TABLES.length) {
    throw new BackupArchiveError("Daftar tabel di dalam arsip cadangan tidak lengkap atau tidak sesuai versi skema.");
  }

  const seenTables = new Set();
  /** @type {Map<string, Buffer>} */
  const blobs = new Map();
  const seenBlobs = new Set();

  for (const blobMeta of manifest.blobs) {
    if (
      !blobMeta ||
      typeof blobMeta !== "object" ||
      typeof blobMeta.sha256 !== "string" ||
      !SHA256_RE.test(blobMeta.sha256) ||
      typeof blobMeta.entryPath !== "string" ||
      blobMeta.entryPath !== `blobs/${blobMeta.sha256}.bin` ||
      typeof blobMeta.byteSize !== "number" ||
      !Number.isInteger(blobMeta.byteSize) ||
      blobMeta.byteSize < 0 ||
      seenBlobs.has(blobMeta.sha256)
    ) {
      throw new BackupArchiveError("Metadata berkas biner pada manifest cadangan tidak valid.");
    }
    const blobBytes = entries.get(blobMeta.entryPath);
    if (!blobBytes) {
      throw new BackupArchiveError(`Berkas biner ${blobMeta.entryPath} hilang dari arsip.`);
    }
    if (blobBytes.byteLength !== blobMeta.byteSize || sha256Hex(blobBytes) !== blobMeta.sha256) {
      throw new BackupArchiveError(`Integritas SHA-256 berkas biner ${blobMeta.entryPath} gagal diverifikasi.`);
    }
    seenBlobs.add(blobMeta.sha256);
    expectedEntryPaths.add(blobMeta.entryPath);
    blobs.set(blobMeta.sha256, blobBytes);
  }

  /** @type {Map<string, { name: string, hasIdentity: boolean, columns: { name: string, udtName: string, nullable: boolean }[], rows: unknown[][] }>} */
  const tableData = new Map();
  const referencedBlobs = new Set();
  let totalRows = 0;

  for (const tableMeta of manifest.tables) {
    if (
      !tableMeta ||
      typeof tableMeta !== "object" ||
      typeof tableMeta.name !== "string" ||
      !BACKUP_DOMAIN_TABLE_SET.has(tableMeta.name) ||
      seenTables.has(tableMeta.name) ||
      typeof tableMeta.entryPath !== "string" ||
      tableMeta.entryPath !== `tables/${tableMeta.name}.json` ||
      typeof tableMeta.sha256 !== "string" ||
      !SHA256_RE.test(tableMeta.sha256) ||
      typeof tableMeta.byteSize !== "number" ||
      !Number.isInteger(tableMeta.byteSize) ||
      typeof tableMeta.rowCount !== "number" ||
      !Number.isInteger(tableMeta.rowCount) ||
      tableMeta.rowCount < 0
    ) {
      throw new BackupArchiveError("Metadata tabel pada manifest cadangan tidak valid.");
    }
    seenTables.add(tableMeta.name);
    expectedEntryPaths.add(tableMeta.entryPath);

    const tableBytes = entries.get(tableMeta.entryPath);
    if (!tableBytes) {
      throw new BackupArchiveError(`Data tabel ${tableMeta.name} hilang dari arsip.`);
    }
    if (tableBytes.byteLength !== tableMeta.byteSize || sha256Hex(tableBytes) !== tableMeta.sha256) {
      throw new BackupArchiveError(`Integritas SHA-256 tabel ${tableMeta.name} tidak cocok.`);
    }

    /** @type {any} */
    let parsedTable;
    try {
      parsedTable = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(tableBytes));
    } catch {
      throw new BackupArchiveError(`File JSON tabel ${tableMeta.name} rusak.`);
    }

    if (
      !parsedTable ||
      typeof parsedTable !== "object" ||
      parsedTable.table !== tableMeta.name ||
      typeof parsedTable.hasIdentity !== "boolean" ||
      !Array.isArray(parsedTable.columns) ||
      !Array.isArray(parsedTable.rows) ||
      parsedTable.rows.length !== tableMeta.rowCount
    ) {
      throw new BackupArchiveError(`Isi JSON tabel ${tableMeta.name} tidak konsisten dengan manifest.`);
    }

    const colNames = new Set();
    /** @type {{ name: string, udtName: string, nullable: boolean }[]} */
    const columns = [];
    for (const col of parsedTable.columns) {
      if (
        !col ||
        typeof col !== "object" ||
        typeof col.name !== "string" ||
        !IDENTIFIER_RE.test(col.name) ||
        colNames.has(col.name) ||
        typeof col.udtName !== "string" ||
        !SUPPORTED_UDT_TYPES.has(col.udtName) ||
        typeof col.nullable !== "boolean"
      ) {
        throw new BackupArchiveError(`Definisi kolom pada tabel ${tableMeta.name} tidak valid.`);
      }
      colNames.add(col.name);
      columns.push({ name: col.name, udtName: col.udtName, nullable: col.nullable });
    }

    const decodedRows = decodeAndValidateTableRows(tableMeta.name, columns, parsedTable.rows, blobs, referencedBlobs);
    totalRows += decodedRows.length;
    tableData.set(tableMeta.name, {
      name: tableMeta.name,
      hasIdentity: parsedTable.hasIdentity,
      columns,
      rows: decodedRows,
    });
  }

  for (const requiredTable of BACKUP_DOMAIN_TABLES) {
    if (!seenTables.has(requiredTable)) {
      throw new BackupArchiveError(`Tabel ${requiredTable} tidak tersedia di dalam arsip cadangan.`);
    }
  }

  if (entries.size !== expectedEntryPaths.size) {
    throw new BackupArchiveError("Arsip cadangan berisi file tambahan di luar katalog manifest.");
  }
  for (const actualName of entries.keys()) {
    if (!expectedEntryPaths.has(actualName)) {
      throw new BackupArchiveError(`Arsip cadangan mengandung file tak dikenal: ${actualName}`);
    }
  }
  for (const blobDigest of blobs.keys()) {
    if (!referencedBlobs.has(blobDigest)) {
      throw new BackupArchiveError(`Berkas biner ${blobDigest} tidak direferensikan oleh tabel mana pun.`);
    }
  }

  for (const seq of manifest.sequences) {
    if (
      !seq ||
      typeof seq !== "object" ||
      typeof seq.tableName !== "string" ||
      !BACKUP_DOMAIN_TABLE_SET.has(seq.tableName) ||
      typeof seq.columnName !== "string" ||
      !IDENTIFIER_RE.test(seq.columnName) ||
      (seq.lastValue !== null && (typeof seq.lastValue !== "string" || !INT_RE.test(seq.lastValue))) ||
      typeof seq.isCalled !== "boolean"
    ) {
      throw new BackupArchiveError("Metadata sequence pada manifest cadangan tidak valid.");
    }
  }

  return {
    archiveSha256,
    byteSize: inputBuffer.byteLength,
    manifest,
    tableData,
    blobs,
    totalRows,
  };
}
