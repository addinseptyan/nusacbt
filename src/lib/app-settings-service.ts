import "server-only";
import { cache } from "react";
import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { LOGO_MAX_BYTES, normalizeBrandingImage } from "@/lib/app-settings-image";
import type { AdminAppSettings, PublicAppSettings } from "@/lib/app-settings-types";
import {
  DEFAULT_APP_SETTINGS,
  isValidAppMode,
  isValidPalette,
  isValidTimeZone,
  parseAppTimeZone,
  validateAppSettingsInput,
  type AppModeId,
  type AppTimeZone,
} from "@/lib/app-settings-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

export const APP_TIME_ZONE_IANA: Record<AppTimeZone, string> = {
  WIB: "Asia/Jakarta",
  WITA: "Asia/Makassar",
  WIT: "Asia/Jayapura",
};

type SettingsRow = {
  appName: string;
  appDescription: string;
  schoolName: string;
  participantInfo: string;
  colorPalette: string;
  defaultTimeZone: string;
  appMode: string;
  hasLogo: boolean;
  revision: string;
  updatedAt: string;
  updatedByUsername: string | null;
};

function mapPublicSettings(
  row: Omit<SettingsRow, "appMode" | "updatedAt" | "updatedByUsername">,
): PublicAppSettings {
  return {
    appName: row.appName || DEFAULT_APP_SETTINGS.appName,
    appDescription: row.appDescription ?? DEFAULT_APP_SETTINGS.appDescription,
    schoolName: row.schoolName ?? "",
    participantInfo: row.participantInfo ?? "",
    colorPalette: isValidPalette(row.colorPalette) ? row.colorPalette : "emerald",
    defaultTimeZone: parseAppTimeZone(row.defaultTimeZone),
    hasLogo: Boolean(row.hasLogo),
    revision: row.revision || "1",
  };
}

export async function loadDefaultTimeZoneWithClient(client: PoolClient): Promise<AppTimeZone> {
  const result = await client.query<{ zone: string }>(
    `SELECT default_time_zone AS zone FROM app_settings WHERE id = 1`,
  );
  return parseAppTimeZone(result.rows[0]?.zone);
}

export const getDefaultTimeZoneSafe = cache(async (): Promise<AppTimeZone> => {
  try {
    const result = await getPostgresPool().query<{ zone: string }>(
      `SELECT default_time_zone AS zone FROM app_settings WHERE id = 1`,
    );
    return parseAppTimeZone(result.rows[0]?.zone);
  } catch {
    return "WIB";
  }
});

