import test from "node:test";
import assert from "node:assert/strict";
import {
  applyClassCheckboxToggle,
  applyClassSessionAssignment,
  filterSessionClassGroups,
  groupSessionStudentsByClass,
  summarizeClassSelection,
} from "../../src/lib/exam-session-grouping.mjs";
import { distributeExamSessions, sessionRandomInt, validateSessionPlan } from "../../src/lib/exam-session-validation.mjs";

function seeded(seed = 1) {
  return (max) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
}
function makeStudents(counts) {
  let id = 0; return counts.flatMap((count, c) => Array.from({length:count}, () => ({studentId:String(++id), classId:String(c+1), sessionNumber:null})));
}

test("sesi mengacak dan menyebar kelas yang tidak sama besar tanpa melebihi kapasitas", () => {
  const students = makeStudents([70, 20, 10]); const capacities = [34, 33, 33];
  const result = distributeExamSessions(students, capacities, seeded(77)); assert.equal(result.ok, true);
  const ids = new Set(result.assignments.map((r) => r.studentId)); assert.equal(ids.size, 100);
  const groups = capacities.map((_, i) => result.assignments.filter((a) => a.sessionNumber === i + 1).length);
  assert.deepEqual(groups, capacities);
  for (const classId of ["1", "2", "3"]) {
    const classIds = new Set(students.filter((s) => s.classId === classId).map((s) => s.studentId));
    const counts = capacities.map((_, i) => result.assignments.filter((a) => a.sessionNumber === i + 1 && classIds.has(a.studentId)).length);
    assert.ok(Math.max(...counts)-Math.min(...counts) <= 1, `${classId}: ${counts}`);
  }
  assert.notDeepEqual(result.assignments, distributeExamSessions(students, capacities, seeded(78)).assignments);
});

test("sesi mengakomodasi kapasitas berbeda dan mempertahankan peserta yang sudah ditetapkan", () => {
  const students = makeStudents([30, 12]); students[0].sessionNumber = 2; students[1].sessionNumber = 1;
  const result = distributeExamSessions(students, [14, 28], seeded(4)); assert.equal(result.ok, true);
  assert.equal(result.assignments.find((r) => r.studentId === "1").sessionNumber, 2);
  assert.equal(result.assignments.find((r) => r.studentId === "2").sessionNumber, 1);
  assert.deepEqual([1,2].map((n)=>result.assignments.filter((r)=>r.sessionNumber===n).length), [14,28]);
});

test("kapasitas yang dikurangi menampilkan siswa tersimpan untuk dipindah, tetapi belum boleh disimpan", () => {
  const students = makeStudents([4]); students.slice(0,3).forEach((student) => { student.sessionNumber=1; });
  const result = distributeExamSessions(students, [2,2], seeded(4)); assert.equal(result.ok,true);
  assert.equal(result.assignments.filter((row)=>row.sessionNumber===1).length,3);
  const values=result.assignments.map((row)=>({...row,placementId:row.studentId}));
  assert.equal(validateSessionPlan({periodId:"1",expectedRevision:"1",capacities:[2,2],assignments:values}).ok,false);
  values.find((row)=>row.sessionNumber===1).sessionNumber=2;
  assert.equal(validateSessionPlan({periodId:"1",expectedRevision:"1",capacities:[2,2],assignments:values}).ok,true);
});

test("kapasitas kurang, siswa ganda, atau sesi tersimpan tidak valid tidak menghasilkan pembagian parsial", () => {
  const students = makeStudents([4]);
  assert.equal(distributeExamSessions(students, [1,2], seeded()).ok, false);
  assert.equal(distributeExamSessions([...students, students[0]], [5], seeded()).ok, false);
  assert.equal(distributeExamSessions([{...students[0],sessionNumber:3}], [3,3], seeded()).ok, false);
  assert.equal(distributeExamSessions(students, [0,4], seeded()).ok, false);
  assert.equal(distributeExamSessions(students, Array(25).fill(1), seeded()).ok, false);
});

test("rencana sesi memvalidasi versi, kapasitas, siswa, penempatan, dan keunikan", () => {
  const good = {periodId:"10",expectedRevision:null,capacities:[2,1],assignments:[{studentId:"4",placementId:"8",sessionNumber:1},{studentId:"5",placementId:"9",sessionNumber:2}]};
  assert.equal(validateSessionPlan(good).ok, true);
  assert.equal(validateSessionPlan({...good,expectedRevision:"0"}).ok, true);
  assert.equal(validateSessionPlan({...good,expectedRevision:"9223372036854775807"}).ok, false);
  assert.equal(validateSessionPlan({...good,periodId:"01"}).ok, false);
  assert.equal(validateSessionPlan({...good,capacities:[1,1],assignments:[good.assignments[0], {...good.assignments[1],sessionNumber:1}]}).ok, false);
  assert.equal(validateSessionPlan({...good,assignments:[good.assignments[0], good.assignments[0]]}).ok, false);
  assert.equal(validateSessionPlan({...good,assignments:[{studentId:"4",placementId:"0",sessionNumber:1}]}).ok, false);
  assert.equal(validateSessionPlan({...good,assignments:[{studentId:"4",placementId:"8",sessionNumber:3}]}).ok, false);
});

