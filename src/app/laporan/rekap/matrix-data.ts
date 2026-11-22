import "server-only";
import type { PoolClient } from "pg";
import { lockActiveAdminSession } from "@/lib/admin-auth";
import type { MatrixFilters } from "@/lib/matrix-report-filter.mjs";
import { buildResultMatrix, type MatrixAttempt, type MatrixColumn, type MatrixRow } from "@/lib/matrix-report.mjs";
import { getPostgresPool } from "@/lib/postgres";

export const MATRIX_PAGE_SIZE = 30, MATRIX_MAX_STUDENTS = 2000, MATRIX_MAX_TESTS = 59, MATRIX_MAX_ATTEMPTS = 10000;
export class MatrixSessionExpired extends Error {}
export class MatrixSizeExceeded extends Error {}
export type MatrixOptions = { years:Array<{id:string;name:string}>; periods:Array<{id:string;name:string;year:string|null}>; tests:Array<{id:string;name:string;period:string}>; classes:string[] };
export type MatrixData = { columns:MatrixColumn[]; rows:MatrixRow[]; total:number; page:number; pages:number; attempts:number; attemptRows:MatrixAttempt[]; options:MatrixOptions|null; warning:string|null };
async function options(client:PoolClient):Promise<MatrixOptions> {
  const years = (await client.query<{id:string;name:string}>("SELECT id::text AS id,name FROM academic_years ORDER BY name DESC,id DESC")).rows;
  const periods = (await client.query<{id:string;name:string;year:string|null}>("SELECT p.id::text AS id,p.name,y.name AS year FROM exam_periods p LEFT JOIN academic_years y ON y.id=p.academic_year_id ORDER BY p.start_date DESC,p.id DESC")).rows;
  const tests = (await client.query<{id:string;name:string;period:string}>("SELECT t.id::text AS id,t.name,p.name AS period FROM exam_tests t JOIN exam_periods p ON p.id=t.period_id ORDER BY lower(t.name),p.start_date DESC,t.id")).rows;
  const classes = (await client.query<{name:string}>("SELECT DISTINCT class_name_snapshot AS name FROM exam_attempts WHERE completed_at IS NOT NULL ORDER BY name")).rows.map((r) => r.name);
  return {years,periods,tests,classes};
}
async function read(client:PoolClient,f:MatrixFilters,requestedPage:number,exporting:boolean):Promise<MatrixData> {
  const opts = await options(client);
  const matches = (await client.query<MatrixAttempt>(
    `SELECT a.id::text AS id,a.student_id::text AS "studentId",a.student_name_snapshot AS student,s.nisn,a.class_name_snapshot AS "className",
      p.academic_year_id::text AS "yearId",y.name AS year,a.exam_test_id::text AS "testId",a.test_name_snapshot AS "testName",p.name AS period,
      a.kind,COALESCE(gs.method,'highest') AS method,a.correct_count AS correct,a.question_count AS questions,
      to_char(a.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS completed
     FROM exam_attempts a JOIN school_students s ON s.id=a.student_id JOIN exam_periods p ON p.id=a.period_id
     LEFT JOIN academic_years y ON y.id=p.academic_year_id LEFT JOIN exam_final_grade_settings gs ON gs.exam_test_id=a.exam_test_id
     WHERE a.completed_at IS NOT NULL
      AND ($1::bigint IS NULL OR p.academic_year_id=$1::bigint) AND ($2::bigint IS NULL OR a.period_id=$2::bigint)
      AND ($3::bigint IS NULL OR a.exam_test_id=$3::bigint) AND ($4::text IS NULL OR a.class_name_snapshot=$4::text)
      AND ($5::text IS NULL OR strpos(lower(a.student_name_snapshot),lower($5::text))>0 OR strpos(lower(a.participant_number_snapshot),lower($5::text))>0 OR strpos(s.nisn,$5::text)>0)
      AND (a.kind=$6::text OR ($7::boolean AND a.kind='makeup'))
      AND ($8::timestamptz IS NULL OR a.completed_at >= $8::timestamptz) AND ($9::timestamptz IS NULL OR a.completed_at < $9::timestamptz)
     ORDER BY a.completed_at,a.id LIMIT $10::int`, [f.yearId,f.periodId,f.testId,f.className,f.student,f.kind,f.merge,f.fromUtc,f.toUtcExclusive,MATRIX_MAX_ATTEMPTS+1],
  )).rows;
  let warning:string|null = matches.length > MATRIX_MAX_ATTEMPTS ? `Terlalu banyak pengerjaan cocok (maksimal ${MATRIX_MAX_ATTEMPTS}). Sempitkan filter.` : null;
  const matrix = warning ? {columns:[],rows:[]} : buildResultMatrix(matches,f.merge);
  if (!warning && matrix.columns.length > MATRIX_MAX_TESTS) warning = `Terlalu banyak kolom tes (maksimal ${MATRIX_MAX_TESTS}). Pilih periode, kelas atau rentang yang lebih sempit.`;
  if (!warning && matrix.rows.length > MATRIX_MAX_STUDENTS) warning = `Terlalu banyak baris siswa (maksimal ${MATRIX_MAX_STUDENTS}). Sempitkan filter.`;
  if (warning) { if (exporting) throw new MatrixSizeExceeded(warning); return {columns:[],rows:[],total:0,page:1,pages:1,attempts:matches.length,attemptRows:[],options:opts,warning}; }
  const total = matrix.rows.length, pages = Math.max(1,Math.ceil(total/MATRIX_PAGE_SIZE)), page = exporting ? 1 : Math.min(Math.max(requestedPage,1),pages);
  return {columns:matrix.columns,rows:exporting ? matrix.rows : matrix.rows.slice((page-1)*MATRIX_PAGE_SIZE,page*MATRIX_PAGE_SIZE),total,page,pages,attempts:matches.length,attemptRows:matches,options:opts,warning:null};
}
export async function withMatrixSnapshot<T>(f:MatrixFilters,page:number,exporting:boolean,render:(data:MatrixData)=>T):Promise<T> {
  const client = await getPostgresPool().connect();
  try { await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); const admin = await lockActiveAdminSession(client); if(!admin) throw new MatrixSessionExpired();
    const data = await read(client,f,page,exporting); const result = render(data); const active = await lockActiveAdminSession(client);
    if(!active || active.id!==admin.id) throw new MatrixSessionExpired(); await client.query("COMMIT"); return result;
  } catch(error) { await client.query("ROLLBACK").catch(()=>{}); throw error; } finally { client.release(); }
}
