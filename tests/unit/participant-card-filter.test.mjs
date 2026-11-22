import test from 'node:test';
import assert from 'node:assert/strict';
import { cardSearchParams, parseCardFilters } from '../../src/lib/participant-card-filter.mjs';
import { cardRequestIsSameOrigin } from '../../src/lib/participant-card-origin.mjs';

function parse(query) { return parseCardFilters(new URLSearchParams(query)); }

test('filter kosong, periode, dan kombinasi kelas/tes/kategori mempertahankan nilai', () => {
  const empty = parse(''); assert.equal(empty.ok, true); assert.equal(empty.filters.periodId, null); assert.equal(empty.page, 1);
  for (const category of ['', 'regular', 'makeup', 'remedial']) {
    const params = new URLSearchParams({ periode: '12', kelas: '34', tes: '56', kategori: category, siswa: " O'HARA_%\\ ", halaman: '2' });
    const result = parseCardFilters(params); assert.equal(result.ok, true);
    assert.equal(result.filters.student, "O'HARA_%\\"); assert.equal(result.page, 2);
    assert.deepEqual(parseCardFilters(cardSearchParams(result.filters, result.page)), result);
  }
});

test('duplikasi, ID, halaman, kategori, kontrol dan filter tanpa periode ditolak', () => {
  for (const query of [
    'periode=1&periode=2', 'periode=0', 'periode=01', 'periode=9223372036854775808',
    'periode=1&kelas=-1', 'periode=1&tes=0', 'periode=1&kategori=__proto__', 'periode=1&kategori=Regular',
    'periode=1&halaman=0', 'periode=1&halaman=1000000', 'periode=1&siswa=%00',
    `periode=1&siswa=${'x'.repeat(101)}`, 'kelas=1', 'tes=1', 'kategori=regular', 'siswa=ana', 'halaman=2',
  ]) assert.equal(parse(query).ok, false, query);
  assert.equal(parse('periode=9223372036854775807&halaman=999999').ok, true);
});

test('endpoint hanya menerima JSON dan header khusus dari origin yang sama', () => {
  const base = { host: 'school.example:3000', origin: 'http://school.example:3000', 'content-type': 'application/json', 'x-nusacbt-cards': '1' };
  const check = (changes = {}) => cardRequestIsSameOrigin(new Headers({ ...base, ...changes }));
  assert.equal(check(), true);
  assert.equal(check({ 'content-type': 'application/json; charset=utf-8', 'sec-fetch-site': 'same-origin' }), true);
  for (const changes of [
    { origin: 'http://evil.example:3000' }, { origin: 'null' }, { origin: '' }, { origin: 'http://school.example:3000/path' },
    { host: 'school.example:3000,evil.example' }, { 'content-type': 'text/plain' }, { 'x-nusacbt-cards': '0' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    { 'x-forwarded-host': 'evil.example' }, { 'x-forwarded-proto': 'https' },
  ]) assert.equal(check(changes), false, JSON.stringify(changes));
  assert.equal(cardRequestIsSameOrigin(new Headers({ ...base, host: 'internal:3100', origin: 'https://school.example',
    'x-forwarded-host': 'school.example', 'x-forwarded-proto': 'https' })), true);
  assert.equal(cardRequestIsSameOrigin(new Headers({ ...base, host: 'internal:3100', origin: 'https://school.example',
    'x-forwarded-host': 'school.example,evil.example', 'x-forwarded-proto': 'https' })), false);
});
