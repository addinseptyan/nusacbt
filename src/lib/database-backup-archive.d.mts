export const BACKUP_FORMAT_ID: string;
export const BACKUP_FORMAT_VERSION: number;
export const MAX_BACKUP_UPLOAD_BYTES: number;
export const MAX_BACKUP_EXPANDED_BYTES: number;
export const MAX_BACKUP_ENTRY_BYTES: number;
export const MAX_BACKUP_ENTRIES: number;
export const RESTORE_CONFIRMATION_PHRASE: string;
export const BACKUP_DOMAIN_TABLES: readonly string[];
export const BACKUP_DOMAIN_TABLE_SET: Set<string>;
export const TWO_PASS_NULLABLE_FK_COLUMNS: Readonly<Record<string, readonly string[]>>;
export const TRANSIENT_TABLES_CLEARED_ON_RESTORE: Set<string>;

export class BackupArchiveError extends Error {}

export type BackupColumnDef = {
  name: string;
  udtName: string;
  nullable: boolean;
};

export type BackupSequenceMeta = {
  tableName: string;
  columnName: string;
  sequenceName: string;
  lastValue: string | null;
  isCalled: boolean;
};

export type BackupManifest = {
  format: string;
  formatVersion: number;
  createdAt: string;
  databaseName: string;
  serverVersion: string;
  encoding: string;
  schemaVersion: string;
  migrations: { version: string; checksum: string }[];
  keyBindings: {
    participantPassword: { bound: boolean; verifierSha256: string | null };
    examToken: { bound: boolean; verifierSha256: string | null };
  };
  tables: {
    name: string;
    entryPath: string;
    sha256: string;
    byteSize: number;
    rowCount: number;
  }[];
  blobs: {
    sha256: string;
    entryPath: string;
    byteSize: number;
  }[];
  sequences: BackupSequenceMeta[];
  summary: {
    tableCount: number;
    totalRows: number;
    blobCount: number;
    totalBlobBytes: number;
  };
};

export type ParsedBackupArchive = {
  archiveSha256: string;
  byteSize: number;
  manifest: BackupManifest;
  tableData: Map<
    string,
    {
      name: string;
      hasIdentity: boolean;
      columns: BackupColumnDef[];
      rows: unknown[][];
    }
  >;
  blobs: Map<string, Buffer>;
  totalRows: number;
};

export function sha256Hex(input: string | Uint8Array | Buffer): string;
export function validateRestorePhrase(phrase: unknown): boolean;
export function buildBackupFilename(date?: Date): string;
export function sanitizeArchiveFilename(raw: unknown, fallback?: string): string;
export function buildColumnSelectSql(columns: Pick<BackupColumnDef, "name" | "udtName">[]): string;
export function serializeTableRows(
  columns: BackupColumnDef[],
  rows: Record<string, unknown>[],
  blobRegistry: Map<string, Buffer>,
): unknown[][];
export function buildBackupArchiveZip(payload: {
  createdAt: string;
  databaseName: string;
  serverVersion: string;
  encoding: string;
  schemaVersion: string;
  migrations: { version: string; checksum: string }[];
  keyBindings: BackupManifest["keyBindings"];
  tables: {
    name: string;
    hasIdentity: boolean;
    columns: BackupColumnDef[];
    rows: unknown[][];
  }[];
  sequences: BackupSequenceMeta[];
  blobs: Map<string, Buffer>;
}): {
  buffer: Buffer;
  archiveSha256: string;
  byteSize: number;
  manifest: BackupManifest;
};
export function parseAndVerifyBackupArchive(inputBuffer: Buffer): Promise<ParsedBackupArchive>;
