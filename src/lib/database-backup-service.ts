import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
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
  TRANSIENT_TABLES_CLEARED_ON_RESTORE,
  TWO_PASS_NULLABLE_FK_COLUMNS,
  validateRestorePhrase,
  type BackupColumnDef,
  type BackupSequenceMeta,
  type ParsedBackupArchive,
} from "@/lib/database-backup-archive.mjs";
import { examTokenKeyVerifier, sameTokenVerifier } from "@/lib/exam-token-crypto.mjs";
import {
  ParticipantKeyFileError,
  participantKeyVerifier,
  readParticipantKeyFile,
  sameParticipantVerifier,
} from "@/lib/participant-password-crypto.mjs";
import { getPostgresPool } from "@/lib/postgres";

export class DatabaseToolError extends Error {}
export class DatabaseToolAuthError extends DatabaseToolError {}
export class DatabaseToolPermissionError extends DatabaseToolError {}
export class DatabaseToolValidationError extends DatabaseToolError {}
export class DatabaseToolConflictError extends DatabaseToolError {}

export type KeyCompatibilityStatus =
  | "matched"
  | "unbound"
  | "mismatch"
  | "missing_key"
  | "invalid_key"
  | "same_key"
  | "inconsistent";

export type KeyCheckReport = {
  participantKeyStatus: KeyCompatibilityStatus;
  tokenKeyStatus: KeyCompatibilityStatus;
  participantBoundInSource: boolean;
  tokenBoundInSource: boolean;
  participantConfigured: boolean;
  tokenConfigured: boolean;
};

export type DatabaseSummaryMetrics = {
  adminUsers: number;
  students: number;
  questions: number;
  questionImages: number;
  snapshotImages: number;
  examTests: number;
  attempts: number;
  hasBrandingLogo: boolean;
  hasBrandingLetterhead: boolean;
};

export type BackupAuditEntry = {
  id: string;
  operationId: string;
  action: "backup" | "restore";
  actorUsername: string;
  archiveFilename: string;
  archiveSha256: string;
  schemaVersion: string;
  tableCount: number;
  rowCount: number;
  blobCount: number;
  byteSize: number;
  detail: string;
  occurredAt: string;
};

export type ToolDashboardData = {
  databaseName: string;
  serverVersion: string;
  encoding: string;
  schemaVersion: string;
  migrationCount: number;
  activeOngoingAttempts: number;
  waitingExpiredAttempts: number;
  summary: DatabaseSummaryMetrics;
  keyCheck: KeyCheckReport;
  auditLogs: BackupAuditEntry[];
};

export type RestorePreviewReport = {
  archiveFilename: string;
  archiveSha256: string;
  byteSize: number;
  createdAt: string;
  sourceDatabaseName: string;
  sourceServerVersion: string;
  schemaVersion: string;
  tableCount: number;
  totalRows: number;
  blobCount: number;
  totalBlobBytes: number;
  schemaCompatible: boolean;
  schemaMessage: string;
  keyCheck: KeyCheckReport;
  activeOngoingAttempts: number;
  waitingExpiredAttempts: number;
  canRestore: boolean;
  blockers: string[];
  warnings: string[];
  summary: DatabaseSummaryMetrics;
};

const TOOL_ADVISORY_LOCK_KEY = 2026111727;
const SAFE_SEQ_RE = /^public\.[a-z_][a-z0-9_]*$/;
const SAFE_IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function quoteIdent(ident: string) {
  if (!SAFE_IDENT_RE.test(ident)) throw new DatabaseToolError(`Identifier tidak valid: ${ident}`);
  return `"${ident}"`;
}

function sqlTypeCast(udtName: string) {
  switch (udtName) {
    case "int2":
      return "smallint";
    case "int4":
      return "integer";
    case "int8":
      return "bigint";
    case "_int8":
      return "bigint[]";
    case "bool":
      return "boolean";
    case "bytea":
      return "bytea";
    case "date":
      return "date";
    case "timestamptz":
      return "timestamptz";
    case "uuid":
      return "uuid";
    case "jsonb":
      return "jsonb";
    case "json":
      return "json";
    case "varchar":
      return "varchar";
    case "bpchar":
      return "char";
    default:
      return "text";
  }
}

type ReadServerKeysResult = {
  participantKey: Buffer | null;
  participantReason: "ready" | "missing" | "invalid";
  tokenKey: Buffer | null;
  tokenReason: "ready" | "missing" | "invalid" | "same";
};

async function readServerKeyPair(): Promise<ReadServerKeysResult> {
  const root = process.env.NUSACBT_INTERNAL_PROJECT_ROOT;
  let participantKey: Buffer | null = null;
  let participantReason: ReadServerKeysResult["participantReason"] = "missing";
  let tokenKey: Buffer | null = null;
  let tokenReason: ReadServerKeysResult["tokenReason"] = "missing";

  if (!root || !isAbsolute(root)) {
    return { participantKey: null, participantReason: "invalid", tokenKey: null, tokenReason: "invalid" };
  }

  try {
    participantKey = await readParticipantKeyFile(process.env.NUSACBT_PARTICIPANT_KEY_FILE, root);
    participantReason = "ready";
  } catch (error) {
    participantReason = error instanceof ParticipantKeyFileError && error.reason === "missing" ? "missing" : "invalid";
  }

  try {
    tokenKey = await readParticipantKeyFile(process.env.NUSACBT_EXAM_TOKEN_KEY_FILE, root);
    if (participantKey && timingSafeEqual(tokenKey, participantKey)) {
      tokenKey.fill(0);
      tokenKey = null;
      tokenReason = "same";
    } else {
      tokenReason = "ready";
    }
  } catch (error) {
    tokenReason = error instanceof ParticipantKeyFileError && error.reason === "missing" ? "missing" : "invalid";
  }

  return { participantKey, participantReason, tokenKey, tokenReason };
}

