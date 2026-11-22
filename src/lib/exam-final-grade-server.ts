import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

/**
 * Urutan kunci bersama: tes (FOR SHARE, atau FOR UPDATE untuk metode),
 * pelaksanaan bila diperlukan, kemudian pasangan tes/identitas. Ambil sebelum
 * kunci attempt atau izin. Kunci per pasangan juga mencakup mulai pertama yang
 * belum mempunyai baris dan pelaksanaan lain dari tes induk yang sama.
 */
export async function lockFinalGradePair(client: PoolClient, testId: string, identityId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nusacbt:final-grade:' || $1::text || ':' || $2::text, 0))", [testId, identityId]);
}

export async function readFinalGradeState(client: PoolClient, testId: string, identityId: string) {
  const result = await client.query<{ revision: string; finalized: boolean }>(
    `SELECT revision::text AS revision,finalized_at IS NOT NULL AS finalized FROM exam_final_grade_state
     WHERE exam_test_id=$1::bigint AND participant_identity_id=$2::bigint`, [testId, identityId],
  );
  return result.rows[0] ?? { revision: "0", finalized: false };
}
export async function isFinalGradeClosed(client: PoolClient, testId: string, identityId: string) {
  return (await readFinalGradeState(client, testId, identityId)).finalized;
}

export type FinalEvidence = {
  id: string; kind: "regular" | "makeup" | "remedial"; correctCount: number; questionCount: number;
};

/** Sidik ini memagari konfirmasi admin dari daftar pengerjaan yang telah berubah. */
export function finalGradeEvidenceDigest(attempts: FinalEvidence[]) {
  const canonical = attempts.map((a) => [a.id, a.kind, a.correctCount, a.questionCount]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
