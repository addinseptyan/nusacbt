import "server-only";
import type { PoolClient } from "pg";

import { EXAM_OPTION_IDS, shuffleExamItems } from "@/lib/exam-attempt-validation.mjs";

/**
 * Soal dikunci dalam urutan ID agar edit bank bersamaan tidak menghasilkan
 * snapshot parsial. Setiap versi disimpan sekali meski dipakai banyak attempt;
 * gambar dan kunci disalin, tidak lagi bergantung pada soal bank yang berubah.
 */
export async function snapshotExamQuestions(client: PoolClient, attemptId: string, originalIds: string[], shuffleQuestions: boolean, shuffleOptions: boolean) {
  if (!originalIds.length || originalIds.length > 1000 || new Set(originalIds).size !== originalIds.length) {
    throw new Error("Jumlah atau identitas soal pelaksanaan tidak valid.");
  }
  const locked = await client.query("SELECT id FROM question_bank WHERE id=ANY($1::bigint[]) ORDER BY id FOR SHARE", [originalIds]);
  if (locked.rowCount !== originalIds.length) throw new Error("Ada soal pelaksanaan yang tidak ditemukan.");
  // CTE menyalin gambar HANYA untuk versi yang baru dibuat. Versi yang sama
  // dari transaksi lain diselesaikan/dikomunikasikan melalui unique index.
  await client.query(
    `WITH created AS (
       INSERT INTO exam_question_snapshots(source_question_id,source_revision,source_updated_at,prompt_text,prompt_rich,has_prompt_image,options,correct_option)
       SELECT q.id,q.xmin::text,q.updated_at,q.prompt_text,q.prompt_rich,q.prompt_image IS NOT NULL,
         jsonb_build_object(
           'A',jsonb_build_object('text',q.option_a_text,'rich',q.option_a_rich,'hasImage',q.option_a_image IS NOT NULL),
           'B',jsonb_build_object('text',q.option_b_text,'rich',q.option_b_rich,'hasImage',q.option_b_image IS NOT NULL),
           'C',jsonb_build_object('text',q.option_c_text,'rich',q.option_c_rich,'hasImage',q.option_c_image IS NOT NULL),
           'D',jsonb_build_object('text',q.option_d_text,'rich',q.option_d_rich,'hasImage',q.option_d_image IS NOT NULL),
           'E',jsonb_build_object('text',q.option_e_text,'rich',q.option_e_rich,'hasImage',q.option_e_image IS NOT NULL)),
         q.correct_option
       FROM question_bank q WHERE q.id=ANY($1::bigint[]) ORDER BY q.id
       ON CONFLICT (source_question_id,source_revision,source_updated_at) DO NOTHING
       RETURNING id,source_question_id
     )
     INSERT INTO exam_question_snapshot_images(snapshot_id,slot,mime,data)
     SELECT s.id,images.slot,images.mime,images.data FROM created s JOIN question_bank q ON q.id=s.source_question_id
     CROSS JOIN LATERAL (VALUES
       ('prompt',q.prompt_image_mime,q.prompt_image),('A',q.option_a_image_mime,q.option_a_image),
       ('B',q.option_b_image_mime,q.option_b_image),('C',q.option_c_image_mime,q.option_c_image),
       ('D',q.option_d_image_mime,q.option_d_image),('E',q.option_e_image_mime,q.option_e_image)
     ) AS images(slot,mime,data) WHERE images.data IS NOT NULL`, [originalIds],
  );
  const ids = shuffleQuestions ? shuffleExamItems(originalIds) : [...originalIds];
  const orders = ids.map(() => shuffleOptions ? shuffleExamItems(EXAM_OPTION_IDS).join("") : "ABCDE");
  const inserted = await client.query(
    `INSERT INTO exam_attempt_questions(attempt_id,position,snapshot_id,option_order)
     SELECT $1::bigint,selected.ordinality::integer,s.id,selected.option_order
     FROM unnest($2::bigint[],$3::text[]) WITH ORDINALITY AS selected(question_id,option_order,ordinality)
     JOIN question_bank q ON q.id=selected.question_id
     JOIN exam_question_snapshots s ON s.source_question_id=q.id AND s.source_revision=q.xmin::text AND s.source_updated_at=q.updated_at`,
    [attemptId, ids, orders],
  );
  if (inserted.rowCount !== ids.length) throw new Error("Snapshot soal tidak lengkap; attempt dibatalkan.");
}
