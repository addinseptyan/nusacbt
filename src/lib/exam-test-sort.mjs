export const EXAM_TEST_SORT_STORAGE_KEY = "nusacbt.daftarTes.sort.v1";
export const EXAM_TEST_DEFAULT_SORT = "name_asc";

export const EXAM_TEST_SORT_OPTIONS = Object.freeze([
  { value: "name_asc", label: "Nama tes (A–Z)" },
  { value: "name_desc", label: "Nama tes (Z–A)" },
  { value: "start_desc", label: "Jadwal mulai (Terbaru)" },
  { value: "start_asc", label: "Jadwal mulai (Terlama)" },
  { value: "questions_desc", label: "Jumlah soal (Terbanyak)" },
  { value: "questions_asc", label: "Jumlah soal (Tersedikit)" },
  { value: "duration_desc", label: "Durasi (Terlama)" },
]);

const VALID_SORT_SET = new Set(EXAM_TEST_SORT_OPTIONS.map((opt) => opt.value));

/** @param {unknown} value */
export function normalizeExamTestSortMode(value) {
  return typeof value === "string" && VALID_SORT_SET.has(value) ? value : EXAM_TEST_DEFAULT_SORT;
}

function compareNames(a, b) {
  return (
    String(a.name ?? "").localeCompare(String(b.name ?? ""), "id", { sensitivity: "base" }) ||
    String(a.name ?? "").localeCompare(String(b.name ?? ""), "id") ||
    String(b.startLocal ?? "").localeCompare(String(a.startLocal ?? "")) ||
    String(b.id ?? "").localeCompare(String(a.id ?? ""))
  );
}

/**
 * Mengurutkan rancangan tes secara deterministik sesuai mode pilihan admin.
 * @template {{ id: string, name: string, startLocal: string, durationMinutes: number, questionIds: readonly string[] }} T
 * @param {readonly T[]} tests
 * @param {string} mode
 * @returns {T[]}
 */
export function sortExamTests(tests, mode) {
  const normalized = normalizeExamTestSortMode(mode);
  const copy = [...tests];
  copy.sort((a, b) => {
    switch (normalized) {
      case "name_desc":
        return -compareNames(a, b);
      case "start_desc":
        return (
          String(b.startLocal ?? "").localeCompare(String(a.startLocal ?? "")) ||
          compareNames(a, b)
        );
      case "start_asc":
        return (
          String(a.startLocal ?? "").localeCompare(String(b.startLocal ?? "")) ||
          compareNames(a, b)
        );
      case "questions_desc":
        return (b.questionIds?.length ?? 0) - (a.questionIds?.length ?? 0) || compareNames(a, b);
      case "questions_asc":
        return (a.questionIds?.length ?? 0) - (b.questionIds?.length ?? 0) || compareNames(a, b);
      case "duration_desc":
        return (b.durationMinutes ?? 0) - (a.durationMinutes ?? 0) || compareNames(a, b);
      case "name_asc":
      default:
        return compareNames(a, b);
    }
  });
  return copy;
}
