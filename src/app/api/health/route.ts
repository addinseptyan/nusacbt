import { NextResponse } from "next/server";

import { getAppVersionInfo } from "@/lib/app-version.mjs";
import { getPostgresPool } from "@/lib/postgres";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const versionInfo = getAppVersionInfo();
  let database: "ready" | "error" = "error";
  try {
    await getPostgresPool().query("SELECT 1");
    database = "ready";
  } catch {
    database = "error";
  }

  const ok = database === "ready";
  return NextResponse.json(
    {
      ok,
      version: versionInfo.version,
      tag: versionInfo.tag,
      database,
      timestamp: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
