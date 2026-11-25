export const APP_COLOR_PALETTES = [
  { id: "emerald", label: "Zamrud", detail: "Hijau zamrud (bawaan)", swatch: "#148a68", darkSwatch: "#49bc93" },
  { id: "indigo", label: "Indigo", detail: "Biru nila bersih", swatch: "#4f46e5", darkSwatch: "#818cf8" },
  { id: "blue", label: "Biru Langit", detail: "Biru cerah profesional", swatch: "#0284c7", darkSwatch: "#38bdf8" },
  { id: "violet", label: "Ungu", detail: "Ungu modern lembut", swatch: "#7c3aed", darkSwatch: "#a78bfa" },
  { id: "rose", label: "Mawar", detail: "Merah mawar hangat", swatch: "#e11d48", darkSwatch: "#fb7185" },
  { id: "amber", label: "Kuning Emas", detail: "Emas hangat berenergi", swatch: "#d97706", darkSwatch: "#fbbf24" },
];

export const APP_MODES = ["production", "dev"];

const PALETTE_IDS = new Set(APP_COLOR_PALETTES.map((item) => item.id));
const APP_MODE_SET = new Set(APP_MODES);
const CTRL_ANY = /[\u0000-\u001f\u007f-\u009f]/;
const CTRL_MULTILINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export const DEFAULT_APP_SETTINGS = {
  appName: "NusaCBT",
  appDescription: "Platform ujian sekolah",
  schoolName: "",
  participantInfo: "",
  colorPalette: "emerald",
  hasLogo: false,
  hasLetterhead: false,
  revision: "1",
};

function cleanSingleLine(raw) {
  if (typeof raw !== "string") return null;
  return raw.replace(/\s+/g, " ").trim();
}

function cleanMultiline(raw) {
  if (typeof raw !== "string") return null;
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/** @param {unknown} raw */
export function isValidPalette(raw) {
  return typeof raw === "string" && PALETTE_IDS.has(raw);
}

/** @param {unknown} raw */
export function isValidAppMode(raw) {
  return typeof raw === "string" && APP_MODE_SET.has(raw);
}

/** @param {unknown} raw */
export function parseTimelineDefaultDays(raw) {
  const num = typeof raw === "number" ? raw : typeof raw === "string" && /^[1-7]$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(num) && num >= 1 && num <= 7 ? num : null;
}

/** @param {Record<string, unknown>} input */
export function validateAppSettingsInput(input) {
  const appName = cleanSingleLine(input.appName);
  const appDescription = cleanSingleLine(input.appDescription ?? "");
  const schoolName = cleanSingleLine(input.schoolName ?? "");
  const participantInfo = cleanMultiline(input.participantInfo ?? "");
  const colorPalette = typeof input.colorPalette === "string" ? input.colorPalette.trim() : "";
  const revision = typeof input.revision === "string" ? input.revision.trim() : "";
  const hasAppMode = input.appMode !== undefined && input.appMode !== null && input.appMode !== "";
  const appMode = hasAppMode ? (typeof input.appMode === "string" ? input.appMode.trim() : "") : "production";
  const hasTimelineDays = input.timelineDefaultDays !== undefined && input.timelineDefaultDays !== null && input.timelineDefaultDays !== "";
  const timelineDefaultDays = hasTimelineDays ? parseTimelineDefaultDays(input.timelineDefaultDays) : 7;

  if (appName === null || Array.from(appName).length < 1 || Array.from(appName).length > 60 || CTRL_ANY.test(appName)) {
    return { ok: false, error: "Nama aplikasi wajib 1–60 karakter tanpa karakter kontrol." };
  }
  if (appDescription === null || Array.from(appDescription).length > 160 || CTRL_ANY.test(appDescription)) {
    return { ok: false, error: "Keterangan aplikasi maksimal 160 karakter tanpa karakter kontrol." };
  }
  if (schoolName === null || Array.from(schoolName).length > 120 || CTRL_ANY.test(schoolName)) {
    return { ok: false, error: "Nama sekolah maksimal 120 karakter tanpa karakter kontrol." };
  }
  if (participantInfo === null || Array.from(participantInfo).length > 2000 || CTRL_MULTILINE.test(participantInfo)) {
    return { ok: false, error: "Informasi untuk peserta maksimal 2.000 karakter tanpa karakter kontrol." };
  }
  if (!isValidPalette(colorPalette)) {
    return { ok: false, error: "Pilih salah satu palet warna yang tersedia." };
  }
  if (!isValidAppMode(appMode)) {
    return { ok: false, error: "Mode aplikasi harus dev atau production." };
  }
  if (timelineDefaultDays === null) {
    return { ok: false, error: "Rentang bawaan timeline harus 1 sampai 7 hari." };
  }
  if (!/^[1-9]\d{0,18}$/.test(revision)) {
    return { ok: false, error: "Versi pengaturan tidak valid. Muat ulang halaman." };
  }

  return {
    ok: true,
    value: {
      appName,
      appDescription,
      schoolName,
      participantInfo,
      colorPalette,
      appMode,
      timelineDefaultDays,
      revision,
      appModeProvided: hasAppMode,
      timelineDaysProvided: hasTimelineDays,
    },
  };
}
