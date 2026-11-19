import { timingSafeEqual } from "node:crypto";
import { CircleAlert, KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";

import { TokenManager } from "@/app/data-tes/token/token-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { lockActiveAdminSession, requireAdmin } from "@/lib/admin-auth";
import { decryptSixDigitToken, digestSixDigitToken } from "@/lib/exam-token-crypto.mjs";
import { ExamTokenKeyProblem, readConfiguredTokenKey, tokenKeyMessage, tokenKeyStatus } from "@/lib/exam-token-key";
import type { AccessTokenRecord, AccessTokenTestOption, TokenKeyStatus } from "@/lib/exam-token-types";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Token — NusaCBT" };
export const dynamic = "force-dynamic";
const HISTORY_SIZE = 20;
class SessionExpired extends Error {}
type TokenRow = Omit<AccessTokenRecord, "issuedAt" | "expiresAt" | "revokedAt" | "code" | "codeStatus"> & {
  issuedAt: Date; expiresAt: Date; revokedAt: Date | null; codeVersion: number; hash: Buffer; nonce: Buffer | null; ciphertext: Buffer | null; tag: Buffer | null;
};
type TestRow = Omit<AccessTokenTestOption, "startsAt" | "endsAt"> & { startsAt: Date; endsAt: Date };
const TOKEN_COLUMNS = `k.id::text AS id, k.xmin::text AS revision, k.scope, k.exam_test_id::text AS "testId",
  k.test_name_snapshot AS "testNameSnapshot", t.name AS "currentTestName", p.name AS "periodName",
  k.duration_minutes AS "durationMinutes", k.issued_at AS "issuedAt", k.expires_at AS "expiresAt",
  k.revoked_at AS "revokedAt", k.revoked_reason AS "revokedReason", a.username AS "createdBy", b.username AS "revokedBy",
  k.code_version AS "codeVersion", k.token_hash AS hash, k.code_nonce AS nonce, k.code_ciphertext AS ciphertext, k.code_tag AS tag`;
const TOKEN_JOINS = `FROM exam_access_tokens k LEFT JOIN exam_tests t ON t.id=k.exam_test_id
  LEFT JOIN exam_periods p ON p.id=t.period_id LEFT JOIN admin_users a ON a.id=k.created_by_admin_id
  LEFT JOIN admin_users b ON b.id=k.revoked_by_admin_id`;

export default async function TokenPage({ searchParams }: { searchParams: Promise<{ history?: string | string[] }> }) {
  await requireAdmin();
  const params = await searchParams;
  const rawPage = typeof params.history === "string" && /^[1-9]\d{0,6}$/.test(params.history) ? Number(params.history) : 1;
  let client: PoolClient | undefined; let key: Buffer | undefined;
  let tests: AccessTokenTestOption[] = []; let current: AccessTokenRecord[] = []; let history: AccessTokenRecord[] = [];
  let serverNow = ""; let keyStatus: TokenKeyStatus = "missing"; let historyPage = 1; let historyPages = 1; let historyTotal = 0;
  try {
    try { key = await readConfiguredTokenKey(); }
    catch (error) { keyStatus = error instanceof ExamTokenKeyProblem ? error.status : "invalid"; }
    client = await getPostgresPool().connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new SessionExpired();
    if (key) keyStatus = await tokenKeyStatus(client, key);
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const now = clock.rows[0].now;
    const testResult = await client.query<TestRow>(
      `SELECT t.id::text AS id,t.xmin::text AS revision,t.name,p.name AS "periodName",t.starts_at AS "startsAt",
         t.starts_at + t.duration_minutes * interval '1 minute' AS "endsAt",t.time_zone AS "timeZone"
       FROM exam_tests t JOIN exam_periods p ON p.id=t.period_id
       WHERE t.starts_at + t.duration_minutes * interval '1 minute' > $1::timestamptz
       ORDER BY t.starts_at,t.id`, [now],
    );
    const ids = testResult.rows.map((row) => row.id);
    const latest = await client.query<TokenRow>(
      `SELECT ${TOKEN_COLUMNS} ${TOKEN_JOINS}
       WHERE k.id IN (
         SELECT id FROM (SELECT DISTINCT ON (scope,exam_test_id) id FROM exam_access_tokens
           WHERE scope='global' OR (scope='test' AND exam_test_id=ANY($1::bigint[]))
           ORDER BY scope,exam_test_id,issued_at DESC,id DESC) newest
         UNION SELECT id FROM exam_access_tokens WHERE revoked_at IS NULL AND (scope='global' OR (scope='test' AND exam_test_id=ANY($1::bigint[])))
       ) ORDER BY k.issued_at DESC,k.id DESC`, [ids],
    );
    const count = await client.query<{ total: string }>("SELECT count(*)::text AS total FROM exam_access_tokens");
    historyTotal = Math.min(Number(count.rows[0].total), Number.MAX_SAFE_INTEGER);
    historyPages = Math.max(1, Math.ceil(historyTotal / HISTORY_SIZE)); historyPage = Math.min(rawPage, historyPages);
    const historyResult = await client.query<TokenRow>(
      `SELECT ${TOKEN_COLUMNS} ${TOKEN_JOINS} ORDER BY k.issued_at DESC,k.id DESC LIMIT $1 OFFSET $2`,
      [HISTORY_SIZE, (historyPage - 1) * HISTORY_SIZE],
    );
    function display(row: TokenRow): AccessTokenRecord {
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
        currentTestName: row.currentTestName, periodName: row.periodName, durationMinutes: row.durationMinutes,
        issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
        revokedReason: row.revokedReason, createdBy: row.createdBy, revokedBy: row.revokedBy, code, codeStatus };
    }
    tests = testResult.rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }));
    current = latest.rows.map(display); history = historyResult.rows.map(display); serverNow = now.toISOString();
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new SessionExpired();
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof SessionExpired) redirect("/login");
    return <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-2 text-[29px] font-bold tracking-tight">Token</h1><Alert variant="destructive" role="alert" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Data token belum dapat dimuat</AlertTitle><AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription></Alert></div>;
  } finally { key?.fill(0); client?.release(); }

  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9"><div className="mb-6 flex items-start gap-3"><span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"><KeyRound className="size-5" /></span><div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Token</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Kelola token global dan token khusus tes dari satu halaman.</p></div></div><TokenManager tests={tests} current={current} history={history} historyPage={historyPage} historyPages={historyPages} historyTotal={historyTotal} keyStatus={keyStatus} keyMessage={tokenKeyMessage(keyStatus)} serverNow={serverNow} /></div>;
}
