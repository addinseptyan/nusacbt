"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarRange, CircleAlert, Eye, Info, Pencil, Plus, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { saveExamRun, changeExamRun } from "@/app/data-tes/daftar/[id]/actions";
import { QuestionPreview } from "@/app/data-tes/daftar/exam-test-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ExamRun, ExamRunKind, SessionPlanPage, SessionStudent } from "@/lib/exam-session-types";
import type { ExamTest, ExamTimeZone } from "@/lib/exam-test-types";
import type { Question } from "@/lib/question-types";

const selectClass="h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const PAGE_SIZE=20;
const kindLabel:Record<ExamRunKind,string>={regular:"Reguler",makeup:"Susulan",remedial:"Remidi"};
const local=(v:string)=>`${v.slice(8,10)}/${v.slice(5,7)}/${v.slice(0,4)} ${v.slice(11,16)}`;
type Notice={message:string;reload?:boolean}|null;
function ErrorNotice({error,onReload}:{error:NonNullable<Notice>;onReload:()=>void}) { return <Alert variant="destructive" role="alert"><CircleAlert className="size-4" /><AlertDescription>{error.message}{error.reload && <Button type="button" size="sm" variant="outline" className="mt-3 block" onClick={onReload}>Muat ulang</Button>}</AlertDescription></Alert>; }

