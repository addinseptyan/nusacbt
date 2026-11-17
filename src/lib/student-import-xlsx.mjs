import { posix } from "node:path";
import { crc32 } from "node:zlib";
import { SaxesParser } from "saxes";
import { fromBufferPromise } from "yauzl";

// Input dibatasi sebelum ZIP dibuka. Isi arsip tidak pernah ditulis ke disk.
export const MAX_IMPORT_BYTES = 512 * 1024;
export const MAX_IMPORT_ROWS = 1000;
const MAX_ENTRIES = 128;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_COLUMNS = 16;
const MAX_CELL_CHARS = 2000;
const MAX_SHARED_STRINGS = 12000;
const MAIN_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);
const RELATION_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);

export class ImportFileError extends Error {}

function invalid(message) {
  throw new ImportFileError(message);
}

/**
 * @param {Buffer} input
 * @returns {Promise<Map<string, Buffer>>}
 */
async function readArchive(input) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_IMPORT_BYTES) {
    invalid("Ukuran file harus lebih dari 0 dan maksimal 512 KB.");
  }
  let zip;
  try {
    zip = await fromBufferPromise(input, { strictFileNames: true, validateEntrySizes: true });
  } catch {
    invalid("File bukan .xlsx yang valid atau arsipnya rusak.");
  }
  const contents = new Map();
  let expanded = 0;
  try {
    if (zip.entryCount > MAX_ENTRIES) invalid("Isi file terlalu kompleks. Gunakan template NusaCBT.");
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if (name.length > 200 || name.includes("\0") || contents.has(name) || entry.isEncrypted() || !entry.canDecodeFileData()) {
        invalid("Isi file tidak didukung atau memiliki entri ganda.");
      }
      if (/^xl\/(vbaProject\.bin|externalLinks\/|macrosheets\/)/i.test(name)) {
        invalid("File dengan makro atau tautan eksternal tidak didukung.");
      }
      if (entry.uncompressedSize > MAX_ENTRY_BYTES || expanded + entry.uncompressedSize > MAX_EXPANDED_BYTES) {
        invalid("Isi file terlalu besar setelah dibuka. Gunakan template dan maksimal 1.000 baris.");
      }
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > entry.uncompressedSize || size > MAX_ENTRY_BYTES || expanded + size > MAX_EXPANDED_BYTES) {
          stream.destroy();
          invalid("Isi file terlalu besar setelah dibuka.");
        }
        chunks.push(bytes);
      }
      if (size !== entry.uncompressedSize) invalid("Isi file tidak lengkap atau rusak.");
      const content = Buffer.concat(chunks, size);
      if ((crc32(content) >>> 0) !== (entry.crc32 >>> 0)) invalid("Isi file tidak lengkap atau rusak.");
      expanded += size;
      contents.set(name, content);
    }
  } catch (error) {
    if (error instanceof ImportFileError) throw error;
    invalid("File tidak dapat dibaca. Pastikan .xlsx tidak rusak atau dilindungi kata sandi.");
  } finally {
    zip.close();
  }
  return contents;
}

function attr(tag, name) {
  return tag.attributes[name]?.value;
}

function relationshipId(tag) {
  return Object.values(tag.attributes).find((item) => item.local === "id" && RELATION_NAMESPACES.has(item.uri))?.value;
}

function isMain(tag, local) {
  return tag.local === local && MAIN_NAMESPACES.has(tag.uri);
}

function decodeExcelText(text) {
  // Penggantian satu kali menjaga `_x005F_x0041_` sebagai teks literal `_x0041_`.
  return text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseXml(bytes, handlers = {}) {
  if (!bytes) invalid("Struktur file .xlsx tidak lengkap. Gunakan template NusaCBT.");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("File menggunakan encoding XML yang tidak didukung.");
  }
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on("doctype", () => invalid("Dokumen XML dengan DTD tidak didukung."));
  parser.on("opentag", (tag) => {
    depth += 1;
    if (depth > 100) invalid("Struktur XML terlalu kompleks.");
    handlers.open?.(tag, depth);
  });
  parser.on("closetag", (tag) => {
    handlers.close?.(tag, depth);
    depth -= 1;
  });
  parser.on("text", (value) => handlers.text?.(value));
  parser.on("cdata", (value) => handlers.text?.(value));
  try {
    parser.write(text).close();
  } catch (error) {
    if (error instanceof ImportFileError) throw error;
    invalid("Struktur XML pada file .xlsx tidak valid.");
  }
}

