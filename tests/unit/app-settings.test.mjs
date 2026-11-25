import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { normalizeBrandingImage } from "../../src/lib/app-settings-image.mjs";
import { isValidPalette, validateAppSettingsInput } from "../../src/lib/app-settings-validation.mjs";

test("validateAppSettingsInput membersihkan spasi, merapikan baris baru, dan memvalidasi palet", () => {
  const result = validateAppSettingsInput({
    appName: "  NusaCBT   Sekolah ",
    appDescription: "  Platform   ujian lokal  ",
    schoolName: "  SMA   Nusantara 1  ",
    participantInfo: " Baris 1\r\n  Baris 2  ",
    colorPalette: "indigo",
    revision: "4",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.appName, "NusaCBT Sekolah");
    assert.equal(result.value.appDescription, "Platform ujian lokal");
    assert.equal(result.value.schoolName, "SMA Nusantara 1");
    assert.equal(result.value.participantInfo, "Baris 1\n  Baris 2");
    assert.equal(result.value.colorPalette, "indigo");
    assert.equal(result.value.revision, "4");
  }
  assert.equal(isValidPalette("emerald"), true);
  assert.equal(isValidPalette("pink"), false);
});

test("validateAppSettingsInput menolak nama aplikasi kosong, palet tidak valid, karakter kontrol, dan revisi buruk", () => {
  assert.equal(
    validateAppSettingsInput({
      appName: "   ",
      appDescription: "",
      schoolName: "Sekolah",
      participantInfo: "",
      colorPalette: "emerald",
      revision: "1",
    }).ok,
    false,
  );
  assert.equal(
    validateAppSettingsInput({
      appName: "NusaCBT",
      appDescription: "",
      schoolName: "Sekolah",
      participantInfo: "",
      colorPalette: "pink",
      revision: "1",
    }).ok,
    false,
  );
  assert.equal(
    validateAppSettingsInput({
      appName: "NusaCBT\x00",
      appDescription: "",
      schoolName: "Sekolah",
      participantInfo: "",
      colorPalette: "emerald",
      revision: "1",
    }).ok,
    false,
  );
  assert.equal(
    validateAppSettingsInput({
      appName: "NusaCBT",
      appDescription: "",
      schoolName: "Sekolah",
      participantInfo: "",
      colorPalette: "emerald",
      revision: "abc",
    }).ok,
    false,
  );
  const devMode = validateAppSettingsInput({
    appName: "NusaCBT",
    appDescription: "",
    schoolName: "Sekolah",
    participantInfo: "",
    colorPalette: "emerald",
    appMode: "dev",
    timelineDefaultDays: "3",
    revision: "5",
  });
  assert.equal(devMode.ok, true);
  if (devMode.ok) {
    assert.equal(devMode.value.appMode, "dev");
    assert.equal(devMode.value.timelineDefaultDays, 3);
  }
  assert.equal(
    validateAppSettingsInput({
      appName: "NusaCBT",
      appDescription: "",
      schoolName: "Sekolah",
      participantInfo: "",
      colorPalette: "emerald",
      appMode: "staging",
      timelineDefaultDays: "3",
      revision: "5",
    }).ok,
    false,
  );
  assert.equal(
    validateAppSettingsInput({
      appName: "NusaCBT",
      appDescription: "",
      schoolName: "Sekolah",
      participantInfo: "",
      colorPalette: "emerald",
      appMode: "production",
      timelineDefaultDays: "8",
      revision: "5",
    }).ok,
    false,
  );
  assert.equal(
    validateAppSettingsInput({
      appName: "NusaCBT",
      appDescription: "",
      schoolName: "Sekolah",
      participantInfo: "",
      colorPalette: "emerald",
      appMode: "production",
      timelineDefaultDays: "0",
      revision: "5",
    }).ok,
    false,
  );
});

test("normalizeBrandingImage menerima PNG/JPEG statis dan menolak SVG atau berkas melebihi batas", async () => {
  const png = await sharp({
    create: { width: 120, height: 120, channels: 4, background: { r: 29, g: 138, b: 92, alpha: 0.8 } },
  })
    .png()
    .toBuffer();
  const normalizedLogo = await normalizeBrandingImage(png, "logo");
  assert.equal(normalizedLogo.ok, true);
  if (normalizedLogo.ok) {
    assert.equal(normalizedLogo.mime, "image/png");
    assert.ok(normalizedLogo.data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  }

  const jpg = await sharp({
    create: { width: 800, height: 200, channels: 3, background: { r: 245, g: 245, b: 245 } },
  })
    .jpeg()
    .toBuffer();
  const normalizedHeader = await normalizeBrandingImage(jpg, "letterhead");
  assert.equal(normalizedHeader.ok, true);
  if (normalizedHeader.ok) {
    assert.equal(normalizedHeader.mime, "image/jpeg");
    assert.equal(normalizedHeader.data[0], 0xff);
    assert.equal(normalizedHeader.data[1], 0xd8);
  }

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgResult = await normalizeBrandingImage(svg, "logo");
  assert.equal(svgResult.ok, false);

  const huge = Buffer.alloc(1_048_577, 0xff);
  const hugeResult = await normalizeBrandingImage(huge, "logo");
  assert.equal(hugeResult.ok, false);
});
