import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { MAX_DOCX_QUESTIONS, readQuestionDocx } from "../../src/lib/question-docx.mjs";
import { buildQuestionDocx, QuestionDocxExportError } from "../../src/lib/question-docx-export.mjs";
import { convertOmml, mathmlToOmml } from "../../src/lib/question-math.mjs";
import { parseQuestionXml } from "../../src/lib/question-xml.mjs";

test("mathmlToOmml dan convertOmml melakukan round-trip pecahan, akar, pangkat, dan subskrip", () => {
  const formula = {
    t: "math",
    c: [
      {
        t: "mfrac",
        c: [
          { t: "msup", c: [{ t: "mi", c: ["x"] }, { t: "mn", c: ["2"] }] },
          { t: "msqrt", c: [{ t: "msub", c: [{ t: "mi", c: ["a"] }, { t: "mn", c: ["1"] }] }] },
        ],
      },
      { t: "mo", c: ["+"] },
      { t: "mroot", c: [{ t: "mn", c: ["8"] }, { t: "mn", c: ["3"] }] },
    ],
  };
  const omml = `<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${mathmlToOmml(formula)}</m:oMathPara>`;
  const roundTripped = convertOmml(parseQuestionXml(omml));
  assert.equal(roundTripped.t, "math");
  const tags = JSON.stringify(roundTripped);
  assert.match(tags, /"mfrac"/);
  assert.match(tags, /"msup"/);
  assert.match(tags, /"msqrt"/);
  assert.match(tags, /"msub"/);
  assert.match(tags, /"mroot"/);
});

test("buildQuestionDocx menghasilkan .docx yang dapat dibaca ulang persis oleh readQuestionDocx", async () => {
  const pngA = await sharp({
    create: { width: 90, height: 60, channels: 3, background: { r: 22, g: 130, b: 84 } },
  })
    .png()
    .toBuffer();
  const jpgB = await sharp({
    create: { width: 80, height: 50, channels: 3, background: { r: 60, g: 80, b: 190 } },
  })
    .jpeg()
    .toBuffer();

  const questions = [
    {
      topicName: "Matematika & Arab",
      promptText: "Hitung nilai pecahan dan kalimat berikut:",
      promptRich: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "left" },
            content: [
              { type: "text", text: "Hitung ", marks: [{ type: "bold" }] },
              {
                type: "mathFormula",
                attrs: {
                  formula: {
                    t: "math",
                    c: [{ t: "mfrac", c: [{ t: "mn", c: ["3"] }, { t: "mn", c: ["4"] }] }],
                  },
                },
              },
              { type: "text", text: " untuk x" },
              { type: "text", text: "2", marks: [{ type: "superscript" }] },
            ],
          },
          {
            type: "paragraph",
            attrs: { dir: "rtl" },
            content: [{ type: "text", text: "اِقْرَأْ بِاسْمِ رَبِّكَ" }],
          },
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  { type: "tableHeader", attrs: { colspan: 2, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Data" }] }] },
                ],
              },
              {
                type: "tableRow",
                content: [
                  { type: "tableCell", attrs: { colspan: 1, rowspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "X" }] }] },
                  { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "10" }] }] },
                ],
              },
              {
                type: "tableRow",
                content: [
                  { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "20" }] }] },
                ],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Butir satu" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Butir dua" }] }] },
            ],
          },
        ],
      },
      promptImage: pngA,
      promptImageMime: "image/png",
      options: [
        { text: "Opsi pertama", image: jpgB, imageMime: "image/jpeg" },
        { text: "Opsi kedua", image: jpgB, imageMime: "image/jpeg" },
        { text: "Opsi ketiga" },
        { text: "Opsi keempat" },
        { text: "Opsi kelima" },
      ],
      correctOption: "B",
    },
  ];

  const docxWithKeys = await buildQuestionDocx(questions, { title: "Uji Ekspor", includeKeys: true });
  const parsed = await readQuestionDocx(docxWithKeys);
  assert.equal(parsed.length, 1);
  const q = parsed[0];
  assert.equal(q.correctOption, "B");
  assert.ok(q.prompt.image);
  assert.ok(q.options[0].image);
  assert.ok(q.options[1].image);
  assert.deepEqual(q.options[0].image.data, q.options[1].image.data);
  assert.equal(q.options[2].image, null);
  assert.match(q.prompt.text, /Hitung/);
  assert.match(q.prompt.text, /اِقْرَأْ/);
  assert.match(q.prompt.text, /Butir satu/);
  assert.ok(q.prompt.rich.content.some((block) => block.type === "table"));

  // Ketika includeKeys: false, kunci tidak disisipkan ke kolom Jawaban
  const docxWithoutKeys = await buildQuestionDocx(questions, { title: "Tanpa Kunci", includeKeys: false });
  await assert.rejects(readQuestionDocx(docxWithoutKeys), /kolom Jawaban harus 0 atau 1/);
});

test("buildQuestionDocx menolak input kosong atau melebihi batas soal", async () => {
  await assert.rejects(buildQuestionDocx([]), QuestionDocxExportError);
  const one = {
    promptText: "Soal",
    options: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }, { text: "E" }],
    correctOption: "A",
  };
  await assert.rejects(buildQuestionDocx(Array(MAX_DOCX_QUESTIONS + 1).fill(one)), QuestionDocxExportError);
});
