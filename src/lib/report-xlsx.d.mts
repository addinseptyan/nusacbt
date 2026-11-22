export type SpreadsheetCell = string | number | { score: number } | null | undefined;
export type SpreadsheetSheet = {
  name: string;
  columns: Array<{ title: string; width: number }>;
  rows: SpreadsheetCell[][];
};
export function createReportWorkbook(sheets: SpreadsheetSheet[]): Uint8Array;
