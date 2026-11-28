import test from "node:test";
import assert from "node:assert/strict";

import {
  isPreviewIframeAuthEnabled,
  PREVIEW_ADMIN_HEADER,
  PREVIEW_PARTICIPANT_HEADER,
  resolvePreviewSessionToken,
} from "../../src/lib/preview-session-headers.mjs";

test("mode fallback header preview mati secara default", () => {
  assert.equal(PREVIEW_ADMIN_HEADER, "x-nusacbt-preview-admin");
  assert.equal(PREVIEW_PARTICIPANT_HEADER, "x-nusacbt-preview-participant");
  assert.equal(isPreviewIframeAuthEnabled({}), false);
  assert.equal(isPreviewIframeAuthEnabled({ NUSACBT_PREVIEW_IFRAME_AUTH: "false" }), false);
  assert.equal(isPreviewIframeAuthEnabled({ NUSACBT_PREVIEW_IFRAME_AUTH: "1" }), false);
  assert.equal(
    resolvePreviewSessionToken({
      cookieToken: undefined,
      headerToken: "abc123",
      env: {},
    }),
    undefined,
  );
  assert.equal(
    resolvePreviewSessionToken({
      cookieToken: undefined,
      headerToken: "abc123",
      env: { NUSACBT_PREVIEW_IFRAME_AUTH: "false" },
    }),
    undefined,
  );
});

test("cookie selalu diutamakan dibanding header meski mode preview aktif", () => {
  assert.equal(isPreviewIframeAuthEnabled({ NUSACBT_PREVIEW_IFRAME_AUTH: "true" }), true);
  assert.equal(
    resolvePreviewSessionToken({
      cookieToken: "cookie-token-1",
      headerToken: "header-token-2",
      env: { NUSACBT_PREVIEW_IFRAME_AUTH: "true" },
    }),
    "cookie-token-1",
  );
});

test("fallback header aktif hanya saat mode preview true dan ukuran token wajar", () => {
  const env = { NUSACBT_PREVIEW_IFRAME_AUTH: "true" };
  assert.equal(
    resolvePreviewSessionToken({ cookieToken: "", headerToken: "preview-token-ok", env }),
    "preview-token-ok",
  );
  assert.equal(
    resolvePreviewSessionToken({ cookieToken: null, headerToken: "", env }),
    undefined,
  );
  assert.equal(
    resolvePreviewSessionToken({ cookieToken: undefined, headerToken: "a".repeat(129), env }),
    undefined,
  );
});
