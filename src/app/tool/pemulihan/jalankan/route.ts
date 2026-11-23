import { NextResponse } from "next/server";

import {
  clearAdminSessionCookie,
  getAdminSession,
  getCurrentAdminSessionTokenHash,
  PERMISSION_DENIED_MESSAGE,
} from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { MAX_BACKUP_UPLOAD_BYTES } from "@/lib/database-backup-archive.mjs";
import {
  DatabaseToolAuthError,
  DatabaseToolConflictError,
  DatabaseToolPermissionError,
  DatabaseToolValidationError,
  executeDatabaseRestore,
} from "@/lib/database-backup-service";
import { toolMultipartRequestIsSameOrigin } from "@/lib/export-origin.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MULTIPART_BYTES = MAX_BACKUP_UPLOAD_BYTES + 2 * 1024 * 1024;
const securityHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: securityHeaders });
}

export async function POST(request: Request) {
  try {
    if (!toolMultipartRequestIsSameOrigin(request.headers)) {
      return jsonError(403, "Permintaan harus berasal dari halaman aplikasi yang sama.");
    }
    const session = await getAdminSession();
    if (!session) {
      return jsonError(401, "Sesi admin diperlukan.");
    }
    if (!adminHasPermission(session, "tools.manage")) {
      return jsonError(403, PERMISSION_DENIED_MESSAGE);
    }

    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader) {
      const len = Number(contentLengthHeader);
      if (Number.isFinite(len) && len > MAX_MULTIPART_BYTES) {
        return jsonError(413, "Ukuran berkas unggahan melebihi batas maksimal 64 MiB.");
      }
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const expectedArchiveSha256 = String(formData.get("expectedArchiveSha256") ?? "");
    const confirmPhrase = String(formData.get("confirmPhrase") ?? "");

    if (!(file instanceof File)) {
      return jsonError(400, "Berkas cadangan (.zip) tidak ditemukan pada permintaan.");
    }
    if (file.size <= 0) {
      return jsonError(400, "Berkas cadangan kosong.");
    }
    if (file.size > MAX_BACKUP_UPLOAD_BYTES) {
      return jsonError(413, "Ukuran berkas cadangan melebihi batas maksimal 64 MiB.");
    }

    const tokenHash = await getCurrentAdminSessionTokenHash();
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await executeDatabaseRestore({
      buffer,
      rawFilename: file.name,
      expectedArchiveSha256,
      confirmPhrase,
      currentSessionTokenHash: tokenHash,
    });

    if (!result.sessionPreserved) {
      await clearAdminSessionCookie();
    }

    return NextResponse.json(result, { status: 200, headers: securityHeaders });
  } catch (error) {
    if (error instanceof DatabaseToolAuthError) {
      return jsonError(401, error.message);
    }
    if (error instanceof DatabaseToolPermissionError) {
      return jsonError(403, error.message);
    }
    if (error instanceof DatabaseToolValidationError) {
      return jsonError(400, error.message);
    }
    if (error instanceof DatabaseToolConflictError) {
      return jsonError(409, error.message);
    }
    return jsonError(503, "Pemulihan database gagal dijalankan. Database tetap dipertahankan seperti semula.");
  }
}
