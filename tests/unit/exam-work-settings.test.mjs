import test from "node:test";
import assert from "node:assert/strict";

import { examDoubtfulValue, examSubmissionWindowMinutes } from "../../src/lib/exam-work-settings-validation.mjs";

test("batas pengumpulan menerima bilangan bulat 1 sampai 10080 menit", () => {
  for (const [value, expected] of [["1", 1], ["5", 5], ["60", 60], ["10080", 10080]]) {
    assert.equal(examSubmissionWindowMinutes(value), expected);
  }
  for (const value of ["", "0", "01", "10081", "-1", "1.5", "1e2", " 5", "5 ", "１２", "999999999999", 5, null, undefined, true, ["5"], {}]) {
    assert.equal(examSubmissionWindowMinutes(value), null, String(value));
  }
});

test("nilai tanda ragu hanya menerima literal true dan false", () => {
  assert.equal(examDoubtfulValue("true"), true);
  assert.equal(examDoubtfulValue("false"), false);
  for (const value of [true, false, "TRUE", "0", "1", "", null, undefined, ["true"], {}]) {
    assert.equal(examDoubtfulValue(value), null);
  }
});
