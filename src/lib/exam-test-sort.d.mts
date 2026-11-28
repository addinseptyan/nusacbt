export type ExamTestSortMode =
  | "name_asc"
  | "name_desc"
  | "start_desc"
  | "start_asc"
  | "questions_desc"
  | "questions_asc"
  | "duration_desc";

export const EXAM_TEST_SORT_STORAGE_KEY: string;
export const EXAM_TEST_DEFAULT_SORT: ExamTestSortMode;
export const EXAM_TEST_SORT_OPTIONS: readonly { value: ExamTestSortMode; label: string }[];
export function normalizeExamTestSortMode(value: unknown): ExamTestSortMode;
export function sortExamTests<
  T extends { id: string; name: string; startLocal: string; durationMinutes: number; questionIds: readonly string[] },
>(tests: readonly T[], mode: ExamTestSortMode | string): T[];
