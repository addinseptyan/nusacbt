export type SpreadsheetCell = string | number | { score: number; style?: "makeup" } | { text: string; style: "conflict" } | null | undefined;
export type SpreadsheetSheet = {
  name: string;
  columns: Array<{ title: string; width: number }>;
  rows: SpreadsheetCell[][];
  preamble?: SpreadsheetCell[][];
  /** Tata letak rekap: metadata di atas dan pita nama tes di atas header. Indeks kolom berbasis nol. */
  matrixLayout?: { firstTestColumn: number; groupTitle: string };
};
export function createReportWorkbook(sheets: SpreadsheetSheet[]): Uint8Array;