test("batas 5.000 siswa dan 24 sesi tidak menghilangkan siswa atau melebihi kapasitas", () => {
  const students=makeStudents([450,400,350,300,250,200,150,100,75,75,500,550,600,500,500]);
  assert.equal(students.length,5000);
  const capacities=Array.from({length:24},(_,i)=>i<8?209:208);
  const result=distributeExamSessions(students,capacities,seeded(2026)); assert.equal(result.ok,true);
  assert.equal(new Set(result.assignments.map((row)=>row.studentId)).size,5000);
  assert.deepEqual(capacities.map((_,i)=>result.assignments.filter((row)=>row.sessionNumber===i+1).length),capacities);
  const assignments=result.assignments.map((row)=>({...row,placementId:row.studentId}));
  assert.equal(validateSessionPlan({periodId:"1",expectedRevision:null,capacities,assignments}).ok,true);
  assert.equal(distributeExamSessions([...students,{studentId:"5001",classId:"1",sessionNumber:null}],capacities,seeded()).ok,false);
});

test("generator acak mengembalikan bilangan dalam rentang", () => {
  for (const n of [1,2,3,17,5000]) for (let i=0;i<40;i+=1) { const x=sessionRandomInt(n); assert.ok(Number.isInteger(x) && x>=0 && x<n); }
  assert.throws(()=>sessionRandomInt(0));
});

test("pengelompokan per kelas, multiselect kelas, dan penyesuaian sesi per kelas atau siswa", () => {
  const students = [
    { studentId: "1", studentName: "Andi", nisn: "0000000001", placementId: "11", classId: "20", classLabel: "10 TKR", active: true, sessionNumber: null },
    { studentId: "2", studentName: "Budi", nisn: "0000000002", placementId: "12", classId: "10", classLabel: "10 RPL", active: true, sessionNumber: null },
    { studentId: "3", studentName: "Citra", nisn: "0000000003", placementId: "13", classId: "10", classLabel: "10 RPL", active: true, sessionNumber: null },
    { studentId: "4", studentName: "Dina", nisn: "0000000004", placementId: "14", classId: "10", classLabel: "10 RPL", active: false, sessionNumber: 2 },
  ];
  const groups = groupSessionStudentsByClass(students);
  assert.deepEqual(groups.map((g) => g.classLabel), ["10 RPL", "10 TKR"]);
  assert.deepEqual(groups[0].students.map((s) => s.studentId), ["2", "3", "4"]);

  let chosen = new Set(["4"]);
  let assignments = new Map([["4", 2]]);
  let summary = summarizeClassSelection(groups[0].students, chosen, assignments, 2);
  assert.equal(summary.allActiveChecked, false);
  assert.equal(summary.indeterminate, true);

  // Centang kelas 10 RPL -> seluruh siswa aktif di bawahnya auto tercentang (4 tidak aktif tetap aman).
  ({ nextChosen: chosen, nextAssignments: assignments } = applyClassCheckboxToggle(groups[0].students, chosen, assignments, true, 1));
  assert.deepEqual([...chosen].sort(), ["2", "3", "4"]);
  assert.equal(assignments.get("2"), 1);
  assert.equal(assignments.get("3"), 1);
  assert.equal(assignments.get("4"), 2);
  summary = summarizeClassSelection(groups[0].students, chosen, assignments, 2);
  assert.equal(summary.allActiveChecked, true);
  assert.equal(summary.indeterminate, false);
  assert.equal(summary.classSessionValue, "1");

  // Sesuaikan sesi satu kelas penuh ke Sesi 2.
  ({ nextChosen: chosen, nextAssignments: assignments } = applyClassSessionAssignment(groups[0].students, chosen, assignments, 2));
  assert.equal(assignments.get("2"), 2);
  assert.equal(assignments.get("3"), 2);
  assert.equal(summarizeClassSelection(groups[0].students, chosen, assignments, 2).classSessionValue, "2");

  // Ubah satu siswa saja ke Sesi 1 -> status kelas menjadi campuran.
  assignments.set("2", 1);
  assert.equal(summarizeClassSelection(groups[0].students, chosen, assignments, 2).classSessionValue, "mixed");

  // Pencarian & filter tampilan tetap menjaga struktur kelompok.
  const onlySesi2 = filterSessionClassGroups(groups, "", "session:2", chosen, assignments);
  assert.deepEqual(onlySesi2.map((g) => g.classLabel), ["10 RPL"]);
  assert.deepEqual(onlySesi2[0].students.map((s) => s.studentId), ["3", "4"]);

  // Pilih sesi pada kelas yang belum dicentang -> auto mencentang seluruh siswa aktif kelas tsb.
  ({ nextChosen: chosen, nextAssignments: assignments } = applyClassSessionAssignment(groups[1].students, chosen, assignments, 2));
  assert.equal(chosen.has("1"), true);
  assert.equal(assignments.get("1"), 2);

  // Hapus centang kelas -> membersihkan siswa aktif di kelas tersebut.
  ({ nextChosen: chosen, nextAssignments: assignments } = applyClassCheckboxToggle(groups[0].students, chosen, assignments, false, 1));
  assert.equal(chosen.has("2"), false);
  assert.equal(chosen.has("3"), false);
  assert.equal(chosen.has("4"), true);
});
