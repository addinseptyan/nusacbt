import { calculateFinalGrade } from './exam-final-grade.mjs';

/** Matriks hanya dari pengerjaan selesai yang SUDAH cocok seluruh filter. */
export function buildResultMatrix(attempts, merge) {
  const tests = new Map(), students = new Map();
  for (const a of attempts) {
    const studentKey = JSON.stringify([a.studentId,a.yearId]);
    const prior = students.get(studentKey) ?? { key:studentKey, studentId:a.studentId, name:a.student, nisn:a.nisn, className:a.className, year:a.year, cells:new Map() };
    // Input berurutan menurut waktu selesai dan ID; snapshot cocok terbaru
    // menjadi label; deteksi bentrok tetap lintas snapshot kelas yang cocok.
    prior.name = a.student; prior.nisn = a.nisn; prior.year = a.year; prior.className = a.className;
    const cell = prior.cells.get(a.testId) ?? []; cell.push(a); prior.cells.set(a.testId,cell); students.set(studentKey,prior);
    const existingTest = tests.get(a.testId);
    const tags = Array.isArray(a.testTags) ? a.testTags : [];
    tests.set(a.testId,{ id:a.testId, name:a.testName, period:a.period, year:a.year, tags:existingTest?.tags?.length ? existingTest.tags : tags });
  }
  const columns = [...tests.values()].sort((a,b) => a.name.localeCompare(b.name,'id') || a.period.localeCompare(b.period,'id') || a.id.localeCompare(b.id));
  const rows = [...students.values()].map((s) => {
    const cells = {}; let sum = 0, count = 0, conflicts = 0;
    for (const [testId, records] of s.cells) {
      const kinds = new Set(records.map((r) => r.kind));
      if (merge && kinds.has('regular') && kinds.has('makeup')) {
        cells[testId] = { kind:'conflict',score:null,attempts:records.length }; conflicts += 1; continue;
      }
      const score = calculateFinalGrade(records[0].method,records.map((r) => ({correctCount:r.correct,questionCount:r.questions})));
      if (score === null) throw new Error('Nilai rekap tidak dapat dihitung.');
      cells[testId] = {kind:records[0].kind,score,attempts:records.length};
      sum += Math.round(score * 100); count += 1;
    }
    return { key:s.key,studentId:s.studentId,name:s.name,nisn:s.nisn,className:s.className,year:s.year,cells,
      average:count ? Math.round(sum/count)/100 : null,scoredCount:count,conflicts };
  }).sort((a,b) => a.name.localeCompare(b.name,'id') || a.nisn.localeCompare(b.nisn) || a.className.localeCompare(b.className,'id') || a.key.localeCompare(b.key));
  return {columns,rows};
}
