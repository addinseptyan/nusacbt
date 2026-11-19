import { mathToText, sanitizeFormula } from "./question-math.mjs";

const MARKS = new Set(["bold", "italic", "underline", "subscript", "superscript"]);
const DIRECTIONS = new Set(["auto", "ltr", "rtl"]);
const ALIGNS = new Set(["left", "center", "right"]);
export const RICH_MAX_JSON_CHARS = 120000;
export const RICH_MAX_NODES = 2500;
export const RICH_MAX_TABLE_ROWS = 30;
export const RICH_MAX_TABLE_COLS = 12;
export const RICH_MAX_TABLE_CELLS = 250;

function invalid(message = "Isi berformat tidak valid atau terlalu kompleks.") { throw new Error(message); }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function hasOnlyKeys(value, keys) { return Object.keys(value).every((key) => keys.includes(key)); }
function cleanAttrs(raw, allowed) {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw) || !hasOnlyKeys(raw, allowed)) invalid();
  return raw;
}

/** @typedef {{type:string, text?:string, attrs?:Record<string,any>, marks?:{type:string}[], content?:RichNode[]}} RichNode */

/** Validate strictly and rebuild the editor JSON; output is safe to persist or render. @param {unknown} raw @returns {RichNode} */
export function sanitizeRichDocument(raw) {
  try { if (JSON.stringify(raw).length > RICH_MAX_JSON_CHARS) invalid(); } catch { invalid(); }
  let totalNodes = 0;
  let totalCells = 0;
  /** @param {unknown} value @param {string} parent @param {number} depth @returns {RichNode} */
  function walk(value, parent, depth) {
    if (!isObject(value) || depth > 24 || ++totalNodes > RICH_MAX_NODES) invalid();
    const obj = /** @type {Record<string,any>} */ (value);
    if (typeof obj.type !== "string" || !hasOnlyKeys(obj, ["type", "attrs", "content", "marks", "text"])) invalid();
    const type = obj.type;
    /** @type {Record<string,string[]>} */
    const allowed = {
      "": ["doc"], doc: ["paragraph", "table", "bulletList", "orderedList"],
      paragraph: ["text", "hardBreak", "mathFormula"],
      bulletList: ["listItem"], orderedList: ["listItem"],
      listItem: ["paragraph", "bulletList", "orderedList"],
      table: ["tableRow"], tableRow: ["tableCell", "tableHeader"],
      tableCell: ["paragraph", "bulletList", "orderedList"], tableHeader: ["paragraph", "bulletList", "orderedList"],
    };
    if (!allowed[parent]?.includes(type)) invalid();
    /** @type {RichNode} */
    const out = { type };
    if (type === "text") {
      if (typeof obj.text !== "string" || !obj.text || !obj.text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(obj.text)) invalid();
      if (obj.attrs !== undefined || obj.content !== undefined) invalid();
      out.text = obj.text;
      if (obj.marks !== undefined) {
        if (!Array.isArray(obj.marks) || obj.marks.length > 5) invalid();
        const seen = new Set();
        out.marks = obj.marks.map((mark) => {
          if (!isObject(mark) || !hasOnlyKeys(mark, ["type"]) || !MARKS.has(mark.type) || seen.has(mark.type)) invalid();
          seen.add(mark.type);
          return { type: mark.type };
        });
        if (seen.has("subscript") && seen.has("superscript")) invalid();
        if (!out.marks.length) delete out.marks;
      }
      return out;
    }
    if (obj.text !== undefined || obj.marks !== undefined) invalid();
    if (type === "hardBreak") {
      if (obj.attrs !== undefined || obj.content !== undefined) invalid();
      return out;
    }
    if (type === "mathFormula") {
      const attrs = cleanAttrs(obj.attrs, ["formula"]);
      if (obj.content !== undefined) invalid();
      out.attrs = { formula: sanitizeFormula(attrs.formula) };
      return out;
    }
    if (type === "paragraph") {
      const attrs = cleanAttrs(obj.attrs, ["dir", "textAlign"]);
      const dir = attrs.dir ?? "auto";
      const textAlign = attrs.textAlign ?? null;
      if (!DIRECTIONS.has(dir) || (textAlign !== null && !ALIGNS.has(textAlign))) invalid();
      out.attrs = { dir, textAlign };
    } else if (type === "tableCell" || type === "tableHeader") {
      const attrs = cleanAttrs(obj.attrs, ["colspan", "rowspan", "colwidth", "align"]);
      const colspan = attrs.colspan ?? 1;
      const rowspan = attrs.rowspan ?? 1;
      const colwidth = attrs.colwidth ?? null;
      const align = attrs.align ?? null;
      if (!Number.isSafeInteger(colspan) || colspan < 1 || colspan > RICH_MAX_TABLE_COLS || !Number.isSafeInteger(rowspan) || rowspan < 1 || rowspan > RICH_MAX_TABLE_ROWS) invalid();
      if (colwidth !== null && (!Array.isArray(colwidth) || colwidth.length !== colspan || colwidth.some((x) => !Number.isInteger(x) || x < 25 || x > 4000))) invalid();
      if (align !== null && !ALIGNS.has(align)) invalid();
      if (++totalCells > RICH_MAX_TABLE_CELLS) invalid("Terlalu banyak sel tabel dalam satu bagian soal.");
      out.attrs = { colspan, rowspan, colwidth: null, align };
    } else if (type === "orderedList") {
      const attrs = cleanAttrs(obj.attrs, ["start", "type"]);
      const start = attrs.start ?? 1;
      if (!Number.isInteger(start) || start < 1 || start > 9999 || (attrs.type !== undefined && attrs.type !== null)) invalid();
      out.attrs = { start, type: null };
    } else {
      cleanAttrs(obj.attrs, []);
    }
    if (obj.content !== undefined && !Array.isArray(obj.content)) invalid();
    const list = obj.content || [];
    if (list.length > RICH_MAX_NODES) invalid();
    if (["doc", "table", "tableRow", "tableCell", "tableHeader", "bulletList", "orderedList", "listItem"].includes(type) && list.length === 0) invalid();
    if (type === "table" && list.length > RICH_MAX_TABLE_ROWS) invalid();
    if (type === "tableRow" && list.length > RICH_MAX_TABLE_COLS) invalid();
    if (list.length) out.content = list.map((item) => walk(item, type, depth + 1));
    if (["tableCell", "tableHeader", "listItem"].includes(type) && out.content?.[0]?.type !== "paragraph") invalid();
    if (type === "table") checkTable(out);
    return out;
  }
  return walk(raw, "", 0);
}

