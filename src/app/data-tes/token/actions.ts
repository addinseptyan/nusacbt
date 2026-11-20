"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { TOKEN_TEST_ELIGIBLE } from "@/app/data-tes/token/token-schedule-sql";
import { lockActiveAdminSession, requireAdmin } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { EXAM_TOKEN_ADVISORY_LOCK } from "@/lib/exam-token-constants.mjs";
import { digestSixDigitToken, encryptSixDigitToken, generateSixDigitToken } from "@/lib/exam-token-crypto.mjs";
import { ExamTokenKeyProblem, lockTokenKeyBinding, readConfiguredTokenKey } from "@/lib/exam-token-key";
import type { IssueTokenResult, ResolveTokenIssueResult, RevokeTokenResult } from "@/lib/exam-token-types";
import { EXAM_TOKEN_FORM_VERSION, validTokenOperationId, validateExamTokenCreation } from "@/lib/exam-token-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { validTopicRevision } from "@/lib/topic-validation.mjs";

// Semua mutasi token dan mulai attempt memakai advisory lock yang sama.
// Jika juga mengunci tes, urutannya adalah baris tes lalu advisory lock.
class TokenProblem extends Error {
  constructor(message: string, readonly reload = false, readonly uncertain = false) { super(message); }
}
function hasSqlState(error: unknown, ...codes: string[]) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

async function lockUnusedTokenOperation(client: PoolClient, operationId: string) {
  await client.query("SELECT pg_advisory_xact_lock($1)", [EXAM_TOKEN_ADVISORY_LOCK]);
  const previous = await client.query("SELECT 1 FROM exam_token_issue_operations WHERE operation_id=$1::uuid", [operationId]);
  if (previous.rowCount) throw new TokenProblem("Permintaan ini sudah diselesaikan. Periksa hasilnya sebelum melanjutkan.", true, true);
}