function evaluateKeyCompatibility(params: {
  serverKeys: ReadServerKeysResult;
  participantVerifier: Buffer | null;
  hasEncryptedPasswords: boolean;
  tokenVerifier: Buffer | null;
  hasEncryptedTokens: boolean;
}): KeyCheckReport {
  const { serverKeys, participantVerifier, hasEncryptedPasswords, tokenVerifier, hasEncryptedTokens } = params;

  let participantKeyStatus: KeyCompatibilityStatus;
  if (!participantVerifier) {
    participantKeyStatus = hasEncryptedPasswords ? "inconsistent" : "unbound";
  } else if (serverKeys.participantReason === "missing") {
    participantKeyStatus = "missing_key";
  } else if (serverKeys.participantReason === "invalid" || !serverKeys.participantKey) {
    participantKeyStatus = "invalid_key";
  } else {
    const expected = participantKeyVerifier(serverKeys.participantKey);
    participantKeyStatus = sameParticipantVerifier(participantVerifier, expected) ? "matched" : "mismatch";
  }

  let tokenKeyStatus: KeyCompatibilityStatus;
  if (!tokenVerifier) {
    tokenKeyStatus = hasEncryptedTokens ? "inconsistent" : "unbound";
  } else if (serverKeys.tokenReason === "missing") {
    tokenKeyStatus = "missing_key";
  } else if (serverKeys.tokenReason === "same") {
    tokenKeyStatus = "same_key";
  } else if (serverKeys.tokenReason === "invalid" || !serverKeys.tokenKey) {
    tokenKeyStatus = "invalid_key";
  } else {
    const expected = examTokenKeyVerifier(serverKeys.tokenKey);
    tokenKeyStatus = sameTokenVerifier(tokenVerifier, expected) ? "matched" : "mismatch";
  }

  return {
    participantKeyStatus,
    tokenKeyStatus,
    participantBoundInSource: Boolean(participantVerifier),
    tokenBoundInSource: Boolean(tokenVerifier),
    participantConfigured: serverKeys.participantReason === "ready",
    tokenConfigured: serverKeys.tokenReason === "ready",
  };
}

function collectKeyBlockers(keyCheck: KeyCheckReport, isForRestore: boolean): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (keyCheck.participantKeyStatus === "mismatch") {
    blockers.push(
      "Kunci sandi peserta (NUSACBT_PARTICIPANT_KEY_FILE) di server saat ini berbeda dengan kunci yang terikat di cadangan.",
    );
  } else if (keyCheck.participantKeyStatus === "inconsistent") {
    blockers.push("Terdapat data sandi terenkripsi tanpa pengikat kunci di dalam cadangan.");
  } else if (keyCheck.participantKeyStatus === "missing_key" && isForRestore && keyCheck.participantBoundInSource) {
    blockers.push(
      "Cadangan memuat sandi peserta terenkripsi, tetapi NUSACBT_PARTICIPANT_KEY_FILE belum dikonfigurasi di server. Pulihkan berkas kunci sandi peserta terlebih dahulu.",
    );
  } else if (keyCheck.participantKeyStatus === "invalid_key" && isForRestore && keyCheck.participantBoundInSource) {
    blockers.push("Berkas kunci sandi peserta (NUSACBT_PARTICIPANT_KEY_FILE) tidak valid atau tidak terbaca.");
  } else if (!keyCheck.participantBoundInSource && !keyCheck.participantConfigured) {
    warnings.push("Kunci sandi peserta belum dikonfigurasi pada server (belum terpakai di cadangan ini).");
  }

  if (keyCheck.tokenKeyStatus === "mismatch") {
    blockers.push(
      "Kunci token ujian (NUSACBT_EXAM_TOKEN_KEY_FILE) di server saat ini berbeda dengan kunci yang terikat di cadangan.",
    );
  } else if (keyCheck.tokenKeyStatus === "same_key") {
    blockers.push("Kunci token ujian (NUSACBT_EXAM_TOKEN_KEY_FILE) harus menggunakan berkas terpisah dari kunci sandi peserta.");
  } else if (keyCheck.tokenKeyStatus === "inconsistent") {
    blockers.push("Terdapat data token terenkripsi tanpa pengikat kunci di dalam cadangan.");
  } else if (keyCheck.tokenKeyStatus === "missing_key" && isForRestore && keyCheck.tokenBoundInSource) {
    blockers.push(
      "Cadangan memuat token ujian terenkripsi, tetapi NUSACBT_EXAM_TOKEN_KEY_FILE belum dikonfigurasi di server. Pulihkan berkas kunci token terlebih dahulu.",
    );
  } else if (keyCheck.tokenKeyStatus === "invalid_key" && isForRestore && keyCheck.tokenBoundInSource) {
    blockers.push("Berkas kunci token ujian (NUSACBT_EXAM_TOKEN_KEY_FILE) tidak valid atau tidak terbaca.");
  } else if (!keyCheck.tokenBoundInSource && !keyCheck.tokenConfigured) {
    warnings.push("Kunci token ujian belum dikonfigurasi pada server (belum terpakai di cadangan ini).");
  }

  return { blockers, warnings };
}

