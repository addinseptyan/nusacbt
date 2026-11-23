export const LOGO_MAX_BYTES: number;
export const LETTERHEAD_MAX_BYTES: number;

export function normalizeBrandingImage(
  bytes: Buffer,
  kind: "logo" | "letterhead",
): Promise<{ ok: true; data: Buffer; mime: "image/png" | "image/jpeg" } | { ok: false; error: string }>;
