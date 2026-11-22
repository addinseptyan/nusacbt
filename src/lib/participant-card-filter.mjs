import { validDataId } from './class-validation.mjs';

// Periode adalah konteks internal untuk memeriksa pratinjau usang, bukan
// pilihan pada halaman. Halaman selalu mengisi periode login aktif dari server.
const FIELDS = ['periode', 'kelas', 'siswa', 'halaman'];

/** @param {URLSearchParams} params
 * @returns {{ok:true, filters:import('./participant-card-filter.mjs').CardFilters, page:number}|{ok:false,error:string}} */
export function parseCardFilters(params) {
  if (!(params instanceof URLSearchParams)) return { ok: false, error: 'Filter kartu tidak valid.' };
  for (const name of params.keys()) if (!FIELDS.includes(name)) return { ok: false, error: `Filter ${name} tidak tersedia pada kartu.` };
  for (const name of FIELDS) if (params.getAll(name).length > 1) return { ok: false, error: `Filter ${name} dikirim lebih dari sekali.` };
  const get = (name) => params.get(name) ?? '';
  const periodId = get('periode') ? validDataId(get('periode')) : null;
  const classId = get('kelas') ? validDataId(get('kelas')) : null;
  if ((get('periode') && !periodId) || (get('kelas') && !classId)) return { ok: false, error: 'Periode atau kelas tidak valid.' };
  const student = get('siswa').trim() || null;
  if (student && (!student.isWellFormed() || Array.from(student).length > 100 || /[\u0000-\u001f\u007f-\u009f]/.test(student))) {
    return { ok: false, error: 'Pencarian terlalu panjang atau mengandung karakter kontrol.' };
  }
  const rawPage = get('halaman');
  if (rawPage && !/^[1-9]\d{0,5}$/.test(rawPage)) return { ok: false, error: 'Nomor halaman tidak valid.' };
  return { ok: true, filters: { periodId, classId, student }, page: rawPage ? Number(rawPage) : 1 };
}

/** @param {import('./participant-card-filter.mjs').CardFilters} filters @param {number} [page] @param {boolean} [includePeriod] */
export function cardSearchParams(filters, page = 1, includePeriod = false) {
  const params = new URLSearchParams();
  if (includePeriod && filters.periodId) params.set('periode', filters.periodId);
  if (filters.classId) params.set('kelas', filters.classId);
  if (filters.student) params.set('siswa', filters.student);
  if (page > 1) params.set('halaman', String(page));
  return params;
}