export const getPublicAppSettingsSafe = cache(async (): Promise<PublicAppSettings> => {
  try {
    const result = await getPostgresPool().query<
      Omit<SettingsRow, "appMode" | "updatedAt" | "updatedByUsername">
    >(
      `SELECT app_name AS "appName",
        app_description AS "appDescription",
        school_name AS "schoolName",
        participant_info AS "participantInfo",
        color_palette AS "colorPalette",
        default_time_zone AS "defaultTimeZone",
        logo_image IS NOT NULL AS "hasLogo",
        revision::text AS revision
       FROM app_settings WHERE id = 1`,
    );
    if (result.rowCount !== 1) return { ...DEFAULT_APP_SETTINGS };
    return mapPublicSettings(result.rows[0]);
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
});

export const getAdminAppModeSafe = cache(async (): Promise<AppModeId> => {
  try {
    const result = await getPostgresPool().query<{ appMode: string }>(
      `SELECT app_mode AS "appMode" FROM app_settings WHERE id = 1`,
    );
    const mode = result.rows[0]?.appMode;
    return isValidAppMode(mode) ? mode : "production";
  } catch {
    return "production";
  }
});

export async function loadAdminAppSettings(): Promise<AdminAppSettings> {
  const result = await getPostgresPool().query<SettingsRow>(
    `SELECT s.app_name AS "appName",
      s.app_description AS "appDescription",
      s.school_name AS "schoolName",
      s.participant_info AS "participantInfo",
      s.color_palette AS "colorPalette",
      s.default_time_zone AS "defaultTimeZone",
      s.app_mode AS "appMode",
      s.logo_image IS NOT NULL AS "hasLogo",
      s.revision::text AS revision,
      to_char(
        s.updated_at AT TIME ZONE CASE s.default_time_zone
          WHEN 'WITA' THEN 'Asia/Makassar'
          WHEN 'WIT' THEN 'Asia/Jayapura'
          ELSE 'Asia/Jakarta'
        END,
        'DD/MM/YYYY HH24:MI'
      ) || ' ' || s.default_time_zone AS "updatedAt",
      u.username AS "updatedByUsername"
     FROM app_settings s
     LEFT JOIN admin_users u ON u.id = s.updated_by
     WHERE s.id = 1`,
  );
  if (result.rowCount !== 1) throw new Error("Baris pengaturan aplikasi belum tersedia.");
  const row = result.rows[0];
  return {
    ...mapPublicSettings(row),
    appMode: isValidAppMode(row.appMode) ? row.appMode : "production",
    updatedAt: row.updatedAt,
    updatedByUsername: row.updatedByUsername,
  };
}

export async function loadBrandingImage(kind: "logo"): Promise<{ data: Buffer; mime: string; revision: string } | null> {
  if (kind !== "logo") return null;
  const result = await getPostgresPool().query<{ data: Buffer | null; mime: string | null; revision: string }>(
    `SELECT logo_image AS data, logo_image_mime AS mime, revision::text AS revision FROM app_settings WHERE id = 1`,
  );
  const row = result.rows[0];
  if (!row || !row.data || !row.mime) return null;
  return { data: row.data, mime: row.mime, revision: row.revision };
}

async function readLogoUpload(
  fileEntry: FormDataEntryValue | null,
  removeFlag: boolean,
): Promise<
  | { ok: true; mode: "keep" }
  | { ok: true; mode: "remove" }
  | { ok: true; mode: "replace"; data: Buffer; mime: "image/png" | "image/jpeg" }
  | { ok: false; error: string }
> {
  const isFile = fileEntry instanceof File && fileEntry.size > 0;
  if (removeFlag && !isFile) return { ok: true, mode: "remove" };
  if (!isFile) return { ok: true, mode: "keep" };
  if (fileEntry.size > LOGO_MAX_BYTES) {
    return { ok: false, error: "Logo sekolah maksimal 1 MiB." };
  }
  const bytes = Buffer.from(await fileEntry.arrayBuffer());
  const normalized = await normalizeBrandingImage(bytes, "logo");
  if (!normalized.ok) return normalized;
  return { ok: true, mode: "replace", data: normalized.data, mime: normalized.mime };
}

export type SaveAppSettingsResult =
  | { ok: true; settings: AdminAppSettings; message: string }
  | { ok: false; error: string; sessionExpired?: boolean };

export async function saveAppSettings(formData: FormData): Promise<SaveAppSettingsResult> {
  const validated = validateAppSettingsInput({
    appName: formData.get("appName"),
    appDescription: formData.get("appDescription"),
    schoolName: formData.get("schoolName"),
    participantInfo: formData.get("participantInfo"),
    colorPalette: formData.get("colorPalette"),
    appMode: formData.get("appMode"),
    defaultTimeZone: formData.get("defaultTimeZone"),
    revision: formData.get("revision"),
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  const logoResult = await readLogoUpload(formData.get("logoFile"), formData.get("removeLogo") === "1");
  if (!logoResult.ok) return { ok: false, error: logoResult.error };

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin telah berakhir. Silakan masuk kembali.", sessionExpired: true };
    }
    if (!adminHasPermission(admin, "app_settings.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }

    const currentRow = await client.query<{ appMode: string }>(
      `SELECT app_mode AS "appMode" FROM app_settings WHERE id = 1 AND revision = $1::bigint FOR UPDATE`,
      [validated.value.revision],
    );
    if (currentRow.rowCount !== 1) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "Pengaturan aplikasi telah diubah admin lain. Muat ulang halaman sebelum menyimpan lagi.",
      };
    }

    const currentMode = isValidAppMode(currentRow.rows[0].appMode) ? currentRow.rows[0].appMode : "production";
    if (
      validated.value.appModeProvided &&
      validated.value.appMode !== currentMode &&
      !admin.isSuperuser
    ) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "Hanya Superadmin yang dapat mengubah mode aplikasi antara Production dan Dev.",
      };
    }

    const params: unknown[] = [
      validated.value.appName,
      validated.value.appDescription,
      validated.value.schoolName,
      validated.value.participantInfo,
      validated.value.colorPalette,
      admin.id,
      validated.value.revision,
    ];
    const sets = [
      "app_name = $1",
      "app_description = $2",
      "school_name = $3",
      "participant_info = $4",
      "color_palette = $5",
      "updated_by = $6",
      "updated_at = now()",
      "revision = revision + 1",
    ];
    if (validated.value.appModeProvided && admin.isSuperuser) {
      params.push(validated.value.appMode);
      sets.push(`app_mode = $${params.length}`);
    }
    if (validated.value.defaultTimeZoneProvided && isValidTimeZone(validated.value.defaultTimeZone)) {
      params.push(validated.value.defaultTimeZone);
      sets.push(`default_time_zone = $${params.length}`);
    }
    if (logoResult.mode === "remove") {
      sets.push("logo_image = NULL", "logo_image_mime = NULL");
    } else if (logoResult.mode === "replace") {
      params.push(logoResult.data, logoResult.mime);
      sets.push(`logo_image = $${params.length - 1}`, `logo_image_mime = $${params.length}`);
    }

    const updated = await client.query(
      `UPDATE app_settings SET ${sets.join(", ")} WHERE id = 1 AND revision = $7::bigint RETURNING revision`,
      params,
    );
    if (updated.rowCount !== 1) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "Pengaturan aplikasi telah diubah admin lain. Muat ulang halaman sebelum menyimpan lagi.",
      };
    }

    if (!(await lockActiveAdminSession(client))) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin telah berakhir. Silakan masuk kembali.", sessionExpired: true };
    }

    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, error: "Pengaturan aplikasi gagal disimpan. Periksa database dan migrasi terbaru." };
  } finally {
    client.release();
  }

  revalidatePath("/", "layout");
  revalidatePath("/pengaturan/aplikasi");
  revalidatePath("/login");
  revalidatePath("/peserta/login");
  revalidatePath("/peserta");
  revalidatePath("/data-peserta/kartu");
  revalidatePath("/data-tes/daftar");
  revalidatePath("/data-tes/monitoring");
  revalidatePath("/data-tes/token");
  revalidatePath("/data-tes/token/riwayat");
  revalidatePath("/laporan/rekap");

  const fresh = await loadAdminAppSettings();
  return { ok: true, settings: fresh, message: "Pengaturan aplikasi berhasil disimpan." };
}
