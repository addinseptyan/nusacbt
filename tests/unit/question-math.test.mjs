import test from "node:test";
import assert from "node:assert/strict";
import { convertOmml, formulaDomSpec, mathToText, parseMathML, sanitizeFormula } from "../../src/lib/question-math.mjs";
import { parseQuestionXml } from "../../src/lib/question-xml.mjs";

const NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const wrapped = (inside) => `<m:oMath xmlns:m="${NS}">${inside}</m:oMath>`;
const r = (text) => `<m:r><m:t>${text}</m:t></m:r>`;
const rad = (text) => `<m:rad><m:radPr><m:degHide m:val="on"/></m:radPr><m:deg/><m:e>${r(text)}</m:e></m:rad>`;

test("MathML ber-prefiks seperti clipboard Word: pecahan dan akar", () => {
  const input = '<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><mml:mfrac><mml:mrow><mml:msqrt><mml:mn>32</mml:mn></mml:msqrt><mml:mo>+</mml:mo><mml:mn>2</mml:mn><mml:msqrt><mml:mn>18</mml:mn></mml:msqrt></mml:mrow><mml:msqrt><mml:mn>8</mml:mn></mml:msqrt></mml:mfrac></mml:math>';
  const tree = parseMathML(input);
  assert.equal(mathToText(tree), "(√(32)+2√(18))/(√(8))");
  assert.equal(formulaDomSpec(tree)[0], "http://www.w3.org/1998/Math/MathML math");
});

test("MathML Word mfenced diperluas agar tanda kurung tampil di browser modern", () => {
  const copied = '<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML"><mml:msqrt><mml:mfenced open="[" close="]" separators="|"><mml:mi>a</mml:mi><mml:mi>b</mml:mi><mml:mi>c</mml:mi></mml:mfenced></mml:msqrt></mml:math>';
  const formula = parseMathML(copied);
  assert.equal(mathToText(formula), "√([a|b|c])");
  assert.equal(formula.c[0].c[0].t, "mrow");
  const withAnnotation = '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mfrac><mn>1</mn><mn>2</mn></mfrac><annotation encoding="application/x-tex">1/2</annotation></semantics></math>';
  assert.equal(mathToText(parseMathML(withAnnotation)), "(1)/(2)");
  assert.throws(() => parseMathML('<math><semantics><mn>1</mn><mn>2</mn></semantics></math>'));
});

test("OMML pecahan bertingkat, akar, pangkat dan subskrip dikonversi", () => {
  const formula = wrapped(`<m:f><m:num>${rad("32")}${r("+2")}${rad("18")}</m:num><m:den>${rad("8")}</m:den></m:f>`);
  assert.equal(mathToText(convertOmml(parseQuestionXml(formula))), "(√(32)+2√(18))/(√(8))");
  const power = wrapped(`<m:sSubSup><m:e>${r("x")}</m:e><m:sub>${r("1")}</m:sub><m:sup>${r("2")}</m:sup></m:sSubSup>`);
  assert.equal(mathToText(convertOmml(parseQuestionXml(power))), "x_(1)^(2)");
  const root = wrapped(`<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr><m:deg>${r("3")}</m:deg><m:e>${r("8")}</m:e></m:rad>`);
  assert.equal(mathToText(convertOmml(parseQuestionXml(root))), "root[3](8)");
});

test("properti run dan ctrlPr seperti dokumen Word nyata tidak membuang pecahan", () => {
  const word = `<m:oMath xmlns:m="${NS}" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><m:r><w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr><m:t>x</m:t></m:r>${r("=")}<m:f><m:fPr><m:ctrlPr><w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr></m:ctrlPr></m:fPr><m:num>${r("-b±")}<m:rad><m:radPr><m:degHide m:val="1"/><m:ctrlPr/></m:radPr><m:deg/><m:e><m:sSup><m:e>${r("b")}</m:e><m:sup>${r("2")}</m:sup></m:sSup>${r("-4ac")}</m:e></m:rad></m:num><m:den>${r("2a")}</m:den></m:f></m:oMath>`;
  assert.equal(mathToText(convertOmml(parseQuestionXml(word))), "x=(-b±√(b^(2)-4ac))/(2a)");
});

test("teks Arab berharakat dan angka Arab-Indic dalam equation tetap menyatu", () => {
  const formula = convertOmml(parseQuestionXml(wrapped(r("سُؤَالٌ ١٢+٣"))));
  assert.equal(mathToText(formula), "سُؤَالٌ ١٢+٣");
  assert.equal(formula.c[0].t, "mi");
  assert.equal(formula.c[0].c[0], "سُؤَالٌ");
  assert.equal(formula.c[2].t, "mn");
  const adjacent = convertOmml(parseQuestionXml(wrapped(r("سُ١٢"))));
  assert.deepEqual(adjacent.c.map((token) => token.t), ["mi", "mn"]);
});

test("OMML yang berisi struktur tidak didukung atau konten tersembunyi ditolak", () => {
  const unsupported = [
    wrapped(`<m:phant><m:e>${r("1")}</m:e></m:phant>`),
    wrapped(`<m:f><m:num>${r("1")}</m:num><m:den>${r("2")}</m:den><m:phant><m:e>${r("3")}</m:e></m:phant></m:f>`),
    wrapped(`<m:f><m:num>${r("1")}</m:num><m:den>${r("2")}</m:den><m:den>${r("3")}</m:den></m:f>`),
    wrapped(`<m:f><m:fPr><m:type m:val="bar"><m:phant>${r("3")}</m:phant></m:type></m:fPr><m:num>${r("1")}</m:num><m:den>${r("2")}</m:den></m:f>`),
    wrapped(`<m:r><m:t>1<m:phant>${r("3")}</m:phant></m:t></m:r>`),
    wrapped(`<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr><m:deg/><m:e>${r("2")}</m:e></m:rad>`),
  ];
  for (const xml of unsupported) assert.throws(() => convertOmml(parseQuestionXml(xml)));
});

test("MathML/JSON tidak dapat membawa script, event, URL, DTD, atau tag HTML", () => {
  const inputs = [
    '<math><script>alert(1)</script></math>',
    '<math><mi onclick="alert(1)">x</mi></math>',
    '<math><mi href="https://example.invalid">x</mi></math>',
    '<!DOCTYPE math [<!ENTITY x "evil">]><math><mi>&x;</mi></math>',
    '<math><mfrac><mn>1</mn><mn>2</mn><mn>3</mn></mfrac></math>',
    '<math><mi>x</mi><svg><script>alert(1)</script></svg></math>',
  ];
  for (const input of inputs) assert.throws(() => parseMathML(input));
  assert.throws(() => sanitizeFormula({ t: "math", c: [{ t: "mi", a: { style: "color:red" }, c: ["x"] }] }));
});
