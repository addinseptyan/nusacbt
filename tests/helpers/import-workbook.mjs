import { strToU8, zipSync } from "fflate";

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Creates fictional test-only XLSX files, supporting shared strings and malformed edge cases.
 * @param {{rows?: Array<{number?: number, hidden?: boolean, cells: unknown[]}>, header?: unknown[], headerHidden?: boolean, shared?: boolean, sheetName?: string, sheetState?: string, extraEntries?: Record<string, string>, merge?: boolean, rawSheet?: string}} [options]
 */
export function makeImportWorkbook(options = {}) {
  const strings = [];
  const shared = options.shared ?? false;
  function columnName(index) {
    let n = index + 1;
    let name = "";
    while (n) {
      n -= 1;
      name = String.fromCharCode(65 + n % 26) + name;
      n = Math.floor(n / 26);
    }
    return name;
  }
  function cell(value, column, row) {
    if (value === null || value === undefined) return "";
    const address = `${columnName(column)}${row}`;
    if (typeof value === "number") return `<c r="${address}" t="n"><v>${value}</v></c>`;
    if (typeof value === "object" && "formula" in value) return `<c r="${address}" t="n"><f>${escapeXml(value.formula)}</f><v>1</v></c>`;
    let text;
    if (typeof value === "object" && "rich" in value) {
      text = value.rich.map((part) => `<r><t xml:space="preserve">${escapeXml(part)}</t></r>`).join("");
    } else {
      text = `<t xml:space="preserve">${escapeXml(value)}</t>`;
    }
    if (shared) {
      const index = strings.length;
      strings.push(`<si>${text}</si>`);
      return `<c r="${address}" t="s"><v>${index}</v></c>`;
    }
    return `<c r="${address}" t="inlineStr"><is>${text}</is></c>`;
  }
  const rows = [{ number: 1, hidden: options.headerHidden, cells: options.header ?? ["Nomor", "Nama", "NISN", "Kelas"] }, ...(options.rows ?? [])];
  const body = rows.map((item, index) => {
    const number = item.number ?? index + 1;
    return `<row r="${number}"${item.hidden ? ' hidden="1"' : ""}>${item.cells.map((value, column) => cell(value, column, number)).join("")}</row>`;
  }).join("");
  const sheet = options.rawSheet ?? `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData>${options.merge ? '<mergeCells count="1"><mergeCell ref="B2:B3"/></mergeCells>' : ""}</worksheet>`;
  const sharedRelation = shared ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : "";
  const entries = {
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(options.sheetName ?? "Peserta")}" sheetId="1" r:id="rId1"${options.sheetState ? ` state="${escapeXml(options.sheetState)}"` : ""}/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${sharedRelation}</Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
    ...(shared ? { "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.join("")}</sst>` } : {}),
    ...(options.extraEntries ?? {}),
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)])), { level: 6 }));
}
