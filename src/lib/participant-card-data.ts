import "server-only";
import type { PoolClient } from "pg";

import { lockActiveAdminSession } from "@/lib/admin-auth";
import { adminHasPermission } from "@/lib/admin-permissions.mjs";
import { PARTICIPANT_CARD_BATCH_SIZE } from "@/lib/participant-card-constants.mjs";
import type { CardFilters } from "@/lib/participant-card-filter.mjs";
import { cardFilterCondition, cardFilterValues } from "@/lib/participant-card-sql";
import type { CardListRow, CardPageData } from "@/lib/participant-card-types";
import type { IdentityPeriod } from "@/lib/participant-identity-types";
import { passwordCandidate } from "@/lib/participant-password-service";
import type { PasswordRow } from "@/lib/participant-password-types";
import { getPostgresPool } from "@/lib/postgres";

export class CardPageSessionExpired extends Error {}
export class CardPagePermissionDenied extends Error {}
export class CardPeriodChanged extends Error {}

type CardDatabaseRow = Omit<PasswordRow, "identityId" | "participantNumber" | "username" | "identityVersion" | "placementId" | "classId" | "classLabel"> & {
  identityId: string | null;
  participantNumber: string | null;
  username: string | null;
  identityVersion: string | null;
  placementId: string;
  classId: string;
  classLabel: string;
  passwordRevision: string | null;
};

async function readPage(client: PoolClient, filters: CardFilters, requestedPage: number): Promise<CardPageData> {
  const periods = (await client.query<IdentityPeriod>(
    `SELECT id::text AS id,name,to_char(start_date,'YYYY-MM-DD') AS "startDate",
      to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
     FROM exam_periods ORDER BY start_date DESC,id DESC`,
  )).rows;
  const login = (await client.query<{ id: string | null; name: string | null }>(
    `SELECT setting.period_id::text AS id,period.name FROM participant_login_settings setting
     LEFT JOIN exam_periods period ON period.id=setting.period_id WHERE setting.id=1`,
  )).rows[0];
  if (!login) throw new Error("Pengaturan login peserta tidak tersedia.");
  if (filters.periodId && filters.periodId !== login.id) throw new CardPeriodChanged();
  const effectiveFilters = { ...filters, periodId: login.id };
  const selected = periods.find((period) => period.id === login.id) ?? null;
  const empty = { filters: effectiveFilters, periods, selected, loginPeriodId: login.id, loginPeriodName: login.name,
    classes: [], tests: [], rows: [], total: 0, page: 1, pages: 1 };
  if (!selected) return empty;

  const classes = (await client.query<{ id: string; label: string }>(
    `SELECT DISTINCT c.id::text AS id,c.level || ' ' || m.name AS label
     FROM student_class_placements p JOIN school_classes c ON c.id=p.class_id JOIN school_majors m ON m.id=c.major_id
     WHERE p.period_id=$1::bigint AND p.ended_at IS NULL ORDER BY label,id`, [selected.id],
  )).rows;
  const base = `FROM student_class_placements p JOIN school_students s ON s.id=p.student_id
    LEFT JOIN participant_identities i ON i.student_id=s.id AND i.period_id=p.period_id
    LEFT JOIN participant_passwords pw ON pw.participant_identity_id=i.id
    JOIN school_classes c ON c.id=p.class_id JOIN school_majors m ON m.id=c.major_id
    WHERE ${cardFilterCondition}`;
  const values = cardFilterValues(effectiveFilters);
  const total = (await client.query<{ total: number }>(`SELECT count(*)::int AS total ${base}`, values)).rows[0].total;
  const pages = Math.max(1, Math.ceil(total / PARTICIPANT_CARD_BATCH_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pages);
  // Daftar tidak memuat hash, ciphertext, atau plaintext sandi. xmin hanya
  // dipakai server untuk membuat fingerprint; nilainya tidak dikirim ke UI.
  const records = (await client.query<CardDatabaseRow>(
    `SELECT i.id::text AS "identityId",s.id::text AS "studentId",s.name AS "studentName",s.nisn,
      to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "studentVersion",
      p.id::text AS "placementId",p.class_id::text AS "classId",c.level || ' ' || m.name AS "classLabel",
      i.participant_number AS "participantNumber",i.username,
      to_char(i.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "identityVersion",
      to_char(pw.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "passwordVersion",
      pw.xmin::text AS "passwordRevision"
     ${base} ORDER BY lower(s.name),s.nisn,s.id LIMIT $4::integer OFFSET $5::integer`,
    [...values, PARTICIPANT_CARD_BATCH_SIZE, (page - 1) * PARTICIPANT_CARD_BATCH_SIZE],
  )).rows;
  const rows: CardListRow[] = records.map((record) => {
    const { studentId, studentName, nisn, classId, classLabel, participantNumber, username, identityId, identityVersion, passwordRevision } = record;
    const candidate = identityId && participantNumber && username && identityVersion
      ? passwordCandidate(selected, { ...record, identityId, participantNumber, username, identityVersion }, passwordRevision)
      : null;
    return { studentId, studentName, nisn, classId, classLabel, participantNumber, username,
      hasPassword: record.passwordVersion !== null, candidate };
  });
  return { filters: effectiveFilters, periods, selected, loginPeriodId: login.id, loginPeriodName: login.name, classes, tests: [], rows, total, page, pages };
}

/** Sesi dan seluruh opsi/daftar diperiksa dalam satu snapshot. */
export async function loadParticipantCardPage(filters: CardFilters, page: number): Promise<CardPageData> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin = await lockActiveAdminSession(client);
    if (!admin) throw new CardPageSessionExpired();
    if (!adminHasPermission(admin, "participant_cards.print")) throw new CardPagePermissionDenied();
    const result = await readPage(client, filters, page);
    const active = await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new CardPageSessionExpired();
    if (!adminHasPermission(active, "participant_cards.print")) throw new CardPagePermissionDenied();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
