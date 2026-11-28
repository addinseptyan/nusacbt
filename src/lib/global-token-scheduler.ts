import "server-only";

import type { PoolClient } from "pg";

import { EXAM_TOKEN_ADVISORY_LOCK } from "@/lib/exam-token-constants.mjs";
import { digestSixDigitToken, encryptSixDigitToken, generateSixDigitToken } from "@/lib/exam-token-crypto.mjs";
import { ExamTokenKeyProblem, lockTokenKeyBinding, readConfiguredTokenKey } from "@/lib/exam-token-key";
import type { GlobalTokenAutoRotateState } from "@/lib/exam-token-types";
import { getPostgresPool } from "@/lib/postgres";

export async function readGlobalAutoRotateWithClient(client: PoolClient): Promise<GlobalTokenAutoRotateState> {
  const result = await client.query<{ enabled: boolean; durationMinutes: number; updatedAt: Date }>(
    'SELECT enabled, duration_minutes AS "durationMinutes", updated_at AS "updatedAt" FROM global_token_auto_rotate WHERE id = 1',
  );
  const row = result.rows[0];
  if (!row) {
    return { enabled: false, durationMinutes: 15, updatedAt: null };
  }
  return {
    enabled: row.enabled,
    durationMinutes: row.durationMinutes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Caller dapat memegang transaksi aktif. Mengunci `EXAM_TOKEN_ADVISORY_LOCK`
 * agar tidak pernah bertabrakan dengan penerbitan atau pencabutan manual.
 */
export async function rotateGlobalTokenWithClient(
  client: PoolClient,
  options?: { key?: Buffer },
): Promise<boolean> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [EXAM_TOKEN_ADVISORY_LOCK]);

  const settingsRes = await client.query<{
    enabled: boolean;
    durationMinutes: number;
    updatedByAdminId: string | null;
  }>(
    'SELECT enabled, duration_minutes AS "durationMinutes", updated_by_admin_id::text AS "updatedByAdminId" FROM global_token_auto_rotate WHERE id = 1 FOR SHARE',
  );
  const settings = settingsRes.rows[0];
  if (!settings?.enabled) return false;

  const existingRes = await client.query<{ id: string; active: boolean }>(
    `SELECT id::text AS id, expires_at > clock_timestamp() AS active
     FROM exam_access_tokens
     WHERE scope = 'global' AND exam_test_id IS NULL AND revoked_at IS NULL
     FOR UPDATE`,
  );
  const existing = existingRes.rows[0] ?? null;
  if (existing?.active) return false;

  let key = options?.key;
  const ownsKey = !key;
  try {
    if (!key) key = await readConfiguredTokenKey();
    await lockTokenKeyBinding(client, key);

    if (existing) {
      await client.query(
        "UPDATE exam_access_tokens SET revoked_at = clock_timestamp(), revoked_reason = 'replaced' WHERE id = $1::bigint",
        [existing.id],
      );
    }

    let code = "";
    let hash: Buffer | undefined;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = generateSixDigitToken();
      const candidateHash = digestSixDigitToken(candidate, key);
      const collision = await client.query<{ present: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM exam_access_tokens WHERE token_hash = $1 AND (revoked_at IS NULL OR issued_at > clock_timestamp() - interval '7 days')) AS present",
        [candidateHash],
      );
      if (!collision.rows[0].present) {
        code = candidate;
        hash = candidateHash;
        break;
      }
    }
    if (!hash) return false;

    const allocated = await client.query<{ id: string }>(
      "SELECT nextval(pg_get_serial_sequence('exam_access_tokens', 'id'))::text AS id",
    );
    const id = allocated.rows[0].id;
    const encrypted = encryptSixDigitToken(code, key, { id, scope: "global" });

    await client.query(
      `WITH moment AS (SELECT clock_timestamp() AS issued)
       INSERT INTO exam_access_tokens(
         id, scope, exam_test_id, test_name_snapshot, token_hash, duration_minutes,
         issued_at, expires_at, created_by_admin_id, code_version, code_nonce, code_ciphertext, code_tag
       )
       OVERRIDING SYSTEM VALUE
       SELECT $1::bigint, 'global', NULL, NULL, $2, $3, issued, issued + $3::integer * interval '1 minute',
              $4::bigint, 2, $5, $6, $7
       FROM moment`,
      [id, hash, settings.durationMinutes, settings.updatedByAdminId, encrypted.nonce, encrypted.ciphertext, encrypted.tag],
    );
    return true;
  } finally {
    if (ownsKey && key) key.fill(0);
  }
}

export async function ensureGlobalTokenAutoRotated(): Promise<boolean> {
  const pool = getPostgresPool();
  const quick = await pool.query<{ enabled: boolean; hasActive: boolean }>(
    `SELECT g.enabled,
       EXISTS(
         SELECT 1 FROM exam_access_tokens k
         WHERE k.scope = 'global' AND k.exam_test_id IS NULL AND k.revoked_at IS NULL AND k.expires_at > clock_timestamp()
       ) AS "hasActive"
     FROM global_token_auto_rotate g
     WHERE g.id = 1`,
  );
  const status = quick.rows[0];
  if (!status?.enabled || status.hasActive) return false;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rotated = await rotateGlobalTokenWithClient(client);
    await client.query("COMMIT");
    return rotated;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof ExamTokenKeyProblem) return false;
    throw error;
  } finally {
    client.release();
  }
}
