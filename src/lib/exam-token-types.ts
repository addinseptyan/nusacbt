export type AccessTokenScope = "global" | "test";
export type TokenKeyStatus = "ready" | "missing" | "invalid" | "same" | "mismatch" | "inconsistent";
export type AccessTokenTestOption = { id: string; revision: string; name: string; periodName: string; startsAt: string; endsAt: string; timeZone: string };
export type AccessTokenRecord = {
  id: string; revision: string; scope: AccessTokenScope; testId: string | null;
  testNameSnapshot: string | null; currentTestName: string | null; periodName: string | null; testEndsAt: string | null;
  durationMinutes: number; issuedAt: string; expiresAt: string;
  revokedAt: string | null; revokedReason: "manual" | "replaced" | null;
  createdBy: string | null; revokedBy: string | null;
  code: string | null; codeStatus: "available" | "legacy" | "key-unavailable" | "corrupt";
};
export type TokenIssued = { code: string; issuedAt: string; expiresAt: string; scope: AccessTokenScope; testName: string | null };
export type IssueTokenResult = ({ ok: true } & TokenIssued) | { ok: false; error: string; reload?: boolean; uncertain?: boolean };
export type ResolveTokenIssueResult = { ok: true; outcome: "issued" | "cancelled"; tokenId: string | null } | { ok: false; error: string };
export type RevokeTokenResult = { ok: true; message: string } | { ok: false; error: string; reload?: boolean };
