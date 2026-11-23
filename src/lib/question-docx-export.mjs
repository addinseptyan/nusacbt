import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import sharp from "sharp";

import { MAX_DOCX_QUESTIONS, MAX_DOCX_TOTAL_IMAGE_BYTES } from "./question-docx.mjs";
import { mathmlToOmml } from "./question-math.mjs";
import { legacyToRich, sanitizeRichDocument } from "./question-rich.mjs";

const EMU_PER_PX = 9525;
const MAX_DRAWING_WIDTH_EMU = 3_960_000; // ~11 cm agar muat rapi di kolom Isi
const MAX_DRAWING_HEIGHT_EMU = 3_240_000;

export class QuestionDocxExportError extends Error {}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphXml(node) {
  const dir = node.attrs?.dir;
  const align = node.attrs?.textAlign;
  const jcMap = { left: "left", center: "center", right: "right" };
  const pPrParts = [];
  if (align && jcMap[align]) pPrParts.push(`<w:jc w:val="${jcMap[align]}"/>`);
  if (dir === "rtl") pPrParts.push("<w:bidi/>");
  const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";

  const inlineParts = [];
  for (const child of node.content || []) {
    if (child.type === "text") {
      const marks = new Set((child.marks || []).map((m) => m.type));
      const rPrParts = [];
      if (marks.has("bold")) rPrParts.push("<w:b/>");
      if (marks.has("italic")) rPrParts.push("<w:i/>");
      if (marks.has("underline")) rPrParts.push('<w:u w:val="single"/>');
      if (marks.has("subscript")) rPrParts.push('<w:vertAlign w:val="subscript"/>');
      else if (marks.has("superscript")) rPrParts.push('<w:vertAlign w:val="superscript"/>');
      const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";
      inlineParts.push(`<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(child.text || "")}</w:t></w:r>`);
    } else if (child.type === "hardBreak") {
      inlineParts.push("<w:r><w:br/></w:r>");
    } else if (child.type === "mathFormula") {
      inlineParts.push(mathmlToOmml(child.attrs.formula));
    }
  }
  return `<w:p>${pPr}${inlineParts.join("")}</w:p>`;
}

function listXml(listNode, depth = 0) {
  const ordered = listNode.type === "orderedList";
  let num = listNode.attrs?.start || 1;
  const indent = depth > 0 ? "  ".repeat(depth) : "";
  const blocks = [];

  for (const item of listNode.content || []) {
    const prefix = ordered ? `${indent}${num++}. ` : `${indent}• `;
    let firstPara = true;
    for (const child of item.content || []) {
      if (child.type === "paragraph") {
        if (firstPara) {
          firstPara = false;
          const prefixed = {
            ...child,
            content: [{ type: "text", text: prefix }, ...(child.content || [])],
          };
          blocks.push(paragraphXml(prefixed));
        } else {
          blocks.push(paragraphXml(child));
        }
      } else if (child.type === "bulletList" || child.type === "orderedList") {
        blocks.push(listXml(child, depth + 1));
      }
    }
  }
  return blocks.join("");
}

function innerTableXml(tableNode) {
  const rows = tableNode.content || [];
  // Hitung lebar kolom total agar gridCol dan continuation vMerge konsisten
  let colCount = 0;
  if (rows.length > 0) {
    for (const cell of rows[0].content || []) colCount += cell.attrs?.colspan || 1;
  }
  colCount = Math.max(1, colCount);
  const colWidth = Math.max(720, Math.floor(4800 / colCount));
  const gridCols = Array.from({ length: colCount }, () => `<w:gridCol w:w="${colWidth}"/>`).join("");

  /** @type {{untilRow:number, span:number}[]} */
  const occupied = [];
  const rowXmls = [];

  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].content || [];
    const cellXmls = [];
    let col = 0;
    let cellIdx = 0;

    while (col < colCount) {
      const active = occupied[col];
      if (active && active.untilRow > r) {
        const span = active.span;
        const spanXml = span > 1 ? `<w:gridSpan w:val="${span}"/>` : "";
        cellXmls.push(
          `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${colWidth * span}"/>${spanXml}<w:vMerge/></w:tcPr><w:p/></w:tc>`,
        );
        col += span;
        continue;
      }

      const cell = cells[cellIdx++];
      if (!cell) break;
      const span = cell.attrs?.colspan || 1;
      const rowspan = cell.attrs?.rowspan || 1;
      const spanXml = span > 1 ? `<w:gridSpan w:val="${span}"/>` : "";
      const vMergeXml = rowspan > 1 ? '<w:vMerge w:val="restart"/>' : "";
      if (rowspan > 1) {
        occupied[col] = { untilRow: r + rowspan, span };
        for (let k = col + 1; k < col + span; k++) occupied[k] = { untilRow: r + rowspan, span: 0 };
      }

      const innerBlocks = [];
      for (const block of cell.content || []) {
        if (block.type === "paragraph") innerBlocks.push(paragraphXml(block));
        else if (block.type === "bulletList" || block.type === "orderedList") innerBlocks.push(listXml(block));
      }
      if (!innerBlocks.length) innerBlocks.push("<w:p/>");

      cellXmls.push(
        `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${colWidth * span}"/>${spanXml}${vMergeXml}</w:tcPr>${innerBlocks.join("")}</w:tc>`,
      );
      col += span;
    }

    rowXmls.push(`<w:tr>${cellXmls.join("")}</w:tr>`);
  }

  return (
    '<w:tbl>' +
    '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:type="auto" w:w="0"/>' +
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/></w:tblBorders>' +
    "</w:tblPr>" +
    `<w:tblGrid>${gridCols}</w:tblGrid>${rowXmls.join("")}</w:tbl>`
  );
}

