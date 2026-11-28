import assert from "node:assert/strict";
import test from "node:test";
import { checkExamDateAgainstPeriod, EXAM_TEST_MAX_QUESTIONS, validateExamStart, validateExamTestDraft, validateExamTestTags } from "../../src/lib/exam-test-validation.mjs";
import { EXAM_TEST_SORT_OPTIONS, normalizeExamTestSortMode, sortExamTests } from "../../src/lib/exam-test-sort.mjs";

const valid = (change = {}) => ({ name: "  Tes Matematika  ", periodId: "1", startLocal: "2026-11-17T08:30", timeZone: "WIB", durationMinutes: "90", shuffleQuestions: null, shuffleOptions: null, questionIds: [], questionRevisions: [], ...change });

test("jadwal tiga zona disimpan sebagai UTC, termasuk perpindahan tanggal dan tahun kabisat", () => {
  assert.equal(validateExamStart("2026-11-17T08:30", "WIB").value?.startsAt, "2026-11-17T01:30:00.000Z");
  assert.equal(validateExamStart("2026-11-17T08:30", "WITA").value?.startsAt, "2026-11-17T00:30:00.000Z");
  assert.equal(validateExamStart("2026-11-17T08:30", "WIT").value?.startsAt, "2026-11-16T23:30:00.000Z");
  assert.equal(validateExamStart("2000-02-29T00:00", "WIT").value?.startsAt, "2000-02-28T15:00:00.000Z");
  assert.equal(validateExamStart("2100-12-31T23:59", "WIB").value?.startsAt, "2100-12-31T16:59:00.000Z");
});

test("jadwal tidak valid, tanggal dinormalisasi, detik dan zona tak dikenal ditolak", () => {
  for (const local of ["2026-02-29T12:00", "2100-02-29T12:00", "2026-04-31T12:00", "2026-00-01T10:00", "2026-01-00T10:00", "2026-01-01T24:00", "2026-01-01T12:60", "1999-12-31T23:59", "2101-01-01T00:00", "2026-01-01", "2026-01-01T01:30:00", "2026-01-01 01:30", "", null, 123]) assert.equal(validateExamStart(local, "WIB").ok, false, String(local));
  for (const zone of ["UTC", "Asia/Jakarta", "wib", "constructor", "__proto__", "", null]) assert.equal(validateExamStart("2026-01-01T12:00", zone).ok, false, String(zone));
});