function targetPath(target) {
  if (typeof target !== "string" || !target || target.length > 200 || target.includes("\\") || target.includes("\0") || /[:?#%]/.test(target)) {
    invalid("Alamat sheet di dalam file tidak valid.");
  }
  const pieces = target.split("/");
  if (pieces.includes("..") || pieces.includes(".")) invalid("Alamat sheet di dalam file tidak valid.");
  const path = posix.normalize(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  if (!path.startsWith("xl/") || path.endsWith("/")) invalid("Alamat sheet di dalam file tidak valid.");
  return path;
}

function workbookParts(contents) {
  let selected;
  let selectedCount = 0;
  let sheetCount = 0;
  parseXml(contents.get("xl/workbook.xml"), {
    open(tag) {
      if (!isMain(tag, "sheet")) return;
      sheetCount += 1;
      if (sheetCount > 32) invalid("Terlalu banyak sheet. Gunakan template NusaCBT.");
      if (attr(tag, "name") === "Peserta") {
        selectedCount += 1;
        selected = { id: relationshipId(tag), state: attr(tag, "state") };
      }
    },
  });
  if (selectedCount !== 1 || !selected?.id || (selected.state && selected.state !== "visible")) {
    invalid("Sheet bernama Peserta tidak ditemukan atau tersembunyi. Gunakan template NusaCBT.");
  }
  const relationships = new Map();
  let sharedTarget;
  parseXml(contents.get("xl/_rels/workbook.xml.rels"), {
    open(tag) {
      if (tag.local !== "Relationship") return;
      const id = attr(tag, "Id");
      const type = attr(tag, "Type") || "";
      const target = attr(tag, "Target");
      const mode = attr(tag, "TargetMode");
      if (!id || relationships.has(id)) invalid("Relasi sheet di dalam file tidak valid.");
      relationships.set(id, { type, target, mode });
      if (type.endsWith("/sharedStrings")) {
        if (sharedTarget || mode === "External") invalid("Daftar teks dalam file tidak valid.");
        sharedTarget = targetPath(target);
      }
    },
  });
  const sheet = relationships.get(selected.id);
  if (!sheet || !sheet.type.endsWith("/worksheet") || sheet.mode === "External") invalid("Sheet Peserta tidak dapat ditemukan.");
  const sheetPath = targetPath(sheet.target);
  if (!contents.has(sheetPath) || (sharedTarget && !contents.has(sharedTarget))) invalid("Isi sheet di dalam file tidak lengkap.");
  return { sheet: contents.get(sheetPath), shared: sharedTarget ? contents.get(sharedTarget) : undefined };
}

function sharedStrings(bytes) {
  if (!bytes) return [];
  const result = [];
  let entryDepth = 0;
  let textDepth = 0;
  let phoneticDepth = 0;
  let value = "";
  parseXml(bytes, {
    open(tag, depth) {
      if (isMain(tag, "si")) {
        if (entryDepth) invalid("Daftar teks dalam file tidak valid.");
        entryDepth = depth;
        value = "";
      } else if (entryDepth && isMain(tag, "rPh")) phoneticDepth = depth;
      else if (entryDepth && !phoneticDepth && isMain(tag, "t")) textDepth = depth;
    },
    text(text) {
      if (textDepth && !phoneticDepth) {
        value += text;
        if (value.length > MAX_CELL_CHARS) invalid("Isi sel terlalu panjang. Gunakan teks singkat pada template.");
      }
    },
    close(tag, depth) {
      if (depth === textDepth && isMain(tag, "t")) textDepth = 0;
      if (depth === phoneticDepth && isMain(tag, "rPh")) phoneticDepth = 0;
      if (depth === entryDepth && isMain(tag, "si")) {
        result.push(decodeExcelText(value));
        if (result.length > MAX_SHARED_STRINGS) invalid("Terlalu banyak teks dalam file.");
        entryDepth = 0;
      }
    },
  });
  return result;
}

function cellAddress(raw) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,3})$/.exec(raw ?? "");
  if (!match) invalid("Posisi sel tidak valid. Gunakan template NusaCBT.");
  let column = 0;
  for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (row > MAX_IMPORT_ROWS + 1 || column > MAX_COLUMNS) invalid("File melampaui batas 1.000 baris atau 16 kolom.");
  return { row, column };
}

function cellValue(cell, strings) {
  if (cell.formula || cell.type === "str") return { kind: "formula", value: "" };
  if (cell.type === "s") {
    if (!/^(0|[1-9][0-9]{0,5})$/.test(cell.raw) || Number(cell.raw) >= strings.length) invalid("Referensi teks dalam file tidak valid.");
    return { kind: "text", value: strings[Number(cell.raw)] };
  }
  if (cell.type === "inlineStr") return { kind: "text", value: decodeExcelText(cell.inline) };
  if (!cell.raw) return { kind: "empty", value: "" };
  if (!cell.type || cell.type === "n") return { kind: "number", value: cell.raw };
  return { kind: "other", value: "" };
}

