import assert from "node:assert/strict";
import test from "node:test";

import {
  checkGitHubLatestRelease,
  compareSemver,
  formatReleaseTag,
  getAppVersionInfo,
  parseSemver,
  safeGitHubHttpsUrl,
  selectWindowsReleaseAssets,
} from "../../src/lib/app-version.mjs";

test("parseSemver, formatReleaseTag & compareSemver mengurutkan versi SemVer dengan benar", () => {
  assert.deepEqual(parseSemver("v1.0.0"), {
    major: 1,
    minor: 0,
    patch: 0,
    prerelease: "",
  });
  assert.equal(formatReleaseTag("1.0.0"), "v1.0.0");
  assert.equal(formatReleaseTag("v1.2.3-rc.1"), "v1.2.3-rc.1");
  assert.equal(parseSemver("invalid"), null);
  assert.equal(parseSemver("1.0"), null);

  assert.equal(compareSemver("v1.0.0", "1.0.0"), 0);
  assert.ok(compareSemver("v1.0.1", "v1.0.0") > 0);
  assert.ok(compareSemver("v1.2.0", "v1.10.0") < 0);
  assert.ok(compareSemver("v2.0.0", "v1.99.99") > 0);
  assert.ok(compareSemver("v1.0.0", "v1.0.0-rc.1") > 0);
  assert.ok(compareSemver("v1.0.0-beta.1", "v1.0.0-rc.1") < 0);
});

test("safeGitHubHttpsUrl hanya mengizinkan HTTPS dari domain GitHub resmi", () => {
  assert.equal(
    safeGitHubHttpsUrl("https://github.com/addinseptyan/nusacbt/releases/tag/v1.0.0"),
    "https://github.com/addinseptyan/nusacbt/releases/tag/v1.0.0",
  );
  assert.equal(
    safeGitHubHttpsUrl("https://objects.githubusercontent.com/file.zip"),
    "https://objects.githubusercontent.com/file.zip",
  );
  assert.equal(safeGitHubHttpsUrl("http://github.com/addinseptyan/nusacbt"), null);
  assert.equal(safeGitHubHttpsUrl("https://evil.example.com/payload.exe"), null);
  assert.equal(safeGitHubHttpsUrl("javascript:alert(1)"), null);
});

test("selectWindowsReleaseAssets memilih installer, portable zip, dan checksums yang aman", () => {
  const picked = selectWindowsReleaseAssets([
    {
      name: "NusaCBT-Setup-v1.1.0-win64.exe",
      browser_download_url: "https://github.com/addinseptyan/nusacbt/releases/download/v1.1.0/NusaCBT-Setup-v1.1.0-win64.exe",
      size: 120000000,
    },
    {
      name: "NusaCBT-v1.1.0-win64-portable.zip",
      browser_download_url: "https://github.com/addinseptyan/nusacbt/releases/download/v1.1.0/NusaCBT-v1.1.0-win64-portable.zip",
      size: 110000000,
    },
    {
      name: "SHA256SUMS.txt",
      browser_download_url: "https://github.com/addinseptyan/nusacbt/releases/download/v1.1.0/SHA256SUMS.txt",
      size: 512,
    },
    {
      name: "NusaCBT-Setup-v1.1.0-win64.exe",
      browser_download_url: "https://untrusted.example.com/fake.exe",
      size: 99,
    },
  ]);

  assert.equal(picked.installer?.name, "NusaCBT-Setup-v1.1.0-win64.exe");
  assert.equal(picked.portableZip?.name, "NusaCBT-v1.1.0-win64-portable.zip");
  assert.equal(picked.checksums?.name, "SHA256SUMS.txt");
});

test("getAppVersionInfo mengembalikan versi awal 1.0.0", () => {
  const info = getAppVersionInfo();
  assert.equal(info.version, "1.0.0");
  assert.equal(info.tag, "v1.0.0");
  assert.equal(info.repo, "addinseptyan/nusacbt");
});

test("checkGitHubLatestRelease menangani 404, versi terbaru, versi sama, dan offline secara aman", async () => {
  const noRelease = await checkGitHubLatestRelease({
    currentVersion: "1.0.0",
    fetchImpl: async () => new Response("Not Found", { status: 404 }),
  });
  assert.equal(noRelease.ok, true);
  if (noRelease.ok) assert.equal(noRelease.noReleaseYet, true);

  const hasNew = await checkGitHubLatestRelease({
    currentVersion: "1.0.0",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          tag_name: "v1.1.0",
          name: "NusaCBT v1.1.0",
          published_at: "2026-12-01T00:00:00Z",
          body: "- Perbaikan sinkronisasi LAN",
          html_url: "https://github.com/addinseptyan/nusacbt/releases/tag/v1.1.0",
          assets: [
            {
              name: "NusaCBT-Setup-v1.1.0-win64.exe",
              browser_download_url: "https://github.com/addinseptyan/nusacbt/releases/download/v1.1.0/NusaCBT-Setup-v1.1.0-win64.exe",
              size: 1000,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  assert.equal(hasNew.ok, true);
  if (hasNew.ok && !hasNew.noReleaseYet) {
    assert.equal(hasNew.hasUpdate, true);
    assert.equal(hasNew.latestTag, "v1.1.0");
    assert.equal(hasNew.assets.installer?.name, "NusaCBT-Setup-v1.1.0-win64.exe");
  }

  const same = await checkGitHubLatestRelease({
    currentVersion: "1.0.0",
    fetchImpl: async () =>
      new Response(JSON.stringify({ tag_name: "v1.0.0", assets: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.equal(same.ok, true);
  if (same.ok && !same.noReleaseYet) assert.equal(same.hasUpdate, false);

  const offline = await checkGitHubLatestRelease({
    currentVersion: "1.0.0",
    fetchImpl: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(offline.ok, false);
  if (!offline.ok) assert.equal(offline.offline, true);
});
