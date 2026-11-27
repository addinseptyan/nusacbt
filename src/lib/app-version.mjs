export const APP_GITHUB_REPO = "addinseptyan/nusacbt";
export const APP_DEFAULT_VERSION = "1.0.1";

/** @typedef {{ major: number; minor: number; patch: number; prerelease: string }} ParsedSemver */

/**
 * @param {unknown} raw
 * @returns {ParsedSemver | null}
 */
export function parseSemver(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(trimmed);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

/**
 * Bandingkan dua versi SemVer. Mengembalikan >0 jika a > b, <0 jika a < b, 0 jika sama.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error("Format versi SemVer tidak valid.");
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && !pb.prerelease) return -1;
  if (pa.prerelease === pb.prerelease) return 0;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/**
 * @param {string} version
 * @returns {string}
 */
export function formatReleaseTag(version) {
  const parsed = parseSemver(version);
  if (!parsed) return `v${APP_DEFAULT_VERSION}`;
  const base = `v${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease ? `${base}-${parsed.prerelease}` : base;
}

export function getAppVersionInfo() {
  const rawVersion = process.env.NEXT_PUBLIC_APP_VERSION || APP_DEFAULT_VERSION;
  const parsed = parseSemver(rawVersion);
  const version = parsed
    ? `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ""}`
    : APP_DEFAULT_VERSION;
  return {
    version,
    tag: formatReleaseTag(version),
    commitSha: (process.env.NEXT_PUBLIC_APP_BUILD_SHA || "").trim(),
    buildDate: (process.env.NEXT_PUBLIC_APP_BUILD_DATE || "").trim(),
    repo: APP_GITHUB_REPO,
  };
}

/**
 * @param {unknown} rawUrl
 * @returns {string | null}
 */
export function safeGitHubHttpsUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return null;
    if (
      parsed.hostname !== "github.com" &&
      parsed.hostname !== "objects.githubusercontent.com" &&
      parsed.hostname !== "release-assets.githubusercontent.com"
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * @typedef {{ name: string; url: string; size: number }} ReleaseAssetInfo
 * @param {unknown} rawAssets
 */
export function selectWindowsReleaseAssets(rawAssets) {
  const list = Array.isArray(rawAssets) ? rawAssets : [];
  /** @type {ReleaseAssetInfo | null} */
  let installer = null;
  /** @type {ReleaseAssetInfo | null} */
  let portableZip = null;
  /** @type {ReleaseAssetInfo | null} */
  let checksums = null;

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name : "";
    const url = safeGitHubHttpsUrl(item.browser_download_url);
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0;
    if (!name || !url) continue;

    if (/^NusaCBT-Setup-v[0-9A-Za-z._-]+-win64\.exe$/i.test(name) || /^NusaCBT-Setup.*\.exe$/i.test(name)) {
      installer = { name, url, size };
    } else if (/^NusaCBT-v[0-9A-Za-z._-]+-win64-portable\.zip$/i.test(name) || /^NusaCBT-.*portable\.zip$/i.test(name)) {
      portableZip = { name, url, size };
    } else if (/^SHA256SUMS\.txt$/i.test(name)) {
      checksums = { name, url, size };
    }
  }

  return { installer, portableZip, checksums };
}

/**
 * Memeriksa pembaruan terbaru di GitHub Releases HANYA saat dipicu secara eksplisit.
 * @param {{
 *   currentVersion?: string;
 *   repo?: string;
 *   fetchImpl?: typeof fetch;
 *   timeoutMs?: number;
 * }} [options]
 */
export async function checkGitHubLatestRelease(options = {}) {
  const currentVersion = options.currentVersion || getAppVersionInfo().version;
  const currentTag = formatReleaseTag(currentVersion);
  const repo = options.repo || APP_GITHUB_REPO;
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 8000;

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return {
      ok: false,
      currentVersion,
      currentTag,
      error: "Nama repositori GitHub tidak valid.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `NusaCBT/${currentVersion}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 404) {
      return {
        ok: true,
        currentVersion,
        currentTag,
        hasUpdate: false,
        noReleaseYet: true,
        latestVersion: currentVersion,
        latestTag: currentTag,
        releaseName: "",
        publishedAt: "",
        notes: "",
        releaseUrl: `https://github.com/${repo}/releases`,
        assets: { installer: null, portableZip: null, checksums: null },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        currentVersion,
        currentTag,
        error: response.status === 403 || response.status === 429
          ? "Batas permintaan API GitHub sementara tercapai. Coba lagi beberapa menit lagi."
          : `Gagal memeriksa rilis GitHub (HTTP ${response.status}).`,
      };
    }

    const payload = await response.json();
    const latestTagRaw = typeof payload?.tag_name === "string" ? payload.tag_name.trim() : "";
    const parsedLatest = parseSemver(latestTagRaw);
    if (!parsedLatest) {
      return {
        ok: false,
        currentVersion,
        currentTag,
        error: "Tag rilis terbaru di GitHub tidak menggunakan format versi SemVer yang valid.",
      };
    }

    const latestTag = formatReleaseTag(latestTagRaw);
    const latestVersion = latestTag.replace(/^v/, "");
    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
    const releaseUrl = safeGitHubHttpsUrl(payload?.html_url) || `https://github.com/${repo}/releases`;
    const notesRaw = typeof payload?.body === "string" ? payload.body.trim() : "";

    return {
      ok: true,
      currentVersion,
      currentTag,
      hasUpdate,
      noReleaseYet: false,
      latestVersion,
      latestTag,
      releaseName: typeof payload?.name === "string" ? payload.name.trim() : latestTag,
      publishedAt: typeof payload?.published_at === "string" ? payload.published_at : "",
      notes: notesRaw.slice(0, 2000),
      releaseUrl,
      assets: selectWindowsReleaseAssets(payload?.assets),
    };
  } catch {
    return {
      ok: false,
      currentVersion,
      currentTag,
      offline: true,
      error: "Tidak dapat terhubung ke GitHub. Pastikan PC server terhubung ke internet saat memeriksa pembaruan, atau gunakan file ZIP rilis offline pada NusaCBT-Server.exe.",
    };
  } finally {
    clearTimeout(timer);
  }
}
