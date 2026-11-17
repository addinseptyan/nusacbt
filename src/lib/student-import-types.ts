export type ImportStatus = "siswa-baru" | "penempatan-baru" | "sudah-sesuai" | "masalah";

export type ImportPreviewRow = {
  rowNumber: number;
  name: string;
  nisn: string;
  className: string;
  status: ImportStatus;
  issues: string[];
};

export type ImportCounts = {
  rows: number;
  newStudents: number;
  newPlacements: number;
  unchanged: number;
  problems: number;
};

export type ImportPreview = {
  periodName: string;
  periodStart: string;
  rows: ImportPreviewRow[];
  counts: ImportCounts;
  token: string | null;
};

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };
export type ImportResult = { ok: true; counts: ImportCounts } | { ok: false; error: string };
