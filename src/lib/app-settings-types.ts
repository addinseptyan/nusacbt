import type { AppModeId, AppTimeZone, ColorPaletteId } from "@/lib/app-settings-validation.mjs";

export type PublicAppSettings = {
  appName: string;
  appDescription: string;
  schoolName: string;
  participantInfo: string;
  colorPalette: ColorPaletteId;
  defaultTimeZone: AppTimeZone;
  hasLogo: boolean;
  revision: string;
};

export type AdminAppSettings = PublicAppSettings & {
  appMode: AppModeId;
  updatedAt: string;
  updatedByUsername: string | null;
};