async function readLiveTableColumns(client: PoolClient) {
  const result = await client.query<{
    tableName: string;
    columnName: string;
    udtName: string;
    isNullable: string;
    isIdentity: string;
  }>(
    `SELECT table_name AS "tableName",
       column_name AS "columnName",
       udt_name AS "udtName",
       is_nullable AS "isNullable",
       is_identity AS "isIdentity"
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    [BACKUP_DOMAIN_TABLES],
  );

  const grouped = new Map<string, { hasIdentity: boolean; columns: BackupColumnDef[] }>();
  for (const row of result.rows) {
    let entry = grouped.get(row.tableName);
    if (!entry) {
      entry = { hasIdentity: false, columns: [] };
      grouped.set(row.tableName, entry);
    }
    if (row.isIdentity === "YES") entry.hasIdentity = true;
    entry.columns.push({
      name: row.columnName,
      udtName: row.udtName,
      nullable: row.isNullable === "YES",
    });
  }
  return grouped;
}

async function readLiveMigrations(client: PoolClient): Promise<{ version: string; checksum: string }[]> {
  const res = await client.query<{ version: string; checksum: string }>(
    "SELECT version, checksum FROM nusacbt_schema_migrations ORDER BY version ASC",
  );
  return res.rows;
}

async function readAttemptMaintenanceCounts(client: PoolClient) {
  const res = await client.query<{ activeOngoing: number; waitingExpired: number }>(
    `SELECT
       count(*) FILTER (WHERE completed_at IS NULL AND deadline > clock_timestamp())::int AS "activeOngoing",
       count(*) FILTER (WHERE completed_at IS NULL AND deadline <= clock_timestamp())::int AS "waitingExpired"
     FROM exam_attempts`,
  );
  return res.rows[0] ?? { activeOngoing: 0, waitingExpired: 0 };
}

async function readLiveAuditLogs(client: PoolClient): Promise<BackupAuditEntry[]> {
  const res = await client.query<BackupAuditEntry>(
    `SELECT id::text AS id,
       operation_id::text AS "operationId",
       action,
       actor_username_snapshot AS "actorUsername",
       archive_filename AS "archiveFilename",
       archive_sha256 AS "archiveSha256",
       schema_version AS "schemaVersion",
       table_count AS "tableCount",
       row_count AS "rowCount",
       blob_count AS "blobCount",
       byte_size::int AS "byteSize",
       detail,
       to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "occurredAt"
     FROM database_backup_audit
     ORDER BY id DESC
     LIMIT 20`,
  );
  return res.rows;
}

function summarizeParsedArchive(parsed: ParsedBackupArchive): DatabaseSummaryMetrics {
  const rowsOf = (name: string) => parsed.tableData.get(name)?.rows ?? [];
  const colIndex = (name: string, col: string) =>
    parsed.tableData.get(name)?.columns.findIndex((c) => c.name === col) ?? -1;

  const qCols = [
    colIndex("question_bank", "prompt_image"),
    colIndex("question_bank", "option_a_image"),
    colIndex("question_bank", "option_b_image"),
    colIndex("question_bank", "option_c_image"),
    colIndex("question_bank", "option_d_image"),
    colIndex("question_bank", "option_e_image"),
  ];
  let questionImages = 0;
  for (const row of rowsOf("question_bank")) {
    for (const idx of qCols) {
      if (idx >= 0 && row[idx] !== null) questionImages += 1;
    }
  }

  const snapshotImages = rowsOf("exam_question_snapshot_images").length;

  const appRows = rowsOf("app_settings");
  const logoIdx = colIndex("app_settings", "logo_image");
  const letterheadIdx = colIndex("app_settings", "letterhead_image");
  const firstApp = appRows[0] ?? [];

  return {
    adminUsers: rowsOf("admin_users").length,
    students: rowsOf("school_students").length,
    questions: rowsOf("question_bank").length,
    questionImages,
    snapshotImages,
    examTests: rowsOf("exam_tests").length,
    attempts: rowsOf("exam_attempts").length,
    hasBrandingLogo: logoIdx >= 0 && firstApp[logoIdx] !== null,
    hasBrandingLetterhead: letterheadIdx >= 0 && firstApp[letterheadIdx] !== null,
  };
}

function compareMigrations(
  live: { version: string; checksum: string }[],
  backup: { version: string; checksum: string }[],
): { compatible: boolean; message: string } {
  const latestLive = live.at(-1)?.version ?? "tidak diketahui";
  const latestBackup = backup.at(-1)?.version ?? "tidak diketahui";
  if (live.length !== backup.length) {
    return {
      compatible: false,
      message: `Skema cadangan (${latestBackup}, ${backup.length} migrasi) tidak cocok dengan skema server saat ini (${latestLive}, ${live.length} migrasi).`,
    };
  }
  for (let i = 0; i < live.length; i += 1) {
    if (live[i].version !== backup[i].version || live[i].checksum !== backup[i].checksum) {
      return {
        compatible: false,
        message: `Definisi migrasi ${backup[i]?.version ?? "?"} pada cadangan berbeda dengan migrasi server saat ini (${live[i].version}).`,
      };
    }
  }
  return {
    compatible: true,
    message: `Skema cocok persis (${latestLive}, ${live.length} migrasi terverifikasi).`,
  };
}

export async function loadToolDashboardData(): Promise<ToolDashboardData> {
  const serverKeys = await readServerKeyPair();
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const dbMeta = (
      await client.query<{ db: string; version: string; encoding: string }>(
        `SELECT current_database() AS db,
           current_setting('server_version') AS version,
           pg_encoding_to_char(encoding) AS encoding
         FROM pg_database WHERE datname = current_database()`,
      )
    ).rows[0];

    const migrations = await readLiveMigrations(client);
    const counts = await readAttemptMaintenanceCounts(client);
    const auditLogs = await readLiveAuditLogs(client);

    const summary = (
      await client.query<DatabaseSummaryMetrics>(
        `SELECT
           (SELECT count(*)::int FROM admin_users) AS "adminUsers",
           (SELECT count(*)::int FROM school_students) AS students,
           (SELECT count(*)::int FROM question_bank) AS questions,
           (SELECT COALESCE(sum(
             (prompt_image IS NOT NULL)::int + (option_a_image IS NOT NULL)::int +
             (option_b_image IS NOT NULL)::int + (option_c_image IS NOT NULL)::int +
             (option_d_image IS NOT NULL)::int + (option_e_image IS NOT NULL)::int
           ), 0)::int FROM question_bank) AS "questionImages",
           (SELECT count(*)::int FROM exam_question_snapshot_images) AS "snapshotImages",
           (SELECT count(*)::int FROM exam_tests) AS "examTests",
           (SELECT count(*)::int FROM exam_attempts) AS attempts,
           COALESCE((SELECT logo_image IS NOT NULL FROM app_settings WHERE id = 1), false) AS "hasBrandingLogo",
           COALESCE((SELECT letterhead_image IS NOT NULL FROM app_settings WHERE id = 1), false) AS "hasBrandingLetterhead"`,
      )
    ).rows[0];

    const pBind = (
      await client.query<{ verifier: Buffer }>("SELECT verifier FROM participant_password_key_binding WHERE id = 1")
    ).rows[0]?.verifier ?? null;
    const hasPw = (
      await client.query<{ present: boolean }>("SELECT EXISTS(SELECT 1 FROM participant_passwords) AS present")
    ).rows[0].present;
    const tBind = (
      await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id = 1")
    ).rows[0]?.verifier ?? null;
    const hasTok = (
      await client.query<{ present: boolean }>("SELECT EXISTS(SELECT 1 FROM exam_access_tokens WHERE code_version = 2) AS present")
    ).rows[0].present;

    await client.query("COMMIT");

    const keyCheck = evaluateKeyCompatibility({
      serverKeys,
      participantVerifier: pBind,
      hasEncryptedPasswords: hasPw,
      tokenVerifier: tBind,
      hasEncryptedTokens: hasTok,
    });

    return {
      databaseName: dbMeta?.db ?? "nusacbt",
      serverVersion: dbMeta?.version ?? "",
      encoding: dbMeta?.encoding ?? "UTF8",
      schemaVersion: migrations.at(-1)?.version ?? "",
      migrationCount: migrations.length,
      activeOngoingAttempts: counts.activeOngoing,
      waitingExpiredAttempts: counts.waitingExpired,
      summary,
      keyCheck,
      auditLogs,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    serverKeys.participantKey?.fill(0);
    serverKeys.tokenKey?.fill(0);
    client.release();
  }
}

export async function createDatabaseBackupArchive() {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SELECT pg_advisory_xact_lock($1)", [TOOL_ADVISORY_LOCK_KEY]);

    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      throw new DatabaseToolAuthError("Sesi admin diperlukan.");
    }
    if (!adminHasPermission(actor, "tools.manage")) {
      await client.query("ROLLBACK");
      throw new DatabaseToolPermissionError(PERMISSION_DENIED_MESSAGE);
    }

    const dbMeta = (
      await client.query<{ db: string; version: string; encoding: string }>(
        `SELECT current_database() AS db,
           current_setting('server_version') AS version,
           pg_encoding_to_char(encoding) AS encoding
         FROM pg_database WHERE datname = current_database()`,
      )
    ).rows[0];

    const migrations = await readLiveMigrations(client);
    const schemaVersion = migrations.at(-1)?.version ?? "";
    if (!schemaVersion) {
      throw new DatabaseToolError("Tabel riwayat migrasi nusacbt_schema_migrations kosong.");
    }

    const columnMap = await readLiveTableColumns(client);
    const blobRegistry = new Map<string, Buffer>();
    const serializedTables: {
      name: string;
      hasIdentity: boolean;
      columns: BackupColumnDef[];
      rows: unknown[][];
    }[] = [];

    for (const tableName of BACKUP_DOMAIN_TABLES) {
      const def = columnMap.get(tableName);
      if (!def || def.columns.length === 0) {
        throw new DatabaseToolError(`Tabel ${tableName} tidak ditemukan pada skema database.`);
      }
      const selectList = buildColumnSelectSql(def.columns);
      const hasId = def.columns.some((col) => col.name === "id");
      const orderBy = hasId ? 'ORDER BY "id" ASC' : `ORDER BY to_jsonb(t)::text ASC`;
      const queryRes = await client.query<Record<string, unknown>>(
        `SELECT ${selectList} FROM ${quoteIdent(tableName)} t ${orderBy}`,
      );
      serializedTables.push({
        name: tableName,
        hasIdentity: def.hasIdentity,
        columns: def.columns,
        rows: serializeTableRows(def.columns, queryRes.rows, blobRegistry),
      });
    }

    const seqMetaRows = (
      await client.query<{ tableName: string; columnName: string; sequenceName: string }>(
        `SELECT tbl.relname AS "tableName",
           col.attname AS "columnName",
           pg_get_serial_sequence(quote_ident(tbl.relname), col.attname) AS "sequenceName"
         FROM pg_class tbl
         JOIN pg_namespace ns ON ns.oid = tbl.relnamespace AND ns.nspname = 'public'
         JOIN pg_depend d ON d.refobjid = tbl.oid AND d.deptype IN ('a', 'i')
         JOIN pg_class seq ON seq.oid = d.objid AND seq.relkind = 'S'
         JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = d.refobjsubid
         WHERE tbl.relkind = 'r' AND tbl.relname = ANY($1::text[])
         ORDER BY tbl.relname, col.attname`,
        [BACKUP_DOMAIN_TABLES],
      )
    ).rows;

    const sequences: BackupSequenceMeta[] = [];
    for (const item of seqMetaRows) {
      if (!item.sequenceName || !SAFE_SEQ_RE.test(item.sequenceName)) continue;
      const seqNameQuoted = `public.${quoteIdent(item.sequenceName.slice("public.".length))}`;
      const state = (
        await client.query<{ lastValue: string; isCalled: boolean }>(
          `SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM ${seqNameQuoted}`,
        )
      ).rows[0];
      sequences.push({
        tableName: item.tableName,
        columnName: item.columnName,
        sequenceName: item.sequenceName,
        lastValue: state ? state.lastValue : null,
        isCalled: Boolean(state?.isCalled),
      });
    }

    const pBind = (
      await client.query<{ verifier: Buffer }>("SELECT verifier FROM participant_password_key_binding WHERE id = 1")
    ).rows[0]?.verifier;
    const tBind = (
      await client.query<{ verifier: Buffer }>("SELECT verifier FROM exam_token_key_binding WHERE id = 1")
    ).rows[0]?.verifier;

    const now = new Date();
    const archive = buildBackupArchiveZip({
      createdAt: now.toISOString(),
      databaseName: dbMeta?.db ?? "nusacbt",
      serverVersion: dbMeta?.version ?? "",
      encoding: dbMeta?.encoding ?? "UTF8",
      schemaVersion,
      migrations,
      keyBindings: {
        participantPassword: { bound: Boolean(pBind), verifierSha256: pBind ? sha256Hex(pBind) : null },
        examToken: { bound: Boolean(tBind), verifierSha256: tBind ? sha256Hex(tBind) : null },
      },
      tables: serializedTables,
      sequences,
      blobs: blobRegistry,
    });

    const filename = buildBackupFilename(now);

    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== actor.id) {
      await client.query("ROLLBACK");
      throw new DatabaseToolAuthError("Sesi admin diperlukan.");
    }
    if (!adminHasPermission(stillActive, "tools.manage")) {
      await client.query("ROLLBACK");
      throw new DatabaseToolPermissionError(PERMISSION_DENIED_MESSAGE);
    }

    await client.query(
      `INSERT INTO database_backup_audit (
         operation_id, action, actor_id, actor_username_snapshot,
         archive_filename, archive_sha256, schema_version,
         table_count, row_count, blob_count, byte_size, detail
       ) VALUES ($1::uuid, 'backup', $2::bigint, $3, $4, $5, $6, $7::int, $8::int, $9::int, $10::bigint, $11)`,
      [
        randomUUID(),
        actor.id,
        actor.username,
        filename,
        archive.archiveSha256,
        schemaVersion,
        archive.manifest.summary.tableCount,
        archive.manifest.summary.totalRows,
        archive.manifest.summary.blobCount,
        String(archive.byteSize),
        `Cadangan ${archive.manifest.summary.tableCount} tabel (${archive.manifest.summary.totalRows} baris, ${archive.manifest.summary.blobCount} berkas biner).`,
      ],
    );

    await client.query("COMMIT");
    return {
      buffer: archive.buffer,
      filename,
      archiveSha256: archive.archiveSha256,
      byteSize: archive.byteSize,
      summary: archive.manifest.summary,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof BackupArchiveError) {
      throw new DatabaseToolValidationError(error.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

function extractArchiveKeyBindings(parsed: ParsedBackupArchive) {
  const getVerifierBuffer = (tableName: string): Buffer | null => {
    const tbl = parsed.tableData.get(tableName);
    if (!tbl || tbl.rows.length === 0) return null;
    const idx = tbl.columns.findIndex((c) => c.name === "verifier");
    if (idx < 0) return null;
    const val = tbl.rows[0][idx];
    return Buffer.isBuffer(val) ? val : null;
  };
  return {
    participantVerifier: getVerifierBuffer("participant_password_key_binding"),
    hasEncryptedPasswords: (parsed.tableData.get("participant_passwords")?.rows.length ?? 0) > 0,
    tokenVerifier: getVerifierBuffer("exam_token_key_binding"),
    hasEncryptedTokens: (() => {
      const tbl = parsed.tableData.get("exam_access_tokens");
      if (!tbl) return false;
      const verIdx = tbl.columns.findIndex((c) => c.name === "code_version");
      if (verIdx < 0) return false;
      return tbl.rows.some((row) => row[verIdx] === 2);
    })(),
  };
}

export async function inspectBackupArchiveForRestore(buffer: Buffer, rawFilename: string): Promise<RestorePreviewReport> {
  let parsed: ParsedBackupArchive;
  try {
    parsed = await parseAndVerifyBackupArchive(buffer);
  } catch (error) {
    throw new DatabaseToolValidationError(
      error instanceof BackupArchiveError ? error.message : "Berkas cadangan tidak valid.",
    );
  }

  const serverKeys = await readServerKeyPair();
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      throw new DatabaseToolAuthError("Sesi admin diperlukan.");
    }
    if (!adminHasPermission(actor, "tools.manage")) {
      await client.query("ROLLBACK");
      throw new DatabaseToolPermissionError(PERMISSION_DENIED_MESSAGE);
    }

    const liveMigrations = await readLiveMigrations(client);
    const liveColumns = await readLiveTableColumns(client);
    const attemptCounts = await readAttemptMaintenanceCounts(client);
    await client.query("COMMIT");

    const blockers: string[] = [];
    const warnings: string[] = [];

    const migCheck = compareMigrations(liveMigrations, parsed.manifest.migrations);
    if (!migCheck.compatible) blockers.push(migCheck.message);

    // Pastikan seluruh kolom tabel di cadangan masih persis cocok dengan skema live.
    for (const tableName of BACKUP_DOMAIN_TABLES) {
      const liveDef = liveColumns.get(tableName);
      const archDef = parsed.tableData.get(tableName);
      if (!liveDef || !archDef) {
        blockers.push(`Definisi tabel ${tableName} tidak lengkap antara arsip dan database.`);
        continue;
      }
      if (liveDef.columns.length !== archDef.columns.length) {
        blockers.push(`Jumlah kolom tabel ${tableName} tidak cocok antara arsip dan database.`);
        continue;
      }
      for (let i = 0; i < liveDef.columns.length; i += 1) {
        if (
          liveDef.columns[i].name !== archDef.columns[i].name ||
          liveDef.columns[i].udtName !== archDef.columns[i].udtName
        ) {
          blockers.push(`Definisi kolom ${tableName}.${liveDef.columns[i].name} tidak cocok dengan database saat ini.`);
          break;
        }
      }
    }

    if (attemptCounts.activeOngoing > 0) {
      blockers.push(
        `Saat ini masih ada ${attemptCounts.activeOngoing} pengerjaan ujian aktif yang belum selesai. Hentikan/tunggu ujian selesai sebelum memulihkan database.`,
      );
    }
    if (attemptCounts.waitingExpired > 0) {
      warnings.push(
        `Terdapat ${attemptCounts.waitingExpired} pengerjaan melewati batas waktu yang menunggu pengumpulan otomatis; seluruh data tersebut akan digantikan isi cadangan.`,
      );
    }

    const extractedKeys = extractArchiveKeyBindings(parsed);
    const keyCheck = evaluateKeyCompatibility({
      serverKeys,
      ...extractedKeys,
    });
    const keyIssues = collectKeyBlockers(keyCheck, true);
    blockers.push(...keyIssues.blockers);
    warnings.push(...keyIssues.warnings);

    if ((parsed.tableData.get("participant_sessions")?.rows.length ?? 0) > 0) {
      warnings.push("Sesi login peserta tidak dipulihkan; peserta harus masuk ulang setelah pemulihan selesai.");
    }

    return {
      archiveFilename: sanitizeArchiveFilename(rawFilename),
      archiveSha256: parsed.archiveSha256,
      byteSize: parsed.byteSize,
      createdAt: parsed.manifest.createdAt,
      sourceDatabaseName: parsed.manifest.databaseName || "-",
      sourceServerVersion: parsed.manifest.serverVersion || "-",
      schemaVersion: parsed.manifest.schemaVersion,
      tableCount: parsed.manifest.summary.tableCount,
      totalRows: parsed.totalRows,
      blobCount: parsed.blobs.size,
      totalBlobBytes: parsed.manifest.summary.totalBlobBytes,
      schemaCompatible: migCheck.compatible,
      schemaMessage: migCheck.message,
      keyCheck,
      activeOngoingAttempts: attemptCounts.activeOngoing,
      waitingExpiredAttempts: attemptCounts.waitingExpired,
      canRestore: blockers.length === 0,
      blockers,
      warnings,
      summary: summarizeParsedArchive(parsed),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    serverKeys.participantKey?.fill(0);
    serverKeys.tokenKey?.fill(0);
    client.release();
  }
}

export async function executeDatabaseRestore(params: {
  buffer: Buffer;
  rawFilename: string;
  expectedArchiveSha256: string;
  confirmPhrase: string;
  currentSessionTokenHash: string | null;
}) {
  if (!validateRestorePhrase(params.confirmPhrase)) {
    throw new DatabaseToolValidationError('Ketik kata konfirmasi "PULIHKAN" (huruf kapital) untuk melanjutkan.');
  }
  if (!/^[0-9a-f]{64}$/.test(params.expectedArchiveSha256)) {
    throw new DatabaseToolValidationError("Sidik SHA-256 pratinjau tidak valid. Muat ulang pratinjau berkas.");
  }

  let parsed: ParsedBackupArchive;
  try {
    parsed = await parseAndVerifyBackupArchive(params.buffer);
  } catch (error) {
    throw new DatabaseToolValidationError(
      error instanceof BackupArchiveError ? error.message : "Berkas cadangan tidak valid.",
    );
  }

  if (parsed.archiveSha256 !== params.expectedArchiveSha256) {
    throw new DatabaseToolConflictError(
      "Berkas yang dikirim berbeda dari berkas yang diperiksa pada pratinjau. Jalankan pratinjau ulang sebelum memulihkan.",
    );
  }

  const filename = sanitizeArchiveFilename(params.rawFilename);
  const serverKeys = await readServerKeyPair();
  const client = await getPostgresPool().connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [TOOL_ADVISORY_LOCK_KEY]);

    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      throw new DatabaseToolAuthError("Sesi admin diperlukan.");
    }
    if (!adminHasPermission(actor, "tools.manage")) {
      await client.query("ROLLBACK");
      throw new DatabaseToolPermissionError(PERMISSION_DENIED_MESSAGE);
    }

    const liveMigrations = await readLiveMigrations(client);
    const migCheck = compareMigrations(liveMigrations, parsed.manifest.migrations);
    if (!migCheck.compatible) {
      await client.query("ROLLBACK");
      throw new DatabaseToolConflictError(migCheck.message);
    }

    const liveColumns = await readLiveTableColumns(client);
    for (const tableName of BACKUP_DOMAIN_TABLES) {
      const liveDef = liveColumns.get(tableName);
      const archDef = parsed.tableData.get(tableName);
      if (!liveDef || !archDef || liveDef.columns.length !== archDef.columns.length) {
        await client.query("ROLLBACK");
        throw new DatabaseToolConflictError(`Struktur tabel ${tableName} tidak cocok dengan skema server saat ini.`);
      }
      for (let i = 0; i < liveDef.columns.length; i += 1) {
        if (
          liveDef.columns[i].name !== archDef.columns[i].name ||
          liveDef.columns[i].udtName !== archDef.columns[i].udtName
        ) {
          await client.query("ROLLBACK");
          throw new DatabaseToolConflictError(`Kolom ${tableName}.${liveDef.columns[i].name} tidak cocok dengan skema server saat ini.`);
        }
      }
    }

    const attemptCounts = await readAttemptMaintenanceCounts(client);
    if (attemptCounts.activeOngoing > 0) {
      await client.query("ROLLBACK");
      throw new DatabaseToolConflictError(
        `Pemulihan diblokir: masih terdapat ${attemptCounts.activeOngoing} pengerjaan ujian aktif yang belum selesai.`,
      );
    }

    const extractedKeys = extractArchiveKeyBindings(parsed);
    const keyCheck = evaluateKeyCompatibility({ serverKeys, ...extractedKeys });
    const keyIssues = collectKeyBlockers(keyCheck, true);
    if (keyIssues.blockers.length > 0) {
      await client.query("ROLLBACK");
      throw new DatabaseToolConflictError(keyIssues.blockers[0]);
    }

    // Kosongkan seluruh tabel domain sekaligus tanpa memicu row-level trigger BEFORE DELETE.
    const truncateList = BACKUP_DOMAIN_TABLES.map((name) => quoteIdent(name)).join(", ");
    await client.query(`TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`);

    const deferredRoleUpdatedBy: { id: string; updatedBy: string }[] = [];

    for (const tableName of BACKUP_DOMAIN_TABLES) {
      if (TRANSIENT_TABLES_CLEARED_ON_RESTORE.has(tableName)) continue;

      const tbl = parsed.tableData.get(tableName);
      if (!tbl || tbl.rows.length === 0) continue;

      const twoPassCols = new Set(TWO_PASS_NULLABLE_FK_COLUMNS[tableName] ?? []);
      const roleIdColIdx = tbl.columns.findIndex((c) => c.name === "id");
      const roleUpdatedByIdx = tbl.columns.findIndex((c) => c.name === "updated_by");

      const colSql = tbl.columns.map((c) => quoteIdent(c.name)).join(", ");
      const colTypes = tbl.columns.map((c) => sqlTypeCast(c.udtName));
      const overrideSql = tbl.hasIdentity ? "OVERRIDING SYSTEM VALUE " : "";
      const batchSize = Math.max(1, Math.min(200, Math.floor(2000 / Math.max(1, tbl.columns.length))));

      for (let start = 0; start < tbl.rows.length; start += batchSize) {
        const slice = tbl.rows.slice(start, start + batchSize);
        const paramsList: unknown[] = [];
        const tuplePlaceholders: string[] = [];

        for (const row of slice) {
          if (tableName === "admin_roles" && twoPassCols.has("updated_by") && roleIdColIdx >= 0 && roleUpdatedByIdx >= 0) {
            const uBy = row[roleUpdatedByIdx];
            if (uBy !== null && uBy !== undefined) {
              deferredRoleUpdatedBy.push({ id: String(row[roleIdColIdx]), updatedBy: String(uBy) });
            }
          }
          const cellPlaceholders: string[] = [];
          for (let c = 0; c < tbl.columns.length; c += 1) {
            const colName = tbl.columns[c].name;
            const value = tableName === "admin_roles" && twoPassCols.has(colName) ? null : row[c];
            paramsList.push(value);
            cellPlaceholders.push(`$${paramsList.length}::${colTypes[c]}`);
          }
          tuplePlaceholders.push(`(${cellPlaceholders.join(", ")})`);
        }

        await client.query(
          `INSERT INTO ${quoteIdent(tableName)} (${colSql}) ${overrideSql}VALUES ${tuplePlaceholders.join(", ")}`,
          paramsList,
        );
      }
    }

    if (deferredRoleUpdatedBy.length > 0) {
      await client.query(
        `UPDATE admin_roles r
         SET updated_by = v.updated_by
         FROM unnest($1::bigint[], $2::bigint[]) AS v(id, updated_by)
         WHERE r.id = v.id`,
        [deferredRoleUpdatedBy.map((x) => x.id), deferredRoleUpdatedBy.map((x) => x.updatedBy)],
      );
    }

    // Pulihkan seluruh sequence milik tabel domain sesuai titik snapshot cadangan.
    const liveSeqRows = (
      await client.query<{ tableName: string; columnName: string; sequenceName: string }>(
        `SELECT tbl.relname AS "tableName",
           col.attname AS "columnName",
           pg_get_serial_sequence(quote_ident(tbl.relname), col.attname) AS "sequenceName"
         FROM pg_class tbl
         JOIN pg_namespace ns ON ns.oid = tbl.relnamespace AND ns.nspname = 'public'
         JOIN pg_depend d ON d.refobjid = tbl.oid AND d.deptype IN ('a', 'i')
         JOIN pg_class seq ON seq.oid = d.objid AND seq.relkind = 'S'
         JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = d.refobjsubid
         WHERE tbl.relkind = 'r' AND tbl.relname = ANY($1::text[])`,
        [BACKUP_DOMAIN_TABLES],
      )
    ).rows;
    const liveSeqMap = new Map<string, string>();
    for (const s of liveSeqRows) {
      if (s.sequenceName && SAFE_SEQ_RE.test(s.sequenceName)) {
        liveSeqMap.set(`${s.tableName}.${s.columnName}`, s.sequenceName);
      }
    }
    for (const seq of parsed.manifest.sequences) {
      const targetSeq = liveSeqMap.get(`${seq.tableName}.${seq.columnName}`);
      if (!targetSeq || seq.lastValue === null) continue;
      if (!BACKUP_DOMAIN_TABLE_SET.has(seq.tableName)) continue;
      await client.query("SELECT setval($1::regclass, $2::bigint, $3::boolean)", [
        targetSeq,
        seq.lastValue,
        seq.isCalled,
      ]);
    }

    let sessionPreserved = false;
    if (params.currentSessionTokenHash) {
      const sessionCheck = await client.query<{ preserved: boolean }>(
        `SELECT EXISTS(
           SELECT 1
           FROM admin_sessions s
           JOIN admin_users u ON u.id = s.admin_id
           WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp() AND u.is_active = true
         ) AS preserved`,
        [params.currentSessionTokenHash],
      );
      sessionPreserved = Boolean(sessionCheck.rows[0]?.preserved);
    }

    // Bila pelaku restorasi belum ada pada snapshot lama, tetap catat username snapshot dengan actor_id NULL.
    const actorExists = (
      await client.query<{ id: string }>("SELECT id::text AS id FROM admin_users WHERE id = $1::bigint", [actor.id])
    ).rows[0]?.id ?? null;

    await client.query(
      `INSERT INTO database_backup_audit (
         operation_id, action, actor_id, actor_username_snapshot,
         archive_filename, archive_sha256, schema_version,
         table_count, row_count, blob_count, byte_size, detail
       ) VALUES ($1::uuid, 'restore', $2::bigint, $3, $4, $5, $6, $7::int, $8::int, $9::int, $10::bigint, $11)`,
      [
        randomUUID(),
        actorExists,
        actor.username,
        filename,
        parsed.archiveSha256,
        parsed.manifest.schemaVersion,
        parsed.manifest.summary.tableCount,
        parsed.totalRows,
        parsed.blobs.size,
        String(parsed.byteSize),
        `Pemulihan ${parsed.manifest.summary.tableCount} tabel (${parsed.totalRows} baris, ${parsed.blobs.size} berkas biner). Sesi peserta dibersihkan.`,
      ],
    );

    await client.query("COMMIT");
    return {
      ok: true as const,
      archiveFilename: filename,
      archiveSha256: parsed.archiveSha256,
      schemaVersion: parsed.manifest.schemaVersion,
      tableCount: parsed.manifest.summary.tableCount,
      totalRows: parsed.totalRows,
      blobCount: parsed.blobs.size,
      sessionPreserved,
      summary: summarizeParsedArchive(parsed),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    serverKeys.participantKey?.fill(0);
    serverKeys.tokenKey?.fill(0);
    client.release();
  }
}
