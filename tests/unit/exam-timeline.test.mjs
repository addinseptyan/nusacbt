import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutTimelineDay, shiftTimelineDate, timelineLocal, timelineRangeLength, timelineSegment, validTimelineDate } from "../../src/lib/exam-timeline.mjs";

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

test("rentang tanggal inklusif membolehkan satu sampai tujuh hari dan menghormati batas maksimal", () => {
  assert.equal(timelineRangeLength("2028-02-28", "2028-02-28"), 1);
  assert.equal(timelineRangeLength("2028-02-27", "2028-03-04"), 7);
  assert.equal(timelineRangeLength("2028-02-27", "2028-03-05"), null);
  assert.equal(timelineRangeLength("2028-02-28", "2028-02-28", 1), 1);
  assert.equal(timelineRangeLength("2028-02-28", "2028-02-29", 1), null);
  assert.equal(timelineRangeLength("2028-02-27", "2028-03-01", 3), null);
  assert.equal(timelineRangeLength("2028-02-27", "2028-02-29", 3), 3);
  assert.equal(timelineRangeLength("2028-03-01", "2028-02-29"), null);
  assert.equal(timelineRangeLength("2027-02-29", "2027-03-01"), null);
  assert.equal(timelineRangeLength("2100-12-31", "2101-01-01"), null);
});

test("hari terpisah dan label tidak menutupi jadwal bertumpuk atau yang berdekatan", () => {
  const items = [
    { id: "pertama", startUtc: "2026-03-02T03:00:00Z", durationMinutes: 60 },
    { id: "bentrok", startUtc: "2026-03-02T03:00:00Z", durationMinutes: 60 },
    { id: "berurutan", startUtc: "2026-03-02T04:00:00Z", durationMinutes: 30 },
    { id: "jauh", startUtc: "2026-03-02T06:00:00Z", durationMinutes: 30 },
    { id: "tengah-malam", startUtc: "2026-03-02T16:50:00Z", durationMinutes: 30 },
  ];
  const day = layoutTimelineDay(items, "2026-03-02", "WIB", 60);
  assert.equal(day.length, 5);
  assert.deepEqual(day.slice(0, 3).map((entry) => entry.lane), [0, 1, 2]);
  assert.equal(day.find((entry) => entry.item.id === "jauh").lane, 0);
  const midnight = day.find((entry) => entry.item.id === "tengah-malam");
  assert.deepEqual(midnight.segment, { left: 1430, width: 10, clippedStart: false, clippedEnd: true });
  assert.equal(midnight.labelLeft + midnight.labelWidth, 1440);
  const next = layoutTimelineDay(items, "2026-03-03", "WIB", 60);
  assert.equal(next.length, 1);
  assert.deepEqual(next[0].segment, { left: 0, width: 20, clippedStart: true, clippedEnd: false });
  for (const a of day) for (const b of day) {
    if (a !== b && a.lane === b.lane && a.labelLeft < b.labelLeft) assert.ok(a.labelLeft + a.labelWidth <= b.labelLeft);
  }
  assert.equal(layoutTimelineDay(items, "2026-03-02", "WIB", 0).length, 0);
});
