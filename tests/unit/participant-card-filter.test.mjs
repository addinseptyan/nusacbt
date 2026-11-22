import test from 'node:test';
import assert from 'node:assert/strict';
import { cardSearchParams, parseCardFilters } from '../../src/lib/participant-card-filter.mjs';
import { cardRequestIsSameOrigin } from '../../src/lib/participant-card-origin.mjs';

function parse(query) { return parseCardFilters(new URLSearchParams(query)); }

test('filter kartu hanya kelas dan siswa, periode internal tidak muncul pada tautan halaman', () => {
  const empty = parse(''); assert.equal(empty.ok, true); assert.equal(empty.filters.periodId, null); assert.equal(empty.page, 1);
  const result = parse('periode=12&kelas=34&siswa=%20Roni%20&halaman=2');
  assert.equal(result.ok,true); assert.equal(result.filters.student,'Roni'); assert.equal(result.page,2);
  assert.equal(cardSearchParams(result.filters,result.page).has('periode'),false);
  assert.deepEqual(parseCardFilters(cardSearchParams(result.filters,result.page,true)),result);
  assert.equal(parse('kelas=34&siswa=Roni').ok,true);
});

test('duplikasi, ID, filter tes/kategori lama, kontrol dan halaman salah ditolak', () => {
  for (const query of ['periode=1&periode=2','periode=0','periode=01','periode=9223372036854775808',
    'kelas=-1','tes=1','kategori=regular','halaman=0','halaman=1000000','siswa=%00',`siswa=${'x'.repeat(101)}`]) assert.equal(parse(query).ok,false,query);
  assert.equal(parse('periode=9223372036854775807&halaman=999999').ok,true);
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
