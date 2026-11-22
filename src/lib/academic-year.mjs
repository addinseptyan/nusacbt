import { validDataId } from './class-validation.mjs';

/** @param {unknown} value */
export function validateAcademicYearName(value) {
  if (typeof value !== 'string') return { ok: false, error: 'Isi tahun ajaran, misalnya 2026/2027.' };
  const name = value.trim();
  const match = /^(\d{4})\/(\d{4})$/.exec(name);
  if (!match || Number(match[1]) < 1900 || Number(match[1]) > 2199 || Number(match[2]) !== Number(match[1]) + 1) {
    return { ok: false, error: 'Gunakan dua tahun berurutan, misalnya 2026/2027.' };
  }
  return { ok: true, value: name };
}

/** Usulan hanya bila tingkat berikutnya dan jurusan yang sama benar-benar ada. */
export function suggestedPromotion(source, classes) {
  const next = { X: 'XI', XI: 'XII', '10': '11', '11': '12' }[String(source.level).toUpperCase()];
  if (!next) return null;
  return classes.find((item) => item.level === next && item.majorId === source.majorId)?.id ?? null;
}

/** @param {unknown} raw */
export function parseRolloverChoices(raw) {
  if (typeof raw !== 'string' || raw.length > 2_000_000) return null;
  let rows;
  try { rows = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) return null;
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((k) => !['studentId', 'action', 'classId'].includes(k))) return null;
    if (!validDataId(row.studentId) || seen.has(row.studentId) || !['promoted','repeated','graduated','left','keep'].includes(row.action)) return null;
    if (typeof row.classId !== 'string' || (['promoted','repeated'].includes(row.action) ? !validDataId(row.classId) : row.classId !== '')) return null;
    seen.add(row.studentId);
  }
  return rows;
}
