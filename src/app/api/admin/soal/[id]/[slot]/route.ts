import type { PoolClient } from "pg";

import { getAdminSession, lockActiveAdminSession } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import type { QuestionImageSlot } from "@/lib/question-types";
import { validTopicRevision } from "@/lib/topic-validation.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const slots: Record<QuestionImageSlot, string> = {
  prompt: "prompt", A: "option_a", B: "option_b", C: "option_c", D: "option_d", E: "option_e",
};
const securityHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string; slot: string }> }) {
  let client: PoolClient | undefined;
  try {
    // Cepat menolak permintaan anonim. Pemeriksaan kedua di dalam transaksi
    // menahan pencabutan sesi dan memeriksa masa berlakunya sebelum gambar dikirim.
    if (!await getAdminSession()) return new Response(null, { status: 401, headers: securityHeaders });
    const { id: rawId, slot } = await params;
    const id = validDataId(rawId);
    const versions = new URL(request.url).searchParams.getAll("versi");
    const revision = versions.length === 1 ? validTopicRevision(versions[0]) : null;
    if (!id || !revision || !Object.hasOwn(slots, slot)) return new Response(null, { status: 404, headers: securityHeaders });

    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) {
      await client.query("ROLLBACK");
      return new Response(null, { status: 401, headers: securityHeaders });
    }
    // Nama kolom hanya berasal dari whitelist, bukan masukan URL. Memeriksa
    // revisi mencegah gambar baru dipasangkan dengan teks soal yang sudah usang.
    const prefix = slots[slot as QuestionImageSlot];
    const result = await client.query<{ data: Buffer | null; mime: string | null }>(
      `SELECT ${prefix}_image AS data, ${prefix}_image_mime AS mime FROM question_bank WHERE id=$1::bigint AND xmin::text=$2`, [id, revision],
    );
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) {
      await client.query("ROLLBACK");
      return new Response(null, { status: 401, headers: securityHeaders });
    }
    await client.query("COMMIT");
    const image = result.rows[0];
    if (!image?.data || (image.mime !== "image/png" && image.mime !== "image/jpeg")) {
      return new Response(null, { status: 404, headers: securityHeaders });
    }
    return new Response(new Uint8Array(image.data), {
      status: 200,
      headers: {
        ...securityHeaders,
        "Content-Type": image.mime,
        "Content-Length": String(image.data.length),
        "Content-Disposition": `inline; filename="gambar-soal.${image.mime === "image/png" ? "png" : "jpg"}"`,
      },
    });
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return new Response(null, { status: 503, headers: securityHeaders });
  } finally {
    client?.release();
  }
}
