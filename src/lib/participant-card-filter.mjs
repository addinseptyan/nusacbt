import { validDataId } from './class-validation.mjs';

const FIELDS = ['periode', 'kelas', 'tes', 'kategori', 'siswa', 'halaman'];
const KINDS = ['regular', 'makeup', 'remedial'];

/**
 * Filter diterapkan pada penempatan aktif. Tes/kategori, bila dipilih,
 * harus cocok pada pelaksanaan DIRILIS yang sama; tanpa keduanya daftar
 * mencakup semua peserta kelas aktif, termasuk yang belum dijadwalkan.
 * @param {URLSearchParams} params
 * @returns {{ok: true, filters: import('./participant-card-filter.mjs').CardFilters, page: number} | {ok: false, error: string}}
 */
export function parseCardFilters(params) {
  if (!(params instanceof URLSearchParams)) return { ok: false, error: 'Filter kartu tidak valid.' };
  for (const name of FIELDS) {
    if (params.getAll(name).length > 1) return { ok: false, error: `Filter ${name} dikirim lebih dari sekali.` };
  }
  const get = (name) => params.get(name) ?? '';
  const periodId = get('periode') ? validDataId(get('periode')) : null;
  const classId = get('kelas') ? validDataId(get('kelas')) : null;
  const testId = get('tes') ? validDataId(get('tes')) : null;
  if ((get('periode') && !periodId) || (get('kelas') && !classId) || (get('tes') && !testId)) {
    return { ok: false, error: 'Filter periode, kelas, atau tes tidak valid.' };
  }
  const rawKind = get('kategori');
  if (rawKind && !KINDS.includes(rawKind)) return { ok: false, error: 'Kategori pelaksanaan tidak valid.' };
  const student = get('siswa').trim() || null;
  if (student && (!student.isWellFormed() || Array.from(student).length > 100 || /[\u0000-\u001f\u007f-\u009f]/.test(student))) {
    return { ok: false, error: 'Pencarian terlalu panjang atau mengandung karakter kontrol.' };
  }
  const rawPage = get('halaman');
  if (rawPage && !/^[1-9]\d{0,5}$/.test(rawPage)) return { ok: false, error: 'Nomor halaman tidak valid.' };
  if (!periodId && (classId || testId || rawKind || student || (rawPage && rawPage !== '1'))) {
    return { ok: false, error: 'Pilih periode sebelum menyaring peserta.' };
  }
  return { ok: true, filters: { periodId, classId, testId, kind: /** @type {'regular'|'makeup'|'remedial'|null} */ (rawKind || null), student }, page: rawPage ? Number(rawPage) : 1 };
}

/** @param {import('./participant-card-filter.mjs').CardFilters} filters @param {number} [page] */
export function cardSearchParams(filters, page = 1) {
  const params = new URLSearchParams();
  if (filters.periodId) params.set('periode', filters.periodId);
  if (filters.classId) params.set('kelas', filters.classId);
  if (filters.testId) params.set('tes', filters.testId);
  if (filters.kind) params.set('kategori', filters.kind);
  if (filters.student) params.set('siswa', filters.student);
  if (page > 1) params.set('halaman', String(page));
  return params;
}
