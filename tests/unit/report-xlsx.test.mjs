import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { createReportWorkbook } from '../../src/lib/report-xlsx.mjs';

const sample = () => [
  { name: 'Rekap', columns: [{ title: 'Nama', width: 30 }, { title: 'NISN', width: 15 }, { title: 'Nilai', width: 12 }],
    rows: [['=HYPERLINK("https://example.invalid")', '0012345678', { score: 8.33 }], ['<&\u0001😀', '@nomor', { score: 100 }]] },
  { name: 'Pengerjaan', columns: [{ title: 'Isi', width: 24 }], rows: [['+2+2'], ['-4'], ['@SUM(1,2)']] },
];
test('XLSX memuat teks literal, NISN dan nilai numerik tanpa formula atau tautan eksternal', () => {
  const files = unzipSync(createReportWorkbook(sample()));
  const summary = strFromU8(files['xl/worksheets/sheet1.xml']);
  const attempts = strFromU8(files['xl/worksheets/sheet2.xml']);
  assert.match(summary, /r="A2" t="inlineStr"/); assert.match(summary, /=HYPERLINK\(&quot;https:\/\/example\.invalid&quot;\)/);
  assert.match(summary, /r="B2" t="inlineStr"[^>]*><is><t[^>]*>0012345678<\/t>/);
  assert.match(summary, /r="C2" s="2"><v>8\.33<\/v>/); assert.match(summary, /&lt;&amp;�😀/);
  assert.match(attempts, />\+2\+2<\/t>/); assert.match(attempts, />-4<\/t>/); assert.match(attempts, />@SUM\(1,2\)<\/t>/);
  for (const [path, contents] of Object.entries(files)) if (path.endsWith('.xml') || path.endsWith('.rels')) {
    const xml = strFromU8(contents);
    assert.doesNotMatch(xml, /<f(?:\s|>)/); assert.doesNotMatch(xml, /TargetMode="External"/);
    const parser = new SaxesParser({ xmlns: true }); parser.write(xml).close();
  }
  assert.equal(Object.keys(files).some((name) => /vba|externalLinks/i.test(name)), false);
});
test('Excel menolak lembar atau ukuran sel yang tidak sah', () => {
  assert.throws(() => createReportWorkbook([]));
  assert.throws(() => createReportWorkbook([{ ...sample()[0], name: 'bad/name' }]));
  assert.throws(() => createReportWorkbook([sample()[0], { ...sample()[0], name: 'rekap' }]));
  assert.throws(() => createReportWorkbook([{ name: 'X', columns: [{ title: 'A', width: 20 }], rows: [['x'.repeat(32768)]] }]));
  assert.throws(() => createReportWorkbook([{ name: 'X', columns: [{ title: 'A', width: 20 }], rows: [[Number.NaN]] }]));
  assert.throws(() => createReportWorkbook([{ name: 'X', columns: [{ title: 'A', width: 20 }], rows: [[]] }]));
});
