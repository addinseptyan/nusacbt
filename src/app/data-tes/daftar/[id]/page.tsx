import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, ChartNoAxesCombined, CircleAlert } from "lucide-react";
import type { PoolClient } from "pg";

import { lockActiveAdminSession, requireAdmin } from "@/lib/admin-auth";
import { validDataId } from "@/lib/class-validation.mjs";
import { loadSessionPlanWithClient, ScheduleSessionExpired } from "@/lib/exam-session-service";
import type { ExamRun, SessionPlanPage, SessionStudent } from "@/lib/exam-session-types";
import type { ExamTest } from "@/lib/exam-test-types";
import { getPostgresPool } from "@/lib/postgres";
import type { Question, QuestionLetter } from "@/lib/question-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExamRunManager } from "./run-manager";

export const metadata = { title: "Pelaksanaan Tes — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
type QuestionRow = {
  id:string; revision:string; topicId:string; topicName:string; prompt:string; promptRich:unknown|null; hasPromptImage:boolean;
  a:string;b:string;c:string;d:string;e:string;richA:unknown|null;richB:unknown|null;richC:unknown|null;richD:unknown|null;richE:unknown|null;
  hasA:boolean;hasB:boolean;hasC:boolean;hasD:boolean;hasE:boolean;correctOption:QuestionLetter;
};

export default async function ExamRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(); const id=validDataId((await params).id);
  if (!id) return <Failure message="Identitas tes tidak valid." />;
  let client: PoolClient | undefined; let test: ExamTest | undefined; let plan: SessionPlanPage | undefined; let runs: ExamRun[]=[]; let questions: Question[]=[];
  try {
    client=await getPostgresPool().connect(); await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const admin=await lockActiveAdminSession(client);
    if (!admin) throw new ScheduleSessionExpired();
    test=(await client.query<ExamTest>(
      `SELECT e.id::text AS id,e.xmin::text AS revision,e.name,e.period_id::text AS "periodId",p.name AS "periodName",
        to_char(e.starts_at AT TIME ZONE (CASE e.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END),'YYYY-MM-DD"T"HH24:MI') AS "startLocal",
        to_char((e.starts_at+e.duration_minutes*interval '1 minute') AT TIME ZONE (CASE e.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END),'YYYY-MM-DD"T"HH24:MI') AS "endLocal",
        e.time_zone AS "timeZone",e.duration_minutes AS "durationMinutes",e.shuffle_questions AS "shuffleQuestions",e.shuffle_options AS "shuffleOptions",
        COALESCE((SELECT array_agg(eq.question_id::text ORDER BY eq.position) FROM exam_test_questions eq WHERE eq.exam_test_id=e.id),ARRAY[]::text[]) AS "questionIds"
       FROM exam_tests e JOIN exam_periods p ON p.id=e.period_id WHERE e.id=$1::bigint`,[id],
    )).rows[0];
    if (test) {
      plan=await loadSessionPlanWithClient(client,test.periodId);
      runs=(await client.query<ExamRun>(
        `SELECT r.id::text AS id,r.xmin::text AS revision,r.kind,r.label,r.session_number AS "sessionNumber",
          to_char(r.starts_at AT TIME ZONE (CASE r.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END),'YYYY-MM-DD"T"HH24:MI') AS "startLocal",
          to_char((r.starts_at+r.duration_minutes*interval '1 minute') AT TIME ZONE (CASE r.time_zone WHEN 'WIB' THEN 'Asia/Jakarta' WHEN 'WITA' THEN 'Asia/Makassar' ELSE 'Asia/Jayapura' END),'YYYY-MM-DD"T"HH24:MI') AS "endLocal",
          r.time_zone AS "timeZone",r.duration_minutes AS "durationMinutes",r.question_mode AS "questionMode",
          to_char(r.published_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS "UTC"') AS "publishedAt",u.username AS "publishedBy",
          COALESCE((SELECT array_agg(p.student_id::text ORDER BY p.student_id) FROM exam_schedule_participants p WHERE p.run_id=r.id),ARRAY[]::text[]) AS "participantIds",
          COALESCE((SELECT array_agg(q.question_id::text ORDER BY q.position) FROM exam_schedule_custom_questions q WHERE q.run_id=r.id),ARRAY[]::text[]) AS "customQuestionIds"
         FROM exam_schedule_runs r LEFT JOIN admin_users u ON u.id=r.published_by WHERE r.exam_test_id=$1::bigint ORDER BY r.starts_at,r.id`, [id],
      )).rows;
      // Sertakan peserta draf lama yang penempatannya telah berakhir agar admin
      // melihat dan dapat mengeluarkannya; server menolak rilis tanpa kelas aktif.
      const known=plan.students.map((s)=>s.studentId);
      const missing=(await client.query<SessionStudent>(
        `SELECT DISTINCT ON (s.id) s.id::text AS "studentId",s.name AS "studentName",s.nisn,old.id::text AS "placementId",
          old.class_id::text AS "classId",old.class_name_snapshot AS "classLabel",false AS active,NULL::smallint AS "sessionNumber"
         FROM exam_schedule_participants rp JOIN school_students s ON s.id=rp.student_id JOIN student_class_placements old ON old.id=rp.placement_id
         WHERE rp.exam_test_id=$1::bigint AND NOT (s.id=ANY($2::bigint[])) ORDER BY s.id,rp.run_id DESC`, [id,known],
      )).rows;
      plan.students.push(...missing);
      const questionRows=(await client.query<QuestionRow>(
        `SELECT q.id::text AS id,q.xmin::text AS revision,q.topic_id::text AS "topicId",t.name AS "topicName",
          q.prompt_text AS prompt,q.prompt_rich AS "promptRich",q.prompt_image IS NOT NULL AS "hasPromptImage",
          q.option_a_text AS a,q.option_b_text AS b,q.option_c_text AS c,q.option_d_text AS d,q.option_e_text AS e,
          q.option_a_rich AS "richA",q.option_b_rich AS "richB",q.option_c_rich AS "richC",q.option_d_rich AS "richD",q.option_e_rich AS "richE",
          q.option_a_image IS NOT NULL AS "hasA",q.option_b_image IS NOT NULL AS "hasB",q.option_c_image IS NOT NULL AS "hasC",
          q.option_d_image IS NOT NULL AS "hasD",q.option_e_image IS NOT NULL AS "hasE",q.correct_option AS "correctOption"
         FROM question_bank q JOIN question_topics t ON t.id=q.topic_id ORDER BY q.id`,
      )).rows;
      questions=questionRows.map((row)=>({id:row.id,revision:row.revision,topicId:row.topicId,topicName:row.topicName,prompt:row.prompt,promptRich:row.promptRich,hasPromptImage:row.hasPromptImage,correctOption:row.correctOption,options:[
        {letter:"A",text:row.a,rich:row.richA,hasImage:row.hasA},{letter:"B",text:row.b,rich:row.richB,hasImage:row.hasB},
        {letter:"C",text:row.c,rich:row.richC,hasImage:row.hasC},{letter:"D",text:row.d,rich:row.richD,hasImage:row.hasD},
        {letter:"E",text:row.e,rich:row.richE,hasImage:row.hasE},
      ]}));
    }
    const active=await lockActiveAdminSession(client);
    if (!active || active.id !== admin.id) throw new ScheduleSessionExpired();
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(()=>{});
    if (error instanceof ScheduleSessionExpired) redirect("/login");
    return <Failure message="Pastikan database berjalan dan migrasi terbaru telah diterapkan." />;
  } finally { client?.release(); }
  if (!test || !plan) return <Failure message="Tes tidak ditemukan atau telah dihapus." />;
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9"><div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><CalendarClock className="size-5" /></span><div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 break-words text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Pelaksanaan Tes</h1><p className="mt-2 break-words text-[13px] leading-6 text-muted-foreground">{test.name} · {test.periodName}</p></div></div><Button asChild variant="outline" className="rounded-xl"><Link href={`/data-tes/monitoring?tes=${test.id}`}><ChartNoAxesCombined className="size-4" /> Hasil &amp; visibilitas nilai</Link></Button></div><ExamRunManager key={`${test.id}-${test.revision}`} test={test} plan={plan} runs={runs} questions={questions} /></div>;
}
function Failure({message}:{message:string}) { return <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-9"><h1 className="text-[29px] font-bold">Pelaksanaan Tes</h1><Alert variant="destructive" role="alert" className="mt-6 max-w-2xl"><CircleAlert className="size-4" /><AlertTitle>Pelaksanaan belum dapat dimuat</AlertTitle><AlertDescription>{message} <Link href="/data-tes/daftar" className="underline">Kembali ke Daftar Tes</Link>.</AlertDescription></Alert></div>; }
