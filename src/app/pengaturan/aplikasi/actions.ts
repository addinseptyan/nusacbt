"use server";

import { getAdminSessionSafe, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { saveAppSettings, type SaveAppSettingsResult } from "@/lib/app-settings-service";
import { checkGitHubLatestRelease, getAppVersionInfo, type CheckUpdateResult } from "@/lib/app-version.mjs";
import { resetOperationalDatabaseForDev, type ExecuteCascadeResult } from "@/lib/dev-cascade-delete-service";

export async function saveAppSettingsAction(formData: FormData): Promise<SaveAppSettingsResult> {
  return saveAppSettings(formData);
}

export async function resetDevDatabaseAction(input: {
  acknowledged: boolean;
  confirmPhrase: string;
}): Promise<ExecuteCascadeResult> {
  return resetOperationalDatabaseForDev(input);
}

export async function checkAppUpdateAction(): Promise<
  (CheckUpdateResult & { sessionExpired?: boolean })
> {
  const admin = await getAdminSessionSafe();
  const info = getAppVersionInfo();
  if (!admin) {
    return {
      ok: false,
      currentVersion: info.version,
      currentTag: info.tag,
      sessionExpired: true,
      error: "Sesi admin telah berakhir. Silakan masuk kembali.",
    };
  }
  if (!adminHasPermission(admin, "app_settings.manage")) {
    return {
      ok: false,
      currentVersion: info.version,
      currentTag: info.tag,
      error: PERMISSION_DENIED_MESSAGE,
    };
  }
  return checkGitHubLatestRelease({ currentVersion: info.version });
}

