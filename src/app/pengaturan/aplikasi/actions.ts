"use server";

import { saveAppSettings, type SaveAppSettingsResult } from "@/lib/app-settings-service";

export async function saveAppSettingsAction(formData: FormData): Promise<SaveAppSettingsResult> {
  return saveAppSettings(formData);
}
