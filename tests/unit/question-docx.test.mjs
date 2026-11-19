import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import sharp from "sharp";
import { MAX_DOCX_BYTES, MAX_DOCX_TOTAL_IMAGE_BYTES, readQuestionDocx } from "../../src/lib/question-docx.mjs";

const fixture = readFileSync(new URL("../../public/templates/template-soal-nusacbt.docx", import.meta.url));
function alterDocument(change) {
  const entries = unzipSync(fixture);
  entries["word/document.xml"] = strToU8(change(strFromU8(entries["word/document.xml"])));
  return Buffer.from(zipSync(entries));
}

test("template fiktif: Arab, tabel dalam sel, OMML akar/pecahan dan gambar", async () => {
  const questions = await readQuestionDocx(fixture);
  assert.equal(questions.length, 4);
  assert.equal(questions[0].prompt.text, "السُّؤَالُ: مَا لَوْنُ السَّمَاءِ؟");
  assert.equal(questions[0].prompt.rich.content[0].attrs.dir, "rtl");
  assert.equal(questions[1].prompt.rich.content[1].type, "table");
  assert.match(questions[1].prompt.text, /Hari\tKegiatan/);
  assert.match(questions[2].prompt.text, /\(√\(32\)\+2√\(18\)\)\/\(√\(8\)\)/);
  assert.equal(questions[2].options[3].text, "(5)/(2)√(2)");
  assert.ok(questions.every((q) => q.options.length === 5 && q.correctOption === "A"));
  assert.equal(questions[3].prompt.image.mime, "image/png");
  assert.ok(questions[3].prompt.image.data.length > 0);
});

test("seluruh impor ditolak jika kunci bukan tepat satu", async () => {
  const altered = alterDocument((xml) => xml.replaceAll("<w:t>1</w:t>", "<w:t>0</w:t>"));
  await assert.rejects(readQuestionDocx(altered), /tepat satu/);
});

test("rumus OMML yang tidak didukung ditolak, bukan dibuang diam-diam", async () => {
  const altered = alterDocument((xml) => xml.replace("<m:f>", "<m:f><m:phant/>"));
  await assert.rejects(readQuestionDocx(altered), /Rumus Equation Word/);
});

test("format tabel utama dan dokumen rusak ditolak", async () => {
  const wrongHeader = alterDocument((xml) => xml.replace("<w:t>Jenis</w:t>", "<w:t>Salah</w:t>"));
  await assert.rejects(readQuestionDocx(wrongHeader), /kolom No, Jenis, Isi, Jawaban/);
  await assert.rejects(readQuestionDocx(Buffer.from("bukan zip")), /bukan .docx/);
  await assert.rejects(readQuestionDocx(Buffer.alloc(MAX_DOCX_BYTES + 1)), /6 MiB/);
});

test("baris terselubung dan objek di kolom metadata ditolak, tidak dilewati", async () => {
  const wrappedRow = alterDocument((xml) => xml.replace("</w:tr>", "</w:tr><w:sdt><w:sdtContent><w:tr/></w:sdtContent></w:sdt>"));
  await assert.rejects(readQuestionDocx(wrappedRow), /Tabel Word mengandung baris/);
  const hiddenMath = alterDocument((xml) => xml.replace("<w:t>SOAL</w:t>", '<w:t>SOAL</w:t><m:oMath><m:r><m:t>42</m:t></m:r></m:oMath>'));
  await assert.rejects(readQuestionDocx(hiddenMath), /kolom No, Jenis, atau Jawaban/i);
  const secondTable = alterDocument((xml) => xml.replace("</w:body>", "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Soal tambahan</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>"));
  await assert.rejects(readQuestionDocx(secondTable), /tepat satu tabel utama/);
});

