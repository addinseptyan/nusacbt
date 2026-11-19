import assert from "node:assert/strict";
import test from "node:test";
import { digestExamToken, effectiveExamTokenScope, generateExamToken, matchesExamToken, normalizeExamToken } from "../../src/lib/exam-token.mjs";
import { validTokenOperationId, validateExamTokenCreation } from "../../src/lib/exam-token-validation.mjs";

const operationId = "12ab3456-cdef-4abc-8abc-123456789012";
const valid = (changes = {}) => ({ operationId, scope: "global", testId: null, testRevision: null, durationMinutes: "15", expectedTokenId: "none", replaceConfirmed: null, ...changes });

test("kode acak 12 karakter tanpa karakter membingungkan, hanya hash yang cocok", () => {
  const codes = Array.from({ length: 200 }, generateExamToken);
  assert.equal(new Set(codes).size, 200);
  for (const code of codes) {
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){2}$/);
    const digest = digestExamToken(code);
    assert.equal(digest.length, 32); assert.equal(matchesExamToken(code, digest), true);
    assert.equal(matchesExamToken(code.toLowerCase().replace(/-/g, " "), digest), true);
    assert.notEqual(digest.toString("hex"), code);
  }
  const first = codes[0]; const second = codes[1];
  assert.equal(matchesExamToken(second, digestExamToken(first)), false);
  assert.equal(matchesExamToken(first, Buffer.alloc(31)), false);
  assert.equal(matchesExamToken(first, new Uint8Array(32)), false);
  assert.equal(matchesExamToken(first, null), false);
});

test("normalisasi menolak format/Unicode salah dan mempertahankan kesetaraan pemisah serta kapitalisasi", () => {
  assert.equal(normalizeExamToken("abcd-efgh-jk23"), "ABCDEFGHJK23");
  assert.equal(normalizeExamToken(" ABCD EFGH JK23 "), "ABCDEFGHJK23");
  for (const invalid of [null, 12, "", "ABCD-EFGH-JK20", "ABCD-EFGH-JK21", "ABCD-EFGH-JKIO", "ABCD-EFGH-JK2", "ABCD-EFGH-JK234", "ABCD\nEFGHJK23", "ABCD_EFGHJK23", "ABCD-EFGH-ſK23", " ".repeat(41)]) {
    assert.equal(normalizeExamToken(invalid), null, String(invalid));
    assert.equal(matchesExamToken(invalid, Buffer.alloc(32)), false);
    assert.throws(() => digestExamToken(invalid), /Format token/);
  }
});

test("prioritas khusus ketika aktif; global digunakan hanya jika khusus tidak aktif", () => {
  assert.equal(effectiveExamTokenScope(true, true), "test");
  assert.equal(effectiveExamTokenScope(true, false), "test");
  assert.equal(effectiveExamTokenScope(false, true), "global");
  assert.equal(effectiveExamTokenScope(false, false), null);
});

test("validasi cakupan, tes, versi, konfirmasi, dan masa aktif", () => {
  assert.deepEqual(validateExamTokenCreation(valid()).value, { operationId, scope: "global", testId: null, testRevision: null, durationMinutes: 15, expectedTokenId: null, replaceConfirmed: false });
  assert.deepEqual(validateExamTokenCreation(valid({ scope: "test", testId: "8", testRevision: "10", durationMinutes: "1440", expectedTokenId: "7", replaceConfirmed: "1" })).value, { operationId, scope: "test", testId: "8", testRevision: "10", durationMinutes: 1440, expectedTokenId: "7", replaceConfirmed: true });
  assert.equal(validateExamTokenCreation(valid({ durationMinutes: "5" })).ok, true);
  for (const durationMinutes of ["0", "4", "1441", "05", "5.0", "1e2", " 15 ", "", null, 15]) assert.equal(validateExamTokenCreation(valid({ durationMinutes })).ok, false, String(durationMinutes));
  for (const changes of [
    { scope: "all" }, { scope: "test" }, { scope: "test", testId: "0", testRevision: "1" },
    { scope: "test", testId: "1", testRevision: "0" }, { scope: "test", testId: "1", testRevision: "4294967296" },
    { scope: "global", testId: "1" }, { scope: "global", testRevision: "1" },
    { expectedTokenId: null }, { expectedTokenId: "0" }, { expectedTokenId: "9223372036854775808" },
    { replaceConfirmed: "on" }, { replaceConfirmed: "0" }, { operationId: null }, { operationId: "" },
    { operationId: "12ab3456-cdef-1abc-8abc-123456789012" }, { operationId: "12ab3456-cdef-4abc-7abc-123456789012" },
  ]) assert.equal(validateExamTokenCreation(valid(changes)).ok, false, JSON.stringify(changes));
});

test("identitas permintaan adalah UUID v4 dan dinormalisasi", () => {
  assert.equal(validTokenOperationId(operationId.toUpperCase()), operationId);
  for (const value of [null, undefined, 42, "", `${operationId} `, "12ab3456-cdef-1abc-8abc-123456789012", "12ab3456-cdef-4abc-7abc-123456789012"]) assert.equal(validTokenOperationId(value), null);
});
