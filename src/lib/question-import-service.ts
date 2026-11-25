import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, PERMISSION_DENIED_MESSAGE } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";
import { MAX_DOCX_BYTES, QuestionDocxError, readQuestionDocx } from "@/lib/question-docx.mjs";
import type { QuestionImportPreview } from "@/lib/question-import-types";

import { formatTopicLabel } from "@/lib/topic-validation.mjs";

class ImportProblem extends Error {}
type ParsedQuestion = Awaited<ReturnType<typeof readQuestionDocx>>[number];
type Upload = { topicId: string; fileHash: string; questions: ParsedQuestion[] };
type Topic = { id: string; name: string; tags: string[] };

async function readUpload(form: FormData): Promise<Upload> {
  if (["topicId", "file"].some((key) => form.getAll(key).length !== 1)) throw new ImportProblem("Kategori atau file ganda/tidak valid.");
  const topicId = validDataId(form.get("topicId"));
  if (!topicId) throw new ImportProblem("Pilih topik atau mata pelajaran yang valid.");
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".docx")) throw new ImportProblem("Pilih file Word .docx dari template NusaCBT.");
  if (!file.size || file.size > MAX_DOCX_BYTES) throw new ImportProblem("Ukuran file harus lebih dari 0 dan maksimal 6 MiB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > MAX_DOCX_BYTES) throw new ImportProblem("File tidak dapat dibaca atau terlalu besar.");
  const questions = await readQuestionDocx(bytes);
  return { topicId, fileHash: createHash("sha256").update(bytes).digest("hex"), questions };
}

function requestHash(adminId: string, upload: Upload, operationId: string) {
  // A category's identity is its ID, not its mutable name. A rename must not
  // prevent recovery of a successful import after its response was lost.
  return createHash("sha256").update(JSON.stringify({ schema: 2, adminId, fileHash: upload.fileHash, topicId: upload.topicId, operationId })).digest("hex");
}

async function selectTopic(client: PoolClient, id: string, lock: boolean): Promise<Topic> {
  const result = await client.query<Topic>(`SELECT id::text AS id, name, tags FROM question_topics WHERE id=$1::bigint ${lock ? "FOR SHARE" : ""}`, [id]);
  if (!result.rows[0]) throw new ImportProblem("Kategori tidak ditemukan atau sudah dihapus. Muat ulang halaman.");
  return result.rows[0];
}

function previewPart(part: ParsedQuestion["prompt"]) {
  return { text: part.text, rich: part.rich, imageUrl: part.image ? `data:${part.image.mime};base64,${part.image.data.toString("base64")}` : null };
}

export async function previewQuestionImport(form: FormData, adminId: string): Promise<QuestionImportPreview> {
  const upload = await readUpload(form);
  const client = await getPostgresPool().connect();
  try {
    const topic = await selectTopic(client, upload.topicId, false);
    const operationId = randomUUID();
    return {
      operationId, topicId: topic.id, topicName: formatTopicLabel(topic),
      token: requestHash(adminId, upload, operationId),
      questions: upload.questions.map((question) => ({
        number: question.number, prompt: previewPart(question.prompt), options: question.options.map(previewPart), correctOption: question.correctOption,
      })),
    };
  } finally { client.release(); }
}

async function insertQuestion(client: PoolClient, topicId: string, question: ParsedQuestion) {
  const parts = [question.prompt, ...question.options];
  const prefixes = ["prompt", "option_a", "option_b", "option_c", "option_d", "option_e"];
  const columns = ["topic_id", "correct_option"];
  const values: unknown[] = [topicId, question.correctOption];
  for (const [index, part] of parts.entries()) {
    columns.push(`${prefixes[index]}_text`, `${prefixes[index]}_rich`, `${prefixes[index]}_image`, `${prefixes[index]}_image_mime`);
    values.push(part.text, JSON.stringify(part.rich), part.image?.data ?? null, part.image?.mime ?? null);
  }
  const placeholders = values.map((_, index) => `$${index + 1}`);
  await client.query(`INSERT INTO question_bank (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`, values);
}

