import { getAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { parseMonitoringFilters } from "@/lib/monitoring-filter.mjs";
import { MonitoringPermissionDenied, MonitoringSessionExpired, MonitoringSizeExceeded, withMonitoringSnapshot } from "../monitoring-data";
import { monitoringWorkbook } from "../monitoring-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control":"private, no-store, max-age=0", "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; sandbox", "Cross-Origin-Resource-Policy":"same-origin", "Referrer-Policy":"no-referrer", "X-Robots-Tag":"noindex, nofollow, noarchive" };
function fail(status:number,message:string) { return new Response(message,{status,headers:{...headers,"Content-Type":"text/plain; charset=utf-8"}}); }
export async function GET(request:Request) {
  try {
    const session = await getAdminSession();
    if (!session) return fail(401,"Sesi admin diperlukan.");
    if (!adminHasPermission(session, "monitoring.view")) return fail(403, PERMISSION_DENIED_MESSAGE);
    const parsed = parseMonitoringFilters(new URL(request.url).searchParams); if (!parsed.ok) return fail(400,parsed.error);
    const workbook = await withMonitoringSnapshot(parsed.filters,1,1,true,(data) => monitoringWorkbook(data,parsed.filters));
    return new Response(new Uint8Array(workbook),{status:200,headers:{...headers,"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":'attachment; filename="monitoring-tes-nusacbt.xlsx"',"Content-Length":String(workbook.byteLength)}});
  } catch(error) {
    if (error instanceof MonitoringSessionExpired) return fail(401,"Sesi admin telah berakhir.");
    if (error instanceof MonitoringPermissionDenied) return fail(403, PERMISSION_DENIED_MESSAGE);
    if (error instanceof MonitoringSizeExceeded) return fail(413,error.message);
    return fail(503,"Monitoring belum dapat diekspor. Periksa PostgreSQL dan migrasi terbaru.");
  }
}
