import type { AppModeId, ColorPaletteId } from "@/lib/app-settings-validation.mjs";

export type PublicAppSettings = {
  appName: string;
  appDescription: string;
  schoolName: string;
  participantInfo: string;
  colorPalette: ColorPaletteId;
  hasLogo: boolean;
  hasLetterhead: boolean;
  revision: string;
};

export type AdminAppSettings = PublicAppSettings & {
  appMode: AppModeId;
  timelineDefaultDays: number;
  updatedAt: string;
  updatedByUsername: string | null;
};
