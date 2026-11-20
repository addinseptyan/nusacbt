import { validDataId } from "@/lib/class-validation.mjs";
import { examQuestionPosition } from "@/lib/exam-attempt-validation.mjs";
import { loadExamAttemptImage } from "@/lib/exam-attempt-work";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };

export async function GET(_request: Request, { params }: { params: Promise<{ attemptId: string; position: string; slot: string }> }) {
  const raw = await params; const id = validDataId(raw.attemptId); const position = examQuestionPosition(raw.position);
  if (!id || !position || !/^(prompt|[ABCDE])$/.test(raw.slot)) return new Response(null, { status: 404, headers });
  try {
    const image = await loadExamAttemptImage(id, position, raw.slot);
    if (!image) return new Response(null, { status: 404, headers });
    return new Response(new Uint8Array(image.data), { headers: { ...headers, "Content-Type": image.mime, "Content-Disposition": "inline" } });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
