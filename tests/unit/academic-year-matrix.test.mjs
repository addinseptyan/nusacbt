import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAcademicYearName,suggestedPromotion,parseRolloverChoices } from '../../src/lib/academic-year.mjs';
import { parseMonitoringFilters,monitoringSearchParams } from '../../src/lib/monitoring-filter.mjs';
import { parseMatrixFilters,matrixSearchParams } from '../../src/lib/matrix-report-filter.mjs';
import { buildResultMatrix } from '../../src/lib/matrix-report.mjs';
import { createReportWorkbook } from '../../src/lib/report-xlsx.mjs';
import { strFromU8,unzipSync } from 'fflate';

test('tahun berurutan, usulan jurusan sama, dan pilihan perpindahan divalidasi',()=>{
  assert.equal(validateAcademicYearName(' 2026/2027 ').value,'2026/2027');
  for(const value of ['2026/2028','2026','1899/1900','abcd/efgh','2026/2026']) assert.equal(validateAcademicYearName(value).ok,false);
  const classes=[{id:'1',level:'XI',majorId:'7',label:'XI AK'},{id:'2',level:'XII',majorId:'8',label:'XII B'}];
  assert.equal(suggestedPromotion({level:'X',majorId:'7'},classes),'1');
  assert.equal(suggestedPromotion({level:'XI',majorId:'7'},classes),null);
  assert.equal(suggestedPromotion({level:'XII',majorId:'8'},classes),null);
  const choices=[{studentId:'1',action:'promoted',classId:'2'},{studentId:'3',action:'graduated',classId:''}];
  assert.deepEqual(parseRolloverChoices(JSON.stringify(choices)),choices);
  assert.equal(parseRolloverChoices(JSON.stringify([choices[0],choices[0]])),null);
  assert.equal(parseRolloverChoices(JSON.stringify([{studentId:'1',action:'left',classId:'2'}])),null);
});

test('filter monitoring dan matriks: tanggal inklusif zona, duplikasi, jenis dan penggabungan',()=>{
  const monitor=parseMonitoringFilters(new URLSearchParams('dari=2026-10-01&sampai=2026-10-07&zona=WITA&kategori=makeup&status=not_started&urut=score_desc'));
  assert.equal(monitor.ok,true); assert.equal(monitor.filters.fromUtc,'2026-09-30T16:00:00.000Z');assert.equal(monitor.filters.toUtcExclusive,'2026-10-07T16:00:00.000Z');
  assert.deepEqual(parseMonitoringFilters(monitoringSearchParams(monitor.filters)),monitor);
  for(const query of ['status=unknown','tes=0','kategori=x','urut=drop','dari=2026-02-30','dari=2026-12-02&sampai=2026-12-01','tes=1&tes=2']) assert.equal(parseMonitoringFilters(new URLSearchParams(query)).ok,false,query);
  const matrix=parseMatrixFilters(new URLSearchParams('tahun=1&kategori=regular&gabung=1&kelas=X%20AK&dari=2026-10-01&sampai=2026-10-07&zona=WIB'));
  assert.equal(matrix.ok,true);assert.equal(matrix.filters.toUtcExclusive,'2026-10-07T17:00:00.000Z');
  assert.deepEqual(parseMatrixFilters(matrixSearchParams(matrix.filters)),matrix);
  for(const query of ['kategori=remedial&gabung=1','gabung=0','gabung=1&gabung=1','tanggal=1']) assert.equal(parseMatrixFilters(new URLSearchParams(query)).ok,false,query);
});

test('nilai matriks hanya dari kategori terpilih; susulan berwarna dan bentrok tidak menjadi nol',()=>{
  const row=(a)=>({id:a.id,studentId:a.studentId,student:a.student,nisn:a.studentId.padStart(10,'0'),className:a.className??'X AK',yearId:'1',year:'2026/2027',testId:a.testId,testName:a.testId==='1'?'Matematika':'Bahasa',period:'STS',kind:a.kind,method:a.method??'average',correct:a.correct,questions:10,completed:a.id});
  const items=[row({id:'1',studentId:'1',student:'Nanda',testId:'1',kind:'regular',correct:8}),row({id:'2',studentId:'1',student:'Nanda',testId:'1',kind:'regular',correct:6}),row({id:'3',studentId:'2',student:'Roni',testId:'1',kind:'makeup',correct:7}),row({id:'4',studentId:'1',student:'Nanda',testId:'2',kind:'regular',correct:9}),row({id:'5',studentId:'1',student:'Nanda',testId:'2',kind:'makeup',correct:5,className:'XI AK'})];
  const result=buildResultMatrix(items,true); const nanda=result.rows.find((r)=>r.name==='Nanda'),roni=result.rows.find((r)=>r.name==='Roni');
  assert.equal(nanda.cells['1'].score,70);assert.equal(nanda.cells['2'].kind,'conflict');assert.equal(nanda.cells['2'].score,null);assert.equal(nanda.average,70);assert.equal(nanda.conflicts,1);
  assert.equal(roni.cells['1'].kind,'makeup');assert.equal(roni.cells['1'].score,70);assert.equal(roni.average,70);assert.equal(roni.cells['2'],undefined);
  assert.equal(nanda.className,'XI AK'); // snapshot cocok terbaru, bentrok lintas snapshot tetap terdeteksi.
});

test('Excel metadata, sel Susulan numerik dan bentrok berwarna tanpa formula',()=>{
  const file=createReportWorkbook([{name:'Rekap',columns:[{title:'Nama',width:20},{title:'Nilai',width:12}],preamble:[['REKAP'],['Grup','X AK'],[]],rows:[['Roni',{score:77,style:'makeup'}],['Nanda',{text:'Periksa',style:'conflict'}]]}]);
  const files=unzipSync(file), sheet=strFromU8(files['xl/worksheets/sheet1.xml']),styles=strFromU8(files['xl/styles.xml']);
  assert.match(sheet,/r="B5" s="3"><v>77<\/v>/);assert.match(sheet,/r="B6" t="inlineStr" s="4"/);
  assert.match(sheet,/autoFilter ref="A4:B6"/);assert.match(styles,/FFDDEBF7/);assert.match(styles,/FFFFE0DE/);assert.doesNotMatch(sheet,/<f(?:\s|>)/);
});
