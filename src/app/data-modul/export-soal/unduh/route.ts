import { getAdminSession, lockActiveAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { exportRequestIsSameOrigin } from "@/lib/export-origin.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { MAX_DOCX_QUESTIONS } from "@/lib/question-docx.mjs";
import { buildQuestionDocx, QuestionDocxExportError } from "@/lib/question-docx-export.mjs";
import type { QuestionLetter } from "@/lib/question-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;
const headers = {
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
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}

type ExportDbRow = {
  id: string;
  topicName: string;
  promptText: string;
  promptRich: unknown | null;
  promptImage: Buffer | null;
  promptImageMime: string | null;
  aText: string;
  aRich: unknown | null;
  aImage: Buffer | null;
  aImageMime: string | null;
  bText: string;
  bRich: unknown | null;
  bImage: Buffer | null;
  bImageMime: string | null;
  cText: string;
  cRich: unknown | null;
  cImage: Buffer | null;
  cImageMime: string | null;
  dText: string;
  dRich: unknown | null;
  dImage: Buffer | null;
  dImageMime: string | null;
  eText: string;
  eRich: unknown | null;
  eImage: Buffer | null;
  eImageMime: string | null;
  correctOption: QuestionLetter;
};

function safeFilename(rawTitle: string): string {
  const slug = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug ? `soal-${slug}.docx` : "ekspor-soal-nusacbt.docx";
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
    if (!adminHasPermission(session, "questions.export")) {
      return fail(403, PERMISSION_DENIED_MESSAGE);
    }

    const rawText = await request.text();
    if (!rawText || Buffer.byteLength(rawText, "utf8") > MAX_BODY_BYTES) {
      return fail(400, "Permintaan ekspor tidak valid atau terlalu besar.");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return fail(400, "Format permintaan ekspor tidak valid.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail(400, "Permintaan ekspor tidak valid.");
    }
    const payload = body as Record<string, unknown>;
    const rawIds = payload.questionIds;
    const includeKeys = payload.includeKeys !== false;
    const title = typeof payload.title === "string" ? payload.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";

    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_DOCX_QUESTIONS) {
      return fail(400, `Pilih 1 sampai ${MAX_DOCX_QUESTIONS} soal untuk diekspor.`);
    }
    const uniqueIds: string[] = [];
    const seen = new Set<string>();
    for (const item of rawIds) {
      if (typeof item !== "string" || !/^[1-9]\d{0,18}$/.test(item)) {
        return fail(400, "Daftar ID soal tidak valid.");
      }
      if (!seen.has(item)) {
        seen.add(item);
        uniqueIds.push(item);
      }
    }

    const client = await getPostgresPool().connect();
    let rows: ExportDbRow[];
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const active = await lockActiveAdminSession(client);
      if (!active) {
        await client.query("ROLLBACK");
        return fail(401, "Sesi admin diperlukan.");
      }
      if (!adminHasPermission(active, "questions.export")) {
        await client.query("ROLLBACK");
        return fail(403, PERMISSION_DENIED_MESSAGE);
      }
      const result = await client.query<ExportDbRow>(
        `SELECT q.id::text AS id,
          t.name AS "topicName",
          q.prompt_text AS "promptText", q.prompt_rich AS "promptRich", q.prompt_image AS "promptImage", q.prompt_image_mime AS "promptImageMime",
          q.option_a_text AS "aText", q.option_a_rich AS "aRich", q.option_a_image AS "aImage", q.option_a_image_mime AS "aImageMime",
          q.option_b_text AS "bText", q.option_b_rich AS "bRich", q.option_b_image AS "bImage", q.option_b_image_mime AS "bImageMime",
          q.option_c_text AS "cText", q.option_c_rich AS "cRich", q.option_c_image AS "cImage", q.option_c_image_mime AS "cImageMime",
          q.option_d_text AS "dText", q.option_d_rich AS "dRich", q.option_d_image AS "dImage", q.option_d_image_mime AS "dImageMime",
          q.option_e_text AS "eText", q.option_e_rich AS "eRich", q.option_e_image AS "eImage", q.option_e_image_mime AS "eImageMime",
          q.correct_option AS "correctOption"
         FROM question_bank q
         JOIN question_topics t ON t.id = q.topic_id
         WHERE q.id = ANY($1::bigint[])
         ORDER BY array_position($1::bigint[], q.id)`,
        [uniqueIds],
      );
      rows = result.rows;
      const stillActive = await lockActiveAdminSession(client);
      if (!stillActive || stillActive.id !== active.id) {
        await client.query("ROLLBACK");
        return fail(401, "Sesi admin diperlukan.");
      }
      if (!adminHasPermission(stillActive, "questions.export")) {
        await client.query("ROLLBACK");
        return fail(403, PERMISSION_DENIED_MESSAGE);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    if (rows.length !== uniqueIds.length) {
      return fail(409, "Sebagian soal yang dipilih telah dihapus atau berubah. Muat ulang halaman sebelum mengekspor.");
    }

    const docxBytes = await buildQuestionDocx(
      rows.map((r) => ({
        topicName: r.topicName,
        promptText: r.promptText,
        promptRich: r.promptRich,
        promptImage: r.promptImage,
        promptImageMime: r.promptImageMime,
        options: [
          { text: r.aText, rich: r.aRich, image: r.aImage, imageMime: r.aImageMime },
          { text: r.bText, rich: r.bRich, image: r.bImage, imageMime: r.bImageMime },
          { text: r.cText, rich: r.cRich, image: r.cImage, imageMime: r.cImageMime },
          { text: r.dText, rich: r.dRich, image: r.dImage, imageMime: r.dImageMime },
          { text: r.eText, rich: r.eRich, image: r.eImage, imageMime: r.eImageMime },
        ],
        correctOption: r.correctOption,
      })),
      { title: title || undefined, includeKeys },
    );

    const filename = safeFilename(title || rows[0]?.topicName || "");
    return new Response(new Uint8Array(docxBytes), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(docxBytes.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof QuestionDocxExportError) {
      return fail(413, error.message);
    }
    return fail(503, "Dokumen Word belum dapat dibuat. Periksa database dan coba lagi.");
  }
}
