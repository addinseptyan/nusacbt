import "server-only";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";

import { lockActiveAdminSession } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { getPostgresPool } from "@/lib/postgres";

export type DevCascadeEntityType =
  | "academic_year"
  | "period"
  | "major"
  | "class"
  | "student"
  | "topic"
  | "question"
  | "exam_test";

export type DevCascadeDependencyItem = {
  label: string;
  count: number;
};

export type DevCascadeInspection = {
  entityType: DevCascadeEntityType;
  entityId: string;
  entityLabel: string;
  confirmPhrase: string;
  blockedActiveAttempts: number;
  totalDependentRows: number;
  dependencies: DevCascadeDependencyItem[];
};

export type InspectCascadeResult =
  | { ok: true; inspection: DevCascadeInspection }
  | { ok: false; error: string };

export type ExecuteCascadeResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

class DevCascadeProblem extends Error {}

const ENTITY_TYPES = new Set<DevCascadeEntityType>([
  "academic_year",
  "period",
  "major",
  "class",
  "student",
  "topic",
  "question",
  "exam_test",
]);

export function isValidDevCascadeEntityType(raw: unknown): raw is DevCascadeEntityType {
  return typeof raw === "string" && ENTITY_TYPES.has(raw as DevCascadeEntityType);
}

type ScopePlan = {
  entityLabel: string;
  attemptIds: string[];
  retakePermissionIds: string[];
  snapshotIds: string[];
  runIds: string[];
  testIds: string[];
  placementIds: string[];
  identityIds: string[];
  periodIds: string[];
  enrollmentIds: string[];
  questionIds: string[];
  classIds: string[];
  majorIds: string[];
  yearIds: string[];
  studentIds: string[];
  topicIds: string[];
  extraSessionAssignmentsCount: number;
  extraScheduleParticipantsCount: number;
  extraCustomQuestionsCount: number;
  extraTestQuestionsCount: number;
  extraFinalGradeStatesCount: number;
  extraAccessTokensCount: number;
};

