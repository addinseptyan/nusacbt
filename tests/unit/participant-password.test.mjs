import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createParticipantKeyFile, decryptParticipantPassword, encryptParticipantPassword, generateParticipantPassword,
  ParticipantKeyFileError, participantKeyVerifier, readParticipantKeyFile, sameParticipantVerifier, validateParticipantPassword,
} from "../../src/lib/participant-password-crypto.mjs";
import { GENERATED_PARTICIPANT_PASSWORD_LENGTH, PARTICIPANT_PASSWORD_BATCH_SIZE } from "../../src/lib/participant-password-constants.mjs";
import { hashParticipantPassword, verifyPassword } from "../../src/lib/password.mjs";

const hasReason = (reason) => (error) => error instanceof ParticipantKeyFileError && error.reason === reason;

test("sandi baru dan reset harus tepat delapan huruf ASCII kapital", () => {
  for (const input of [null, undefined, 123, "ABCDEFG", "ABCDEFGHI", "ABCDEFGH\n", "ABCDEFGH\r", "abcdefgh", "ABCD1234", "ABC DEFH", "ABC-DEFH", "ÉBCDEFGH", "😀".repeat(8), "ABC\ud800EFGH", "  Sandi lama 2026  "]) {
    assert.equal(validateParticipantPassword(input).ok, false, String(input));
  }
  for (const input of ["ABCDEFGH", "ZZZZZZZZ", "OILAZXYZ"]) {
    assert.deepEqual(validateParticipantPassword(input), { ok: true, value: input });
  }
});

test("generator memakai delapan huruf kapital acak dan batch dibatasi", () => {
  assert.equal(GENERATED_PARTICIPANT_PASSWORD_LENGTH, 8);
  assert.equal(PARTICIPANT_PASSWORD_BATCH_SIZE, 25);
  const values = Array.from({ length: 500 }, () => generateParticipantPassword());
  assert.ok(values.every((value) => value.length === 8 && /^[A-Z]{8}$/.test(value)));
  assert.ok(new Set(values).size > 495);
});

test("hash scrypt dan salinan AES-GCM untuk sandi baru dapat diverifikasi", async () => {
  const key = randomBytes(32);
  const password = "ABCDEFGH";
  const binding = { identityId: "42", periodId: "19" };
  const hash = await hashParticipantPassword(password);
  const secondHash = await hashParticipantPassword(password);
  assert.notEqual(hash, secondHash);
  assert.ok(hash.startsWith("scrypt$32768$8$3$"));
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(password.toLowerCase(), hash), false);
  const first = encryptParticipantPassword(password, key, binding);
  const second = encryptParticipantPassword(password, key, binding);
  assert.equal(first.nonce.length, 12);
  assert.equal(first.ciphertext.length, 8);
  assert.equal(first.authenticationTag.length, 16);
  assert.notDeepEqual(first.nonce, second.nonce);
  assert.notDeepEqual(first.ciphertext, Buffer.from(password));
  assert.equal(decryptParticipantPassword(first, key, binding), password);
  const verifier = participantKeyVerifier(key);
  assert.equal(verifier.length, 32);
  assert.equal(sameParticipantVerifier(verifier, participantKeyVerifier(key)), true);
  assert.equal(sameParticipantVerifier(verifier, participantKeyVerifier(randomBytes(32))), false);
  assert.equal(sameParticipantVerifier(verifier, Buffer.alloc(1)), false);
});

test("vektor PR 17 tetap terbuka dan terverifikasi, tetapi tidak dapat dibuat sebagai sandi baru", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/participant-password-v014.json", import.meta.url), "utf8"));
  const key = Buffer.from(fixture.key, "base64");
  try {
    for (const vector of fixture.vectors) {
      const encrypted = { nonce: Buffer.from(vector.nonce, "base64"), ciphertext: Buffer.from(vector.ciphertext, "base64"), authenticationTag: Buffer.from(vector.authenticationTag, "base64") };
      assert.equal(await verifyPassword(vector.password, vector.hash), true);
      assert.equal(decryptParticipantPassword(encrypted, key, fixture.binding), vector.password);
      assert.equal(validateParticipantPassword(vector.password).ok, false);
      await assert.rejects(() => hashParticipantPassword(vector.password));
      assert.throws(() => encryptParticipantPassword(vector.password, key, fixture.binding));
    }
  } finally { key.fill(0); }
});

test("AES-GCM menolak ciphertext, nonce, tag, kunci, dan identitas yang berubah", () => {
  const key = randomBytes(32);
  const binding = { identityId: "123", periodId: "456" };
  const encrypted = encryptParticipantPassword("ABCDEFGH", key, binding);
  for (const field of ["nonce", "ciphertext", "authenticationTag"]) {
    const changed = { ...encrypted, [field]: Buffer.from(encrypted[field]) };
    changed[field][0] ^= 1;
    assert.throws(() => decryptParticipantPassword(changed, key, binding));
  }
  assert.throws(() => decryptParticipantPassword({ ...encrypted, ciphertext: Buffer.alloc(7) }, key, binding));
  assert.throws(() => decryptParticipantPassword({ ...encrypted, ciphertext: Buffer.alloc(513) }, key, binding));
  assert.throws(() => decryptParticipantPassword(encrypted, randomBytes(32), binding));
  assert.throws(() => decryptParticipantPassword(encrypted, key, { ...binding, identityId: "124" }));
  assert.throws(() => decryptParticipantPassword(encrypted, key, { ...binding, periodId: "457" }));
  assert.throws(() => encryptParticipantPassword("ABCDEFGH", key, { ...binding, identityId: "01" }));
  assert.throws(() => encryptParticipantPassword("pendek", key, binding));
});

