import type { IdentityPageData } from "@/lib/participant-identity-types";
import type { PasswordPageData } from "@/lib/participant-password-types";

// Versi ini hanya untuk menolak dialog usang, bukan rahasia/autentikasi.
export type LoginLock = {
  identityId: string;
  studentId: string;
  username: string;
  identityRevision: string;
  studentRevision: string;
  periodRevision: string;
  lockedUntil: string;
};

export type AccountPageData = {
  identities: IdentityPageData;
  passwords: PasswordPageData;
  locks: LoginLock[];
};

export type UnlockActionResult = { ok: true; message: string } | { ok: false; error: string };
