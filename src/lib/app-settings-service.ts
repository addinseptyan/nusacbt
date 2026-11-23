import "server-only";
import { cache } from "react";
import { revalidatePath } from "next/cache";

import { lockActiveAdminSession } from "@/lib/admin-auth";
import { LETTERHEAD_MAX_BYTES, LOGO_MAX_BYTES, normalizeBrandingImage } from "@/lib/app-settings-image";
import type { AdminAppSettings, PublicAppSettings } from "@/lib/app-settings-types";
import { DEFAULT_APP_SETTINGS, isValidPalette, validateAppSettingsInput } from "@/lib/app-settings-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

type SettingsRow = {
  appName: string;
  appDescription: string;
  schoolName: string;
  participantInfo: string;
  colorPalette: string;
  hasLogo: boolean;
  hasLetterhead: boolean;
  revision: string;
  updatedAt: string;
  updatedByUsername: string | null;
};

function mapPublicSettings(row: Omit<SettingsRow, "updatedAt" | "updatedByUsername">): PublicAppSettings {
  return {
    appName: row.appName || DEFAULT_APP_SETTINGS.appName,
    appDescription: row.appDescription ?? DEFAULT_APP_SETTINGS.appDescription,
    schoolName: row.schoolName ?? "",
    participantInfo: row.participantInfo ?? "",
    colorPalette: isValidPalette(row.colorPalette) ? row.colorPalette : "emerald",
    hasLogo: Boolean(row.hasLogo),
    hasLetterhead: Boolean(row.hasLetterhead),
    revision: row.revision || "1",
  };
}

export const getPublicAppSettingsSafe = cache(async (): Promise<PublicAppSettings> => {
  try {
    const result = await getPostgresPool().query<Omit<SettingsRow, "updatedAt" | "updatedByUsername">>(
      `SELECT app_name AS "appName",
        app_description AS "appDescription",
        school_name AS "schoolName",
        participant_info AS "participantInfo",
        color_palette AS "colorPalette",
        logo_image IS NOT NULL AS "hasLogo",
        letterhead_image IS NOT NULL AS "hasLetterhead",
        revision::text AS revision
       FROM app_settings WHERE id = 1`,
    );
    if (result.rowCount !== 1) return { ...DEFAULT_APP_SETTINGS };
    return mapPublicSettings(result.rows[0]);
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
});

export async function loadAdminAppSettings(): Promise<AdminAppSettings> {
  const result = await getPostgresPool().query<SettingsRow>(
    `SELECT s.app_name AS "appName",
      s.app_description AS "appDescription",
      s.school_name AS "schoolName",
      s.participant_info AS "participantInfo",
      s.color_palette AS "colorPalette",
      s.logo_image IS NOT NULL AS "hasLogo",
      s.letterhead_image IS NOT NULL AS "hasLetterhead",
      s.revision::text AS revision,
      to_char(s.updated_at AT TIME ZONE 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI') || ' WIB' AS "updatedAt",
      u.username AS "updatedByUsername"
     FROM app_settings s
     LEFT JOIN admin_users u ON u.id = s.updated_by
     WHERE s.id = 1`,
  );
  if (result.rowCount !== 1) throw new Error("Baris pengaturan aplikasi belum tersedia.");
  const row = result.rows[0];
  return {
    ...mapPublicSettings(row),
    updatedAt: row.updatedAt,
    updatedByUsername: row.updatedByUsername,
  };
}

export async function loadBrandingImage(kind: "logo" | "letterhead"): Promise<{ data: Buffer; mime: string; revision: string } | null> {
  const column = kind === "logo" ? "logo_image" : "letterhead_image";
  const mimeColumn = kind === "logo" ? "logo_image_mime" : "letterhead_image_mime";
  const result = await getPostgresPool().query<{ data: Buffer | null; mime: string | null; revision: string }>(
    `SELECT ${column} AS data, ${mimeColumn} AS mime, revision::text AS revision FROM app_settings WHERE id = 1`,
  );
  const row = result.rows[0];
  if (!row || !row.data || !row.mime) return null;
  return { data: row.data, mime: row.mime, revision: row.revision };
}

async function readImageUpload(
  fileEntry: FormDataEntryValue | null,
  removeFlag: boolean,
  kind: "logo" | "letterhead",
): Promise<
  | { ok: true; mode: "keep" }
  | { ok: true; mode: "remove" }
  | { ok: true; mode: "replace"; data: Buffer; mime: "image/png" | "image/jpeg" }
  | { ok: false; error: string }
> {
  const isFile = fileEntry instanceof File && fileEntry.size > 0;
  if (removeFlag && !isFile) return { ok: true, mode: "remove" };
  if (!isFile) return { ok: true, mode: "keep" };
  const maxBytes = kind === "logo" ? LOGO_MAX_BYTES : LETTERHEAD_MAX_BYTES;
  const label = kind === "logo" ? "Logo sekolah" : "Gambar kop surat";
  if (fileEntry.size > maxBytes) {
    return { ok: false, error: `${label} maksimal ${kind === "logo" ? "1 MiB" : "2 MiB"}.` };
  }
  const bytes = Buffer.from(await fileEntry.arrayBuffer());
  const normalized = await normalizeBrandingImage(bytes, kind);
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
    revision: formData.get("revision"),
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  const logoResult = await readImageUpload(formData.get("logoFile"), formData.get("removeLogo") === "1", "logo");
  if (!logoResult.ok) return { ok: false, error: logoResult.error };

  const letterheadResult = await readImageUpload(
    formData.get("letterheadFile"),
    formData.get("removeLetterhead") === "1",
    "letterhead",
  );
  if (!letterheadResult.ok) return { ok: false, error: letterheadResult.error };

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin telah berakhir. Silakan masuk kembali.", sessionExpired: true };
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
    if (logoResult.mode === "remove") {
      sets.push("logo_image = NULL", "logo_image_mime = NULL");
    } else if (logoResult.mode === "replace") {
      params.push(logoResult.data, logoResult.mime);
      sets.push(`logo_image = $${params.length - 1}`, `logo_image_mime = $${params.length}`);
    }
    if (letterheadResult.mode === "remove") {
      sets.push("letterhead_image = NULL", "letterhead_image_mime = NULL");
    } else if (letterheadResult.mode === "replace") {
      params.push(letterheadResult.data, letterheadResult.mime);
      sets.push(`letterhead_image = $${params.length - 1}`, `letterhead_image_mime = $${params.length}`);
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
    return { ok: false, error: "Pengaturan aplikasi gagal disimpan. Periksa database dan migrasi 025." };
  } finally {
    client.release();
  }

  revalidatePath("/", "layout");
  revalidatePath("/pengaturan/aplikasi");
  revalidatePath("/login");
  revalidatePath("/peserta/login");
  revalidatePath("/peserta");
  revalidatePath("/data-peserta/kartu");

  const fresh = await loadAdminAppSettings();
  return { ok: true, settings: fresh, message: "Pengaturan aplikasi berhasil disimpan." };
}