async function lockAndBuildScope(
  client: PoolClient,
  entityType: DevCascadeEntityType,
  entityId: string,
): Promise<ScopePlan> {
  // Advisory lock mencegah balapan mutasi antar operasi Dev cascade & jadwal
  await client.query("SELECT pg_advisory_xact_lock(2026111728)");

  let entityLabel = "";
  let yearIds: string[] = [];
  let majorIds: string[] = [];
  let classIds: string[] = [];
  let studentIds: string[] = [];
  let topicIds: string[] = [];
  let questionIds: string[] = [];
  let periodIds: string[] = [];
  let testIds: string[] = [];
  let runIds: string[] = [];
  let enrollmentIds: string[] = [];
  let placementIds: string[] = [];
  let identityIds: string[] = [];
  let attemptIds: string[] = [];

  if (entityType === "academic_year") {
    const r = await client.query<{ id: string; name: string }>(
      "SELECT id::text AS id, name FROM academic_years WHERE id = $1::bigint FOR UPDATE",
      [entityId],
    );
    if (!r.rowCount) throw new DevCascadeProblem("Tahun ajaran tidak ditemukan.");
    entityLabel = `Tahun ajaran ${r.rows[0].name}`;
    yearIds = [r.rows[0].id];
    periodIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM exam_periods WHERE academic_year_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    enrollmentIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM academic_year_enrollments WHERE academic_year_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    if (periodIds.length) {
      placementIds = (
        await client.query<{ id: string }>(
          "SELECT id::text AS id FROM student_class_placements WHERE period_id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
          [periodIds],
        )
      ).rows.map((x) => x.id);
      identityIds = (
        await client.query<{ id: string }>(
          "SELECT id::text AS id FROM participant_identities WHERE period_id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
          [periodIds],
        )
      ).rows.map((x) => x.id);
      testIds = (
        await client.query<{ id: string }>(
          "SELECT id::text AS id FROM exam_tests WHERE period_id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
          [periodIds],
        )
      ).rows.map((x) => x.id);
      runIds = (
        await client.query<{ id: string }>(
          "SELECT id::text AS id FROM exam_schedule_runs WHERE period_id = ANY($1::bigint[]) OR exam_test_id = ANY($2::bigint[]) ORDER BY id FOR UPDATE",
          [periodIds, testIds],
        )
      ).rows.map((x) => x.id);
    }
    attemptIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM exam_attempts WHERE period_id = ANY($1::bigint[]) OR run_id = ANY($2::bigint[]) OR participant_identity_id = ANY($3::bigint[]) ORDER BY id FOR UPDATE",
        [periodIds, runIds, identityIds],
      )
    ).rows.map((x) => x.id);
  } else if (entityType === "period") {
    const r = await client.query<{ id: string; name: string }>(
      "SELECT id::text AS id, name FROM exam_periods WHERE id = $1::bigint FOR UPDATE",
      [entityId],
    );
    if (!r.rowCount) throw new DevCascadeProblem("Periode ujian tidak ditemukan.");
    entityLabel = `Periode ${r.rows[0].name}`;
    periodIds = [r.rows[0].id];
    placementIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM student_class_placements WHERE period_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    identityIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM participant_identities WHERE period_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    testIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM exam_tests WHERE period_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    runIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM exam_schedule_runs WHERE period_id = $1::bigint OR exam_test_id = ANY($2::bigint[]) ORDER BY id FOR UPDATE",
        [entityId, testIds],
      )
    ).rows.map((x) => x.id);
    attemptIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM exam_attempts WHERE period_id = $1::bigint OR run_id = ANY($2::bigint[]) OR participant_identity_id = ANY($3::bigint[]) ORDER BY id FOR UPDATE",
        [entityId, runIds, identityIds],
      )
    ).rows.map((x) => x.id);
  } else if (entityType === "major" || entityType === "class") {
    if (entityType === "major") {
      const m = await client.query<{ id: string; name: string }>(
        "SELECT id::text AS id, name FROM school_majors WHERE id = $1::bigint FOR UPDATE",
        [entityId],
      );
      if (!m.rowCount) throw new DevCascadeProblem("Jurusan tidak ditemukan.");
      entityLabel = `Jurusan ${m.rows[0].name}`;
      majorIds = [m.rows[0].id];
      classIds = (
        await client.query<{ id: string }>(
          "SELECT id::text AS id FROM school_classes WHERE major_id = $1::bigint ORDER BY id FOR UPDATE",
          [entityId],
        )
      ).rows.map((x) => x.id);
    } else {
      const c = await client.query<{ id: string; label: string }>(
        "SELECT c.id::text AS id, c.level || ' ' || m.name AS label FROM school_classes c JOIN school_majors m ON m.id = c.major_id WHERE c.id = $1::bigint FOR UPDATE OF c",
        [entityId],
      );
      if (!c.rowCount) throw new DevCascadeProblem("Kelas tidak ditemukan.");
      entityLabel = `Kelas ${c.rows[0].label}`;
      classIds = [c.rows[0].id];
    }
    if (classIds.length) {
      enrollmentIds = (
        await client.query<{ id: string }>(
          "SELECT id::text AS id FROM academic_year_enrollments WHERE class_id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
          [classIds],
        )
      ).rows.map((x) => x.id);
      placementIds = (
        await client.query<{ id: string }>(
          "SELECT id::text AS id FROM student_class_placements WHERE class_id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
          [classIds],
        )
      ).rows.map((x) => x.id);
      if (placementIds.length) {
        attemptIds = (
          await client.query<{ id: string }>(
            `SELECT a.id::text AS id
             FROM exam_attempts a
             WHERE EXISTS (
               SELECT 1 FROM exam_schedule_participants sp
               WHERE sp.run_id = a.run_id AND sp.student_id = a.student_id AND sp.placement_id = ANY($1::bigint[])
             )
             ORDER BY a.id FOR UPDATE OF a`,
            [placementIds],
          )
        ).rows.map((x) => x.id);
      }
    }
  } else if (entityType === "student") {
    const s = await client.query<{ id: string; name: string; nisn: string }>(
      "SELECT id::text AS id, name, nisn FROM school_students WHERE id = $1::bigint FOR UPDATE",
      [entityId],
    );
    if (!s.rowCount) throw new DevCascadeProblem("Data siswa tidak ditemukan.");
    entityLabel = `Siswa ${s.rows[0].name} (${s.rows[0].nisn})`;
    studentIds = [s.rows[0].id];
    enrollmentIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM academic_year_enrollments WHERE student_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    placementIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM student_class_placements WHERE student_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    identityIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM participant_identities WHERE student_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    attemptIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM exam_attempts WHERE student_id = $1::bigint OR participant_identity_id = ANY($2::bigint[]) ORDER BY id FOR UPDATE",
        [entityId, identityIds],
      )
    ).rows.map((x) => x.id);
  } else if (entityType === "topic" || entityType === "question") {
    if (entityType === "topic") {
      const t = await client.query<{ id: string; name: string }>(
        "SELECT id::text AS id, name FROM question_topics WHERE id = $1::bigint FOR UPDATE",
        [entityId],
      );
      if (!t.rowCount) throw new DevCascadeProblem("Mata pelajaran tidak ditemukan.");
      entityLabel = `Mata pelajaran ${t.rows[0].name}`;
      topicIds = [t.rows[0].id];
      questionIds = (
        await client.query<{ id: string }>(
          "SELECT id::text AS id FROM question_bank WHERE topic_id = $1::bigint ORDER BY id FOR UPDATE",
          [entityId],
        )
      ).rows.map((x) => x.id);
    } else {
      const q = await client.query<{ id: string; topicName: string }>(
        "SELECT q.id::text AS id, t.name AS \"topicName\" FROM question_bank q JOIN question_topics t ON t.id = q.topic_id WHERE q.id = $1::bigint FOR UPDATE OF q",
        [entityId],
      );
      if (!q.rowCount) throw new DevCascadeProblem("Soal tidak ditemukan.");
      entityLabel = `Soal #${q.rows[0].id} (${q.rows[0].topicName})`;
      questionIds = [q.rows[0].id];
    }
    if (questionIds.length) {
      attemptIds = (
        await client.query<{ id: string }>(
          `SELECT a.id::text AS id
           FROM exam_attempts a
           WHERE EXISTS (
             SELECT 1 FROM exam_attempt_questions aq
             JOIN exam_question_snapshots qs ON qs.id = aq.snapshot_id
             WHERE aq.attempt_id = a.id AND qs.source_question_id = ANY($1::bigint[])
           )
           ORDER BY a.id FOR UPDATE OF a`,
          [questionIds],
        )
      ).rows.map((x) => x.id);
    }
  } else if (entityType === "exam_test") {
    const et = await client.query<{ id: string; name: string }>(
      "SELECT id::text AS id, name FROM exam_tests WHERE id = $1::bigint FOR UPDATE",
      [entityId],
    );
    if (!et.rowCount) throw new DevCascadeProblem("Rancangan tes tidak ditemukan.");
    entityLabel = `Rancangan tes ${et.rows[0].name}`;
    testIds = [et.rows[0].id];
    runIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM exam_schedule_runs WHERE exam_test_id = $1::bigint ORDER BY id FOR UPDATE",
        [entityId],
      )
    ).rows.map((x) => x.id);
    attemptIds = (
      await client.query<{ id: string }>(
        "SELECT id::text AS id FROM exam_attempts WHERE exam_test_id = $1::bigint OR run_id = ANY($2::bigint[]) ORDER BY id FOR UPDATE",
        [entityId, runIds],
      )
    ).rows.map((x) => x.id);
  }

  const retakePermissionIds = attemptIds.length || runIds.length || identityIds.length
    ? (
        await client.query<{ id: string }>(
          `SELECT id::text AS id FROM exam_retake_permissions
           WHERE previous_attempt_id = ANY($1::bigint[])
              OR consumed_attempt_id = ANY($1::bigint[])
              OR run_id = ANY($2::bigint[])
              OR participant_identity_id = ANY($3::bigint[])
           ORDER BY id FOR UPDATE`,
          [attemptIds, runIds, identityIds],
        )
      ).rows.map((x) => x.id)
    : [];

  const snapshotIds = attemptIds.length
    ? (
        await client.query<{ id: string }>(
          `SELECT DISTINCT snapshot_id::text AS id FROM exam_attempt_questions WHERE attempt_id = ANY($1::bigint[]) ORDER BY 1`,
          [attemptIds],
        )
      ).rows.map((x) => x.id)
    : [];

  const extraSessionAssignmentsCount = periodIds.length || studentIds.length || placementIds.length
    ? (
        await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM exam_session_assignments
           WHERE period_id = ANY($1::bigint[]) OR student_id = ANY($2::bigint[]) OR placement_id = ANY($3::bigint[])`,
          [periodIds, studentIds, placementIds],
        )
      ).rows[0].count
    : 0;

  const extraScheduleParticipantsCount = runIds.length || studentIds.length || placementIds.length
    ? (
        await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM exam_schedule_participants
           WHERE run_id = ANY($1::bigint[]) OR student_id = ANY($2::bigint[]) OR placement_id = ANY($3::bigint[])`,
          [runIds, studentIds, placementIds],
        )
      ).rows[0].count
    : 0;

  const extraCustomQuestionsCount = runIds.length || questionIds.length
    ? (
        await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM exam_schedule_custom_questions
           WHERE run_id = ANY($1::bigint[]) OR question_id = ANY($2::bigint[])`,
          [runIds, questionIds],
        )
      ).rows[0].count
    : 0;

  const extraTestQuestionsCount = testIds.length || questionIds.length
    ? (
        await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM exam_test_questions
           WHERE exam_test_id = ANY($1::bigint[]) OR question_id = ANY($2::bigint[])`,
          [testIds, questionIds],
        )
      ).rows[0].count
    : 0;

  const extraFinalGradeStatesCount = testIds.length || identityIds.length || periodIds.length
    ? (
        await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM exam_final_grade_state
           WHERE exam_test_id = ANY($1::bigint[]) OR participant_identity_id = ANY($2::bigint[]) OR period_id = ANY($3::bigint[])`,
          [testIds, identityIds, periodIds],
        )
      ).rows[0].count
    : 0;

  const extraAccessTokensCount = testIds.length
    ? (
        await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM exam_access_tokens WHERE exam_test_id = ANY($1::bigint[])`,
          [testIds],
        )
      ).rows[0].count
    : 0;

  return {
    entityLabel,
    attemptIds,
    retakePermissionIds,
    snapshotIds,
    runIds,
    testIds,
    placementIds,
    identityIds,
    periodIds,
    enrollmentIds,
    questionIds,
    classIds,
    majorIds,
    yearIds,
    studentIds,
    topicIds,
    extraSessionAssignmentsCount,
    extraScheduleParticipantsCount,
    extraCustomQuestionsCount,
    extraTestQuestionsCount,
    extraFinalGradeStatesCount,
    extraAccessTokensCount,
  };
}

