import test from "node:test";
import assert from "node:assert/strict";
import { legacyToRich, richToPlain, sanitizeRichDocument, validateRichInput } from "../../src/lib/question-rich.mjs";
import { parseMathML } from "../../src/lib/question-math.mjs";

const p = (text) => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) });
const cell = (text, attrs = {}) => ({ type: "tableCell", attrs, content: [p(text)] });
const doc = (...nodes) => ({ type: "doc", content: nodes });

test("teks Arab berharakat dan multiline lama tetap utuh, bukan HTML", () => {
  const source = 'بِسْمِ اللّٰهِ\n<script>alert(1)</script> 123';
  const result = sanitizeRichDocument(legacyToRich(source));
  assert.equal(richToPlain(result), source);
  assert.equal(result.content[1].content[0].type, "text");
});

test("tabel dua kolom, penebalan dan rumus menghasilkan teks pencarian tanpa hilang", () => {
  const formula = parseMathML('<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><msqrt><mn>2</mn></msqrt></mfrac></math>');
  const input = doc({ type: "paragraph", attrs: { dir: "rtl", textAlign: "right" }, content: [
    { type: "text", text: "سُؤَالٌ", marks: [{ type: "bold" }] }, { type: "mathFormula", attrs: { formula } },
  ] }, { type: "table", content: [
    { type: "tableRow", content: [cell("Kolom 1"), cell("Kolom 2")] },
    { type: "tableRow", content: [cell("A"), cell("B")] },
  ] });
  const sanitized = sanitizeRichDocument(input);
  assert.equal(sanitized.content[0].attrs.dir, "rtl");
  assert.equal(sanitized.content[0].content[0].marks[0].type, "bold");
  assert.equal(richToPlain(sanitized), "سُؤَالٌ(1)/(√(2))\nKolom 1\tKolom 2\nA\tB");
  assert.equal(validateRichInput(JSON.stringify(input), 5000).plain, richToPlain(sanitized));
});

test("sel gabungan yang valid dipertahankan, bentuk tak beraturan ditolak", () => {
  const good = doc({ type: "table", content: [
    { type: "tableRow", content: [cell("A", { rowspan: 2, colspan: 1 }), cell("B")] },
    { type: "tableRow", content: [cell("C")] },
  ] });
  assert.equal(sanitizeRichDocument(good).content[0].content[0].content[0].attrs.rowspan, 2);
  const bad = doc({ type: "table", content: [
    { type: "tableRow", content: [cell("A"), cell("B")] },
    { type: "tableRow", content: [cell("C")] },
  ] });
  assert.throws(() => sanitizeRichDocument(bad), /tabel/i);
  const extendsBeyond = doc({ type: "table", content: [{ type: "tableRow", content: [cell("A", { rowspan: 2 })] }] });
  assert.throws(() => sanitizeRichDocument(extendsBeyond), /tabel/i);
});

test("menolak elemen, atribut, rumus, dan kontrol yang tidak diizinkan", () => {
  const attacks = [
    doc({ type: "script", content: [{ type: "text", text: "alert(1)" }] }),
    doc({ type: "paragraph", attrs: { dir: 'rtl" onmouseover="alert(1)' }, content: [{ type: "text", text: "x" }] }),
    doc({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }),
    doc({ type: "paragraph", content: [{ type: "mathFormula", attrs: { formula: { t: "math", c: [{ t: "script", c: ["alert(1)"] }] } } }] }),
    doc(p("x\u0000y")),
  ];
  for (const attack of attacks) assert.throws(() => sanitizeRichDocument(attack));
});

test("batas teks dan kompleksitas tetap diterapkan setelah decoding JSON", () => {
  assert.throws(() => validateRichInput(JSON.stringify(doc(p("😀".repeat(2001)))), 2000), /2000/);
  assert.throws(() => validateRichInput("{broken", 5000));
  assert.throws(() => sanitizeRichDocument(doc(...Array.from({ length: 2501 }, () => p("x")))));
  assert.throws(() => sanitizeRichDocument(doc({ type: "table", content: Array.from({ length: 31 }, () => ({ type: "tableRow", content: [cell("x")] })) })));
});
