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

test("validasi sandi manual mempertahankan spasi dan mendukung Unicode dalam batas", () => {
  for (const input of [null, undefined, 123, "x".repeat(11), "x".repeat(129), "😀".repeat(129), "a".repeat(12) + "\n", "a".repeat(12) + "\u0080", "a".repeat(12) + "\ud800"]) {
    assert.equal(validateParticipantPassword(input).ok, false);
  }
  for (const input of ["123456789012", "   kata sandi panjang   ", "😀".repeat(128)]) {
    assert.deepEqual(validateParticipantPassword(input), { ok: true, value: input });
  }
});

test("generator memakai 16 karakter acak dan batch dibatasi", () => {
  assert.equal(GENERATED_PARTICIPANT_PASSWORD_LENGTH, 16);
  assert.equal(PARTICIPANT_PASSWORD_BATCH_SIZE, 25);
  const values = Array.from({ length: 500 }, () => generateParticipantPassword());
  assert.ok(values.every((value) => /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{16}$/.test(value)));
  assert.equal(new Set(values).size, values.length);
});

test("hash scrypt dan salinan AES-GCM dapat diverifikasi tanpa menyimpan plaintext", async () => {
  const key = randomBytes(32);
  const password = "  contoh sandi fiktif 2026  ";
  const binding = { identityId: "42", periodId: "19" };
  const hash = await hashParticipantPassword(password);
  const secondHash = await hashParticipantPassword(password);
  assert.notEqual(hash, secondHash);
  assert.ok(hash.startsWith("scrypt$32768$8$3$"));
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(password.trim(), hash), false);
  const first = encryptParticipantPassword(password, key, binding);
  const second = encryptParticipantPassword(password, key, binding);
  assert.equal(first.nonce.length, 12);
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

test("format hash yang sama mendukung 128 karakter Unicode multi-byte", async () => {
  const password = "😀".repeat(128);
  const hash = await hashParticipantPassword(password);
  assert.equal(await verifyPassword(password, hash), true);
  await assert.rejects(() => hashParticipantPassword("😀".repeat(129)));
});

test("AES-GCM menolak ciphertext, nonce, tag, kunci, dan identitas yang berubah", () => {
  const key = randomBytes(32);
  const binding = { identityId: "123", periodId: "456" };
  const encrypted = encryptParticipantPassword("sandi fiktif 123456", key, binding);
  for (const field of ["nonce", "ciphertext", "authenticationTag"]) {
    const changed = { ...encrypted, [field]: Buffer.from(encrypted[field]) };
    changed[field][0] ^= 1;
    assert.throws(() => decryptParticipantPassword(changed, key, binding));
  }
  assert.throws(() => decryptParticipantPassword(encrypted, randomBytes(32), binding));
  assert.throws(() => decryptParticipantPassword(encrypted, key, { ...binding, identityId: "124" }));
  assert.throws(() => decryptParticipantPassword(encrypted, key, { ...binding, periodId: "457" }));
  assert.throws(() => encryptParticipantPassword("sandi fiktif 123456", key, { ...binding, identityId: "01" }));
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
