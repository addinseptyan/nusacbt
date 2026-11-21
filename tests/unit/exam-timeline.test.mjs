import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftTimelineDate, timelineLocal, timelineSegment, validTimelineDate } from "../../src/lib/exam-timeline.mjs";

test("tanggal timeline divalidasi dan loncatan dibatasi", () => {
  assert.equal(validTimelineDate("2028-02-29"), true);
  for (const value of ["2027-02-29", "2026-13-01", "1999-12-31", "2101-01-01", "2026-1-01", null]) assert.equal(validTimelineDate(value), false);
  assert.equal(shiftTimelineDate("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftTimelineDate("2026-01-02", -7), "2025-12-26");
  assert.equal(shiftTimelineDate("2000-01-01", -7), null);
  assert.equal(shiftTimelineDate("2100-12-31", 7), null);
});

test("zona diproyeksikan ke satu skala bersama tanpa bergantung pada zona browser", () => {
  assert.equal(timelineLocal("2026-03-01T17:30:00Z", "WIB"), "2026-03-02T00:30");
  assert.equal(timelineLocal("2026-03-01T17:30:00Z", "WITA"), "2026-03-02T01:30");
  assert.equal(timelineLocal("2026-03-01T17:30:00Z", "WIT"), "2026-03-02T02:30");
  assert.equal(timelineLocal("bukan tanggal", "WIB"), null);
  assert.deepEqual(timelineSegment("2026-03-01T17:30:00Z", 120, "2026-03-02", "WIB"), { left: 30, width: 120, clippedStart: false, clippedEnd: false });
  assert.deepEqual(timelineSegment("2026-03-01T17:30:00Z", 120, "2026-03-02", "WIT"), { left: 150, width: 120, clippedStart: false, clippedEnd: false });
});

test("jadwal melewati tengah malam dan batas minggu dipotong secara tepat", () => {
  assert.deepEqual(timelineSegment("2026-03-01T16:00:00Z", 180, "2026-03-02", "WIB"), { left: 0, width: 120, clippedStart: true, clippedEnd: false });
  assert.equal(timelineSegment("2026-03-01T16:00:00Z", 60, "2026-03-02", "WIB"), null); // berakhir tepat 00
  assert.deepEqual(timelineSegment("2026-03-08T16:30:00Z", 120, "2026-03-02", "WIB"), { left: 10050, width: 30, clippedStart: false, clippedEnd: true });
  assert.equal(timelineSegment("2026-03-08T17:00:00Z", 60, "2026-03-02", "WIB"), null);
  assert.equal(timelineSegment("2026-03-02T00:00:00Z", 0, "2026-03-02", "WIB"), null);
});