test("CRC dan batas ukuran setelah dekompresi ditegakkan", async () => {
  const entries = unzipSync(fixture);
  const uncompressed = Buffer.from(zipSync(entries, { level: 0 }));
  const offset = uncompressed.indexOf(Buffer.from("<Types xmlns="));
  assert.ok(offset > 0);
  uncompressed[offset + 1] ^= 1;
  await assert.rejects(readQuestionDocx(uncompressed), /rusak/);
  entries["word/untrusted.bin"] = new Uint8Array(10 * 1024 * 1024 + 1);
  const bomb = Buffer.from(zipSync(entries));
  assert.ok(bomb.length < MAX_DOCX_BYTES);
  await assert.rejects(readQuestionDocx(bomb), /terlalu besar/);
});

test("menolak DTD, makro, jalur ZIP tidak aman, dan gambar yang rusak", async () => {
  const dtd = alterDocument((xml) => xml.replace("?>", '?>\n<!DOCTYPE x [<!ENTITY secret "unsafe">]>'));
  await assert.rejects(readQuestionDocx(dtd), /XML dokumen Word/);
  const macros = unzipSync(fixture); macros["word/vbaProject.bin"] = strToU8("fake");
  await assert.rejects(readQuestionDocx(Buffer.from(zipSync(macros))), /makro/);
  const traversal = unzipSync(fixture); traversal["../escape.txt"] = strToU8("fake");
  await assert.rejects(readQuestionDocx(Buffer.from(zipSync(traversal))));
  const badImage = unzipSync(fixture); const image = Object.keys(badImage).find((x) => x.startsWith("word/media/"));
  badImage[image] = strToU8("not a png or jpeg");
  await assert.rejects(readQuestionDocx(Buffer.from(zipSync(badImage))), /Gambar Word/);
});

test("total gambar menghitung setiap pemakaian ulang dan menolak perluasan pratinjau yang berlebihan", async () => {
  const entries = unzipSync(fixture);
  const xml = strFromU8(entries["word/document.xml"]);
  const root = xml.match(/<w:document\b[^>]*>/)?.[0];
  const drawing = xml.match(/<w:r><w:drawing>.*?<\/w:drawing><\/w:r>/s)?.[0];
  const media = Object.keys(entries).find((name) => name.startsWith("word/media/"));
  assert.ok(root && drawing && media);
  // One realistic, incompressible PNG is referenced many times in document.xml.
  // The DOCX stays small, while naive expansion would duplicate it for every slot.
  entries[media] = await sharp(randomBytes(512 * 512 * 3), { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer();
  const text = (value) => `<w:r><w:t>${value}</w:t></w:r>`;
  const cell = (content) => `<w:tc><w:p>${content}</w:p></w:tc>`;
  const row = (number, kind, content, answer) => `<w:tr>${[text(number), text(kind), content, text(answer)].map(cell).join("")}</w:tr>`;
  const makeDocument = (count) => {
    let table = row("No", "Jenis", text("Isi"), "Jawaban");
    for (let question = 0; question < count; question++) {
      table += row(String(question + 1), "SOAL", text("Soal fiktif") + drawing, "");
      for (let option = 0; option < 5; option++) table += row("", "JAWABAN", text(`Pilihan ${option + 1}`) + drawing, option ? "0" : "1");
    }
    const copy = { ...entries, "word/document.xml": strToU8(`${root}<w:body><w:tbl>${table}</w:tbl></w:body></w:document>`) };
    return Buffer.from(zipSync(copy));
  };
  const accepted = await readQuestionDocx(makeDocument(3));
  const firstImage = accepted[0].prompt.image.data;
  assert.ok(firstImage.length * 18 <= MAX_DOCX_TOTAL_IMAGE_BYTES);
  assert.ok(firstImage.length * 24 > MAX_DOCX_TOTAL_IMAGE_BYTES);
  assert.equal(accepted[2].options[4].image.data, firstImage); // Cached decode, each occurrence still counts.
  await assert.rejects(readQuestionDocx(makeDocument(4)), /Total gambar.*16 MiB/);
});