function richDocXml(rawRich, fallbackText) {
  let doc;
  try {
    doc = rawRich ? sanitizeRichDocument(rawRich) : legacyToRich(fallbackText || "");
  } catch {
    doc = legacyToRich(fallbackText || "");
  }
  const parts = [];
  for (const block of doc.content || []) {
    if (block.type === "paragraph") parts.push(paragraphXml(block));
    else if (block.type === "table") parts.push(innerTableXml(block));
    else if (block.type === "bulletList" || block.type === "orderedList") parts.push(listXml(block));
  }
  return parts.length ? parts.join("") : "<w:p/>";
}

async function measureImageEmu(bytes) {
  try {
    const meta = await sharp(bytes, { limitInputPixels: 8_000_000, animated: false }).metadata();
    const w = meta.width || 400;
    const h = meta.height || 260;
    let cx = w * EMU_PER_PX;
    let cy = h * EMU_PER_PX;
    const scale = Math.min(1, MAX_DRAWING_WIDTH_EMU / cx, MAX_DRAWING_HEIGHT_EMU / cy);
    cx = Math.max(9525, Math.round(cx * scale));
    cy = Math.max(9525, Math.round(cy * scale));
    return { cx, cy };
  } catch {
    return { cx: 2_286_000, cy: 1_524_000 };
  }
}

