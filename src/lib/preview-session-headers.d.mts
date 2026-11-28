export declare const PREVIEW_ADMIN_HEADER: "x-nusacbt-preview-admin";
export declare const PREVIEW_PARTICIPANT_HEADER: "x-nusacbt-preview-participant";

export function isPreviewIframeAuthEnabled(env?: Record<string, string | undefined>): boolean;

export function resolvePreviewSessionToken(input: {
  cookieToken?: string | null;
  headerToken?: string | null;
  env?: Record<string, string | undefined>;
}): string | undefined;
