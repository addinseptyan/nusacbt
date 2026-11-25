export type ColorPaletteId = "emerald" | "indigo" | "blue" | "violet" | "rose" | "amber";
export type AppModeId = "production" | "dev";

export const APP_COLOR_PALETTES: ReadonlyArray<{
  id: ColorPaletteId;
  label: string;
  detail: string;
  swatch: string;
  darkSwatch: string;
}>;

export const APP_MODES: ReadonlyArray<AppModeId>;

export const DEFAULT_APP_SETTINGS: {
  appName: string;
  appDescription: string;
  schoolName: string;
  participantInfo: string;
  colorPalette: ColorPaletteId;
  hasLogo: boolean;
  hasLetterhead: boolean;
  revision: string;
};

export function isValidPalette(raw: unknown): raw is ColorPaletteId;
export function isValidAppMode(raw: unknown): raw is AppModeId;
export function parseTimelineDefaultDays(raw: unknown): number | null;
export function validateAppSettingsInput(input: {
  appName: unknown;
  appDescription: unknown;
  schoolName: unknown;
  participantInfo: unknown;
  colorPalette: unknown;
  appMode?: unknown;
  timelineDefaultDays?: unknown;
  revision: unknown;
}):
  | {
      ok: true;
      value: {
        appName: string;
        appDescription: string;
        schoolName: string;
        participantInfo: string;
        colorPalette: ColorPaletteId;
        appMode: AppModeId;
        timelineDefaultDays: number;
        revision: string;
        appModeProvided: boolean;
        timelineDaysProvided: boolean;
      };
    }
  | { ok: false; error: string };
