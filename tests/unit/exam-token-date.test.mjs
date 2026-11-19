import assert from "node:assert/strict";
import test from "node:test";

import { parseTokenDateFilter, parseTokenZone, tokenCalendarDate, tokenDayBounds, tokenPageNumber } from "../../src/lib/exam-token-date.mjs";

test("hari mengikuti jam server dan zona WIB/WITA/WIT, termasuk pergantian tanggal", () => {
  const now = "2026-11-19T16:30:00.000Z";
  assert.equal(tokenCalendarDate(now, "WIB"), "2026-11-19");
  assert.equal(tokenCalendarDate(now, "WITA"), "2026-11-20");
  assert.equal(tokenCalendarDate(now, "WIT"), "2026-11-20");
  assert.equal(parseTokenZone("WIT"), "WIT"); assert.equal(parseTokenZone("unknown"), "WIB");
  assert.throws(() => tokenCalendarDate("invalid", "WIB"));
});

test("batas tanggal dalam zona yang dipilih memakai interval setengah terbuka", () => {
  assert.deepEqual(tokenDayBounds("2026-11-19", "WIB"), { start: "2026-11-18T17:00:00.000Z", end: "2026-11-19T17:00:00.000Z" });
  assert.deepEqual(tokenDayBounds("2028-02-29", "WITA"), { start: "2028-02-28T16:00:00.000Z", end: "2028-02-29T16:00:00.000Z" });
  assert.deepEqual(tokenDayBounds("2026-01-01", "WIT"), { start: "2025-12-31T15:00:00.000Z", end: "2026-01-01T15:00:00.000Z" });
  for (const date of ["2026-02-29", "2026-13-01", "0000-01-01", "1999-12-31", "2102-01-01", "2026-1-1"]) assert.throws(() => tokenDayBounds(date, "WIB"));
});

test("filter default hari ini, semua tanggal, tanggal valid, dan masukan tidak valid", () => {
  const now = "2026-11-19T16:30:00.000Z";
  assert.deepEqual(parseTokenDateFilter(undefined, now, "WIB"), { mode: "today", date: "2026-11-19" });
  assert.deepEqual(parseTokenDateFilter("all", now, "WITA"), { mode: "all", date: null });
  assert.deepEqual(parseTokenDateFilter("2028-02-29", now, "WIB"), { mode: "date", date: "2028-02-29" });
  for (const invalid of ["2026-02-29", "2026-01-01' OR true", ["all", "2026-11-20"]]) {
    assert.deepEqual(parseTokenDateFilter(invalid, now, "WITA"), { mode: "today", date: "2026-11-20" });
  }
});

test("nomor halaman dibatasi dan input ganda tidak dipercaya", () => {
  assert.equal(tokenPageNumber("25"), 25);
  for (const invalid of ["0", "-1", "1.5", "10000000", ["1", "2"], undefined]) assert.equal(tokenPageNumber(invalid), 1);
});