function buildDependencySummary(entityType: DevCascadeEntityType, plan: ScopePlan): DevCascadeDependencyItem[] {
  const items: DevCascadeDependencyItem[] = [];
  const push = (label: string, count: number) => {
    if (count > 0) items.push({ label, count });
  };
  if (entityType !== "period") push("Periode ujian", plan.periodIds.length);
  if (entityType !== "class") push("Kelas / rombel", plan.classIds.length);
  push("Roster tahun ajaran", plan.enrollmentIds.length);
  push("Penempatan kelas per periode", plan.placementIds.length);
  push("Identitas & sandi peserta", plan.identityIds.length);
  push("Pembagian sesi peserta", plan.extraSessionAssignmentsCount);
  if (entityType !== "question") push("Soal pada bank soal", plan.questionIds.length);
  if (entityType !== "exam_test") push("Rancangan tes", plan.testIds.length);
  push("Relasi soal pada tes / remidi", plan.extraTestQuestionsCount + plan.extraCustomQuestionsCount);
  push("Pelaksanaan tes", plan.runIds.length);
  push("Peserta terdaftar pelaksanaan", plan.extraScheduleParticipantsCount);
  push("Token khusus tes terkait", plan.extraAccessTokensCount);
  push("Riwayat pengerjaan & jawaban siswa", plan.attemptIds.length);
  push("Izin mengulang ujian", plan.retakePermissionIds.length);
  push("Status nilai akhir peserta", plan.extraFinalGradeStatesCount);
  return items;
}

