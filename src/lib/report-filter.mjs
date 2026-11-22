import { validDataId } from './class-validation.mjs';

export const REPORT_ZONES = Object.freeze({ WIB: 7, WITA: 8, WIT: 9 });
const FIELDS = ['periode', 'tes', 'kelas', 'siswa', 'mulai', 'sampai', 'zona', 'halaman'];

/** Mengubah tanggal lokal berketelitian menit dalam zona Indonesia menjadi UTC. */
function minuteInUtc(value, offsetHours) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const [year, month, day, hour, minute] = [y, mo, d, h, mi].map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day ||
      local.getUTCHours() !== hour || local.getUTCMinutes() !== minute) return null;
  return local.getTime() - offsetHours * 60 * 60 * 1000;
}

/**
 * Filter ini dipakai sama persis oleh halaman dan endpoint Excel. Rentang akhir
 * mencakup seluruh menit yang dipilih, lalu diubah menjadi batas atas eksklusif.
 * @param {URLSearchParams} params
 * @returns {{ok: true, filters: import('./report-filter.mjs').ReportFilters, page: number} | {ok: false, error: string}}
 */
export function parseReportFilters(params) {
  if (!(params instanceof URLSearchParams)) return { ok: false, error: 'Filter laporan tidak valid.' };
  for (const field of FIELDS) if (params.getAll(field).length > 1) return { ok: false, error: `Filter ${field} dikirim lebih dari sekali.` };
  const get = (name) => params.get(name) ?? '';
  const periodId = get('periode') === '' ? null : validDataId(get('periode'));
  const testId = get('tes') === '' ? null : validDataId(get('tes'));
  if ((get('periode') && !periodId) || (get('tes') && !testId)) return { ok: false, error: 'Filter periode atau tes tidak valid.' };
  // Nilai kelas berasal dari snapshot persis; jangan membuang spasi pada
  // snapshot lama yang mungkin tersimpan dengan spasi di tepi.
  const className = get('kelas') || null;
  const student = get('siswa').trim() || null;
  if ((className && (!className.trim() || Array.from(className).length > 100 || /[\u0000-\u001f\u007f]/.test(className))) ||
      (student && (Array.from(student).length > 100 || /[\u0000-\u001f\u007f]/.test(student)))) {
    return { ok: false, error: 'Filter kelas atau siswa terlalu panjang atau mengandung karakter kontrol.' };
  }
  const zone = get('zona') || 'WIB';
  if (!Object.hasOwn(REPORT_ZONES, zone)) return { ok: false, error: 'Zona waktu harus WIB, WITA, atau WIT.' };
  const fromLocal = get('mulai') || null;
  const toLocal = get('sampai') || null;
  const offset = REPORT_ZONES[/** @type {keyof typeof REPORT_ZONES} */ (zone)];
  const from = fromLocal ? minuteInUtc(fromLocal, offset) : null;
  const to = toLocal ? minuteInUtc(toLocal, offset) : null;
  if ((fromLocal && from === null) || (toLocal && to === null)) {
    return { ok: false, error: 'Tanggal dan waktu harus valid, berketelitian menit, antara tahun 2000 dan 2100.' };
  }
  if (from !== null && to !== null && from > to) return { ok: false, error: 'Waktu mulai filter tidak boleh sesudah waktu akhir.' };
  const rawPage = get('halaman');
  if (rawPage && !/^[1-9]\d{0,5}$/.test(rawPage)) return { ok: false, error: 'Nomor halaman tidak valid.' };
  return {
    ok: true,
    filters: {
      periodId, testId, className, student, zone: /** @type {'WIB'|'WITA'|'WIT'} */ (zone),
      fromLocal, toLocal,
      fromUtc: from === null ? null : new Date(from).toISOString(),
      toUtcExclusive: to === null ? null : new Date(to + 60_000).toISOString(),
    },
    page: rawPage ? Number(rawPage) : 1,
  };
}

/** @param {import('./report-filter.mjs').ReportFilters} filters @param {number} [page] */
export function reportSearchParams(filters, page = 1) {
  const p = new URLSearchParams();
  if (filters.periodId) p.set('periode', filters.periodId);
  if (filters.testId) p.set('tes', filters.testId);
  if (filters.className) p.set('kelas', filters.className);
  if (filters.student) p.set('siswa', filters.student);
  if (filters.fromLocal) p.set('mulai', filters.fromLocal);
  if (filters.toLocal) p.set('sampai', filters.toLocal);
  p.set('zona', filters.zone);
  if (page > 1) p.set('halaman', String(page));
  return p;
}
