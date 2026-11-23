export type ColorPaletteId = "emerald" | "indigo" | "blue" | "violet" | "rose" | "amber";

export const APP_COLOR_PALETTES: ReadonlyArray<{
  id: ColorPaletteId;
  label: string;
  detail: string;
  swatch: string;
  darkSwatch: string;
}>;

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
export function validateAppSettingsInput(input: {
  appName: unknown;
  appDescription: unknown;
  schoolName: unknown;
  participantInfo: unknown;
  colorPalette: unknown;
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
        revision: string;
      };
    }
  | { ok: false; error: string };
