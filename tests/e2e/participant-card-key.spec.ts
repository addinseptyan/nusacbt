import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { createParticipantKeyFile } from "../../src/lib/participant-password-crypto.mjs";
import { loginAsAdmin } from "./helpers";
import { cleanupLoginFixture, loginTestDatabase, seedLoginFixture } from "./participant-login-helpers";

const endpoint = "/data-peserta/kartu/siapkan";

async function startWithKey(keyPath: string) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Port fixture tidak tersedia.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const root = process.cwd();
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", root, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root, env: { ...process.env, NUSACBT_PARTICIPANT_KEY_FILE: keyPath, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let output = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server fixture kunci tidak siap.")), 30_000);
      const receive = (chunk: Buffer) => { output += chunk.toString(); if (output.includes("Ready in")) { clearTimeout(timer); resolve(); } };
      child.stdout?.on("data", receive); child.stderr?.on("data", receive);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server fixture berhenti (${code}).`)); });
    });
    return { port, close: async () => { child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 5_000); await exited; clearTimeout(timer); } };
  } catch (error) { child.kill("SIGKILL"); await exited; throw error; }
}

test("tanpa kunci atau kunci berbeda, kartu tanpa sandi tetap tersedia dan pengungkapan gagal tertutup", async ({ page }) => {
  test.setTimeout(90_000);
  const client = loginTestDatabase(); await client.connect(); const f = await seedLoginFixture(client);
  const dir = await mkdtemp(join(tmpdir(), "nusacbt-card-key-")); const wrongKey = join(dir, "wrong.key");
  try {
    await createParticipantKeyFile(wrongKey, process.cwd());
    await loginAsAdmin(page); await page.goto(`/data-peserta/kartu?periode=${f.periodA}`);
    await page.getByRole("checkbox", { name: new RegExp(`^Pilih ${f.studentAName} NISN`) }).check();
    const waiting = page.waitForResponse((response) => response.url().includes(endpoint) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Pratinjau kartu" }).click();
    const payload = (await waiting).request().postDataJSON();
    await page.getByRole("dialog", { name: /Pratinjau/ }).getByRole("button", { name: "Tutup" }).click();
    for (const scenario of [
      { path: "", message: "Kunci sandi peserta belum dikonfigurasi" },
      { path: wrongKey, message: "Kunci tidak cocok dengan database" },
    ]) {
      const isolated = await startWithKey(scenario.path);
      try {
        const origin = `http://127.0.0.1:${isolated.port}`;
        const headers = { Origin: origin, "Content-Type": "application/json", "X-NusaCBT-Cards": "1" };
        const safe = await page.request.post(`${origin}${endpoint}`, { headers, data: payload });
        expect(safe.status()).toBe(200); const safeBody = await safe.json(); expect(safeBody.result.cards[0].password).toBeNull();
        const reveal = await page.request.post(`${origin}${endpoint}`, { headers, data: { ...payload, includePassword: true } });
        expect(reveal.status()).toBe(409); const text = await reveal.text();
        expect(text).toContain(scenario.message); expect(text).not.toContain(f.passwordA);
      } finally { await isolated.close(); }
    }
    expect((await client.query<{ n: number }>("SELECT count(*)::int AS n FROM participant_password_audit WHERE participant_identity_id=$1 AND event='reveal'", [f.identityA])).rows[0].n).toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); await cleanupLoginFixture(client, f); await client.end(); }
});
