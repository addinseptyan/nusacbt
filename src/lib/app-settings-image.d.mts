export const LOGO_MAX_BYTES: number;

export function normalizeBrandingImage(
  bytes: Buffer,
  kind?: "logo",
): Promise<{ ok: true; data: Buffer; mime: "image/png" | "image/jpeg" } | { ok: false; error: string }>;
