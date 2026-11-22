import { getAdminSession } from "@/lib/admin-auth";
import { parseReportFilters } from "@/lib/report-filter.mjs";
import { ReportSessionExpired, ReportSizeExceeded, withReportSnapshot } from "../report-data";
import { createReportXlsx } from "../report-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const securityHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
function fail(status: number, message: string) {
  return new Response(message, { status, headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(request: Request) {
  try {
    // Menolak anonim dengan cepat; sesi diperiksa dan dikunci lagi di dalam
    // transaksi snapshot, juga setelah file selesai dibuat sebelum dikirim.
    if (!await getAdminSession()) return fail(401, "Sesi admin diperlukan.");
    const parsed = parseReportFilters(new URL(request.url).searchParams);
    if (!parsed.ok) return fail(400, parsed.error);
    const workbook = await withReportSnapshot(parsed.filters, 1, true, (data) => createReportXlsx(data, parsed.filters));
    return new Response(new Uint8Array(workbook), { status: 200, headers: {
      ...securityHeaders,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="rekap-hasil-nusacbt.xlsx"',
      "Content-Length": String(workbook.byteLength),
    } });
  } catch (error) {
    if (error instanceof ReportSessionExpired) return fail(401, "Sesi admin telah berakhir.");
    if (error instanceof ReportSizeExceeded) return fail(413, error.message);
    return fail(503, "Laporan belum dapat dibuat. Periksa PostgreSQL dan migrasi sampai 023.");
  }
}
