import "server-only";

import { cookies, headers } from "next/headers";

import { participantSessionDigest } from "@/lib/participant-login-validation.mjs";
import {
  isPreviewIframeAuthEnabled,
  PREVIEW_ADMIN_HEADER,
  PREVIEW_PARTICIPANT_HEADER,
  resolvePreviewSessionToken,
} from "@/lib/preview-session-headers.mjs";

const ADMIN_COOKIE_NAME = "nusacbt_admin_session";
const PARTICIPANT_COOKIE_NAME = "nusacbt_participant_session";
const ADMIN_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export { isPreviewIframeAuthEnabled };

export async function readAdminSessionToken(): Promise<string | undefined> {
  const cookieToken = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;
  if (!isPreviewIframeAuthEnabled()) return undefined;
  const headerToken = (await headers()).get(PREVIEW_ADMIN_HEADER);
  return resolvePreviewSessionToken({ cookieToken, headerToken });
}

export async function readParticipantSessionToken(): Promise<string | undefined> {
  const cookieToken = (await cookies()).get(PARTICIPANT_COOKIE_NAME)?.value;
  if (cookieToken) return cookieToken;
  if (!isPreviewIframeAuthEnabled()) return undefined;
  const headerToken = (await headers()).get(PREVIEW_PARTICIPANT_HEADER);
  return resolvePreviewSessionToken({ cookieToken, headerToken });
}

export async function getPreviewAdminTokenForClient(): Promise<string | null> {
  if (!isPreviewIframeAuthEnabled()) return null;
  const token = await readAdminSessionToken();
  return token && ADMIN_TOKEN_FORMAT.test(token) ? token : null;
}

export async function getPreviewParticipantTokenForClient(): Promise<string | null> {
  if (!isPreviewIframeAuthEnabled()) return null;
  const token = await readParticipantSessionToken();
  return token && participantSessionDigest(token) ? token : null;
}
