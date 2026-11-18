import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { normalizeQuestionImage, QUESTION_IMAGE_MAX_BYTES } from "../../src/lib/question-image.mjs";

test("PNG dan JPEG valid diproses ulang, dan metadata dibuang", async () => {
  for (const type of ["png", "jpeg"]) {
    const source = await sharp({ create: { width: 20, height: 12, channels: 3, background: "#47aa88" } }).toFormat(type).withMetadata({ orientation: 6 }).toBuffer();
    const before = await sharp(source).metadata();
    assert.ok(before.exif);
    const result = await normalizeQuestionImage(source);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error(result.error);
    assert.equal(result.mime, type === "png" ? "image/png" : "image/jpeg");
    const metadata = await sharp(result.data).metadata();
    assert.equal(metadata.format, type);
    assert.equal(metadata.width, 12);
    assert.equal(metadata.height, 20);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.ok(result.data.length <= QUESTION_IMAGE_MAX_BYTES);
  }
});

test("menolak SVG, WebP, file rusak, dan gambar kosong atau terlalu besar", async () => {
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).webp().toBuffer();
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(QUESTION_IMAGE_MAX_BYTES + 1), Buffer.from('<svg onload="alert(1)"></svg>'), webp, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0xff, 0xd8, 0xff, 0x00])]) {
    assert.equal((await normalizeQuestionImage(bytes)).ok, false);
  }
});

test("menolak APNG animasi meski decoder hanya melaporkan frame pertama", async () => {
  // Dua frame fiktif, dibuat dengan Pillow; tidak perlu alat eksternal saat CI.
  const apng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAFAAAABQAAAAAAAAAAAAEACgAAOWtYUQAAABVJREFUeJxj/M/A8J8BDTChC1BBEADOqQIIHIR0VwAAABpmY1RMAAAAAQAAAAUAAAAFAAAAAAAAAAAAAQAKAACiGLKFAAAAGWZkQVQAAAACeJxjZGD4/58BDTChC1BBEADMqwIIUregcAAAAABJRU5ErkJggg==", "base64");
  const result = await normalizeQuestionImage(apng);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /animasi/);
});

test("menolak gambar melebihi batas dimensi atau delapan megapiksel meskipun file kecil", async () => {
  const tooWide = await sharp({ create: { width: 4001, height: 3, channels: 3, background: "white" } }).png().toBuffer();
  const tooManyPixels = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: "white" } }).png().toBuffer();
  assert.ok(tooWide.length < QUESTION_IMAGE_MAX_BYTES);
  assert.ok(tooManyPixels.length < QUESTION_IMAGE_MAX_BYTES);
  assert.equal((await normalizeQuestionImage(tooWide)).ok, false);
  assert.equal((await normalizeQuestionImage(tooManyPixels)).ok, false);
});
