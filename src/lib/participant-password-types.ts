import type { IdentityPeriod } from "@/lib/participant-identity-types";

export type PasswordRow = {
  identityId: string;
  studentId: string;
  studentName: string;
  nisn: string;
  studentVersion: string;
  placementId: string | null;
  classId: string | null;
  classLabel: string | null;
  participantNumber: string;
  username: string;
  identityVersion: string;
  passwordVersion: string | null;
};

export type PasswordCandidate = { identityId: string; studentId: string; token: string };
export type PasswordDisplayRow = PasswordRow & { candidate: PasswordCandidate };
export type PasswordAudit = {
  id: string;
  studentName: string;
  nisn: string;
  adminUsername: string;
  event: "create_manual" | "create_auto" | "reset_manual" | "reset_auto" | "reveal";
  occurredAt: string;
};
export type PasswordKeyStatus = "ready" | "missing" | "invalid" | "mismatch" | "inconsistent";
export type PasswordPageData = {
  periods: IdentityPeriod[];
  selected: IdentityPeriod | null;
  rows: PasswordDisplayRow[];
  batch: { candidates: PasswordCandidate[]; totalMissing: number } | null;
  audit: PasswordAudit[];
  keyStatus: PasswordKeyStatus;
  selectionMissing: boolean;
};
export type PasswordActionResult = { ok: true; message: string } | { ok: false; error: string };
export type PasswordRevealResult = { ok: true; password: string } | { ok: false; error: string };
