import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReportFilters, reportSearchParams } from '../../src/lib/report-filter.mjs';

function parse(query) { return parseReportFilters(new URLSearchParams(query)); }
test('filter kosong dan halaman mempertahankan zona WIB tanpa batas', () => {
  const result = parse(''); assert.equal(result.ok, true);
  assert.equal(result.page, 1); assert.equal(result.filters.zone, 'WIB');
  assert.equal(result.filters.fromUtc, null); assert.equal(result.filters.toUtcExclusive, null);
});
test('rentang selesai inklusif pada satu menit dan zona Indonesia', () => {
  for (const [zone, from, to] of [
    ['WIB', '2024-02-29T00:00:00.000Z', '2024-02-29T00:01:00.000Z'],
    ['WITA', '2024-02-28T23:00:00.000Z', '2024-02-28T23:01:00.000Z'],
    ['WIT', '2024-02-28T22:00:00.000Z', '2024-02-28T22:01:00.000Z'],
  ]) {
    const p = new URLSearchParams({ zona: zone, mulai: '2024-02-29T07:00', sampai: '2024-02-29T07:00' });
    const result = parseReportFilters(p); assert.equal(result.ok, true);
    assert.equal(result.filters.fromUtc, from); assert.equal(result.filters.toUtcExclusive, to);
  }
});
test('tanggal tidak valid, terbalik, di luar batas, atau berketelitian salah ditolak', () => {
  for (const q of [
    'mulai=2025-02-29T10%3A00', 'mulai=2024-04-31T10%3A00', 'mulai=2101-01-01T00%3A00',
    'mulai=1999-12-31T23%3A59', 'mulai=2025-12-01T24%3A00', 'mulai=2025-12-01T12%3A60',
    'mulai=2025-12-01T12%3A00%3A00', 'mulai=2025-12-02T12%3A00&sampai=2025-12-01T12%3A00',
  ]) assert.equal(parse(q).ok, false, q);
  assert.equal(parse('mulai=2000-02-29T00%3A00&sampai=2100-12-31T23%3A59').ok, true);
});
test('duplikasi, ID, zona, halaman dan input berbahaya ditolak dengan aman', () => {
  for (const q of ['tes=1&tes=2', 'zona=WIB&zona=WITA', 'periode=0', 'tes=9223372036854775808',
    'zona=__proto__', 'halaman=0', 'halaman=1000000', 'siswa=%00', `siswa=${'x'.repeat(101)}`]) {
    assert.equal(parse(q).ok, false, q);
  }
  const search = new URLSearchParams({ siswa: "  O'HARA_%\\  ", kelas: ' X AK ', tes: '42', zona: 'WITA', halaman: '3' });
  const result = parseReportFilters(search); assert.equal(result.ok, true);
  assert.equal(result.filters.student, "O'HARA_%\\"); assert.equal(result.filters.className, ' X AK ');
  assert.equal(result.page, 3);
  const restored = parseReportFilters(reportSearchParams(result.filters, result.page));
  assert.deepEqual(restored, result);
});
