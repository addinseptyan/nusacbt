import { posix } from "node:path";
import { crc32 } from "node:zlib";
import { fromBufferPromise } from "yauzl";

import { normalizeQuestionImage, QUESTION_IMAGE_MAX_BYTES } from "./question-image.mjs";
import { convertOmml, OMML_NS } from "./question-math.mjs";
import { richToPlain, sanitizeRichDocument } from "./question-rich.mjs";
import { validateQuestionContent, validateQuestionDraft } from "./question-validation.mjs";
import { parseQuestionXml, xmlAttr, xmlChild, xmlChildren, xmlText } from "./question-xml.mjs";

export const MAX_DOCX_BYTES = 6 * 1024 * 1024;
export const MAX_DOCX_QUESTIONS = 100;
// Count each placement, including repeated references to the same Word image:
// previews and database rows contain a separate copy for every placement.
export const MAX_DOCX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const V = "urn:schemas-microsoft-com:vml";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

export class QuestionDocxError extends Error {}
function fail(message) { throw new QuestionDocxError(message); }
function is(node, local, ns = W) { return node?.local === local && node?.uri === ns; }
function child(node, local, ns = W) { return xmlChild(node, local, ns); }
function children(node, local, ns = W) { return xmlChildren(node, local, ns); }
function val(node) { return node ? xmlAttr(node, "val", W) : undefined; }
function isOn(node) { const value = val(node); return Boolean(node) && !["false", "0", "off", "none"].includes(value || ""); }
function xmlFrom(bytes) {
  if (!bytes) fail("Struktur Word tidak lengkap. Gunakan template NusaCBT.");
  try { return parseQuestionXml(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("XML dokumen Word tidak valid atau terlalu kompleks."); }
}

/** ZIP is read in memory only, with size, CRC, duplicates and path checks. */
async function readArchive(input) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_DOCX_BYTES) fail("File Word harus lebih dari 0 dan maksimal 6 MiB.");
  let zip;
  try { zip = await fromBufferPromise(input, { strictFileNames: true, validateEntrySizes: true }); }
  catch { fail("File bukan .docx yang valid, rusak, atau dilindungi kata sandi."); }
  const contents = new Map();
  const names = new Set();
  let expanded = 0;
  try {
    if (zip.entryCount > MAX_ENTRIES) fail("Isi dokumen terlalu kompleks.");
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      const lowered = name.toLowerCase();
      if (!name || name.length > 250 || name.includes("\0") || name.includes("\\") || name.startsWith("/") || name.split("/").some((x) => x === ".." || x === ".") || names.has(lowered) || entry.isEncrypted() || !entry.canDecodeFileData()) fail("Isi dokumen memiliki nama, enkripsi, atau entri ganda yang tidak didukung.");
      names.add(lowered);
      if (/^word\/(?:vbaproject\.bin|embeddings\/|activex\/)/i.test(name)) fail("Dokumen dengan makro atau objek tertanam tidak didukung.");
      if (entry.uncompressedSize > MAX_ENTRY_BYTES || expanded + entry.uncompressedSize > MAX_EXPANDED_BYTES) fail("Isi dokumen terlalu besar setelah dibuka.");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > entry.uncompressedSize || size > MAX_ENTRY_BYTES || expanded + size > MAX_EXPANDED_BYTES) { stream.destroy(); fail("Isi dokumen terlalu besar setelah dibuka."); }
        chunks.push(bytes);
      }
      if (size !== entry.uncompressedSize) fail("Isi dokumen tidak lengkap atau rusak.");
      const data = Buffer.concat(chunks, size);
      if ((crc32(data) >>> 0) !== (entry.crc32 >>> 0)) fail("Isi dokumen tidak lengkap atau rusak.");
      expanded += size;
      contents.set(name, data);
    }
  } catch (error) {
    if (error instanceof QuestionDocxError) throw error;
    fail("File Word tidak dapat dibaca atau arsipnya rusak.");
  } finally { zip.close(); }
  return contents;
}

