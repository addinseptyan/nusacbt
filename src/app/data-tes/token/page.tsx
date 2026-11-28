import { CircleAlert, KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";

import { displayToken, TOKEN_COLUMNS, TOKEN_JOINS, type TokenRow } from "@/app/data-tes/token/token-data";
import type { Zone } from "@/app/data-tes/token/token-display";
import { TokenManager } from "@/app/data-tes/token/token-manager";
import { TOKEN_SCHEDULE_LATERAL } from "@/app/data-tes/token/token-schedule-sql";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { lockActiveAdminSession, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { loadDefaultTimeZoneWithClient } from "@/lib/app-settings-service";
import { parseTokenDateFilter, parseTokenZone, tokenDayBounds, tokenPageNumber } from "@/lib/exam-token-date.mjs";
import { ExamTokenKeyProblem, readConfiguredTokenKey, tokenKeyMessage, tokenKeyStatus } from "@/lib/exam-token-key";
import type { AccessTokenRecord, AccessTokenTestOption, GlobalTokenAutoRotateState, TokenKeyStatus } from "@/lib/exam-token-types";
import { ensureGlobalTokenAutoRotated, readGlobalAutoRotateWithClient } from "@/lib/global-token-scheduler";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Token" };
export const dynamic = "force-dynamic";
const TESTS_PER_PAGE = 20;
class SessionExpired extends Error {}
class TokenPermissionDenied extends Error {}
type TestRow = Omit<AccessTokenTestOption, "startsAt" | "endsAt"> & { startsAt: Date; endsAt: Date };
type QueryParams = { tanggal?: string | string[]; zona?: string | string[]; halaman?: string | string[] };

export default async function TokenPage({ searchParams }: { searchParams: Promise<QueryParams> }) {
  const { allowed } = await requireAdminAccess("tokens.manage");
  if (!allowed) return <AccessDenied section="Data tes" title="Token" />;
  const params = await searchParams;
  const hasExplicitZone = typeof params.zona === "string" && (params.zona === "WIB" || params.zona === "WITA" || params.zona === "WIT");
  let zone: Zone = hasExplicitZone ? parseTokenZone(params.zona) : "WIB";
  let defaultTimeZone: Zone = "WIB";
  const rawPage = tokenPageNumber(params.halaman);
  let client: PoolClient | undefined; let key: Buffer | undefined;
  let tests: AccessTokenTestOption[] = []; let current: AccessTokenRecord[] = [];
  let autoRotate: GlobalTokenAutoRotateState = { enabled: false, durationMinutes: 15, updatedAt: null };
  let serverNow = ""; let keyStatus: TokenKeyStatus = "missing"; let page = 1; let pages = 1; let total = 0;
  let filter: { mode: "today" | "date" | "all"; date: string | null } = { mode: "all", date: null };
  try {
    try { key = await readConfiguredTokenKey(); }
    catch (error) { keyStatus = error instanceof ExamTokenKeyProblem ? error.status : "invalid"; }
    await ensureGlobalTokenAutoRotated().catch(() => false);
    client = await getPostgresPool().connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new SessionExpired();
    if (!adminHasPermission(admin, "tokens.manage")) throw new TokenPermissionDenied();
    defaultTimeZone = await loadDefaultTimeZoneWithClient(client);
    if (!hasExplicitZone) zone = defaultTimeZone;
    if (key) keyStatus = await tokenKeyStatus(client, key);
    autoRotate = await readGlobalAutoRotateWithClient(client);
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const now = clock.rows[0].now; filter = parseTokenDateFilter(params.tanggal, now, zone);
    const bounds = filter.date ? tokenDayBounds(filter.date, zone) : null;
    const args = [now, bounds?.start ?? null, bounds?.end ?? null];
    const count = await client.query<{ total: string }>(`SELECT count(*)::text AS total FROM exam_tests t ${TOKEN_SCHEDULE_LATERAL}`, args);
    total = Math.min(Number(count.rows[0].total), Number.MAX_SAFE_INTEGER);
    pages = Math.max(1, Math.ceil(total / TESTS_PER_PAGE)); page = Math.min(rawPage, pages);
    const testResult = await client.query<TestRow>(
      `SELECT t.id::text AS id,t.xmin::text AS revision,t.name,COALESCE(t.tags,ARRAY[]::text[]) AS tags,p.name AS "periodName",sched.starts_at AS "startsAt",
         sched.ends_at AS "endsAt",sched.time_zone AS "timeZone",sched.label AS "scheduleLabel",sched.kind AS "scheduleKind",sched.published AS "schedulePublished"
       FROM exam_tests t JOIN exam_periods p ON p.id=t.period_id ${TOKEN_SCHEDULE_LATERAL}
       ORDER BY (sched.starts_at <= $1::timestamptz) DESC,sched.starts_at,t.id LIMIT $4 OFFSET $5`,
      [...args, TESTS_PER_PAGE, (page - 1) * TESTS_PER_PAGE],
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
    tests = testResult.rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }));
    current = latest.rows.map((row) => displayToken(row, key, keyStatus)); serverNow = now.toISOString();
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new SessionExpired();
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof SessionExpired) redirect("/login");
    if (error instanceof TokenPermissionDenied) return <AccessDenied section="Data tes" title="Token" />;
    return <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-2 text-[29px] font-bold tracking-tight">Token</h1><Alert variant="destructive" role="alert" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Data token belum dapat dimuat</AlertTitle><AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan dengan <code>npm run db:migrate</code>.</AlertDescription></Alert></div>;
  } finally { key?.fill(0); client?.release(); }

  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9"><div className="mb-6 flex items-start gap-3"><span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"><KeyRound className="size-5" /></span><div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Token</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Kelola token global dan token khusus tes dari satu halaman.</p></div></div><TokenManager tests={tests} current={current} autoRotate={autoRotate} filter={filter} zone={zone} defaultTimeZone={defaultTimeZone} page={page} pages={pages} total={total} keyStatus={keyStatus} keyMessage={tokenKeyMessage(keyStatus)} serverNow={serverNow} /></div>;
}