export async function issueExamToken(formData: FormData): Promise<IssueTokenResult> {
  await requireAdmin();
  const fields = ["operationId", "formVersion", "scope", "testId", "testRevision", "durationMinutes", "expectedTokenId", "replaceConfirmed"];
  if (fields.some((field) => formData.getAll(field).length > 1)) return { ok: false, error: "Data token mengandung nilai ganda. Periksa formulir dan coba lagi." };
  if (formData.get("formVersion") !== EXAM_TOKEN_FORM_VERSION) return { ok: false, error: "Versi formulir tidak sesuai. Muat ulang daftar.", reload: true };
  const parsed = validateExamTokenCreation({
    operationId: formData.get("operationId"), scope: formData.get("scope"), testId: formData.get("testId"), testRevision: formData.get("testRevision"), durationMinutes: formData.get("durationMinutes"),
    expectedTokenId: formData.get("expectedTokenId"), replaceConfirmed: formData.get("replaceConfirmed"),
  });
  if (!parsed.ok) return parsed;
  const draft = parsed.value;
  let client: PoolClient | undefined;
  let key: Buffer | undefined;
  let issued: { code: string; issuedAt: string; expiresAt: string; testName: string | null } | undefined;
  try {
    key = await readConfiguredTokenKey();
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new TokenProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    let testName: string | null = null;
    if (draft.scope === "test") {
      // Kunci tes sebelum advisory token, sama seperti mulai attempt. Baris
      // tetap terkunci sehingga identitas dan revisinya tidak berubah.
      const test = await client.query<{ name: string; revision: string; eligible: boolean }>(`SELECT t.name, t.xmin::text AS revision, ${TOKEN_TEST_ELIGIBLE} AS eligible FROM exam_tests t WHERE t.id=$1::bigint FOR SHARE OF t`, [draft.testId]);
      if (!test.rowCount || test.rows[0].revision !== draft.testRevision || !test.rows[0].eligible) {
        // Walau tes sudah berubah/hilang, operasi lama mungkin baru saja
        // berhasil. Tunggu penyelesaiannya dan cek pagar sebelum menyimpulkan.
        await lockUnusedTokenOperation(client, draft.operationId);
        throw new TokenProblem(!test.rowCount || test.rows[0].revision !== draft.testRevision
          ? "Tes sudah berubah atau dihapus. Muat ulang daftar sebelum membuat token."
          : "Jadwal tes sudah berakhir. Muat ulang daftar sebelum membuat token.", true);
      }
      testName = test.rows[0].name;
    }
    // Pagar diperiksa di bawah lock bahkan ketika tes valid; replay yang
    // bersamaan harus menunggu hasil transaksi pertama.
    await lockUnusedTokenOperation(client, draft.operationId);
    await lockTokenKeyBinding(client, key);
    const current = await client.query<{ id: string; active: boolean }>(
      `SELECT id::text AS id, expires_at > clock_timestamp() AS active FROM exam_access_tokens
       WHERE scope=$1 AND (($1='global' AND exam_test_id IS NULL) OR ($1='test' AND exam_test_id=$2::bigint))
         AND revoked_at IS NULL FOR UPDATE`, [draft.scope, draft.testId],
    );
    const existing = current.rows[0] ?? null;
    if ((existing?.id ?? null) !== draft.expectedTokenId) throw new TokenProblem("Status token sudah berubah. Muat ulang daftar dan periksa kembali sebelum membuat token.", true);
    if (existing?.active && !draft.replaceConfirmed) throw new TokenProblem("Konfirmasi penggantian token aktif diperlukan. Muat ulang status dan periksa kembali.", true);
    if (existing) {
      await client.query("UPDATE exam_access_tokens SET revoked_at=clock_timestamp(), revoked_reason='replaced', revoked_by_admin_id=$2::bigint WHERE id=$1::bigint", [existing.id, admin.id]);
    }
    let code = ""; let hash: Buffer | undefined;
    // Hindari tabrakan dengan semua slot yang belum ditutup dan kode yang baru
    // digunakan dalam 7 hari, tetapi jangan habiskan ruang 1 juta kode selamanya.
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = generateSixDigitToken(); const candidateHash = digestSixDigitToken(candidate, key);
      const collision = await client.query<{ present: boolean }>("SELECT EXISTS(SELECT 1 FROM exam_access_tokens WHERE token_hash=$1 AND (revoked_at IS NULL OR issued_at > clock_timestamp()-interval '7 days')) AS present", [candidateHash]);
      if (!collision.rows[0].present) { code = candidate; hash = candidateHash; break; }
    }
    if (!hash) throw new TokenProblem("Kode baru belum dapat dibuat tanpa benturan. Coba lagi nanti.");
    // Ambil ID terlebih dahulu agar ciphertext diikat ke ID dan scope; riwayat
    // tetap dapat dibuka walau tesnya kemudian dihapus (FK menjadi NULL).
    const allocated = await client.query<{ id: string }>("SELECT nextval(pg_get_serial_sequence('exam_access_tokens','id'))::text AS id");
    const id = allocated.rows[0].id; const encrypted = encryptSixDigitToken(code, key, { id, scope: draft.scope });
    const result = await client.query<{ id: string; issuedAt: Date; expiresAt: Date }>(
      `WITH moment AS (SELECT clock_timestamp() AS issued)
       INSERT INTO exam_access_tokens(id,scope,exam_test_id,test_name_snapshot,token_hash,duration_minutes,issued_at,expires_at,created_by_admin_id,code_version,code_nonce,code_ciphertext,code_tag)
       OVERRIDING SYSTEM VALUE
       SELECT $1::bigint,$2,$3::bigint,$4,$5,$6,issued,issued + $6::integer * interval '1 minute',$7::bigint,2,$8,$9,$10 FROM moment
       RETURNING id::text AS id, issued_at AS "issuedAt", expires_at AS "expiresAt"`,
      [id, draft.scope, draft.testId, testName, hash, draft.durationMinutes, admin.id, encrypted.nonce, encrypted.ciphertext, encrypted.tag],
    );
    await client.query("INSERT INTO exam_token_issue_operations(operation_id,result,token_id) VALUES($1::uuid,'issued',$2::bigint)", [draft.operationId, result.rows[0].id]);
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new TokenProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    const stillValid = await client.query<{ active: boolean }>("SELECT expires_at > clock_timestamp() AS active FROM exam_access_tokens WHERE id=$1::bigint", [result.rows[0].id]);
    if (!stillValid.rows[0]?.active) throw new TokenProblem("Masa token sudah berakhir saat penyimpanan. Muat ulang daftar dan coba lagi.", true);
    if (draft.scope === "test") {
      const eligible = await client.query<{ yes: boolean }>(`SELECT ${TOKEN_TEST_ELIGIBLE} AS yes FROM exam_tests t WHERE t.id=$1::bigint`, [draft.testId]);
      if (!eligible.rows[0]?.yes) throw new TokenProblem("Jadwal tes sudah berakhir saat penyimpanan. Muat ulang daftar.", true);
    }
    await client.query("COMMIT");
    issued = { code, issuedAt: result.rows[0].issuedAt.toISOString(), expiresAt: result.rows[0].expiresAt.toISOString(), testName };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof TokenProblem) return { ok: false, error: error.message, reload: error.reload, uncertain: error.uncertain };
    if (error instanceof ExamTokenKeyProblem) return { ok: false, error: error.message, reload: true };
    if (hasSqlState(error, "23505", "23503", "23001")) return { ok: false, error: "Token atau tes berubah bersamaan. Muat ulang daftar dan periksa kembali.", reload: true };
    return { ok: false, error: "Hasil pembuatan token belum dapat dipastikan. Periksa dan amankan permintaan sebelum membuat token lain.", uncertain: true };
  } finally { key?.fill(0); client?.release(); }
  revalidatePath("/data-tes/token");
  return { ok: true, ...issued, scope: draft.scope };
}