test("rancangan valid, soal kosong, urutan, zona dan pengaturan acak", () => {
  const result = validateExamTestDraft(valid({ questionIds: ["3", "1"], questionRevisions: ["5", "6"], timeZone: "WITA", shuffleQuestions: "1", shuffleOptions: null }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { name: "Tes Matematika", periodId: "1", startsAt: "2026-11-17T00:30:00.000Z", timeZone: "WITA", durationMinutes: 90, shuffleQuestions: true, shuffleOptions: false, questionIds: ["3", "1"], questionRevisions: ["5", "6"] });
  assert.equal(validateExamTestDraft(valid()).ok, true);
  assert.equal(validateExamTestDraft(valid({ shuffleQuestions: null, shuffleOptions: "1" })).value?.shuffleOptions, true);
});

test("nama, identitas, durasi dan pengaturan tidak valid ditolak", () => {
  for (const name of [null, "", " ", "a\n", "a\u0085", "\ud800", "x".repeat(101)]) assert.equal(validateExamTestDraft(valid({ name })).ok, false, String(name));
  assert.equal(validateExamTestDraft(valid({ name: "😀".repeat(100) })).ok, true);
  for (const periodId of [null, "0", "01", "-1", "1;SELECT", "9223372036854775808"]) assert.equal(validateExamTestDraft(valid({ periodId })).ok, false, String(periodId));
  for (const durationMinutes of [null, "", "0", "01", "-1", "1.5", "10081", "1e2", " 90 ", "Infinity", 5]) assert.equal(validateExamTestDraft(valid({ durationMinutes })).ok, false, String(durationMinutes));
  assert.equal(validateExamTestDraft(valid({ durationMinutes: "1" })).ok, true);
  assert.equal(validateExamTestDraft(valid({ durationMinutes: "10080" })).ok, true);
  for (const setting of ["on", "0", "true", false, "", {}, 1]) assert.equal(validateExamTestDraft(valid({ shuffleQuestions: setting })).ok, false, String(setting));
});

test("versi dan identitas soal valid, unik, berurutan, dan maksimal 1000", () => {
  const ids = Array.from({ length: EXAM_TEST_MAX_QUESTIONS }, (_, i) => String(i + 1));
  const versions = ids.map(() => "9");
  assert.equal(validateExamTestDraft(valid({ questionIds: ids, questionRevisions: versions })).ok, true);
  assert.equal(validateExamTestDraft(valid({ questionIds: [...ids, "1001"], questionRevisions: [...versions, "9"] })).ok, false);
  for (const change of [
    { questionIds: ["1", "1"], questionRevisions: ["2", "2"] },
    { questionIds: ["0"], questionRevisions: ["1"] },
    { questionIds: ["1"], questionRevisions: ["0"] },
    { questionIds: ["1"], questionRevisions: ["4294967296"] },
    { questionIds: ["1"], questionRevisions: [] },
    { questionIds: [], questionRevisions: ["1"] },
    { questionIds: "1", questionRevisions: ["1"] },
  ]) assert.equal(validateExamTestDraft(valid(change)).ok, false, JSON.stringify(change));
});

test("tag tes diurutkan alfabetis dan pemeriksaan rentang tanggal periode bersifat informatif", () => {
  const tags = validateExamTestTags("UAS, Kelas X, uas, Matematika");
  assert.equal(tags.ok, true);
  if (tags.ok) {
    assert.deepEqual(tags.value, ["Kelas X", "Matematika", "UAS"]);
    assert.equal(tags.signature, "kelas x\x1fmatematika\x1fuas");
  }
  assert.equal(checkExamDateAgainstPeriod("2026-01-05T08:00", "2026-01-05T09:00", "2026-01-01", "2026-01-31"), null);
  assert.equal(checkExamDateAgainstPeriod("2025-12-31T08:00", "2025-12-31T09:00", "2026-01-01", "2026-01-31")?.includes("lebih awal"), true);
  assert.equal(checkExamDateAgainstPeriod("2026-01-31T23:00", "2026-02-01T01:00", "2026-01-01", "2026-01-31")?.includes("melewati"), true);
  assert.equal(checkExamDateAgainstPeriod("2026-02-15T08:00", "2026-02-15T09:00", "2026-01-01", null), null);
});

test("pengurutan rancangan tes mendukung 7 mode dengan default abjad A-Z", () => {
  assert.equal(EXAM_TEST_SORT_OPTIONS.length, 7);
  assert.equal(normalizeExamTestSortMode(null), "name_asc");
  assert.equal(normalizeExamTestSortMode("invalid"), "name_asc");
  assert.equal(normalizeExamTestSortMode("questions_desc"), "questions_desc");

  const items = [
    { id: "10", name: "Matematika", startLocal: "2026-11-20T08:00", durationMinutes: 90, questionIds: ["1", "2"] },
    { id: "5", name: "Bahasa Indonesia", startLocal: "2026-11-18T08:00", durationMinutes: 60, questionIds: ["1", "2", "3"] },
    { id: "12", name: "Fisika", startLocal: "2026-11-19T08:00", durationMinutes: 120, questionIds: ["1"] },
  ];
  assert.deepEqual(sortExamTests(items, "name_asc").map((i) => i.name), ["Bahasa Indonesia", "Fisika", "Matematika"]);
  assert.deepEqual(sortExamTests(items, "name_desc").map((i) => i.name), ["Matematika", "Fisika", "Bahasa Indonesia"]);
  assert.deepEqual(sortExamTests(items, "start_asc").map((i) => i.name), ["Bahasa Indonesia", "Fisika", "Matematika"]);
  assert.deepEqual(sortExamTests(items, "start_desc").map((i) => i.name), ["Matematika", "Fisika", "Bahasa Indonesia"]);
  assert.deepEqual(sortExamTests(items, "questions_desc").map((i) => i.name), ["Bahasa Indonesia", "Matematika", "Fisika"]);
  assert.deepEqual(sortExamTests(items, "questions_asc").map((i) => i.name), ["Fisika", "Matematika", "Bahasa Indonesia"]);
  assert.deepEqual(sortExamTests(items, "duration_desc").map((i) => i.name), ["Fisika", "Matematika", "Bahasa Indonesia"]);
});

