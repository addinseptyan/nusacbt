"use server";

import { saveAppSettings, type SaveAppSettingsResult } from "@/lib/app-settings-service";
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
