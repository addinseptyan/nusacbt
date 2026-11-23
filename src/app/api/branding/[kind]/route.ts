import { loadBrandingImage } from "@/lib/app-settings-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const { kind } = await context.params;
  if (kind !== "logo" && kind !== "letterhead") {
    return new Response("Tidak ditemukan.", { status: 404 });
  }
  try {
    const image = await loadBrandingImage(kind);
    if (!image) {
      return new Response("Gambar belum diatur.", { status: 404 });
    }
    return new Response(new Uint8Array(image.data), {
      status: 200,
      headers: {
        "Content-Type": image.mime,
        "Content-Length": String(image.data.byteLength),
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    return new Response("Gambar tidak dapat dimuat.", { status: 503 });
  }
}
