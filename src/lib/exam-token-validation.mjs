import { validDataId } from "./class-validation.mjs";
import { validTopicRevision } from "./topic-validation.mjs";

export const EXAM_TOKEN_DURATIONS = [5, 15, 30, 60, 120, 360, 1440];
export const EXAM_TOKEN_FORM_VERSION = "access-token-v2";

/** @param {unknown} value @returns {string | null} */
export function validTokenOperationId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * @param {{operationId: unknown, scope: unknown, testId: unknown, testRevision: unknown, durationMinutes: unknown, expectedTokenId: unknown, replaceConfirmed: unknown}} input
 * @returns {{ok: true, value: {operationId: string, scope: "global" | "test", testId: string | null, testRevision: string | null, durationMinutes: number, expectedTokenId: string | null, replaceConfirmed: boolean}} | {ok: false, error: string}}
 */
export function validateExamTokenCreation(input) {
  const operationId = validTokenOperationId(input.operationId);
  if (!operationId) return { ok: false, error: "Identitas permintaan tidak valid. Muat ulang halaman." };
  if (input.scope !== "global" && input.scope !== "test") return { ok: false, error: "Pilih cakupan token yang valid." };
  const scope = input.scope;
  let testId = null;
  let testRevision = null;
  if (scope === "test") {
    testId = validDataId(input.testId);
    testRevision = validTopicRevision(input.testRevision);
    if (!testId || !testRevision) return { ok: false, error: "Pilih tes yang valid dan muat ulang daftar bila tes berubah." };
  } else if ((input.testId !== null && input.testId !== "") || (input.testRevision !== null && input.testRevision !== "")) {
    return { ok: false, error: "Token global tidak boleh memuat identitas tes." };
  }
  if (typeof input.durationMinutes !== "string" || !/^[1-9]\d{0,3}$/.test(input.durationMinutes)) return { ok: false, error: "Pilih masa aktif yang tersedia." };
  const durationMinutes = Number(input.durationMinutes);
  if (!EXAM_TOKEN_DURATIONS.includes(durationMinutes)) return { ok: false, error: "Pilih masa aktif yang tersedia." };
  let expectedTokenId = null;
  if (input.expectedTokenId !== "none") {
    expectedTokenId = validDataId(input.expectedTokenId);
    if (!expectedTokenId) return { ok: false, error: "Status token belum lengkap. Muat ulang daftar." };
  }
  if (input.replaceConfirmed !== null && input.replaceConfirmed !== "1") return { ok: false, error: "Konfirmasi penggantian token tidak valid." };
  return { ok: true, value: { operationId, scope, testId, testRevision, durationMinutes, expectedTokenId, replaceConfirmed: input.replaceConfirmed === "1" } };
}

/**
 * @param {{ enabled: unknown, durationMinutes: unknown }} input
 * @returns {{ ok: true, value: { enabled: boolean, durationMinutes: number } } | { ok: false, error: string }}
 */
export function validateGlobalAutoRotate(input) {
  if (input.enabled !== "1" && input.enabled !== "0") {
    return { ok: false, error: "Status auto-generate tidak valid." };
  }
  if (typeof input.durationMinutes !== "string" || !/^[1-9]\d{0,3}$/.test(input.durationMinutes)) {
    return { ok: false, error: "Pilih durasi token global yang tersedia." };
  }
  const durationMinutes = Number(input.durationMinutes);
  if (!EXAM_TOKEN_DURATIONS.includes(durationMinutes)) {
    return { ok: false, error: "Pilih durasi token global yang tersedia." };
  }
  return { ok: true, value: { enabled: input.enabled === "1", durationMinutes } };
}
