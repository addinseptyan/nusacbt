import { CircleAlert, KeyRound } from "lucide-react";
import type { PoolClient } from "pg";

import { TokenManager } from "@/app/data-tes/token/token-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdmin } from "@/lib/admin-auth";
import type { AccessTokenRecord, AccessTokenTestOption } from "@/lib/exam-token-types";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Token — NusaCBT" };
export const dynamic = "force-dynamic";

type TokenRow = Omit<AccessTokenRecord, "issuedAt" | "expiresAt" | "revokedAt"> & { issuedAt: Date; expiresAt: Date; revokedAt: Date | null };

export default async function TokenPage() {
  await requireAdmin();
  let client: PoolClient | undefined;
  let tests: AccessTokenTestOption[]; let tokens: AccessTokenRecord[]; let serverNow: string;
  try {
    client = await getPostgresPool().connect();
    // Opsi tes dan slot token harus mencerminkan snapshot database yang sama.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const testResult = await client.query<AccessTokenTestOption>(
      `SELECT t.id::text AS id, t.xmin::text AS revision, t.name, p.name AS "periodName"
       FROM exam_tests t JOIN exam_periods p ON p.id=t.period_id ORDER BY lower(t.name), t.name, t.id`,
    );
    const tokenResult = await client.query<TokenRow>(
      `SELECT k.id::text AS id, k.xmin::text AS revision, k.scope, k.exam_test_id::text AS "testId",
         k.test_name_snapshot AS "testNameSnapshot", t.name AS "currentTestName", p.name AS "periodName",
         k.duration_minutes AS "durationMinutes", k.issued_at AS "issuedAt", k.expires_at AS "expiresAt",
         k.revoked_at AS "revokedAt", k.revoked_reason AS "revokedReason", a.username AS "createdBy", b.username AS "revokedBy"
       FROM exam_access_tokens k
       LEFT JOIN exam_tests t ON t.id=k.exam_test_id LEFT JOIN exam_periods p ON p.id=t.period_id
       LEFT JOIN admin_users a ON a.id=k.created_by_admin_id LEFT JOIN admin_users b ON b.id=k.revoked_by_admin_id
       WHERE k.id IN (
         SELECT id FROM exam_access_tokens WHERE revoked_at IS NULL AND (scope='global' OR exam_test_id IS NOT NULL)
         UNION ALL
         SELECT id FROM (SELECT id FROM exam_access_tokens WHERE revoked_at IS NOT NULL OR (scope='test' AND exam_test_id IS NULL)
           ORDER BY issued_at DESC, id DESC LIMIT 100) recent
       ) ORDER BY k.issued_at DESC, k.id DESC`,
    );
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    await client.query("COMMIT");
    tests = testResult.rows;
    tokens = tokenResult.rows.map((row) => ({ ...row, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null }));
    serverNow = clock.rows[0].now.toISOString();
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-2 text-[29px] font-bold tracking-tight">Token</h1><Alert variant="destructive" role="alert" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Data token belum dapat dimuat</AlertTitle><AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription></Alert></div>;
  } finally { client?.release(); }

  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9"><div className="mb-6 flex items-start gap-3"><span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"><KeyRound className="size-5" /></span><div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Token</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Siapkan token global atau token khusus untuk satu tes.</p></div></div><TokenManager tests={tests} tokens={tokens} serverNow={serverNow} /></div>;
}
