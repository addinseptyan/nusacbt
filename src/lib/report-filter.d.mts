export type ReportZone = 'WIB' | 'WITA' | 'WIT';
export type ReportFilters = {
  periodId: string | null;
  testId: string | null;
  className: string | null;
  student: string | null;
  zone: ReportZone;
  fromLocal: string | null;
  toLocal: string | null;
  fromUtc: string | null;
  toUtcExclusive: string | null;
};
export const REPORT_ZONES: Readonly<Record<ReportZone, number>>;
export function parseReportFilters(params: URLSearchParams):
  | { ok: true; filters: ReportFilters; page: number }
  | { ok: false; error: string };
export function reportSearchParams(filters: ReportFilters, page?: number): URLSearchParams;