export async function applyQuestionImport(form: FormData, adminId: string) {
  if (["previewToken", "operationId"].some((key) => form.getAll(key).length !== 1)) throw new ImportProblem("Pratinjau tidak valid; periksa ulang file.");
  const expected = form.get("previewToken");
  const operationId = form.get("operationId");
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected) || typeof operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) throw new ImportProblem("Pratinjau tidak valid; periksa ulang file.");
  const upload = await readUpload(form);
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== adminId) throw new ImportProblem("Sesi admin sudah berakhir. Masuk kembali dan periksa ulang file.");
    if (!adminHasPermission(active, "questions.import")) throw new ImportProblem(PERMISSION_DENIED_MESSAGE);
    if (requestHash(adminId, upload, operationId) !== expected) throw new ImportProblem("File atau kategori berbeda dari pratinjau. Jika pernah menekan Simpan, periksa Manajemen Soal sebelum membuat pratinjau baru.");
    async function previousResult() {
      const previous = await client.query<{ request_hash: string; admin_id: string | null; question_count: number }>(
        "SELECT request_hash,admin_id::text AS admin_id,question_count FROM question_import_batches WHERE operation_id=$1::uuid FOR SHARE", [operationId],
      );
      const row = previous.rows[0];
      if (!row) return null;
      if (row.request_hash !== expected || row.admin_id !== adminId || row.question_count !== upload.questions.length) throw new ImportProblem("Pratinjau impor tidak cocok dengan hasil yang sudah ada.");
      return row;
    }
    // Check an already committed operation before looking up the category. Even
    // if its name changed (or the category was later removed), a retry must not
    // claim that the earlier COMMIT did not happen or insert duplicates.
    let previous = await previousResult();
    if (previous) {
      const stillActive = await lockActiveAdminSession(client);
      if (!stillActive || stillActive.id !== adminId) throw new ImportProblem("Sesi admin telah berakhir. Masuk kembali untuk memeriksa hasil impor.");
      await client.query("COMMIT");
      return { count: previous.question_count, alreadySaved: true };
    }
    const topic = await selectTopic(client, upload.topicId, true);
    const batch = await client.query(
      `INSERT INTO question_import_batches (operation_id, topic_id, admin_id, request_hash, question_count)
       VALUES ($1::uuid,$2::bigint,$3::bigint,$4,$5) ON CONFLICT (operation_id) DO NOTHING RETURNING operation_id`,
      [operationId, topic.id, adminId, expected, upload.questions.length],
    );
    if (!batch.rowCount) {
      // A concurrent request with this ID may have committed while INSERT waited.
      previous = await previousResult();
      if (!previous) throw new ImportProblem("Pratinjau impor tidak cocok dengan hasil yang sudah ada.");
      const stillActive = await lockActiveAdminSession(client);
      if (!stillActive || stillActive.id !== adminId) throw new ImportProblem("Sesi admin telah berakhir. Masuk kembali untuk memeriksa hasil impor.");
      await client.query("COMMIT");
      return { count: previous.question_count, alreadySaved: true };
    }
    for (const question of upload.questions) await insertQuestion(client, topic.id, question);
    const beforeCommit = await lockActiveAdminSession(client);
    if (!beforeCommit || beforeCommit.id !== adminId) throw new ImportProblem("Sesi admin telah berakhir. Impor dibatalkan.");
    await client.query("COMMIT");
    return { count: upload.questions.length, alreadySaved: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof ImportProblem || error instanceof QuestionDocxError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && ["23503", "23001", "40001", "40P01"].includes(String(error.code))) throw new ImportProblem("Data berubah saat impor. Tidak ada soal disimpan; periksa ulang file dan kategori.");
    throw error;
  } finally { client.release(); }
}

export function questionImportError(error: unknown, saving: boolean) {
  if (error instanceof ImportProblem || error instanceof QuestionDocxError) return error.message;
  return saving ? "Hasil penyimpanan belum dapat dipastikan. Periksa Manajemen Soal; coba simpan lagi pratinjau yang sama tanpa mengganti file atau kategori." : "Pratinjau belum dapat dibuat. Periksa koneksi, file, dan migrasi, lalu coba lagi.";
}
