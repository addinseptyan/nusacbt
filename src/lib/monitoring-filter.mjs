import { validDataId } from './class-validation.mjs';

const fields = ['tahun','tes','kelas','kategori','status','dari','sampai','zona','urut','halaman','nilaiHalaman'];
const statuses = ['not_started','working','waiting','submitted','time_expired'];
const kinds = ['regular','makeup','remedial'];
const orders = ['time_desc','time_asc','score_desc','score_asc','student_asc','student_desc','test_asc','test_desc'];
const zones = { WIB: 7, WITA: 8, WIT: 9 };
function dateUtc(value, offset) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null;
  return day.getTime() - offset * 3600_000;
}
/** @param {URLSearchParams} p @returns {{ok:true, filters:import('./monitoring-filter.mjs').MonitoringFilters,page:number,finalPage:number}|{ok:false,error:string}} */
export function parseMonitoringFilters(p) {
  if (!(p instanceof URLSearchParams)) return { ok:false, error:'Filter monitoring tidak valid.' };
  for (const key of p.keys()) if (!fields.includes(key)) return { ok:false, error:`Filter ${key} tidak dikenal.` };
  for (const key of fields) if (p.getAll(key).length > 1) return { ok:false, error:`Filter ${key} dikirim lebih dari sekali.` };
  const get = (key) => p.get(key) ?? '';
  const yearId = get('tahun') ? validDataId(get('tahun')) : null;
  const testId = get('tes') ? validDataId(get('tes')) : null;
  if ((get('tahun') && !yearId) || (get('tes') && !testId)) return { ok:false, error:'Tahun ajaran atau tes tidak valid.' };
  const className = get('kelas') || null;
  if (className && (!className.isWellFormed() || !className.trim() || Array.from(className).length > 100 || /[\u0000-\u001f\u007f-\u009f]/.test(className))) return { ok:false, error:'Kelas tidak valid.' };
  const kind = get('kategori') || null, status = get('status') || null;
  if ((kind && !kinds.includes(kind)) || (status && !statuses.includes(status))) return { ok:false,error:'Kategori atau status tidak valid.' };
  const order = get('urut') || 'time_desc';
  if (!orders.includes(order)) return { ok:false,error:'Pengurutan tidak valid.' };
  const zone = get('zona') || 'WIB'; if (!Object.hasOwn(zones,zone)) return { ok:false,error:'Zona waktu tidak valid.' };
  const from = get('dari') || null, to = get('sampai') || null;
  const a = from ? dateUtc(from, zones[zone]) : null, b = to ? dateUtc(to, zones[zone]) : null;
  if ((from && a === null) || (to && b === null) || (a !== null && b !== null && a > b)) return { ok:false,error:'Rentang tanggal tidak valid (tahun 2000–2100).' };
  const page = get('halaman'), finalPage = get('nilaiHalaman');
  if ((page && !/^[1-9]\d{0,5}$/.test(page)) || (finalPage && !/^[1-9]\d{0,5}$/.test(finalPage))) return { ok:false,error:'Nomor halaman tidak valid.' };
  return { ok:true, filters:{ yearId,testId,className,kind,status,order,zone,from,to,
    fromUtc:a === null ? null : new Date(a).toISOString(), toUtcExclusive:b === null ? null : new Date(b + 86400_000).toISOString() },
    page:page ? Number(page) : 1, finalPage:finalPage ? Number(finalPage) : 1 };
}
/** @param {import('./monitoring-filter.mjs').MonitoringFilters} f @param {number} [page] @param {number} [finalPage] */
export function monitoringSearchParams(f,page=1,finalPage=1) {
  const p = new URLSearchParams();
  if(f.yearId) p.set('tahun',f.yearId); if(f.testId) p.set('tes',f.testId); if(f.className) p.set('kelas',f.className);
  if(f.kind) p.set('kategori',f.kind); if(f.status) p.set('status',f.status);
  if(f.from) p.set('dari',f.from); if(f.to) p.set('sampai',f.to); if(f.zone !== 'WIB') p.set('zona',f.zone);
  if(f.order !== 'time_desc') p.set('urut',f.order); if(page>1) p.set('halaman',String(page)); if(finalPage>1) p.set('nilaiHalaman',String(finalPage));
  return p;
}
