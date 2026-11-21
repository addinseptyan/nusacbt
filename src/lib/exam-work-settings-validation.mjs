export const EXAM_WORK_WINDOW_MINUTES_MIN = 1;
export const EXAM_WORK_WINDOW_MINUTES_MAX = 10080;

/** @param {unknown} raw @returns {number | null} */
export function examSubmissionWindowMinutes(raw) {
  if (typeof raw !== "string" || !/^[1-9]\d{0,4}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= EXAM_WORK_WINDOW_MINUTES_MIN && value <= EXAM_WORK_WINDOW_MINUTES_MAX ? value : null;
}

/** Tanda dikirim sebagai literal, bukan Boolean() atas input arbitrer. @param {unknown} raw @returns {boolean | null} */
export function examDoubtfulValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}
