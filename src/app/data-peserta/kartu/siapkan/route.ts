import { getAdminSession } from "@/lib/admin-auth";
import { parseCardFilters } from "@/lib/participant-card-filter.mjs";
import { cardRequestIsSameOrigin } from "@/lib/participant-card-origin.mjs";
import { PasswordProblem, PasswordSessionExpired, passwordErrorMessage, prepareParticipantCards } from "@/lib/participant-password-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Vary": "Cookie",
};
function reply(status: number, body: object) { return Response.json(body, { status, headers }); }
class BodyTooLarge extends Error {}

async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new BodyTooLarge();
  if (!request.body) throw new Error("Body kosong.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); throw new BodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
}

export async function POST(request: Request) {
  try {
    if (!cardRequestIsSameOrigin(request.headers)) return reply(403, { ok: false, error: "Permintaan harus berasal dari halaman aplikasi yang sama." });
    if (!await getAdminSession()) return reply(401, { ok: false, error: "Sesi admin diperlukan." });
    let input: unknown;
    try { input = await readJson(request); }
    catch (error) { return reply(error instanceof BodyTooLarge ? 413 : 400, { ok: false, error: "Permintaan kartu tidak valid atau terlalu besar." }); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, { ok: false, error: "Permintaan kartu tidak valid." });
    const body = input as Record<string, unknown>;
    if (!Object.keys(body).every((key) => ["mode", "filters", "candidates", "includePassword"].includes(key)) ||
        (body.mode !== "prepare" && body.mode !== "verify") || typeof body.filters !== "string" || body.filters.length > 2048 ||
        !Array.isArray(body.candidates) || typeof body.includePassword !== "boolean" || (body.mode === "verify" && body.includePassword)) {
      return reply(400, { ok: false, error: "Permintaan kartu tidak valid." });
    }
    const params = new URLSearchParams(body.filters);
    if ([...params.keys()].some((key) => !["periode", "kelas", "tes", "kategori", "siswa"].includes(key))) {
      return reply(400, { ok: false, error: "Filter kartu tidak valid." });
    }
    const parsed = parseCardFilters(params);
    if (!parsed.ok || !parsed.filters.periodId) return reply(400, { ok: false, error: parsed.ok ? "Pilih periode." : parsed.error });
    const form = new FormData();
    form.set("periodId", parsed.filters.periodId);
    form.set("candidates", JSON.stringify(body.candidates));
    const result = await prepareParticipantCards(form, parsed.filters, body.includePassword);
    // Pemeriksaan ulang sebelum dialog cetak tidak mengirim ulang identitas
    // maupun sandi. Audit hanya dibuat saat pengungkapan berhasil disiapkan.
    return reply(200, body.mode === "verify" ? { ok: true } : { ok: true, result });
  } catch (error) {
    if (error instanceof PasswordSessionExpired) return reply(401, { ok: false, error: passwordErrorMessage(error) });
    if (error instanceof PasswordProblem) return reply(409, { ok: false, error: passwordErrorMessage(error) });
    return reply(503, { ok: false, error: "Kartu belum dapat disiapkan. Periksa koneksi dan sesi, lalu muat ulang daftar." });
  }
}
