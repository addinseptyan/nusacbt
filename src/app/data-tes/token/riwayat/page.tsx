import { CircleAlert, History } from "lucide-react";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";

import { displayToken, TOKEN_COLUMNS, TOKEN_JOINS, type TokenRow } from "@/app/data-tes/token/token-data";
import { TokenHistory } from "@/app/data-tes/token/token-history";
import type { DateFilter } from "@/app/data-tes/token/token-links";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { lockActiveAdminSession, requireAdminAccess } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { parseTokenDateFilter, parseTokenZone, tokenPageNumber } from "@/lib/exam-token-date.mjs";
import { ExamTokenKeyProblem, readConfiguredTokenKey, tokenKeyMessage, tokenKeyStatus } from "@/lib/exam-token-key";
import type { AccessTokenRecord, TokenKeyStatus } from "@/lib/exam-token-types";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Riwayat Token — NusaCBT" };
export const dynamic = "force-dynamic";
const HISTORY_SIZE = 20;
class SessionExpired extends Error {}
class TokenPermissionDenied extends Error {}

type QueryParams = { tanggal?: string | string[]; zona?: string | string[]; asal?: string | string[]; halaman?: string | string[] };

export default async function TokenHistoryPage({ searchParams }: { searchParams: Promise<QueryParams> }) {
  const { allowed } = await requireAdminAccess("tokens.manage");
  if (!allowed) return <AccessDenied section="Data tes · Token" title="Riwayat token" />;
  const params = await searchParams;
  const zone = parseTokenZone(params.zona); const fromPage = tokenPageNumber(params.asal); const rawPage = tokenPageNumber(params.halaman);
  let client: PoolClient | undefined; let key: Buffer | undefined;
  let history: AccessTokenRecord[] = []; let serverNow = ""; let keyStatus: TokenKeyStatus = "missing";
  let page = 1; let pages = 1; let total = 0;
  let filter: DateFilter = { mode: "today", date: null };
  try {
    try { key = await readConfiguredTokenKey(); }
    catch (error) { keyStatus = error instanceof ExamTokenKeyProblem ? error.status : "invalid"; }
    client = await getPostgresPool().connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new SessionExpired();
    if (!adminHasPermission(admin, "tokens.manage")) throw new TokenPermissionDenied();
    if (key) keyStatus = await tokenKeyStatus(client, key);
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    filter = parseTokenDateFilter(params.tanggal, clock.rows[0].now, zone);
    const count = await client.query<{ total: string }>("SELECT count(*)::text AS total FROM exam_access_tokens");
    total = Math.min(Number(count.rows[0].total), Number.MAX_SAFE_INTEGER);
    pages = Math.max(1, Math.ceil(total / HISTORY_SIZE)); page = Math.min(rawPage, pages);
    const result = await client.query<TokenRow>(
      `SELECT ${TOKEN_COLUMNS} ${TOKEN_JOINS} ORDER BY k.issued_at DESC,k.id DESC LIMIT $1 OFFSET $2`,
      [HISTORY_SIZE, (page - 1) * HISTORY_SIZE],
    );
    history = result.rows.map((row) => displayToken(row, key, keyStatus)); serverNow = clock.rows[0].now.toISOString();
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new SessionExpired();
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof SessionExpired) redirect("/login");
    if (error instanceof TokenPermissionDenied) return <AccessDenied section="Data tes · Token" title="Riwayat token" />;
    return <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9"><h1 className="text-[29px] font-bold tracking-tight">Riwayat token</h1><Alert variant="destructive" role="alert" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Riwayat belum dapat dimuat</AlertTitle><AlertDescription>Pastikan PostgreSQL berjalan dan migrasi terbaru telah dijalankan.</AlertDescription></Alert></div>;
  } finally { key?.fill(0); client?.release(); }

  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9"><div className="mb-6 flex items-start gap-3"><span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"><History className="size-5" /></span><div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes · Token</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Riwayat token</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Catatan pembuatan, penggantian, dan pencabutan token.</p></div></div><TokenHistory history={history} page={page} pages={pages} total={total} serverNow={serverNow} keyStatus={keyStatus} keyMessage={tokenKeyMessage(keyStatus)} zone={zone} filter={filter} fromPage={fromPage} /></div>;
}
