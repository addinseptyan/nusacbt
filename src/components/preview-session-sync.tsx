"use client";

import { useInsertionEffect } from "react";

const ADMIN_STORAGE_KEY = "nusacbt_preview_admin_session";
const PARTICIPANT_STORAGE_KEY = "nusacbt_preview_participant_session";
const ADMIN_HEADER = "x-nusacbt-preview-admin";
const PARTICIPANT_HEADER = "x-nusacbt-preview-participant";

export type PreviewTokenAction = { type: "set"; token: string } | { type: "clear" };

let fetchPatched = false;
let storageHydrated = false;
let memoryAdminToken: string | null = null;
let memoryParticipantToken: string | null = null;

function readStorage(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Abaikan jika sessionStorage dibatasi iframe; token memori tetap aktif.
  }
}

function removeStorage(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Abaikan jika sessionStorage dibatasi iframe.
  }
}

function ensureStorageHydrated() {
  if (storageHydrated || typeof window === "undefined") return;
  storageHydrated = true;
  if (!memoryAdminToken) memoryAdminToken = readStorage(ADMIN_STORAGE_KEY);
  if (!memoryParticipantToken) memoryParticipantToken = readStorage(PARTICIPANT_STORAGE_KEY);
}

function installPreviewFetchPatch() {
  if (typeof window === "undefined") return;
  ensureStorageHydrated();
  if (fetchPatched) return;
  fetchPatched = true;
  const originalFetch = window.fetch;

  window.fetch = function previewSessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let targetUrl: URL;
    try {
      const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      targetUrl = new URL(rawUrl, window.location.origin);
    } catch {
      return originalFetch.call(window, input, init);
    }

    if (targetUrl.origin !== window.location.origin) {
      return originalFetch.call(window, input, init);
    }

    const adminToken = memoryAdminToken ?? readStorage(ADMIN_STORAGE_KEY);
    const participantToken = memoryParticipantToken ?? readStorage(PARTICIPANT_STORAGE_KEY);
    const isParticipantPath =
      targetUrl.pathname === "/peserta" || targetUrl.pathname.startsWith("/peserta/");

    const needsAdmin = !isParticipantPath && Boolean(adminToken);
    const needsParticipant = isParticipantPath && Boolean(participantToken);
    if (!needsAdmin && !needsParticipant) {
      return originalFetch.call(window, input, init);
    }

    const mergedHeaders = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => mergedHeaders.set(key, value));
    }
    if (needsAdmin && adminToken && !mergedHeaders.has(ADMIN_HEADER)) {
      mergedHeaders.set(ADMIN_HEADER, adminToken);
    }
    if (needsParticipant && participantToken && !mergedHeaders.has(PARTICIPANT_HEADER)) {
      mergedHeaders.set(PARTICIPANT_HEADER, participantToken);
    }

    if (input instanceof Request) {
      const patchedRequest = new Request(input, init ? { ...init, headers: mergedHeaders } : { headers: mergedHeaders });
      return originalFetch.call(window, patchedRequest);
    }

    return originalFetch.call(window, input, { ...init, headers: mergedHeaders });
  };
}

if (typeof window !== "undefined") {
  installPreviewFetchPatch();
}

export function PreviewSessionSync({
  adminAction,
  participantAction,
}: {
  adminAction?: PreviewTokenAction;
  participantAction?: PreviewTokenAction;
}) {
  const adminType = adminAction?.type;
  const adminToken = adminAction?.type === "set" ? adminAction.token : "";
  const participantType = participantAction?.type;
  const participantToken = participantAction?.type === "set" ? participantAction.token : "";

  useInsertionEffect(() => {
    installPreviewFetchPatch();
    if (adminType === "set" && adminToken) {
      memoryAdminToken = adminToken;
      writeStorage(ADMIN_STORAGE_KEY, adminToken);
    } else if (adminType === "clear") {
      memoryAdminToken = null;
      removeStorage(ADMIN_STORAGE_KEY);
    }

    if (participantType === "set" && participantToken) {
      memoryParticipantToken = participantToken;
      writeStorage(PARTICIPANT_STORAGE_KEY, participantToken);
    } else if (participantType === "clear") {
      memoryParticipantToken = null;
      removeStorage(PARTICIPANT_STORAGE_KEY);
    }
  }, [adminType, adminToken, participantType, participantToken]);

  return null;
}
