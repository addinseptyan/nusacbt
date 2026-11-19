import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { decryptSixDigitToken, digestSixDigitToken, encryptSixDigitToken, examTokenKeyVerifier, generateSixDigitToken, normalizeSixDigitToken, sameTokenVerifier } from "../../src/lib/exam-token-crypto.mjs";

const run = promisify(execFile);

test("token baru tepat enam digit, termasuk nol di depan", () => {
  for (let i = 0; i < 500; i += 1) assert.match(generateSixDigitToken(), /^[0-9]{6}$/);
  assert.equal(normalizeSixDigitToken("000001"), "000001"); assert.equal(normalizeSixDigitToken("999999"), "999999");
  for (const value of [null, 123456, "12345", "1234567", " 123456", "１２３４５６", "12-456", "12345\n"]) assert.equal(normalizeSixDigitToken(value), null);
});

test("HMAC berkunci dan AES-GCM mempertahankan nol di depan, mendeteksi perubahan, dan mengikat ID serta scope", () => {
  const key = randomBytes(32); const other = randomBytes(32); const binding = { id: "42", scope: "test" }; const code = "000123";
  const first = encryptSixDigitToken(code, key, binding); const second = encryptSixDigitToken(code, key, binding);
  assert.equal(first.nonce.length, 12); assert.equal(first.ciphertext.length, 6); assert.equal(first.tag.length, 16);
  assert.notDeepEqual(first.nonce, second.nonce); assert.notDeepEqual(first.ciphertext, Buffer.from(code));
  assert.equal(decryptSixDigitToken(first, key, binding), code);
  const mac = digestSixDigitToken(code, key); assert.equal(mac.length, 32); assert.notDeepEqual(mac, digestSixDigitToken(code, other));
  assert.notDeepEqual(mac, createHash("sha256").update(code).digest()); assert.deepEqual(mac, digestSixDigitToken(code, key));
  assert.throws(() => decryptSixDigitToken(first, other, binding));
  assert.throws(() => decryptSixDigitToken(first, key, { ...binding, id: "43" }));
  assert.throws(() => decryptSixDigitToken(first, key, { ...binding, scope: "global" }));
  const broken = { ...first, ciphertext: Buffer.from(first.ciphertext) }; broken.ciphertext[0] ^= 1;
  assert.throws(() => decryptSixDigitToken(broken, key, binding)); assert.throws(() => decryptSixDigitToken({ ...first, tag: Buffer.alloc(15) }, key, binding));
  assert.equal(sameTokenVerifier(examTokenKeyVerifier(key), examTokenKeyVerifier(key)), true);
  assert.equal(sameTokenVerifier(examTokenKeyVerifier(key), examTokenKeyVerifier(other)), false);
  assert.equal(sameTokenVerifier(null, examTokenKeyVerifier(key)), false);
  assert.throws(() => digestSixDigitToken("12345", key)); assert.throws(() => encryptSixDigitToken("123456", Buffer.alloc(31), binding));
  key.fill(0); other.fill(0);
});

test("CLI kunci token membuat file luar proyek sekali dan menolak penimpaan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nusacbt-token-key-")); const path = join(dir, "token.key");
  try {
    await run(process.execPath, ["scripts/create-exam-token-key.mjs", path]); const before = await readFile(path, "utf8"); assert.match(before.trim(), /^[A-Za-z0-9+/]{43}=$/);
    await assert.rejects(run(process.execPath, ["scripts/create-exam-token-key.mjs", path])); assert.equal(await readFile(path, "utf8"), before);
    await assert.rejects(run(process.execPath, ["scripts/create-exam-token-key.mjs", join(process.cwd(), "token-test.key")]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
