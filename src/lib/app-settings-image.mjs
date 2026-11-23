import sharp from "sharp";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LETTERHEAD_MAX_BYTES = 2 * 1024 * 1024;

function isAnimatedPng(bytes) {
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL" || type === "fcTL" || type === "fdAT") return true;
    offset += length + 12;
    if (type === "IEND") break;
  }
  return false;
}

/**
 * Validasi dan proses ulang PNG/JPEG statis untuk logo atau kop surat.
 * @param {Buffer} bytes
 * @param {"logo" | "letterhead"} kind
 */
export async function normalizeBrandingImage(bytes, kind) {
  const maxBytes = kind === "logo" ? LOGO_MAX_BYTES : LETTERHEAD_MAX_BYTES;
  const maxWidth = kind === "logo" ? 2000 : 4000;
  const maxHeight = kind === "logo" ? 2000 : 2000;
  const label = kind === "logo" ? "Logo sekolah" : "Gambar kop surat";
  const maxLabel = kind === "logo" ? "1 MiB" : "2 MiB";

  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) {
    return { ok: false, error: `${label} harus berukuran 1 byte sampai ${maxLabel}.` };
  }
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) {
    return { ok: false, error: `${label} harus berupa PNG atau JPEG statis; SVG tidak didukung.` };
  }
  if (png && isAnimatedPng(bytes)) {
    return { ok: false, error: `${label} tidak boleh berupa PNG animasi.` };
  }

  try {
    const image = sharp(bytes, { limitInputPixels: 8_000_000, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if ((png && meta.format !== "png") || (jpeg && meta.format !== "jpeg") || (meta.pages ?? 1) !== 1) {
      return { ok: false, error: `${label} harus berupa PNG atau JPEG statis yang valid.` };
    }
    if (!meta.width || !meta.height || meta.width > maxWidth || meta.height > maxHeight || meta.width * meta.height > 8_000_000) {
      return { ok: false, error: `Dimensi ${label.toLowerCase()} maksimal ${maxWidth}×${maxHeight} piksel.` };
    }
    const data = png
      ? await image.rotate().png({ compressionLevel: 9 }).toBuffer()
      : await image.rotate().jpeg({ quality: 90 }).toBuffer();
    if (data.length === 0 || data.length > maxBytes) {
      return { ok: false, error: `${label} setelah pemrosesan melebihi ${maxLabel}. Perkecil atau kompres gambar.` };
    }
    return { ok: true, data, mime: png ? "image/png" : "image/jpeg" };
  } catch {
    return { ok: false, error: `${label} rusak, terlalu besar, atau tidak dapat diproses sebagai PNG/JPEG.` };
  }
}