function sheetRows(bytes, strings) {
  const rows = [];
  let sheetDataDepth = 0;
  let row;
  let cell;
  let rowDepth = 0;
  let cellDepth = 0;
  let inlineDepth = 0;
  let textDepth = 0;
  let valueDepth = 0;
  let phoneticDepth = 0;
  let lastRow = 0;
  let lastColumn = 0;
  parseXml(bytes, {
    open(tag, depth) {
      if (isMain(tag, "mergeCell")) invalid("Sheet Peserta tidak boleh berisi sel yang digabung (merge)." );
      if (isMain(tag, "sheetData")) {
        if (sheetDataDepth) invalid("Struktur sheet Peserta tidak valid.");
        sheetDataDepth = depth;
      } else if (sheetDataDepth && isMain(tag, "row")) {
        const raw = attr(tag, "r");
        const number = raw ? Number(raw) : lastRow + 1;
        if ((raw && !/^[1-9][0-9]{0,3}$/.test(raw)) || !Number.isSafeInteger(number) || number <= lastRow || number > MAX_IMPORT_ROWS + 1) {
          invalid("File melampaui batas 1.000 baris atau urutan baris tidak valid.");
        }
        if (row) invalid("Struktur baris pada sheet tidak valid.");
        row = { number, hidden: attr(tag, "hidden") === "1" || attr(tag, "hidden") === "true", cells: new Map() };
        rowDepth = depth;
        lastRow = number;
        lastColumn = 0;
      } else if (row && isMain(tag, "c")) {
        if (cell) invalid("Struktur sel pada sheet tidak valid.");
        const raw = attr(tag, "r");
        const address = raw ? cellAddress(raw) : { row: row.number, column: lastColumn + 1 };
        if (address.row !== row.number || address.column <= lastColumn || address.column > MAX_COLUMNS) invalid("Urutan atau posisi sel tidak valid.");
        lastColumn = address.column;
        cell = { column: address.column, type: attr(tag, "t") || "n", raw: "", inline: "", formula: false };
        cellDepth = depth;
      } else if (cell && isMain(tag, "f")) {
        cell.formula = true;
      } else if (cell && isMain(tag, "v")) {
        valueDepth = depth;
      } else if (cell && isMain(tag, "is")) {
        inlineDepth = depth;
      } else if (cell && inlineDepth && isMain(tag, "rPh")) {
        phoneticDepth = depth;
      } else if (cell && inlineDepth && !phoneticDepth && isMain(tag, "t")) {
        textDepth = depth;
      }
    },
    text(text) {
      if (!cell) return;
      if (valueDepth) cell.raw += text;
      if (textDepth && !phoneticDepth) cell.inline += text;
      if (cell.raw.length > MAX_CELL_CHARS || cell.inline.length > MAX_CELL_CHARS) invalid("Isi sel terlalu panjang. Gunakan teks singkat pada template.");
    },
    close(tag, depth) {
      if (depth === textDepth && isMain(tag, "t")) textDepth = 0;
      if (depth === valueDepth && isMain(tag, "v")) valueDepth = 0;
      if (depth === inlineDepth && isMain(tag, "is")) inlineDepth = 0;
      if (depth === phoneticDepth && isMain(tag, "rPh")) phoneticDepth = 0;
      if (cell && depth === cellDepth && isMain(tag, "c")) {
        row.cells.set(cell.column, cellValue(cell, strings));
        cell = undefined;
        cellDepth = 0;
      }
      if (row && depth === rowDepth && isMain(tag, "row")) {
        rows.push(row);
        row = undefined;
        rowDepth = 0;
      }
      if (depth === sheetDataDepth && isMain(tag, "sheetData")) sheetDataDepth = 0;
    },
  });
  return rows;
}

/**
 * Membaca subset XLSX template peserta: teks inline/shared, angka dan formula terdeteksi.
 * Tidak menghitung formula, tidak membuka tautan, dan tidak mengeksekusi makro.
 * @param {Buffer} input
 * @returns {Promise<Array<{rowNumber: number, hidden: boolean, cells: Array<{kind: string, value: string}>}>>}
 */
export async function readStudentWorkbook(input) {
  const contents = await readArchive(input);
  const parts = workbookParts(contents);
  const strings = sharedStrings(parts.shared);
  const parsed = sheetRows(parts.sheet, strings);
  const header = parsed.find((row) => row.number === 1);
  if (header?.hidden) invalid("Baris judul tersembunyi. Tampilkan kembali sebelum impor.");
  const expected = ["nomor", "nama", "nisn", "kelas"];
  for (let column = 1; column <= 4; column += 1) {
    const cell = header?.cells.get(column);
    if (!cell || cell.kind !== "text" || cell.value.trim().toLowerCase() !== expected[column - 1]) {
      invalid("Baris pertama sheet Peserta harus berisi Nomor, Nama, NISN, Kelas secara berurutan.");
    }
  }
  if ([...header.cells.entries()].some(([column, cell]) => column > 4 && (cell.kind === "formula" || cell.kind === "other" || cell.value.trim() !== ""))) {
    invalid("Kolom tambahan pada header tidak didukung. Gunakan empat kolom template.");
  }
  const empty = { kind: "empty", value: "" };
  return parsed.filter((row) => row.number > 1).map((row) => ({
    rowNumber: row.number,
    hidden: row.hidden,
    cells: Array.from({ length: MAX_COLUMNS }, (_, index) => row.cells.get(index + 1) ?? empty),
  })).filter((row) => row.cells.slice(1).some((cell) => cell.kind === "formula" || cell.kind === "other" || cell.value.trim() !== ""));
}
