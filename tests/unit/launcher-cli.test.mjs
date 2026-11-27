import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("scripts/launcher-cli.mjs");

test("launcher-cli check melaporkan status missing_env secara bersih pada data-dir kosong di luar proyek", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nusacbt-launcher-check-"));
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.PGHOST;
    delete cleanEnv.PGPORT;
    delete cleanEnv.PGDATABASE;
    delete cleanEnv.PGUSER;
    delete cleanEnv.PGPASSWORD;
    delete cleanEnv.NUSACBT_PARTICIPANT_KEY_FILE;
    delete cleanEnv.NUSACBT_EXAM_TOKEN_KEY_FILE;

    const { stdout } = await execFileAsync(process.execPath, [cliPath, "check", "--data-dir", dir], {
      env: cleanEnv,
    });
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.version, "1.0.0");
    assert.equal(parsed.tag, "v1.0.0");
    assert.equal(parsed.envExists, false);
    assert.equal(parsed.keys.participantOk, false);
    assert.equal(parsed.keys.tokenOk, false);
    assert.equal(parsed.db.configured, false);
    assert.equal(parsed.db.errorCode, "missing_env");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("launcher-cli menolak subperintah tidak dikenal dengan JSON terstruktur", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nusacbt-launcher-badcmd-"));
  try {
    let failed = false;
    try {
      await execFileAsync(process.execPath, [cliPath, "unknown-cmd", "--data-dir", dir]);
    } catch (error) {
      failed = true;
      const errObj = /** @type {{ code?: number; stdout?: string }} */ (error);
      assert.equal(errObj.code, 1);
      const parsed = JSON.parse(String(errObj.stdout || "").trim());
      assert.equal(parsed.ok, false);
      assert.match(parsed.error, /tidak dikenal/i);
    }
    assert.equal(failed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("launcher-cli setup menolak nama database tidak aman sebelum menyentuh file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nusacbt-launcher-badsetup-"));
  try {
    const child = execFile(process.execPath, [cliPath, "setup", "--data-dir", dir]);
    child.stdin?.end(
      JSON.stringify({
        host: "127.0.0.1",
        port: 5432,
        database: "nusacbt; DROP TABLE admin_users;",
        user: "nusacbt_app",
        password: "secret",
      }),
    );
    const result = await new Promise((resolvePromise) => {
      let stdout = "";
      child.stdout?.on("data", (d) => {
        stdout += String(d);
      });
      child.on("close", (code) => resolvePromise({ code, stdout }));
    });
    const res = /** @type {{ code: number; stdout: string }} */ (result);
    assert.equal(res.code, 1);
    const parsed = JSON.parse(res.stdout.trim());
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /Nama database/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
