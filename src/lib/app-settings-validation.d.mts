export type ColorPaletteId = "emerald" | "indigo" | "blue" | "violet" | "rose" | "amber";
export type AppModeId = "production" | "dev";
export type AppTimeZone = "WIB" | "WITA" | "WIT";

export const APP_COLOR_PALETTES: ReadonlyArray<{
  id: ColorPaletteId;
  label: string;
  detail: string;
  swatch: string;
  darkSwatch: string;
}>;

export const APP_MODES: ReadonlyArray<AppModeId>;

export const APP_TIME_ZONES: ReadonlyArray<{
  id: AppTimeZone;
  label: string;
  detail: string;
}>;

export const DEFAULT_APP_SETTINGS: {
  appName: string;
  appDescription: string;
  schoolName: string;
  participantInfo: string;
  colorPalette: ColorPaletteId;
  defaultTimeZone: AppTimeZone;
  hasLogo: boolean;
  revision: string;
};

export function isValidPalette(raw: unknown): raw is ColorPaletteId;
export function isValidAppMode(raw: unknown): raw is AppModeId;
export function isValidTimeZone(raw: unknown): raw is AppTimeZone;
export function parseAppTimeZone(raw: unknown, fallback?: AppTimeZone): AppTimeZone;
export function validateAppSettingsInput(input: {
  appName: unknown;
  appDescription: unknown;
  schoolName: unknown;
  participantInfo: unknown;
  colorPalette: unknown;
  appMode?: unknown;
  defaultTimeZone?: unknown;
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
        defaultTimeZone: AppTimeZone;
        revision: string;
        appModeProvided: boolean;
        defaultTimeZoneProvided: boolean;
      };
    }
  | { ok: false; error: string };