// Menyelesaikan hasil tak pasti dengan pagar persisten. Jika pembuatan sudah
// commit, laporkan identitas token (bukan kodenya). Jika belum, catat
// pembatalan di bawah kunci yang sama: request lama yang datang terlambat
// tidak boleh membuat token. Operasi ini boleh diulang bila respons hilang.
export async function resolveUncertainTokenIssue(formData: FormData): Promise<ResolveTokenIssueResult> {
  await requireAdmin();
  const operationId = formData.getAll("operationId").length === 1 ? validTokenOperationId(formData.get("operationId")) : null;
  if (!operationId) return { ok: false, error: "Identitas permintaan tidak valid; jangan membuat token lain sebelum memeriksa status." };
  let client: PoolClient | undefined;
  let resolved: { outcome: "issued" | "cancelled"; tokenId: string | null } | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new TokenProblem("Sesi admin sudah berakhir. Masuk kembali untuk memeriksa permintaan.");
    await client.query("SELECT pg_advisory_xact_lock($1)", [EXAM_TOKEN_ADVISORY_LOCK]);
    await client.query("INSERT INTO exam_token_issue_operations(operation_id,result) VALUES($1::uuid,'cancelled') ON CONFLICT (operation_id) DO NOTHING", [operationId]);
    const result = await client.query<{ outcome: "issued" | "cancelled"; tokenId: string | null }>(
      "SELECT result AS outcome, token_id::text AS \"tokenId\" FROM exam_token_issue_operations WHERE operation_id=$1::uuid", [operationId],
    );
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new TokenProblem("Sesi admin sudah berakhir. Masuk kembali untuk memeriksa permintaan.");
    await client.query("COMMIT");
    resolved = result.rows[0];
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof TokenProblem) return { ok: false, error: error.message };
    return { ok: false, error: "Belum dapat memastikan hasil. Periksa sambungan dan coba periksa lagi; jangan membuat token lain dahulu." };
  } finally { client?.release(); }
  revalidatePath("/data-tes/token");
  return { ok: true, ...resolved };
}

export async function revokeExamToken(formData: FormData): Promise<RevokeTokenResult> {
  await requireAdmin();
  if (["id", "revision", "confirmed"].some((field) => formData.getAll(field).length !== 1) || formData.get("confirmed") !== "1") {
    return { ok: false, error: "Identitas atau konfirmasi token tidak valid. Muat ulang daftar.", reload: true };
  }
  const id = validDataId(formData.get("id"));
  const revision = validTopicRevision(formData.get("revision"));
  if (!id || !revision) return { ok: false, error: "Identitas atau versi token tidak valid. Muat ulang daftar.", reload: true };
  let client: PoolClient | undefined;
  try {
    client = await getPostgresPool().connect();
    await client.query("BEGIN");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new TokenProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    await client.query("SELECT pg_advisory_xact_lock($1)", [EXAM_TOKEN_ADVISORY_LOCK]);
    const result = await client.query<{ revision: string; active: boolean; scope: "global" | "test"; testId: string | null; revokedAt: Date | null }>(
      `SELECT xmin::text AS revision, expires_at > clock_timestamp() AS active, scope, exam_test_id::text AS "testId", revoked_at AS "revokedAt"
       FROM exam_access_tokens WHERE id=$1::bigint FOR UPDATE`, [id],
    );
    const current = result.rows[0];
    if (!current || current.revision !== revision || current.revokedAt || !current.active || (current.scope === "test" && !current.testId)) {
      throw new TokenProblem("Token sudah berubah atau tidak aktif. Muat ulang daftar.", true);
    }
    await client.query("UPDATE exam_access_tokens SET revoked_at=clock_timestamp(), revoked_reason='manual', revoked_by_admin_id=$2::bigint WHERE id=$1::bigint", [id, admin.id]);
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new TokenProblem("Sesi admin sudah berakhir. Masuk kembali sebelum melanjutkan.");
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof TokenProblem) return { ok: false, error: error.message, reload: error.reload };
    return { ok: false, error: "Hasil pencabutan belum dapat dipastikan. Muat ulang status sebelum mencoba lagi.", reload: true };
  } finally { client?.release(); }
  revalidatePath("/data-tes/token");
  return { ok: true, message: "Token berhasil dicabut." };
}
