import assert from "node:assert/strict";
import { test } from "node:test";
import { participantAttemptBucket, participantPageNumber, participantSessionDigest, parseParticipantCredentials } from "../../src/lib/participant-login-validation.mjs";

test("kredensial memerlukan periode bigint dan username per periode; kapitalisasi dinormalisasi", () => {
  assert.deepEqual(parseParticipantCredentials("17", "  Abc.07 ", "Password-fiktif-123"), { periodId: "17", username: "abc.07", password: "Password-fiktif-123" });
  for (const period of [null, "0", "01", "-1", "9223372036854775808", "1 OR 1=1"]) assert.equal(parseParticipantCredentials(period, "abc", "a"), null);
  for (const username of ["ab", "a b", "x' OR 1=1", null, "ééé", "x".repeat(65)]) assert.equal(parseParticipantCredentials("1", username, "a"), null);
  for (const password of [null, "", "x".repeat(257), "🧪".repeat(129), "\ud800"]) assert.equal(parseParticipantCredentials("1", "abc", password), null);
  assert.equal(parseParticipantCredentials("1", "abc", "🧪".repeat(128))?.password.length, 256);
});

test("bucket terpisah menurut periode dan username serta tidak menyimpan input", () => {
  const first = participantAttemptBucket("1", "abc");
  assert.equal(first.length, 32);
  assert.deepEqual(first, participantAttemptBucket("1", "abc"));
  assert.notDeepEqual(first, participantAttemptBucket("2", "abc"));
  assert.notDeepEqual(first, participantAttemptBucket("1", "abd"));
  assert.equal(first.includes(Buffer.from("abc")), false);
});

test("digest sesi hanya menerima token acak berformat dan paginasi dibatasi", () => {
  const token = "A".repeat(43);
  assert.equal(participantSessionDigest(token)?.length, 32);
  for (const invalid of [null, "", "A".repeat(42), "A".repeat(44), "!".repeat(43)]) assert.equal(participantSessionDigest(invalid), null);
  assert.notDeepEqual(participantSessionDigest(token), participantSessionDigest("B".repeat(43)));
  assert.equal(participantPageNumber("2"), 2);
  for (const invalid of [undefined, "0", "-1", "01", "1.1", "1000000", ["2"]]) assert.equal(participantPageNumber(invalid), 1);
});
