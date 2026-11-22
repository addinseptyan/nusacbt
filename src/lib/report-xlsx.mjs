import { strToU8, zipSync } from 'fflate';

/** XML 1.0: karakter yang tidak sah diganti, bukan dimasukkan ke berkas. */
function xml(value) {
  let safe = '';
  for (const character of String(value)) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    safe += code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xD7FF) ||
      (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF) ? character : '\uFFFD';
  }
  return safe.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/** @param {number} zeroBased */
function columnName(zeroBased) {
  let n = zeroBased + 1, value = '';
  while (n > 0) { n -= 1; value = String.fromCharCode(65 + n % 26) + value; n = Math.floor(n / 26); }
  return value;
}

/** @param {import('./report-xlsx.mjs').SpreadsheetCell} value @param {string} reference @param {boolean} header @param {boolean} title */
function cell(value, reference, header = false, title = false) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    if (value.length > 32767) throw new Error('Isi sel Excel melebihi batas.');
    // inlineStr memaksa teks literal, termasuk teks yang diawali =, +, - atau @.
    // Tidak ada elemen formula, hyperlink, external link, atau makro.
    return `<c r="${reference}" t="inlineStr"${title ? ' s="5"' : header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Angka Excel tidak valid.');
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  if (typeof value === 'object' && 'score' in value && Number.isFinite(value.score) && (value.style === undefined || value.style === 'makeup')) {
    return `<c r="${reference}" s="${value.style === 'makeup' ? 3 : 2}"><v>${value.score}</v></c>`;
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string' && value.style === 'conflict') {
    if (value.text.length > 32767) throw new Error('Isi sel Excel melebihi batas.');
    return `<c r="${reference}" t="inlineStr" s="4"><is><t xml:space="preserve">${xml(value.text)}</t></is></c>`;
  }
  throw new Error('Jenis sel Excel tidak didukung.');
}

/** @param {import('./report-xlsx.mjs').SpreadsheetSheet} sheet */
function worksheet(sheet) {
  const width = sheet.columns.length;
  const preamble = sheet.preamble ?? [], layout = sheet.matrixLayout;
  if (!width || width > 64 || sheet.rows.length > 1_000_000 || !Array.isArray(preamble) || preamble.length > 30) throw new Error('Ukuran lembar Excel tidak didukung.');
  if (layout && (!Number.isInteger(layout.firstTestColumn) || layout.firstTestColumn < 2 || layout.firstTestColumn >= width || typeof layout.groupTitle !== 'string' || !layout.groupTitle.trim() || !preamble.length)) throw new Error('Tata letak matriks Excel tidak valid.');
  /** @type {string[]} */
  const merges = [];
  const prefix = preamble.map((row, index) => {
    if (!Array.isArray(row) || row.length > width || (layout && row.length > (index === 0 ? 1 : 2))) throw new Error('Metadata Excel tidak valid.');
    const number = index + 1;
    if (!layout) return `<row r="${number}">${row.map((item, col) => cell(item, `${columnName(col)}${number}`, index === 0)).join('')}</row>`;
    // Judul serta label metadata digabung agar teks tidak terpotong oleh kolom No yang sempit.
    if (index === 0) {
      merges.push(`A1:${columnName(layout.firstTestColumn - 1)}1`);
      return `<row r="1" ht="22" customHeight="1">${cell(row[0], 'A1', false, true)}</row>`;
    }
    if (row.length) merges.push(`A${number}:B${number}`);
    return `<row r="${number}">${cell(row[0], `A${number}`)}${cell(row[1], `C${number}`)}</row>`;
  }).join('');
  const groupNumber = preamble.length + 1;
  const group = layout ? `<row r="${groupNumber}" ht="20" customHeight="1">${cell(layout.groupTitle, `${columnName(layout.firstTestColumn)}${groupNumber}`, true)}</row>` : '';
  if (layout && width > layout.firstTestColumn + 1) merges.push(`${columnName(layout.firstTestColumn)}${groupNumber}:${columnName(width - 1)}${groupNumber}`);
  const headerNumber = groupNumber + (layout ? 1 : 0);
  const header = `<row r="${headerNumber}"${layout ? ' ht="42" customHeight="1"' : ''}>${sheet.columns.map((col, index) => cell(col.title, `${columnName(index)}${headerNumber}`, true)).join('')}</row>`;
  const rows = sheet.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== width) throw new Error('Jumlah kolom Excel tidak sesuai.');
    const rowNumber = rowIndex + headerNumber + 1;
    return `<row r="${rowNumber}">${row.map((item, index) => cell(item, `${columnName(index)}${rowNumber}`)).join('')}</row>`;
  }).join('');
  const cols = sheet.columns.map((col, index) => {
    const size = Number.isFinite(col.width) ? Math.max(8, Math.min(60, col.width)) : 18;
    return `<col min="${index + 1}" max="${index + 1}" width="${size}" customWidth="1"/>`;
  }).join('');
  const lastRow = sheet.rows.length + headerNumber, range = `A1:${columnName(width - 1)}${lastRow}`;
  const filter = `A${headerNumber}:${columnName(width - 1)}${lastRow}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerNumber}" topLeftCell="A${headerNumber+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${prefix}${group}${header}${rows}</sheetData><autoFilter ref="${filter}"/>` +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '') + `</worksheet>`;
}

/**
 * Hasilkan .xlsx OOXML tanpa formula atau tautan eksternal. Nilai berupa teks
 * selalu sel teks; nomor peserta/NISN dengan nol di depan tidak diubah menjadi
 * angka. Pemanggil wajib membatasi jumlah data sebelum memanggil fungsi ini.
 * @param {import('./report-xlsx.mjs').SpreadsheetSheet[]} sheets
 * @returns {Uint8Array}
 */
export function createReportWorkbook(sheets) {
  if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > 5) throw new Error('Jumlah lembar Excel tidak valid.');
  const names = new Set();
  for (const sheet of sheets) {
    if (!sheet || typeof sheet.name !== 'string' || !sheet.name || sheet.name.length > 31 || /[\\/?*\[\]:]/.test(sheet.name) ||
        sheet.name.startsWith("'") || sheet.name.endsWith("'") || names.has(sheet.name.toLocaleLowerCase('en-US')) ||
        !Array.isArray(sheet.columns) || !Array.isArray(sheet.rows)) throw new Error('Nama atau isi lembar Excel tidak valid.');
    names.add(sheet.name.toLocaleLowerCase('en-US'));
  }
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets = sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const relationships = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>` +
    `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16745D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE0DE"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  /** @type {Record<string, Uint8Array>} */
  const files = {
    '[Content_Types].xml': strToU8(declaration + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`),
    '_rels/.rels': strToU8(declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(declaration + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(declaration + styles),
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheet(sheet)); });
  return zipSync(files, { level: 6 });
}
