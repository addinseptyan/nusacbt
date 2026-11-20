import "server-only";

import { timingSafeEqual } from "node:crypto";
import { decryptSixDigitToken, digestSixDigitToken } from "@/lib/exam-token-crypto.mjs";
import type { AccessTokenRecord, TokenKeyStatus } from "@/lib/exam-token-types";

export type TokenRow = Omit<AccessTokenRecord, "issuedAt" | "expiresAt" | "revokedAt" | "testEndsAt" | "code" | "codeStatus"> & {
  issuedAt: Date; expiresAt: Date; revokedAt: Date | null; testEndsAt: Date | null; codeVersion: number; hash: Buffer; nonce: Buffer | null; ciphertext: Buffer | null; tag: Buffer | null;
};
export const TOKEN_COLUMNS = `k.id::text AS id, k.xmin::text AS revision, k.scope, k.exam_test_id::text AS "testId",
  k.test_name_snapshot AS "testNameSnapshot", t.name AS "currentTestName", p.name AS "periodName",
  COALESCE((SELECT max(r.starts_at + r.duration_minutes * interval '1 minute') FROM exam_schedule_runs r WHERE r.exam_test_id=t.id),
    t.starts_at + t.duration_minutes * interval '1 minute') AS "testEndsAt",
  k.duration_minutes AS "durationMinutes", k.issued_at AS "issuedAt", k.expires_at AS "expiresAt",
  k.revoked_at AS "revokedAt", k.revoked_reason AS "revokedReason", a.username AS "createdBy", b.username AS "revokedBy",
  k.code_version AS "codeVersion", k.token_hash AS hash, k.code_nonce AS nonce, k.code_ciphertext AS ciphertext, k.code_tag AS tag`;
export const TOKEN_JOINS = `FROM exam_access_tokens k LEFT JOIN exam_tests t ON t.id=k.exam_test_id
  LEFT JOIN exam_periods p ON p.id=t.period_id LEFT JOIN admin_users a ON a.id=k.created_by_admin_id
  LEFT JOIN admin_users b ON b.id=k.revoked_by_admin_id`;

export function displayToken(row: TokenRow, key: Buffer | undefined, keyStatus: TokenKeyStatus): AccessTokenRecord {
  let code: string | null = null;
  let codeStatus: AccessTokenRecord["codeStatus"] = row.codeVersion === 1 ? "legacy" : "key-unavailable";
  if (row.codeVersion === 2 && key && keyStatus === "ready" && row.nonce && row.ciphertext && row.tag) {
    try {
      const recovered = decryptSixDigitToken({ nonce: row.nonce, ciphertext: row.ciphertext, tag: row.tag }, key, { id: row.id, scope: row.scope });
      const expectedHash = digestSixDigitToken(recovered, key);
      if (!Buffer.isBuffer(row.hash) || row.hash.length !== expectedHash.length || !timingSafeEqual(row.hash, expectedHash)) throw new Error("Hash token tidak cocok.");
      code = recovered; codeStatus = "available";
    } catch { codeStatus = "corrupt"; }
  }
  return { id: row.id, revision: row.revision, scope: row.scope, testId: row.testId, testNameSnapshot: row.testNameSnapshot,
    currentTestName: row.currentTestName, periodName: row.periodName, testEndsAt: row.testEndsAt?.toISOString() ?? null, durationMinutes: row.durationMinutes,
    issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedReason: row.revokedReason, createdBy: row.createdBy, revokedBy: row.revokedBy, code, codeStatus };
}
