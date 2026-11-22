import { getAdminSession } from "@/lib/admin-auth";
import { parseMatrixFilters } from "@/lib/matrix-report-filter.mjs";
import { MatrixSessionExpired, MatrixSizeExceeded, withMatrixSnapshot } from "../matrix-data";
import { createMatrixWorkbook } from "../matrix-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox","Cross-Origin-Resource-Policy":"same-origin","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow, noarchive"};
function fail(status:number,message:string) { return new Response(message,{status,headers:{...headers,"Content-Type":"text/plain; charset=utf-8"}}); }
export async function GET(request:Request) {
  try {
    if (!await getAdminSession()) return fail(401,"Sesi admin diperlukan.");
    const parsed = parseMatrixFilters(new URL(request.url).searchParams); if(!parsed.ok) return fail(400,parsed.error);
    const workbook = await withMatrixSnapshot(parsed.filters,1,true,(data) => createMatrixWorkbook(data,parsed.filters));
    return new Response(new Uint8Array(workbook),{status:200,headers:{...headers,"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":'attachment; filename="rekap-hasil-nusacbt.xlsx"',"Content-Length":String(workbook.byteLength)}});
  } catch(error) {
    if(error instanceof MatrixSessionExpired) return fail(401,"Sesi admin telah berakhir.");
    if(error instanceof MatrixSizeExceeded) return fail(413,error.message);
    return fail(503,"Rekap belum dapat dibuat. Periksa PostgreSQL dan migrasi terbaru.");
  }
}
