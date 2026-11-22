export type CardKind = 'regular' | 'makeup' | 'remedial';
export type CardFilters = {
  periodId: string | null;
  classId: string | null;
  testId: string | null;
  kind: CardKind | null;
  student: string | null;
};
export function parseCardFilters(params: URLSearchParams):
  | { ok: true; filters: CardFilters; page: number }
  | { ok: false; error: string };
export function cardSearchParams(filters: CardFilters, page?: number): URLSearchParams;