function imageRelationships(archive) {
  const result = new Map();
  const relBytes = archive.get("word/_rels/document.xml.rels");
  if (!relBytes) return result;
  const root = xmlFrom(relBytes);
  if (!is(root, "Relationships", PKG_REL)) fail("Relasi dokumen Word tidak valid.");
  for (const rel of children(root, "Relationship", PKG_REL)) {
    const id = xmlAttr(rel, "Id", "");
    const type = xmlAttr(rel, "Type", "") || "";
    const target = xmlAttr(rel, "Target", "");
    const mode = xmlAttr(rel, "TargetMode", "");
    if (!id || result.has(id)) fail("Relasi dokumen Word tidak valid atau ganda.");
    if (!type.endsWith("/image")) continue;
    if (mode && mode.toLowerCase() !== "internal") { result.set(id, null); continue; }
    if (!target || target.length > 200 || target.includes("\\") || /[:?#%\0]/.test(target) || target.split("/").some((x) => x === ".." || x === ".")) fail("Alamat gambar dalam Word tidak didukung.");
    const path = posix.normalize(target.startsWith("/") ? target.slice(1) : `word/${target}`);
    if (!path.startsWith("word/media/") || path.endsWith("/")) fail("Alamat gambar dalam Word tidak didukung.");
    result.set(id, path);
  }
  return result;
}

function descendants(node, predicate) {
  const result = [];
  const visit = (current) => {
    for (const item of current.children) {
      if (typeof item === "string") continue;
      if (predicate(item)) result.push(item);
      visit(item);
    }
  };
  visit(node);
  return result;
}
function simpleText(node) {
  return descendants(node, (part) => is(part, "t")).map(xmlText).join("").trim();
}
function hasAnyCellContent(node) {
  return descendants(node, (part) => (is(part, "t") && Boolean(xmlText(part).trim())) || is(part, "oMath", OMML_NS) || is(part, "oMathPara", OMML_NS) || is(part, "drawing") || is(part, "pict") || is(part, "object") || is(part, "tbl")).length > 0;
}
function cellSpan(cell) {
  const pr = child(cell, "tcPr");
  const raw = val(pr && child(pr, "gridSpan"));
  if (raw === undefined) return 1;
  if (!/^[1-9]\d?$/.test(raw) || Number(raw) > 12) fail("Penggabungan kolom tabel tidak didukung.");
  return Number(raw);
}
function mergeValue(cell) {
  const pr = child(cell, "tcPr");
  const merge = pr && child(pr, "vMerge");
  if (!merge) return null;
  const v = val(merge) || "continue";
  if (v !== "restart" && v !== "continue") fail("Penggabungan baris tabel tidak didukung.");
  return v;
}
function cellsOf(row) {
  const pr = child(row, "trPr");
  if (pr && ["gridBefore", "gridAfter"].some((kind) => Number(val(child(pr, kind)) || "0") !== 0)) fail("Susunan tabel Word tidak didukung.");
  // Do not filter out wrapped cells, tracked revisions, or unfamiliar row
  // objects: doing so could silently lose a question or part of a table.
  for (const item of row.children) {
    if (typeof item === "string") { if (item.trim()) fail("Susunan baris tabel Word tidak didukung."); continue; }
    if (item.uri !== W || !["trPr", "tblPrEx", "tc", "proofErr", "bookmarkStart", "bookmarkEnd"].includes(item.local)) fail("Baris tabel Word mengandung elemen yang belum didukung.");
  }
  return children(row, "tc");
}

function checkTableStructure(table) {
  for (const item of table.children) {
    if (typeof item === "string") { if (item.trim()) fail("Susunan tabel Word tidak didukung."); continue; }
    if (item.uri !== W || !["tblPr", "tblGrid", "tr", "proofErr", "bookmarkStart", "bookmarkEnd"].includes(item.local)) fail("Tabel Word mengandung baris atau elemen yang belum didukung.");
  }
}

// Metadata columns must be plain text, not hidden equations, pictures or
// nested tables that would otherwise be silently ignored by simpleText().
function metadataText(cell) {
  let text = "";
  const visit = (node) => {
    if (is(node, "t")) {
      if (node.children.some((item) => typeof item !== "string")) fail("Teks metadata Word tidak valid.");
      text += xmlText(node); return;
    }
    if (is(node, "tab") || is(node, "br") || is(node, "cr")) { text += " "; return; }
    if (node.uri === W && ["tcPr", "pPr", "rPr", "proofErr", "bookmarkStart", "bookmarkEnd", "commentRangeStart", "commentRangeEnd", "commentReference", "lastRenderedPageBreak", "noProof"].includes(node.local)) return;
    if (node.uri !== W || !["tc", "p", "r"].includes(node.local)) fail("Kolom No, Jenis, atau Jawaban hanya boleh berisi teks biasa.");
    for (const item of node.children) {
      if (typeof item === "string") { if (item.trim()) fail("Kolom No, Jenis, atau Jawaban tidak valid."); }
      else visit(item);
    }
  };
  visit(cell);
  return text.trim();
}
function paragraphAttrs(paragraph) {
  const pr = child(paragraph, "pPr");
  const alignValue = val(pr && child(pr, "jc"));
  const textAlign = alignValue === "center" ? "center" : ["right", "end"].includes(alignValue || "") ? "right" : ["left", "start"].includes(alignValue || "") ? "left" : null;
  const dir = pr && isOn(child(pr, "bidi")) ? "rtl" : "auto";
  if (pr && child(pr, "numPr")) fail("Daftar otomatis Word pada isi soal belum didukung. Ubah menjadi teks biasa atau buat daftar di editor.");
  return { dir, textAlign };
}
function marksOf(run) {
  const pr = child(run, "rPr");
  if (!pr) return [];
  const marks = [];
  if (isOn(child(pr, "b")) || isOn(child(pr, "bCs"))) marks.push({ type: "bold" });
  if (isOn(child(pr, "i")) || isOn(child(pr, "iCs"))) marks.push({ type: "italic" });
  if (isOn(child(pr, "u"))) marks.push({ type: "underline" });
  const vertical = val(child(pr, "vertAlign"));
  if (vertical === "subscript" || vertical === "superscript") marks.push({ type: vertical });
  return marks;
}

/** @typedef {{ref:string, inTable:boolean}[]} ImageRefs */
function drawingReference(node, images, inTable) {
  const drawing = descendants(node, (item) => is(item, "blip", A) || is(item, "imagedata", V));
  if (drawing.length !== 1) fail("Gambar Word tidak dapat dibaca; gunakan PNG/JPEG biasa.");
  if (xmlAttr(drawing[0], "link", R)) fail("Gambar tertaut dari luar dokumen tidak didukung.");
  const ref = xmlAttr(drawing[0], "embed", R) || xmlAttr(drawing[0], "id", R);
  if (!ref) fail("Gambar Word tidak memiliki relasi yang valid.");
  if (inTable) fail("Gambar di dalam tabel isi soal belum didukung. Letakkan gambar setelah tabel atau unggah manual.");
  images.push({ ref, inTable });
  if (images.length > 1) fail("Maksimal satu gambar per isi soal atau pilihan jawaban.");
}

function parseParagraph(paragraph, images, inTable) {
  const content = [];
  const addText = (text, marks) => {
    if (!text) return;
    if (!text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) fail("Teks Word mengandung karakter kontrol yang tidak didukung.");
    content.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
  };
  const parseInline = (node, marks = []) => {
    if (is(node, "r")) {
      const nextMarks = marksOf(node);
      for (const item of node.children) if (typeof item !== "string") parseInline(item, nextMarks);
    } else if (is(node, "t")) {
      if (node.children.some((item) => typeof item !== "string")) fail("Teks Word mengandung struktur yang tidak valid.");
      addText(xmlText(node), marks);
    }
    else if (is(node, "tab")) addText("\t", marks);
    else if (is(node, "br") || is(node, "cr")) content.push({ type: "hardBreak" });
    else if (is(node, "noBreakHyphen")) addText("‑", marks);
    else if (is(node, "softHyphen")) addText("\u00ad", marks);
    else if (is(node, "oMath", OMML_NS) || is(node, "oMathPara", OMML_NS)) {
      try { content.push({ type: "mathFormula", attrs: { formula: convertOmml(node) } }); }
      catch { fail("Rumus Equation Word mengandung bentuk yang belum didukung; periksa pecahan, akar, atau pangkat dan coba lagi."); }
    } else if (is(node, "drawing") || is(node, "pict")) drawingReference(node, images, inTable);
    else if (is(node, "hyperlink") || is(node, "smartTag")) {
      if (is(node, "hyperlink") && xmlAttr(node, "id", R)) fail("Tautan dalam isi soal belum didukung. Hapus tautan dan coba lagi.");
      for (const item of node.children) if (typeof item !== "string") parseInline(item, marks);
    } else if (is(node, "AlternateContent", MC)) {
      const selected = child(node, "Choice", MC) || child(node, "Fallback", MC);
      if (!selected) fail("Isi alternatif Word tidak didukung.");
      for (const item of selected.children) if (typeof item !== "string") parseInline(item, marks);
    } else if (is(node, "sdt")) {
      const inner = child(node, "sdtContent");
      if (!inner) fail("Kontrol isi Word tidak didukung.");
      for (const item of inner.children) if (typeof item !== "string") parseInline(item, marks);
    } else if (node.uri === W && ["pPr", "rPr", "proofErr", "bookmarkStart", "bookmarkEnd", "lastRenderedPageBreak", "commentRangeStart", "commentRangeEnd", "commentReference", "noProof"].includes(node.local)) {
      return;
    } else fail("Isi Word mengandung objek, revisi, atau elemen yang belum didukung. Sederhanakan dokumen dan coba lagi.");
  };
  for (const item of paragraph.children) if (typeof item !== "string") parseInline(item);
  return { type: "paragraph", attrs: paragraphAttrs(paragraph), ...(content.length ? { content } : {}) };
}

function parseInnerTable(table, images) {
  checkTableStructure(table);
  const rows = children(table, "tr");
  if (!rows.length || rows.length > 30) fail("Tabel dalam isi soal maksimal 30 baris.");
  const result = [];
  let active = new Map();
  let expectedWidth = null;
  for (const row of rows) {
    const next = new Map();
    const output = [];
    let col = 0;
    const cells = cellsOf(row);
    if (!cells.length) fail("Tabel isi soal kosong atau tidak valid.");
    for (const cell of cells) {
      const span = cellSpan(cell);
      const merge = mergeValue(cell);
      if (col + span > 12) fail("Tabel dalam isi soal maksimal 12 kolom.");
      if (merge === "continue") {
        const prior = active.get(col);
        if (!prior || prior.attrs.colspan !== span || hasAnyCellContent(cell)) fail("Penggabungan sel tabel isi soal tidak valid.");
        prior.attrs.rowspan++;
        for (let k = col; k < col + span; k++) next.set(k, prior);
      } else {
        const blocks = [];
        for (const part of cell.children) {
          if (typeof part === "string" || is(part, "tcPr")) continue;
          if (is(part, "p")) blocks.push(parseParagraph(part, images, true));
          else if (is(part, "tbl")) fail("Tabel di dalam tabel isi soal belum didukung.");
          else fail("Isi sel tabel Word belum didukung.");
        }
        if (!blocks.length) blocks.push({ type: "paragraph" });
        const item = { type: "tableCell", attrs: { colspan: span, rowspan: 1, colwidth: null, align: null }, content: blocks };
        output.push(item);
        if (merge === "restart") for (let k = col; k < col + span; k++) next.set(k, item);
      }
      col += span;
    }
    if (expectedWidth === null) expectedWidth = col;
    if (col !== expectedWidth) fail("Jumlah kolom tabel isi soal tidak konsisten.");
    result.push({ type: "tableRow", content: output });
    active = next;
  }
  return { type: "table", content: result };
}

function parseContentCell(cell) {
  const blocks = [];
  /** @type {ImageRefs} */
  const images = [];
  for (const part of cell.children) {
    if (typeof part === "string" || is(part, "tcPr")) continue;
    if (is(part, "p")) blocks.push(parseParagraph(part, images, false));
    else if (is(part, "tbl")) blocks.push(parseInnerTable(part, images));
    else fail("Isi sel Word mengandung elemen yang belum didukung.");
  }
  if (!blocks.length) blocks.push({ type: "paragraph" });
  try {
    const rich = sanitizeRichDocument({ type: "doc", content: blocks });
    return { rich, text: richToPlain(rich), imageRef: images[0]?.ref || null };
  } catch { fail("Isi berformat atau tabel terlalu kompleks untuk disimpan."); }
}

async function readImage(ref, rels, archive) {
  if (!ref) return null;
  const path = rels.get(ref);
  const bytes = path && archive.get(path);
  if (!bytes || bytes.length > QUESTION_IMAGE_MAX_BYTES) fail("Gambar tidak ditemukan, tertaut dari luar, atau lebih dari 1 MiB.");
  const image = await normalizeQuestionImage(bytes);
  if (!image.ok) fail(`Gambar Word: ${image.error}`);
  return { data: image.data, mime: image.mime };
}

/** Read a supported .docx template without ever executing document contents. @param {Buffer} bytes */
export async function readQuestionDocx(bytes) {
  const archive = await readArchive(bytes);
  if (!archive.has("[Content_Types].xml")) fail("File bukan dokumen Word .docx yang lengkap.");
  const document = xmlFrom(archive.get("word/document.xml"));
  if (!is(document, "document")) fail("Dokumen Word tidak menggunakan struktur yang didukung.");
  const body = child(document, "body");
  if (!body) fail("Isi dokumen Word tidak ditemukan.");
  const bodyTables = children(body, "tbl");
  if (bodyTables.length !== 1) fail("Gunakan tepat satu tabel utama Word; tabel soal tambahan di luar tabel utama tidak boleh diabaikan.");
  const tables = bodyTables.filter((table) => {
    const header = children(table, "tr")[0];
    if (!header) return false;
    const cells = children(header, "tc");
    return cells.length === 4 && cells.map((cell) => simpleText(cell).toLowerCase()).join("|") === "no|jenis|isi|jawaban";
  });
  if (tables.length !== 1) fail("Gunakan satu tabel utama dengan kolom No, Jenis, Isi, Jawaban seperti template.");
  checkTableStructure(tables[0]);
  const headerCells = cellsOf(children(tables[0], "tr")[0]);
  if (headerCells.length !== 4 || headerCells.map((cell) => metadataText(cell).toLowerCase()).join("|") !== "no|jenis|isi|jawaban") fail("Kolom judul tabel Word tidak valid.");
  const rels = imageRelationships(archive);
  const allRows = children(tables[0], "tr");
  if (allRows.length > MAX_DOCX_QUESTIONS * 6 + 20) fail("Dokumen terlalu panjang; maksimal 100 soal per file.");
  /** @type {{number:number, prompt:ReturnType<typeof parseContentCell>, options:ReturnType<typeof parseContentCell>[], keys:string[]}[]} */
  const parsed = [];
  let current = null;
  for (const [index, row] of allRows.slice(1).entries()) {
    const rowNo = index + 2;
    const cells = cellsOf(row);
    if (cells.length !== 4 || cells.some((cell) => cellSpan(cell) !== 1)) fail(`Baris ${rowNo}: tabel utama harus memiliki empat kolom tanpa penggabungan kolom.`);
    if (cells.slice(1).some((cell) => mergeValue(cell) !== null)) fail(`Baris ${rowNo}: gabungan vertikal hanya boleh pada kolom No.`);
    metadataText(cells[0]); // Nomor Word tidak dipakai sebagai ID; tetapi objek tersembunyi tidak boleh hilang.
    const kind = metadataText(cells[1]).toUpperCase();
    const answer = metadataText(cells[3]);
    if (!kind && !hasAnyCellContent(cells[2]) && !answer) continue;
    if (kind === "SOAL") {
      if (answer) fail(`Baris ${rowNo}: kolom Jawaban pada baris SOAL harus kosong.`);
      if (parsed.length >= MAX_DOCX_QUESTIONS) fail("Dokumen maksimal 100 soal per file.");
      try { current = { number: parsed.length + 1, prompt: parseContentCell(cells[2]), options: [], keys: [] }; }
      catch (error) { if (error instanceof QuestionDocxError) fail(`Baris ${rowNo}: ${error.message}`); throw error; }
      parsed.push(current);
    } else if (kind === "JAWABAN") {
      if (!current || current.options.length >= 5) fail(`Baris ${rowNo}: setiap SOAL harus diikuti tepat lima JAWABAN.`);
      if (answer !== "0" && answer !== "1") fail(`Baris ${rowNo}: kolom Jawaban harus 0 atau 1.`);
      try { current.options.push(parseContentCell(cells[2])); }
      catch (error) { if (error instanceof QuestionDocxError) fail(`Baris ${rowNo}: ${error.message}`); throw error; }
      current.keys.push(answer);
    } else fail(`Baris ${rowNo}: kolom Jenis harus SOAL atau JAWABAN.`);
  }
  if (!parsed.length) fail("Tidak ada soal pada tabel Word.");
  const questions = [];
  const imageCache = new Map();
  let totalImageBytes = 0;
  for (const item of parsed) {
    if (item.options.length !== 5 || item.keys.filter((key) => key === "1").length !== 1) fail(`Soal ${item.number}: harus ada lima jawaban dan tepat satu jawaban bernilai 1.`);
    const entries = [item.prompt, ...item.options];
    const imageSlots = [];
    for (const entry of entries) {
      // A Word document may reuse one media file in hundreds of cells. Decode it
      // only once, but count every occurrence before expanding the preview.
      const imagePath = entry.imageRef ? rels.get(entry.imageRef) : null;
      let image = imagePath ? imageCache.get(imagePath) : null;
      if (!image) {
        image = await readImage(entry.imageRef, rels, archive);
        if (imagePath && image) imageCache.set(imagePath, image);
      }
      if (image) {
        totalImageBytes += image.data.length;
        if (totalImageBytes > MAX_DOCX_TOTAL_IMAGE_BYTES) fail("Total gambar setelah diproses maksimal 16 MiB per file, termasuk gambar yang dipakai berulang. Bagi dokumen menjadi beberapa file.");
      }
      imageSlots.push(image);
    }
    const correctOption = "ABCDE"[item.keys.indexOf("1")];
    const draft = validateQuestionDraft({ topicId: "1", prompt: item.prompt.text, options: item.options.map((option) => option.text), correctOption });
    if (!draft.ok) fail(`Soal ${item.number}: ${draft.error}`);
    const complete = validateQuestionContent(draft.value, imageSlots.map(Boolean));
    if (!complete.ok) fail(`Soal ${item.number}: ${complete.error}`);
    questions.push({ number: item.number, prompt: { rich: item.prompt.rich, text: draft.value.prompt, image: imageSlots[0] }, options: item.options.map((option, i) => ({ rich: option.rich, text: draft.value.options[i], image: imageSlots[i + 1] })), correctOption });
  }
  return questions;
}
