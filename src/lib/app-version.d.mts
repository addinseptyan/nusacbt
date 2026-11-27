export const APP_GITHUB_REPO: string;
export const APP_DEFAULT_VERSION: string;

export type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
};

export type AppVersionInfo = {
  version: string;
  tag: string;
  commitSha: string;
  buildDate: string;
  repo: string;
};

export type ReleaseAssetInfo = {
  name: string;
  url: string;
  size: number;
};

export type CheckUpdateResult =
  | {
      ok: true;
      currentVersion: string;
      currentTag: string;
      hasUpdate: boolean;
      noReleaseYet: boolean;
      latestVersion: string;
      latestTag: string;
      releaseName: string;
      publishedAt: string;
      notes: string;
      releaseUrl: string;
      assets: {
        installer: ReleaseAssetInfo | null;
        portableZip: ReleaseAssetInfo | null;
        checksums: ReleaseAssetInfo | null;
      };
    }
  | {
      ok: false;
      currentVersion: string;
      currentTag: string;
      offline?: boolean;
      error: string;
    };

export function parseSemver(raw: unknown): ParsedSemver | null;
export function compareSemver(a: string, b: string): number;
export function formatReleaseTag(version: string): string;
export function getAppVersionInfo(): AppVersionInfo;
export function safeGitHubHttpsUrl(rawUrl: unknown): string | null;
export function selectWindowsReleaseAssets(rawAssets: unknown): {
  installer: ReleaseAssetInfo | null;
  portableZip: ReleaseAssetInfo | null;
  checksums: ReleaseAssetInfo | null;
};
export function checkGitHubLatestRelease(options?: {
  currentVersion?: string;
  repo?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CheckUpdateResult>;