/** Verify merged cells form a rectangular grid and don't extend outside the table. @param {RichNode} table */
function checkTable(table) {
  const rows = table.content || [];
  /** @type {number[]} */
  const occupiedUntil = [];
  let width = null;
  for (let r = 0; r < rows.length; r++) {
    let col = 0;
    for (const cell of rows[r].content || []) {
      while ((occupiedUntil[col] ?? 0) > r) col++;
      const span = cell.attrs?.colspan || 1;
      const rowSpan = cell.attrs?.rowspan || 1;
      if (col + span > RICH_MAX_TABLE_COLS || r + rowSpan > rows.length) invalid("Tabel memiliki penggabungan sel yang tidak valid.");
      for (let k = col; k < col + span; k++) {
        if ((occupiedUntil[k] ?? 0) > r) invalid("Tabel memiliki penggabungan sel yang bertumpuk.");
        occupiedUntil[k] = r + rowSpan;
      }
      col += span;
    }
    while ((occupiedUntil[col] ?? 0) > r) col++;
    if (occupiedUntil.some((until, index) => index >= col && until > r)) invalid("Tabel tidak membentuk baris yang lengkap.");
    if (width === null) width = col;
    if (col !== width || width < 1) invalid("Jumlah kolom tabel tidak konsisten.");
  }
}

/** @param {RichNode} doc @returns {string} */
export function richToPlain(doc) {
  function txt(node) {
    if (node.type === "text") return node.text || "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "mathFormula") return mathToText(node.attrs.formula);
    const children = (node.content || []).map(txt);
    if (node.type === "tableRow") return children.join("\t");
    if (["doc", "table", "tableCell", "tableHeader", "listItem", "bulletList", "orderedList"].includes(node.type)) return children.join("\n");
    return children.join("");
  }
  return txt(doc).trim();
}

/** @param {string} text @returns {RichNode} */
export function legacyToRich(text) {
  return { type: "doc", content: String(text || "").split("\n").map((line) => ({ type: "paragraph", attrs: { dir: "auto", textAlign: null }, ...(line ? { content: [{ type: "text", text: line }] } : {}) })) };
}

/** @param {unknown} input @param {number} limit */
export function validateRichInput(input, limit) {
  if (typeof input !== "string" || input.length > RICH_MAX_JSON_CHARS) invalid();
  let obj;
  try { obj = JSON.parse(input); } catch { invalid(); }
  const doc = sanitizeRichDocument(obj);
  const plain = richToPlain(doc);
  if (Array.from(plain).length > limit) invalid(`Teks dalam bagian soal maksimal ${limit} karakter.`);
  return { doc, plain };
}
