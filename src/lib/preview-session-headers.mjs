export const PREVIEW_ADMIN_HEADER = "x-nusacbt-preview-admin";
export const PREVIEW_PARTICIPANT_HEADER = "x-nusacbt-preview-participant";

const MAX_HEADER_TOKEN_LENGTH = 128;

/** @param {Record<string, string | undefined>} [env] */
export function isPreviewIframeAuthEnabled(env = process.env) {
  return env.NUSACBT_PREVIEW_IFRAME_AUTH === "true";
}

/**
 * Mengutamakan cookie HttpOnly standar. Fallback header hanya aktif bila mode
 * Live Preview iframe diaktifkan secara eksplisit melalui variabel lingkungan.
 *
 * @param {{
 *   cookieToken?: string | null;
 *   headerToken?: string | null;
 *   env?: Record<string, string | undefined>;
 * }} input
 * @returns {string | undefined}
 */
export function resolvePreviewSessionToken({ cookieToken, headerToken, env = process.env }) {
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }
  if (!isPreviewIframeAuthEnabled(env)) {
    return undefined;
  }
  if (typeof headerToken !== "string" || headerToken.length === 0 || headerToken.length > MAX_HEADER_TOKEN_LENGTH) {
    return undefined;
  }
  return headerToken;
}