test("file kunci dibuat eksklusif di luar proyek, dibaca konsisten, dan tidak ditimpa", async () => {
  const home = await mkdtemp(join(tmpdir(), "nusacbt-key-test-"));
  const project = join(home, "project");
  const keyFile = join(home, "participant.key");
  try {
    await mkdir(project);
    await createParticipantKeyFile(keyFile, project);
    const original = await readFile(keyFile, "utf8");
    assert.match(original, /^[A-Za-z0-9+/]{43}=\n$/);
    if (process.platform !== "win32") assert.equal((await stat(keyFile)).mode & 0o077, 0);
    const key = await readParticipantKeyFile(keyFile, project);
    assert.equal(key.length, 32);
    assert.equal(key.toString("base64"), original.trim());
    key.fill(0);
    await assert.rejects(() => createParticipantKeyFile(keyFile, project), hasReason("exists"));
    assert.equal(await readFile(keyFile, "utf8"), original);
    await assert.rejects(() => createParticipantKeyFile(join(project, "bad.key"), project), hasReason("inside_project"));
    await assert.rejects(() => readParticipantKeyFile("relative.key", project), hasReason("invalid"));
    await assert.rejects(() => readParticipantKeyFile(undefined, project), hasReason("missing"));
    await assert.rejects(() => readParticipantKeyFile(keyFile, undefined), hasReason("unreadable"));
    await assert.rejects(() => readParticipantKeyFile(keyFile, "relative-project"), hasReason("unreadable"));
    await assert.rejects(() => readParticipantKeyFile(join(home, "missing.key"), project), hasReason("unreadable"));
    await writeFile(join(home, "bad.key"), "bukan-base64-benar\n");
    await assert.rejects(() => readParticipantKeyFile(join(home, "bad.key"), project), hasReason("invalid"));
    await writeFile(join(home, "bad.key"), "x".repeat(500));
    await assert.rejects(() => readParticipantKeyFile(join(home, "bad.key"), project), hasReason("invalid"));
    await writeFile(join(project, "inside.key"), original);
    const otherWorkingDirectory = join(home, "other-cwd");
    await mkdir(otherWorkingDirectory);
    await mkdir(join(project, ".git"));
    await assert.rejects(() => readParticipantKeyFile(join(project, "inside.key"), otherWorkingDirectory), hasReason("inside_project"));
    await assert.rejects(() => createParticipantKeyFile(join(project, "new.key"), otherWorkingDirectory), hasReason("inside_project"));
    const deployed = join(home, "deployed-without-git");
    await mkdir(deployed);
    await writeFile(join(deployed, "package.json"), '{"name":"nusacbt"}');
    await writeFile(join(deployed, "inside.key"), original);
    await assert.rejects(() => readParticipantKeyFile(join(deployed, "inside.key"), otherWorkingDirectory), hasReason("inside_project"));
    await assert.rejects(() => createParticipantKeyFile(join(deployed, "new.key"), otherWorkingDirectory), hasReason("inside_project"));
    try {
      await symlink(join(project, "inside.key"), join(home, "linked.key"), "file");
      await assert.rejects(() => readParticipantKeyFile(join(home, "linked.key"), project), hasReason("inside_project"));
      await assert.rejects(() => readParticipantKeyFile(join(home, "linked.key"), otherWorkingDirectory), hasReason("inside_project"));
      await symlink(project, join(home, "linked-project"), "dir");
      await assert.rejects(() => createParticipantKeyFile(join(home, "linked-project", "new.key"), project), hasReason("inside_project"));
      await assert.rejects(() => createParticipantKeyFile(join(home, "linked-project", "new.key"), otherWorkingDirectory), hasReason("inside_project"));
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "ENOSYS", "ENOTSUP"].includes(error?.code)) throw error;
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("CLI mengenali proyek walau dijalankan dari direktori induk file kunci", async () => {
  const home = await mkdtemp(join(tmpdir(), "nusacbt-key-cli-test-"));
  const keyFile = join(home, "kunci-fiktif.key");
  const script = fileURLToPath(new URL("../../scripts/create-participant-key.mjs", import.meta.url));
  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
  try {
    const result = spawnSync(process.execPath, [script, keyFile], { cwd: home, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const key = await readParticipantKeyFile(keyFile, projectRoot);
    try { assert.equal(key.length, 32); assert.ok(!result.stdout.includes(key.toString("base64"))); }
    finally { key.fill(0); }
  } finally { await rm(home, { recursive: true, force: true }); }
});