async function assertDevCascadeAuthorized(client: PoolClient) {
  const admin = await lockActiveAdminSession(client);
  if (!admin) throw new DevCascadeProblem("Sesi admin sudah berakhir. Masuk kembali.");
  if (!admin.isSuperuser) {
    throw new DevCascadeProblem("Hanya Superadmin yang dapat menghapus data berdependensi pada mode Dev.");
  }
  const modeRow = await client.query<{ appMode: string }>(
    'SELECT app_mode AS "appMode" FROM app_settings WHERE id = 1 FOR SHARE',
  );
  if (modeRow.rows[0]?.appMode !== "dev") {
    throw new DevCascadeProblem("Penghapusan berdependensi hanya diizinkan saat Mode Aplikasi diatur ke Dev.");
  }
  return admin;
}

export async function inspectDevCascadeDependencies(
  rawType: unknown,
  rawId: unknown,
): Promise<InspectCascadeResult> {
  if (!isValidDevCascadeEntityType(rawType)) {
    return { ok: false, error: "Jenis entitas tidak valid." };
  }
  const entityId = validDataId(rawId);
  if (!entityId) return { ok: false, error: "Identitas data tidak valid." };

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await assertDevCascadeAuthorized(client);
    const plan = await lockAndBuildScope(client, rawType, entityId);
    const activeAttempts = plan.attemptIds.length
      ? (
          await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM exam_attempts
             WHERE id = ANY($1::bigint[]) AND completed_at IS NULL AND deadline > clock_timestamp()`,
            [plan.attemptIds],
          )
        ).rows[0].count
      : 0;
    const dependencies = buildDependencySummary(rawType, plan);
    const totalDependentRows = dependencies.reduce((acc, item) => acc + item.count, 0);
    await client.query("COMMIT");

    return {
      ok: true,
      inspection: {
        entityType: rawType,
        entityId,
        entityLabel: plan.entityLabel,
        confirmPhrase: "HAPUS PERMANEN",
        blockedActiveAttempts: activeAttempts,
        totalDependentRows,
        dependencies,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof DevCascadeProblem) return { ok: false, error: error.message };
    return { ok: false, error: "Gagal memeriksa dependensi data. Coba muat ulang halaman." };
  } finally {
    client.release();
  }
}

export async function executeDevCascadeDelete(
  rawType: unknown,
  rawId: unknown,
  confirmPhrase: unknown,
): Promise<ExecuteCascadeResult> {
  if (!isValidDevCascadeEntityType(rawType)) {
    return { ok: false, error: "Jenis entitas tidak valid." };
  }
  const entityId = validDataId(rawId);
  if (!entityId) return { ok: false, error: "Identitas data tidak valid." };
  if (typeof confirmPhrase !== "string" || confirmPhrase.trim() !== "HAPUS PERMANEN") {
    return { ok: false, error: 'Ketik tepat "HAPUS PERMANEN" untuk mengonfirmasi penghapusan.' };
  }

  const client = await getPostgresPool().connect();
  let label = "";
  try {
    await client.query("BEGIN");
    const admin = await assertDevCascadeAuthorized(client);
    const plan = await lockAndBuildScope(client, rawType, entityId);
    label = plan.entityLabel;

    if (plan.attemptIds.length) {
      const activeAttempts = (
        await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM exam_attempts
           WHERE id = ANY($1::bigint[]) AND completed_at IS NULL AND deadline > clock_timestamp()`,
          [plan.attemptIds],
        )
      ).rows[0].count;
      if (activeAttempts > 0) {
        throw new DevCascadeProblem(
          `Penghapusan ditolak: ada ${activeAttempts} pengerjaan ujian yang masih berlangsung aktif. Tunggu hingga ujian selesai atau waktu habis.`,
        );
      }
    }

    // 1. Retake operations & retake permissions
    if (plan.retakePermissionIds.length || plan.attemptIds.length) {
      await client.query(
        `DELETE FROM exam_retake_operations
         WHERE attempt_id = ANY($1::bigint[]) OR permission_id = ANY($2::bigint[])`,
        [plan.attemptIds, plan.retakePermissionIds],
      );
      await client.query(
        `DELETE FROM exam_retake_permissions WHERE id = ANY($1::bigint[])`,
        [plan.retakePermissionIds],
      );
    }

    // 2. Exam attempts & their attempt questions (MUST happen before deleting snapshots)
    if (plan.attemptIds.length) {
      await client.query(
        `DELETE FROM exam_attempt_questions WHERE attempt_id = ANY($1::bigint[])`,
        [plan.attemptIds],
      );
      await client.query(
        `DELETE FROM exam_attempts WHERE id = ANY($1::bigint[])`,
        [plan.attemptIds],
      );
    }

    // 3. Clean up unreferenced question snapshots & their images (trigger allows delete once unreferenced)
    if (plan.snapshotIds.length) {
      await client.query(
        `DELETE FROM exam_question_snapshots s
         WHERE s.id = ANY($1::bigint[])
           AND NOT EXISTS (SELECT 1 FROM exam_attempt_questions aq WHERE aq.snapshot_id = s.id)`,
        [plan.snapshotIds],
      );
    }

    // 4. Final grade states referencing deleted tests, identities, or periods
    if (plan.testIds.length || plan.identityIds.length || plan.periodIds.length) {
      await client.query(
        `DELETE FROM exam_final_grade_state
         WHERE exam_test_id = ANY($1::bigint[])
            OR participant_identity_id = ANY($2::bigint[])
            OR period_id = ANY($3::bigint[])`,
        [plan.testIds, plan.identityIds, plan.periodIds],
      );
    }

    // 5. Schedule participants, custom questions, runs
    if (plan.runIds.length || plan.studentIds.length || plan.placementIds.length) {
      await client.query(
        `DELETE FROM exam_schedule_participants
         WHERE run_id = ANY($1::bigint[]) OR student_id = ANY($2::bigint[]) OR placement_id = ANY($3::bigint[])`,
        [plan.runIds, plan.studentIds, plan.placementIds],
      );
    }
    if (plan.runIds.length || plan.questionIds.length) {
      await client.query(
        `DELETE FROM exam_schedule_custom_questions
         WHERE run_id = ANY($1::bigint[]) OR question_id = ANY($2::bigint[])`,
        [plan.runIds, plan.questionIds],
      );
    }
    if (plan.runIds.length) {
      await client.query(
        `DELETE FROM exam_schedule_runs WHERE id = ANY($1::bigint[])`,
        [plan.runIds],
      );
    }

    // 6. Test questions & exam tests
    if (plan.testIds.length || plan.questionIds.length) {
      await client.query(
        `DELETE FROM exam_test_questions
         WHERE exam_test_id = ANY($1::bigint[]) OR question_id = ANY($2::bigint[])`,
        [plan.testIds, plan.questionIds],
      );
    }
    if (plan.testIds.length) {
      await client.query(
        `DELETE FROM exam_access_tokens
         WHERE exam_test_id = ANY($1::bigint[])`,
        [plan.testIds],
      );
      await client.query(
        `DELETE FROM exam_tests WHERE id = ANY($1::bigint[])`,
        [plan.testIds],
      );
    }

    // 7. Participant sessions, password audit, passwords, identities
    if (plan.identityIds.length || plan.placementIds.length) {
      await client.query(
        `DELETE FROM participant_sessions
         WHERE participant_identity_id = ANY($1::bigint[]) OR placement_id = ANY($2::bigint[])`,
        [plan.identityIds, plan.placementIds],
      );
    }
    if (plan.identityIds.length) {
      await client.query(
        `DELETE FROM participant_password_audit WHERE participant_identity_id = ANY($1::bigint[])`,
        [plan.identityIds],
      );
      await client.query(
        `DELETE FROM participant_passwords WHERE participant_identity_id = ANY($1::bigint[])`,
        [plan.identityIds],
      );
      await client.query(
        `DELETE FROM participant_identities WHERE id = ANY($1::bigint[])`,
        [plan.identityIds],
      );
    }

    // 8. Session assignments, groups, plans (if deleting period)
    if (plan.periodIds.length || plan.studentIds.length || plan.placementIds.length) {
      await client.query(
        `DELETE FROM exam_session_assignments
         WHERE period_id = ANY($1::bigint[]) OR student_id = ANY($2::bigint[]) OR placement_id = ANY($3::bigint[])`,
        [plan.periodIds, plan.studentIds, plan.placementIds],
      );
    }
    if (plan.periodIds.length) {
      await client.query(
        `DELETE FROM exam_session_groups WHERE period_id = ANY($1::bigint[])`,
        [plan.periodIds],
      );
      await client.query(
        `DELETE FROM exam_session_plans WHERE period_id = ANY($1::bigint[])`,
        [plan.periodIds],
      );
    }

    // 9. Placements & Enrollments
    if (plan.placementIds.length) {
      await client.query(
        `DELETE FROM student_class_placements WHERE id = ANY($1::bigint[])`,
        [plan.placementIds],
      );
    }
    if (plan.enrollmentIds.length) {
      await client.query(
        `DELETE FROM academic_year_enrollments WHERE id = ANY($1::bigint[])`,
        [plan.enrollmentIds],
      );
    }

    // 10. Questions & Topics
    if (plan.questionIds.length) {
      await client.query(
        `DELETE FROM question_bank WHERE id = ANY($1::bigint[])`,
        [plan.questionIds],
      );
    }
    if (plan.topicIds.length) {
      await client.query(
        `DELETE FROM question_topics WHERE id = ANY($1::bigint[])`,
        [plan.topicIds],
      );
    }

    // 11. Periods (detach active login setting if pointing to deleted periods)
    if (plan.periodIds.length) {
      await client.query(
        `UPDATE participant_login_settings
         SET period_id = NULL
         WHERE id = 1 AND period_id = ANY($1::bigint[])`,
        [plan.periodIds],
      );
      await client.query(
        `DELETE FROM exam_periods WHERE id = ANY($1::bigint[])`,
        [plan.periodIds],
      );
      await client.query(
        `UPDATE participant_login_settings
         SET period_id = (
           SELECT id FROM exam_periods WHERE is_active = true ORDER BY start_date DESC, id DESC LIMIT 1
         )
         WHERE id = 1 AND period_id IS NULL`,
      );
    }

    // 12. Academic years (clear active setting & source_year_id refs)
    if (plan.yearIds.length) {
      await client.query(
        `UPDATE academic_year_enrollments SET source_year_id = NULL WHERE source_year_id = ANY($1::bigint[])`,
        [plan.yearIds],
      );
      await client.query(
        `UPDATE academic_year_settings
         SET active_year_id = NULL, revision = revision + 1
         WHERE id = 1 AND active_year_id = ANY($1::bigint[])`,
        [plan.yearIds],
      );
      await client.query(
        `DELETE FROM academic_years WHERE id = ANY($1::bigint[])`,
        [plan.yearIds],
      );
    }

    // 13. Classes, Majors, Students
    if (plan.classIds.length) {
      await client.query(`DELETE FROM school_classes WHERE id = ANY($1::bigint[])`, [plan.classIds]);
    }
    if (plan.majorIds.length) {
      await client.query(`DELETE FROM school_majors WHERE id = ANY($1::bigint[])`, [plan.majorIds]);
    }
    if (plan.studentIds.length) {
      await client.query(`DELETE FROM school_students WHERE id = ANY($1::bigint[])`, [plan.studentIds]);
    }

    const stillActive = await lockActiveAdminSession(client);
    if (!stillActive || stillActive.id !== admin.id) {
      throw new DevCascadeProblem("Sesi admin sudah berakhir. Masuk kembali.");
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof DevCascadeProblem) return { ok: false, error: error.message };
    return { ok: false, error: "Penghapusan berdependensi gagal diselesaikan. Tidak ada data yang diubah." };
  } finally {
    client.release();
  }

  for (const path of [
    "/",
    "/data-peserta/tahun-ajaran",
    "/data-peserta/periode",
    "/data-peserta/kelas",
    "/data-peserta/siswa",
    "/data-peserta/identitas",
    "/data-peserta/sandi",
    "/data-peserta/akun",
    "/data-peserta/kartu",
    "/data-modul/topik",
    "/data-modul/soal",
    "/data-modul/export-soal",
    "/data-tes/daftar",
    "/data-tes/daftar/sesi",
    "/data-tes/token",
    "/data-tes/monitoring",
    "/laporan/rekap",
    "/peserta/login",
    "/peserta",
  ]) {
    revalidatePath(path);
  }

  return { ok: true, message: `${label} beserta seluruh data dependensinya berhasil dihapus permanen.` };
}
