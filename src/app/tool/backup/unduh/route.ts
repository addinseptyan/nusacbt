import { getAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import {
  createDatabaseBackupArchive,
  DatabaseToolAuthError,
  DatabaseToolPermissionError,
  DatabaseToolValidationError,
} from "@/lib/database-backup-service";
import { exportRequestIsSameOrigin } from "@/lib/export-origin.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const securityHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function fail(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  try {
    if (!exportRequestIsSameOrigin(request.headers)) {
      return fail(403, "Permintaan harus berasal dari halaman aplikasi yang sama.");
    }
    const session = await getAdminSession();
    if (!session) {
      return fail(401, "Sesi admin diperlukan.");
    }
    if (!adminHasPermission(session, "tools.manage")) {
      return fail(403, PERMISSION_DENIED_MESSAGE);
    }

    const bodyText = await request.text();
    if (bodyText.length > 256) {
      return fail(400, "Permintaan cadangan tidak valid.");
    }

    const result = await createDatabaseBackupArchive();
    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        ...securityHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Length": String(result.byteSize),
        "X-NusaCBT-Archive-Sha256": result.archiveSha256,
      },
    });
  } catch (error) {
    if (error instanceof DatabaseToolAuthError) {
      return fail(401, error.message);
    }
    if (error instanceof DatabaseToolPermissionError) {
      return fail(403, error.message);
    }
    if (error instanceof DatabaseToolValidationError) {
      return fail(413, error.message);
    }
    return fail(503, "Cadangan database belum dapat dibuat. Periksa koneksi PostgreSQL dan coba lagi.");
  }
}