function drawingParagraphXml(rId, docPrId, name, cx, cy) {
  return (
    `<w:p><w:r><w:drawing><wp:inline xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

/**
 * Bangun dokumen Word (.docx) sesuai template NusaCBT (`No | Jenis | Isi | Jawaban`).
 * @param {Array<{
 *   topicName?: string,
 *   promptText: string,
 *   promptRich?: unknown,
 *   promptImage?: Buffer | null,
 *   promptImageMime?: string | null,
 *   options: Array<{ text: string, rich?: unknown, image?: Buffer | null, imageMime?: string | null }>,
 *   correctOption: 'A'|'B'|'C'|'D'|'E'
 * }>} questions
 * @param {{ title?: string, includeKeys?: boolean }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function buildQuestionDocx(questions, options = {}) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new QuestionDocxExportError("Pilih minimal satu soal untuk diekspor.");
  }
  if (questions.length > MAX_DOCX_QUESTIONS) {
    throw new QuestionDocxExportError(`Maksimal ${MAX_DOCX_QUESTIONS} soal per file Word. Pilih batch lebih kecil.`);
  }

  const includeKeys = options.includeKeys !== false;
  const heading = options.title?.trim() || "Daftar Soal Pilihan Ganda NusaCBT";

  /** @type {Map<string, { rId: string, filename: string, bytes: Buffer, ext: string, cx: number, cy: number }>} */
  const mediaByHash = new Map();
  let nextImageIndex = 1;
  let nextRelIndex = 3; // rId1 = styles, rId2 = settings
  let nextDocPrId = 1;
  let totalImageBytes = 0;

  async function registerImage(bytes, mime) {
    if (!bytes || !bytes.length) return null;
    totalImageBytes += bytes.length;
    if (totalImageBytes > MAX_DOCX_TOTAL_IMAGE_BYTES) {
      throw new QuestionDocxExportError("Total ukuran gambar soal melebihi 16 MiB per file Word. Pilih lebih sedikit soal per ekspor.");
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const existing = mediaByHash.get(hash);
    if (existing) return existing;
    const ext = mime === "image/jpeg" ? "jpeg" : "png";
    const filename = `media/image${nextImageIndex++}.${ext}`;
    const rId = `rId${nextRelIndex++}`;
    const { cx, cy } = await measureImageEmu(bytes);
    const entry = { rId, filename, bytes, ext, cx, cy };
    mediaByHash.set(hash, entry);
    return entry;
  }

  async function contentCellXml(rich, fallbackText, imageBytes, imageMime) {
    const bodyXml = richDocXml(rich, fallbackText);
    const img = await registerImage(imageBytes, imageMime);
    const imgXml = img ? drawingParagraphXml(img.rId, nextDocPrId++, img.filename.split("/")[1], img.cx, img.cy) : "";
    return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="5400"/></w:tcPr>${bodyXml}${imgXml}</w:tc>`;
  }

  const headerRow =
    "<w:tr>" +
    '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="900"/><w:shd w:val="clear" w:color="auto" w:fill="E9F5EF"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>No</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1350"/><w:shd w:val="clear" w:color="auto" w:fill="E9F5EF"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Jenis</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="5400"/><w:shd w:val="clear" w:color="auto" w:fill="E9F5EF"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Isi</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1350"/><w:shd w:val="clear" w:color="auto" w:fill="E9F5EF"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Jawaban</w:t></w:r></w:p></w:tc>' +
    "</w:tr>";

  const bodyRows = [headerRow];

  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    if (!q.options || q.options.length !== 5) {
      throw new QuestionDocxExportError(`Soal nomor ${idx + 1} tidak memiliki tepat lima pilihan.`);
    }
    const promptCell = await contentCellXml(q.promptRich, q.promptText, q.promptImage, q.promptImageMime);
    bodyRows.push(
      "<w:tr>" +
      `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="900"/><w:vMerge w:val="restart"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:t>${idx + 1}</w:t></w:r></w:p></w:tc>` +
      '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1350"/></w:tcPr><w:p><w:r><w:t>SOAL</w:t></w:r></w:p></w:tc>' +
      promptCell +
      '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1350"/></w:tcPr><w:p/></w:tc>' +
      "</w:tr>",
    );

    const letters = ["A", "B", "C", "D", "E"];
    for (let optIdx = 0; optIdx < 5; optIdx++) {
      const opt = q.options[optIdx];
      const optCell = await contentCellXml(opt.rich, opt.text, opt.image, opt.imageMime);
      const ansVal = includeKeys ? (q.correctOption === letters[optIdx] ? "1" : "0") : "";
      const ansXml = ansVal ? `<w:p><w:r><w:t>${ansVal}</w:t></w:r></w:p>` : "<w:p/>";
      bodyRows.push(
        "<w:tr>" +
        '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="900"/><w:vMerge/></w:tcPr><w:p/></w:tc>' +
        '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1350"/></w:tcPr><w:p><w:r><w:t>JAWABAN</w:t></w:r></w:p></w:tc>' +
        optCell +
        `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1350"/></w:tcPr>${ansXml}</w:tc>` +
        "</w:tr>",
      );
    }
  }

  const subtitle = includeKeys
    ? `Total ${questions.length} soal. Kolom Jawaban berisi 1 untuk jawaban benar dan 0 untuk jawaban salah (kompatibel dengan Import Soal Word NusaCBT).`
    : `Total ${questions.length} soal (kolom Jawaban dikosongkan sebagai naskah latihan).`;

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" +
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(heading)}</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>${escapeXml(subtitle)}</w:t></w:r></w:p>` +
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:type="dxa" w:w="9000"/>' +
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="7A9A8B"/><w:left w:val="single" w:sz="4" w:space="0" w:color="7A9A8B"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="7A9A8B"/><w:right w:val="single" w:sz="4" w:space="0" w:color="7A9A8B"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B7CCC0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B7CCC0"/></w:tblBorders>' +
    "</w:tblPr>" +
    '<w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="1350"/><w:gridCol w:w="5400"/><w:gridCol w:w="1350"/></w:tblGrid>' +
    `${bodyRows.join("")}</w:tbl>` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
    "</w:body></w:document>";

  const imageRels = Array.from(mediaByHash.values())
    .map(
      (item) =>
        `<Relationship Id="${item.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${item.filename}"/>`,
    )
    .join("");

  const documentRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    imageRels +
    "</Relationships>";

  const hasPng = Array.from(mediaByHash.values()).some((m) => m.ext === "png");
  const hasJpeg = Array.from(mediaByHash.values()).some((m) => m.ext === "jpeg");

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (hasPng ? '<Default Extension="png" ContentType="image/png"/>' : "") +
    (hasJpeg ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : "") +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>";

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    "</Relationships>";

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    "</w:styles>";

  const settingsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/></w:settings>';

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const coreXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(heading)}</dc:title>` +
    "<dc:creator>NusaCBT</dc:creator>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>` +
    "</cp:coreProperties>";

  const appXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    "<Application>NusaCBT</Application>" +
    "</Properties>";

  const enc = (str) => new TextEncoder().encode(str);
  /** @type {Record<string, Uint8Array>} */
  const files = {
    "[Content_Types].xml": enc(contentTypesXml),
    "_rels/.rels": enc(rootRelsXml),
    "docProps/core.xml": enc(coreXml),
    "docProps/app.xml": enc(appXml),
    "word/document.xml": enc(documentXml),
    "word/_rels/document.xml.rels": enc(documentRelsXml),
    "word/styles.xml": enc(stylesXml),
    "word/settings.xml": enc(settingsXml),
  };
  for (const media of mediaByHash.values()) {
    files[`word/${media.filename}`] = new Uint8Array(media.bytes);
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}
