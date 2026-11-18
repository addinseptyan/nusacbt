import sharp from "sharp";

export const QUESTION_IMAGE_MAX_BYTES = 1024 * 1024;
export const QUESTION_IMAGE_MAX_PIXELS = 8_000_000;
export const QUESTION_IMAGE_MAX_DIMENSION = 4000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Decoder tertentu hanya melihat frame pertama APNG dan tidak melaporkan pages.
// Tolak chunk animasi secara eksplisit agar gambar tidak diam-diam kehilangan frame.
/** @param {Buffer} bytes */
function isAnimatedPng(bytes) {
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false; // Decoder akan menolak file rusak.
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL" || type === "fcTL" || type === "fdAT") return true;
    offset += length + 12;
    if (type === "IEND") break;
  }
  return false;
}

/**
 * Periksa signature lalu decode dan encode ulang PNG/JPEG. File mentah, metadata,
 * nama file, SVG, dan format lain tidak disimpan. Batas pixel mencegah image bomb.
 * @param {Buffer} bytes
 * @returns {Promise<{ok: true, data: Buffer, mime: "image/png" | "image/jpeg"} | {ok: false, error: string}>}
 */
export async function normalizeQuestionImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > QUESTION_IMAGE_MAX_BYTES) {
    return { ok: false, error: "Gambar wajib berukuran 1 byte sampai 1 MiB." };
  }
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) return { ok: false, error: "Gambar harus berupa PNG atau JPEG yang valid; SVG tidak didukung." };
  if (png && isAnimatedPng(bytes)) return { ok: false, error: "Gambar animasi tidak didukung; gunakan PNG atau JPEG statis." };

  try {
    const image = sharp(bytes, { limitInputPixels: QUESTION_IMAGE_MAX_PIXELS, failOn: "warning", animated: false });
    const metadata = await image.metadata();
    if ((png && metadata.format !== "png") || (jpeg && metadata.format !== "jpeg") || (metadata.pages ?? 1) !== 1) {
      return { ok: false, error: "Gambar harus berupa PNG atau JPEG statis yang valid." };
    }
    const { width, height } = metadata;
    if (!width || !height || width > QUESTION_IMAGE_MAX_DIMENSION || height > QUESTION_IMAGE_MAX_DIMENSION || width * height > QUESTION_IMAGE_MAX_PIXELS) {
      return { ok: false, error: "Dimensi gambar maksimal 4000 piksel per sisi dan 8 megapiksel." };
    }
    // rotate() menerapkan orientasi EXIF; encode ulang tanpa withMetadata membuang metadata.
    const data = png
      ? await image.rotate().png({ compressionLevel: 9 }).toBuffer()
      : await image.rotate().jpeg({ quality: 90 }).toBuffer();
    if (data.length === 0 || data.length > QUESTION_IMAGE_MAX_BYTES) {
      return { ok: false, error: "Gambar setelah pemrosesan melebihi 1 MiB. Perkecil atau kompres gambar." };
    }
    return { ok: true, data, mime: png ? "image/png" : "image/jpeg" };
  } catch {
    return { ok: false, error: "Gambar rusak, terlalu besar, atau tidak dapat diproses sebagai PNG/JPEG." };
  }
}