function RunEditor({test,plan,run,questions,onClose}:{test:ExamTest;plan:SessionPlanPage;run:ExamRun|null;questions:Question[];onClose:()=>void}) {
  const router=useRouter(); const [pending,startSaving]=useTransition(); const [error,setError]=useState<Notice>(null);
  const [kind,setKind]=useState<ExamRunKind>(run?.kind ?? "regular");
  const [label,setLabel]=useState(run?.label ?? "Sesi 1");
  const [sessionNumber,setSessionNumber]=useState<number | null>(run?.sessionNumber ?? plan.groups[0]?.sessionNumber ?? null);
  const [startLocal,setStartLocal]=useState(run?.startLocal ?? test.startLocal); const [zone,setZone]=useState<ExamTimeZone>(run?.timeZone ?? test.timeZone);
  const [duration,setDuration]=useState(String(run?.durationMinutes ?? test.durationMinutes));
  const [mode,setMode]=useState<"inherit"|"custom">(run?.questionMode ?? "inherit");
  const [selected,setSelected]=useState<Set<string>>(()=>new Set(run?.participantIds ?? []));
  const [chosenQuestions,setChosenQuestions]=useState<string[]>(run?.customQuestionIds ?? []);
  const [classId,setClassId]=useState(""); const [query,setQuery]=useState(""); const [page,setPage]=useState(0);
  const [questionQuery,setQuestionQuery]=useState(""); const [questionPage,setQuestionPage]=useState(0); const [previewQuestion,setPreviewQuestion]=useState<string|null>(null);
  const byQuestion=useMemo(()=>new Map(questions.map((q)=>[q.id,q])),[questions]);
  const eligible=(row:SessionStudent)=>row.active && (kind!=="regular" || (sessionNumber!==null && row.sessionNumber===sessionNumber));
  const classMap=new Map<string,string>(); for (const row of plan.students) if (eligible(row)) classMap.set(row.classId,row.classLabel);
  const classes=[...classMap].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name));
  const normalized=query.trim().toLowerCase();
  const filtered=plan.students.filter((row)=>(eligible(row)||selected.has(row.studentId)) && (!normalized || [row.studentName,row.nisn,row.classLabel].some((s)=>s.toLowerCase().includes(normalized))));
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)), currentPage=Math.min(page,pages-1), visible=filtered.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  const selectedRows=plan.students.filter((row)=>selected.has(row.studentId));
  const invalidSelection=selectedRows.length!==selected.size || selectedRows.some((row)=>!eligible(row));
  const qNorm=questionQuery.trim().toLowerCase();
  const matchedQuestions=questions.filter((q)=>!qNorm || [q.id,q.topicName,q.prompt,...q.options.map((o)=>o.text)].some((s)=>s.toLowerCase().includes(qNorm)));
  const questionPages=Math.max(1,Math.ceil(matchedQuestions.length/PAGE_SIZE)), qPage=Math.min(questionPage,questionPages-1), visibleQuestions=matchedQuestions.slice(qPage*PAGE_SIZE,(qPage+1)*PAGE_SIZE);
  const selectedQuestionSet=new Set(chosenQuestions); const selectedGroup=plan.groups.find((g)=>g.sessionNumber===sessionNumber);
  const groupSize=plan.students.filter((row)=>row.sessionNumber===sessionNumber).length;
  function close(){if(!pending) onClose();}
  function changeKind(next:ExamRunKind){ setKind(next);setLabel(next==="regular" ? `Sesi ${plan.groups[0]?.sessionNumber ?? 1}` : kindLabel[next]);setSelected(new Set());setMode("inherit");setChosenQuestions([]);setClassId("");setPage(0);setError(null); }
  function changeGroup(value:string){const n=value ? Number(value) : null;setSessionNumber(n);if(!run)setLabel(`Sesi ${n ?? 1}`);setClassId("");setPage(0);setError(null);}
  function selectStudent(id:string,checked:boolean){const next=new Set(selected);if(checked)next.add(id);else next.delete(id);setSelected(next);setError(null);}
  function addClass(){if(!classId)return;const next=new Set(selected);for(const row of plan.students)if(row.classId===classId && eligible(row))next.add(row.studentId);setSelected(next);setError(null);}
  function addAll(){const next=new Set(selected);for(const row of plan.students)if(eligible(row))next.add(row.studentId);setSelected(next);setError(null);}
  function toggleQuestion(id:string){setChosenQuestions((current)=>current.includes(id)?current.filter((v)=>v!==id):[...current,id]);setError(null);}
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(invalidSelection){setError({message:"Ada peserta yang tidak aktif atau tidak berada di kelompok sesi yang dipilih. Hapus dari pilihan atau perbaiki pembagiannya.",reload:true});return;}
    if(kind==="regular" && !selectedGroup){setError({message:"Pilih kelompok sesi yang sudah disimpan."});return;}
    if(mode==="custom" && chosenQuestions.length>test.questionIds.length){setError({message:"Jumlah soal remidi tidak boleh melebihi soal reguler."});return;}
    const selectedQuestionRows=chosenQuestions.map((id)=>byQuestion.get(id));
    if(selectedQuestionRows.some((q)=>!q)){setError({message:"Ada soal yang tidak ditemukan. Muat ulang halaman.",reload:true});return;}
    const payload={testId:test.id,testRevision:test.revision,planRevision:plan.revision,runId:run?.id ?? null,runRevision:run?.revision ?? null,kind,label,
      sessionNumber:kind==="regular" ? sessionNumber : null,startLocal,timeZone:zone,
      durationMinutes:kind==="remedial" ? Number(duration) : test.durationMinutes,questionMode:kind==="remedial" ? mode : "inherit",
      participants:selectedRows.map((r)=>({studentId:r.studentId,placementId:r.placementId})),
      questions:kind==="remedial" && mode==="custom" ? selectedQuestionRows.map((q)=>({id:q!.id,revision:q!.revision})) : []};
    const form=new FormData();form.set("data",JSON.stringify(payload));setError(null);
    startSaving(async()=>{try{const result=await saveExamRun(form);if(!result.ok){setError({message:result.error,reload:result.reload});return;}onClose();toast.success(result.message);router.refresh();}catch{setError({message:"Hasil penyimpanan belum dapat dipastikan. Muat ulang sebelum mencoba lagi.",reload:true});}});
  }
  return <Dialog open onOpenChange={(open)=>{if(!open)close();}}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-4xl" showCloseButton={!pending} onEscapeKeyDown={(e)=>{if(pending)e.preventDefault();}} onInteractOutside={(e)=>{if(pending)e.preventDefault();}}>
    <DialogHeader><DialogTitle>{run ? "Ubah draf pelaksanaan" : "Tambah pelaksanaan"}</DialogTitle><DialogDescription>Rancangan {test.name} · {test.periodName}. Draf tidak terlihat peserta sampai dirilis.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5 pt-1">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><label htmlFor="run-kind" className="text-xs font-semibold">Jenis pelaksanaan</label><select id="run-kind" value={kind} disabled={pending||Boolean(run)} onChange={(e)=>changeKind(e.target.value as ExamRunKind)} className={selectClass}><option value="regular">Reguler</option><option value="makeup">Susulan</option><option value="remedial">Remidi</option></select></div>
        <div className="space-y-1.5"><label htmlFor="run-label" className="text-xs font-semibold">Nama pelaksanaan</label><Input id="run-label" value={label} maxLength={200} required disabled={pending} onChange={(e)=>setLabel(e.target.value)} placeholder="Contoh: Sesi 1" className="h-10" /></div>
        {kind==="regular" && <div className="space-y-1.5 sm:col-span-2"><label htmlFor="run-session" className="text-xs font-semibold">Kelompok sesi periode</label><select id="run-session" value={sessionNumber ?? ""} disabled={pending} onChange={(e)=>changeGroup(e.target.value)} className={selectClass}><option value="">Pilih kelompok sesi</option>{plan.groups.map((g)=><option key={g.sessionNumber} value={g.sessionNumber}>Sesi {g.sessionNumber} · kapasitas {g.capacity}</option>)}</select>{!plan.groups.length && <p className="text-xs text-destructive">Belum ada kelompok. Tutup dialog dan <Link href={`/data-tes/daftar/sesi?periode=${test.periodId}`} className="font-semibold underline">atur kelompok sesi</Link> terlebih dahulu.</p>}</div>}
        <div className="space-y-1.5"><label htmlFor="run-start" className="text-xs font-semibold">Tanggal dan waktu mulai</label><Input id="run-start" type="datetime-local" min="2000-01-01T00:00" max="2100-12-31T23:59" step={60} value={startLocal} required disabled={pending} onChange={(e)=>setStartLocal(e.target.value)} className="h-10" /></div>
        <div className="space-y-1.5"><label htmlFor="run-zone" className="text-xs font-semibold">Zona waktu</label><select id="run-zone" value={zone} disabled={pending} onChange={(e)=>setZone(e.target.value as ExamTimeZone)} className={selectClass}><option value="WIB">WIB (UTC+7)</option><option value="WITA">WITA (UTC+8)</option><option value="WIT">WIT (UTC+9)</option></select></div>
        <div className="space-y-1.5"><label htmlFor="run-duration" className="text-xs font-semibold">Durasi (menit)</label><Input id="run-duration" type="number" min={1} max={10080} step={1} value={kind==="remedial" ? duration : String(test.durationMinutes)} disabled={pending||kind!=="remedial"} onChange={(e)=>setDuration(e.target.value)} className="h-10" /><p className="text-xs text-muted-foreground">{kind==="remedial" ? "Remidi boleh memakai durasi berbeda." : "Reguler dan susulan mengikuti durasi rancangan tes."}</p></div>
      </div>
      <fieldset disabled={pending} className="space-y-3 rounded-xl border p-4"><legend className="px-1 text-sm font-bold">Peserta pelaksanaan</legend><p className="text-xs leading-5 text-muted-foreground">{kind==="regular" ? "Hanya siswa dalam kelompok sesi periode ini yang dapat dipilih. Tambahkan kelas atau semua kelompok, lalu hilangkan centang untuk pengecualian." : "Tambahkan kelas dan/atau individu, lalu hilangkan centang untuk pengecualian. Susulan dan remidi tidak otomatis mengubah sesi reguler."}</p>
        <div className="flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1 space-y-1"><label htmlFor="run-class" className="block text-xs font-semibold">Kelas untuk ditambahkan</label><select id="run-class" value={classId} onChange={(e)=>setClassId(e.target.value)} className={selectClass}><option value="">Pilih kelas</option>{classes.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><Button type="button" variant="outline" disabled={!classId} onClick={addClass}>Tambahkan kelas</Button><Button type="button" variant="outline" disabled={kind==="regular" && !selectedGroup} onClick={addAll}>Pilih semua yang tersedia</Button></div>
        <div className="flex flex-wrap items-end justify-between gap-2"><div className="w-full max-w-sm space-y-1"><label htmlFor="run-student-search" className="block text-xs font-semibold">Cari peserta</label><Input id="run-student-search" value={query} onChange={(e)=>{setQuery(e.target.value);setPage(0);}} placeholder="Nama, NISN, atau kelas" className="h-10" /></div><Badge variant="secondary">{selected.size} dipilih{kind==="regular" && selectedGroup ? ` / ${selectedGroup.capacity} tempat` : ""}</Badge></div>
        {kind==="regular" && selectedGroup && <p className="text-xs leading-5 text-muted-foreground">Kelompok ini berisi {groupSize} siswa. {Math.max(0,groupSize-selectedRows.filter((row)=>row.sessionNumber===sessionNumber).length)} siswa kelompok belum dipilih dan tidak akan menerima jadwal pelaksanaan ini.</p>}
        {invalidSelection && <p role="alert" className="text-xs text-destructive">Ada peserta yang tidak aktif atau sudah berpindah kelompok. Perbaiki pilihan sebelum menyimpan.</p>}
        {!visible.length ? <p className="rounded-xl bg-muted/50 p-3 text-xs">Tidak ada siswa yang tersedia untuk pilihan ini.</p> : <ul aria-label="Pilih peserta pelaksanaan" className="divide-y rounded-xl border">{visible.map((row)=><li key={row.studentId} className="p-3"><label className="flex items-start gap-2"><input type="checkbox" aria-label={`Peserta ${row.studentName} ${row.nisn}`} checked={selected.has(row.studentId)} disabled={!eligible(row)&&!selected.has(row.studentId)} onChange={(e)=>selectStudent(row.studentId,e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" /><span className="min-w-0 break-words text-xs leading-5"><strong>{row.studentName}</strong> · {row.nisn} · {row.classLabel}{row.sessionNumber!==null && <> · Sesi {row.sessionNumber}</>}{!eligible(row) && <span className="text-destructive"> · tidak lagi sesuai</span>}</span></label></li>)}</ul>}
        {pages>1 && <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>Halaman {currentPage+1} dari {pages}</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Sebelumnya</Button><Button type="button" size="sm" variant="outline" disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>Berikutnya</Button></div></div>}
      </fieldset>
      <fieldset disabled={pending} className="space-y-3 rounded-xl border p-4"><legend className="px-1 text-sm font-bold">Soal dan aturan</legend><p className="text-xs leading-5 text-muted-foreground">Reguler dan susulan memakai {test.questionIds.length} soal serta pengaturan acak dari rancangan tes. Rancangan mengikuti bank terkini; snapshot disimpan saat peserta mulai.</p>
        {kind==="remedial" && <><label className="flex items-center gap-2 text-sm"><input type="radio" name="questionMode" checked={mode==="inherit"} onChange={()=>setMode("inherit")} /> Gunakan soal reguler</label><label className="flex items-center gap-2 text-sm"><input type="radio" name="questionMode" checked={mode==="custom"} onChange={()=>setMode("custom")} /> Pilih soal lain dari bank</label></>}
        {kind==="remedial" && mode==="custom" && <div className="space-y-3"><p className="text-xs text-muted-foreground">Pilih maksimal {test.questionIds.length} soal. Draf boleh kosong, tetapi tidak dapat dirilis sebelum diisi.</p><label htmlFor="run-question-search" className="block text-xs font-semibold">Cari soal</label><Input id="run-question-search" value={questionQuery} onChange={(e)=>{setQuestionQuery(e.target.value);setQuestionPage(0);setPreviewQuestion(null);}} placeholder="Isi, pilihan, topik, atau ID" className="h-10" /><p className="text-xs">{chosenQuestions.length} soal dipilih</p>
          <ul aria-label="Pilih soal remidi" className="divide-y rounded-xl border">{visibleQuestions.map((q)=><li key={q.id} className="min-w-0 p-3"><div className="flex items-start gap-2"><label className="flex min-w-0 flex-1 items-start gap-2"><input type="checkbox" aria-label={`Pilih soal remidi ${q.id}`} checked={selectedQuestionSet.has(q.id)} onChange={()=>toggleQuestion(q.id)} className="mt-0.5 size-4 shrink-0 accent-primary" /><span className="min-w-0 break-words text-xs leading-5"><strong>#{q.id} · {q.topicName}</strong><span className="block text-muted-foreground">{q.prompt.slice(0,150) || (q.hasPromptImage ? "[Gambar soal]" : "[Isi soal]")}</span></span></label><Button type="button" size="sm" variant="ghost" aria-label={`Lihat soal remidi ${q.id}`} onClick={()=>setPreviewQuestion(previewQuestion===q.id?null:q.id)}><Eye className="size-4" /> Lihat</Button></div>{previewQuestion===q.id && <QuestionPreview question={q} />}</li>)}</ul>
          {questionPages>1 && <div className="flex items-center justify-between gap-2 text-xs"><span>Soal: halaman {qPage+1} dari {questionPages}</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={qPage===0} onClick={()=>setQuestionPage(qPage-1)}>Sebelumnya</Button><Button type="button" size="sm" variant="outline" disabled={qPage+1>=questionPages} onClick={()=>setQuestionPage(qPage+1)}>Berikutnya</Button></div></div>}
        </div>}
      </fieldset>
      {error && <ErrorNotice error={error} onReload={()=>{close();router.refresh();}} />}
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Batal</Button><Button type="submit" disabled={pending}>{pending ? "Menyimpan..." : "Simpan draf"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

function RunActionDialog({test,run,students,planRevision,operation,onClose}:{test:ExamTest;run:ExamRun;students:SessionStudent[];planRevision:string|null;operation:"publish"|"unpublish"|"delete";onClose:()=>void}) {
  const router=useRouter(); const [pending,startTransition]=useTransition(); const [error,setError]=useState<Notice>(null);
  const names=new Map(students.map((s)=>[s.studentId,s]));
  const selectedIds=new Set(run.participantIds);
  const omitted=run.kind==="regular" ? students.filter((s)=>s.sessionNumber===run.sessionNumber && !selectedIds.has(s.studentId)).length : 0;
  const title=operation==="publish" ? "Rilis jadwal pelaksanaan?" : operation==="unpublish" ? "Tarik rilis jadwal?" : "Hapus draf pelaksanaan?";
  function perform(){const form=new FormData();form.set("data",JSON.stringify({testId:test.id,testRevision:test.revision,planRevision,runId:run.id,runRevision:run.revision,operation}));setError(null);startTransition(async()=>{try{const result=await changeExamRun(form);if(!result.ok){setError({message:result.error,reload:result.reload});return;}onClose();toast.success(result.message);router.refresh();}catch{setError({message:"Hasil tindakan belum dapat dipastikan. Muat ulang sebelum mencoba lagi.",reload:true});}});}
  return <Dialog open onOpenChange={(open)=>{if(!open&&!pending)onClose();}}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg" showCloseButton={!pending} onEscapeKeyDown={(e)=>{if(pending)e.preventDefault();}} onInteractOutside={(e)=>{if(pending)e.preventDefault();}}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription><strong className="text-foreground">{test.name} · {run.label}</strong> · {local(run.startLocal)} {run.timeZone} · {run.participantIds.length} peserta.</DialogDescription></DialogHeader>
    <p className="text-xs leading-5 text-muted-foreground">{operation==="publish" ? "Jadwal hanya tampil kepada peserta dalam daftar ini. Server memeriksa kelas aktif, soal, kelompok, dan bentrok sebelum merilis; akun login tetap perlu disiapkan." : operation==="unpublish" ? "Jadwal tidak lagi tampil kepada peserta pada permintaan berikutnya. Perubahan yang sudah terlihat di layar tidak dapat ditarik kembali." : "Draf dan daftar peserta pelaksanaan ini dihapus, bukan soal bank atau rancangan tes."}</p>
    {operation==="publish" && run.kind==="regular" && <p className="rounded-xl border bg-muted/40 p-3 text-xs leading-5">{omitted ? `${omitted} siswa lain dalam kelompok sesi ini tidak dipilih dan tidak akan menerima jadwal ini. Periksa apakah pengecualian tersebut disengaja.` : "Semua siswa dalam kelompok sesi ini tercantum pada daftar pelaksanaan."}</p>}
    {operation==="publish" && <ul aria-label="Peserta yang akan menerima jadwal" className="max-h-48 divide-y overflow-y-auto rounded-xl border">{run.participantIds.map((id)=><li key={id} className="break-words p-2 text-xs">{names.get(id)?.studentName ?? `Siswa #${id}`} · {names.get(id)?.nisn ?? "—"}</li>)}</ul>}
    {error && <ErrorNotice error={error} onReload={()=>{onClose();router.refresh();}} />}
    <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Batal</Button><Button type="button" variant={operation==="delete" ? "destructive" : "default"} disabled={pending} onClick={perform}>{pending ? "Memproses..." : operation==="publish" ? "Ya, rilis jadwal" : operation==="unpublish" ? "Ya, tarik rilis" : "Ya, hapus draf"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function RunStatusBadge({ published }: { published: boolean }) {
  return <Badge variant="outline" data-status={published ? "published" : "draft"} className={published
    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"}>
    <span aria-hidden="true" className="relative inline-flex size-1.5 shrink-0">
      {!published && <span className="absolute inline-flex size-full rounded-full bg-amber-500 opacity-60 motion-safe:animate-ping motion-safe:[animation-iteration-count:3]" />}
      <span className={`relative inline-flex size-1.5 rounded-full ${published ? "bg-emerald-600 dark:bg-emerald-400" : "bg-amber-600 dark:bg-amber-400"}`} />
    </span>
    {published ? "Dirilis" : "Draf"}
  </Badge>;
}

export function ExamRunManager({test,plan,runs,questions}:{test:ExamTest;plan:SessionPlanPage;runs:ExamRun[];questions:Question[]}) {
  const [editor,setEditor]=useState<ExamRun|null|undefined>(undefined);
  const [action,setAction]=useState<{run:ExamRun;operation:"publish"|"unpublish"|"delete"}|null>(null);
  const names=new Map(plan.students.map((s)=>[s.studentId,s]));
  return <div className="max-w-6xl space-y-5"><div className="flex flex-wrap gap-2"><Button asChild variant="ghost" size="sm"><Link href="/data-tes/daftar"><ArrowLeft className="size-4" /> Daftar Tes</Link></Button><Button asChild variant="outline" size="sm"><Link href={`/data-tes/daftar/sesi?periode=${test.periodId}`}><CalendarRange className="size-4" /> Atur kelompok sesi periode</Link></Button></div>
    <Alert className="rounded-2xl border-[#e3e6fa] bg-[#f2f3ff] text-[#4b5893] dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"><Info className="size-4" /><AlertTitle>Sesi tetap, jadwal per tes</AlertTitle><AlertDescription className="text-xs leading-5">Siswa memakai kelompok sesi reguler yang sama sepanjang periode. Atur waktu tiap sesi untuk tes ini, lalu rilis satu per satu. Susulan dan remidi dapat memilih peserta berbeda. Setelah peserta mulai, pelaksanaan tidak dapat ditarik untuk melindungi riwayat pengerjaan.</AlertDescription></Alert>
    <Card className="gap-0 rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="break-words text-base font-bold">{test.name}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{test.periodName} · {test.questionIds.length} soal · {test.durationMinutes} menit · acak soal {test.shuffleQuestions ? "aktif" : "tidak"} · acak pilihan {test.shuffleOptions ? "aktif" : "tidak"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Jadwal dasar rancangan: {local(test.startLocal)} {test.timeZone}. Waktu pelaksanaan diatur terpisah; token khusus tetap satu untuk tes induk dan semua pelaksanaannya.</p></div><Button type="button" onClick={()=>setEditor(null)}><Plus className="size-4" /> Tambah pelaksanaan</Button></div></Card>
    <Card className="gap-0 rounded-2xl p-5 sm:p-6"><h2 className="text-base font-bold">Daftar pelaksanaan</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Draf tidak ditampilkan peserta. Rilis memeriksa bentrok jadwal untuk setiap peserta; akun login dan ketersediaan ruang tetap perlu diperiksa admin.</p>
      {!runs.length ? <p className="mt-5 rounded-xl bg-muted/50 p-4 text-xs">Belum ada pelaksanaan. Jadwal tes lama tidak tampil kepada peserta sampai diatur dan dirilis.</p> : <ul aria-label="Daftar pelaksanaan tes" className="mt-4 divide-y rounded-xl border">{runs.map((run)=><li key={run.id} className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-2"><h3 className="break-words text-sm font-bold">{kindLabel[run.kind]} · {run.label}</h3><RunStatusBadge published={Boolean(run.publishedAt)} /></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{local(run.startLocal)}–{local(run.endLocal)} {run.timeZone} · {run.durationMinutes} menit · {run.participantIds.length} peserta{run.sessionNumber!==null ? ` · kelompok sesi ${run.sessionNumber}` : ""}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Soal: {run.questionMode==="inherit" ? `mengikuti reguler (${test.questionIds.length})` : `pilihan remidi (${run.customQuestionIds.length})`}{run.publishedAt && <> · dirilis oleh {run.publishedBy} pada {run.publishedAt}</>}</p></div><div className="flex flex-wrap gap-2">{!run.publishedAt ? <><Button type="button" size="sm" variant="outline" aria-label={`Ubah pelaksanaan ${run.label}`} onClick={()=>setEditor(run)}><Pencil className="size-3.5" /> Ubah</Button><Button type="button" size="sm" variant="outline" aria-label={`Hapus pelaksanaan ${run.label}`} onClick={()=>setAction({run,operation:"delete"})}><Trash2 className="size-3.5" /> Hapus</Button><Button type="button" size="sm" aria-label={`Rilis ${run.label}`} onClick={()=>setAction({run,operation:"publish"})}><Send className="size-3.5" /> Rilis</Button></> : <Button type="button" size="sm" variant="outline" aria-label={`Tarik rilis ${run.label}`} onClick={()=>setAction({run,operation:"unpublish"})}><Undo2 className="size-3.5" /> Tarik rilis</Button>}</div></div>
        <details className="text-xs"><summary className="cursor-pointer font-semibold">Lihat {run.participantIds.length} peserta</summary><ul className="mt-2 max-h-48 divide-y overflow-y-auto rounded-lg border">{run.participantIds.map((id)=><li key={id} className="break-words p-2">{names.get(id)?.studentName ?? `Siswa #${id}`} · {names.get(id)?.nisn ?? "—"} · {names.get(id)?.classLabel ?? "—"}</li>)}</ul></details>
      </li>)}</ul>}
    </Card>
    {editor!==undefined && <RunEditor key={editor?.id ?? "new"} test={test} plan={plan} run={editor} questions={questions} onClose={()=>setEditor(undefined)} />}
    {action && <RunActionDialog test={test} run={action.run} students={plan.students} planRevision={plan.revision} operation={action.operation} onClose={()=>setAction(null)} />}
  </div>;
}
