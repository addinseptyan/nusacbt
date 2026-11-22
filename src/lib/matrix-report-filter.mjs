import { validDataId } from './class-validation.mjs';
import { parseMonitoringFilters } from './monitoring-filter.mjs';
const fields = ['tahun','periode','tes','kelas','siswa','kategori','gabung','dari','sampai','zona','halaman'];
/** @param {URLSearchParams} p @returns {{ok:true,filters:import('./matrix-report-filter.mjs').MatrixFilters,page:number}|{ok:false,error:string}} */
export function parseMatrixFilters(p) {
  if (!(p instanceof URLSearchParams)) return {ok:false,error:'Filter rekap tidak valid.'};
  for (const k of p.keys()) if (!fields.includes(k)) return {ok:false,error:`Filter ${k} tidak dikenal.`};
  for (const k of fields) if (p.getAll(k).length>1) return {ok:false,error:`Filter ${k} dikirim lebih dari sekali.`};
  const get = (k) => p.get(k) ?? '';
  const yearId = get('tahun') ? validDataId(get('tahun')) : null, periodId = get('periode') ? validDataId(get('periode')) : null, testId = get('tes') ? validDataId(get('tes')) : null;
  if ((get('tahun') && !yearId)||(get('periode') && !periodId)||(get('tes') && !testId)) return {ok:false,error:'Tahun, periode, atau tes tidak valid.'};
  const className = get('kelas') || null, student = get('siswa').trim() || null;
  if ([className,student].some((v) => v && (!v.isWellFormed() || !v.trim() || Array.from(v).length>100 || /[\u0000-\u001f\u007f-\u009f]/.test(v)))) return {ok:false,error:'Kelas atau pencarian siswa tidak valid.'};
  const kind = get('kategori') || 'regular'; if (!['regular','makeup','remedial'].includes(kind)) return {ok:false,error:'Jenis ujian tidak valid.'};
  const mergeRaw = get('gabung'); if (!['','1'].includes(mergeRaw) || (mergeRaw === '1' && kind !== 'regular')) return {ok:false,error:'Penggabungan hanya tersedia untuk pilihan Reguler.'};
  const dateParams = new URLSearchParams(); for (const k of ['dari','sampai','zona']) if (get(k)) dateParams.set(k,get(k));
  const date = parseMonitoringFilters(dateParams); if (!date.ok) return date;
  const page = get('halaman'); if (page && !/^[1-9]\d{0,5}$/.test(page)) return {ok:false,error:'Nomor halaman tidak valid.'};
  return {ok:true,filters:{yearId,periodId,testId,className,student,kind,merge:mergeRaw==='1',zone:date.filters.zone,
    from:date.filters.from,to:date.filters.to,fromUtc:date.filters.fromUtc,toUtcExclusive:date.filters.toUtcExclusive},page:page ? Number(page) : 1};
}
/** @param {import('./matrix-report-filter.mjs').MatrixFilters} f @param {number} [page] */
export function matrixSearchParams(f,page=1) {
  const p = new URLSearchParams(); if(f.yearId)p.set('tahun',f.yearId);if(f.periodId)p.set('periode',f.periodId);if(f.testId)p.set('tes',f.testId);
  if(f.className)p.set('kelas',f.className);if(f.student)p.set('siswa',f.student);if(f.kind!=='regular')p.set('kategori',f.kind);if(f.merge)p.set('gabung','1');
  if(f.from)p.set('dari',f.from);if(f.to)p.set('sampai',f.to);if(f.zone!=='WIB')p.set('zona',f.zone);if(page>1)p.set('halaman',String(page));return p;
}
