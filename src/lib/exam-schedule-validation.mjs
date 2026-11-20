import { validDataId } from "./class-validation.mjs";
import { EXAM_TEST_MAX_DURATION, EXAM_TEST_MAX_QUESTIONS, validateExamStart } from "./exam-test-validation.mjs";
import { SESSION_MAX_GROUPS, SESSION_MAX_STUDENTS } from "./exam-session-validation.mjs";
import { validTopicRevision } from "./topic-validation.mjs";

/** @param {unknown} value @returns {value is string | null} */
function validPlanRevision(value) {
  return value === null || (typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) < BigInt("9223372036854775807"));
}

/**
 * @param {unknown} raw
 * @returns {{ok:true,value:{testId:string,testRevision:string,planRevision:string|null,runId:string|null,runRevision:string|null,kind:'regular'|'makeup'|'remedial',label:string,sessionNumber:number|null,startsAt:string,timeZone:'WIB'|'WITA'|'WIT',durationMinutes:number,questionMode:'inherit'|'custom',participants:Array<{studentId:string,placementId:string}>,questions:Array<{id:string,revision:string}>}}|{ok:false,error:string}}
 */
export function validateExamRun(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {ok:false,error:"Data pelaksanaan tidak valid."};
  const v = /** @type {Record<string, unknown>} */ (raw);
  const testId = validDataId(v.testId), testRevision = validTopicRevision(v.testRevision);
  const runId = v.runId === null ? null : validDataId(v.runId);
  const runRevision = v.runId === null && v.runRevision === null ? null : validTopicRevision(v.runRevision);
  if (!testId || !testRevision || !validPlanRevision(v.planRevision) || (v.runId !== null && !runId) || (runId && !runRevision) || (v.runId === null && v.runRevision !== null)) return {ok:false,error:"Tes atau versi pelaksanaan tidak valid. Muat ulang halaman."};
  if (v.kind !== "regular" && v.kind !== "makeup" && v.kind !== "remedial") return {ok:false,error:"Jenis pelaksanaan tidak valid."};
  if (typeof v.label !== "string" || v.label.length > 200 || !v.label.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(v.label)) return {ok:false,error:"Nama pelaksanaan wajib diisi, maksimal 100 karakter tanpa karakter kontrol."};
  const label = v.label.trim();
  if (!label || Array.from(label).length > 100) return {ok:false,error:"Nama pelaksanaan wajib diisi, maksimal 100 karakter."};
  if (v.kind === "regular" ? (typeof v.sessionNumber !== "number" || !Number.isInteger(v.sessionNumber) || v.sessionNumber < 1 || v.sessionNumber > SESSION_MAX_GROUPS) : v.sessionNumber !== null) return {ok:false,error:"Kelompok sesi tidak sesuai jenis pelaksanaan."};
  const schedule = validateExamStart(v.startLocal, v.timeZone); if (!schedule.ok) return schedule;
  if (typeof v.durationMinutes !== "number" || !Number.isInteger(v.durationMinutes) || v.durationMinutes < 1 || v.durationMinutes > EXAM_TEST_MAX_DURATION) return {ok:false,error:"Durasi harus berupa menit bulat antara 1 dan 10080."};
  if ((v.questionMode !== "inherit" && v.questionMode !== "custom") || (v.kind !== "remedial" && v.questionMode !== "inherit")) return {ok:false,error:"Pilihan soal tidak sesuai jenis pelaksanaan."};
  if (!Array.isArray(v.participants) || v.participants.length > SESSION_MAX_STUDENTS) return {ok:false,error:`Pilih maksimal ${SESSION_MAX_STUDENTS} siswa.`};
  /** @type {Array<{studentId:string,placementId:string}>} */ const participants=[]; const seenStudents=new Set();
  for (const item of v.participants) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return {ok:false,error:"Daftar peserta tidak valid."};
    const row=/** @type {Record<string,unknown>} */(item), studentId=validDataId(row.studentId), placementId=validDataId(row.placementId);
    if (!studentId || !placementId || seenStudents.has(studentId)) return {ok:false,error:"Peserta atau penempatan tidak valid, atau siswa dipilih dua kali."};
    seenStudents.add(studentId); participants.push({studentId,placementId});
  }
  if (!Array.isArray(v.questions) || v.questions.length > EXAM_TEST_MAX_QUESTIONS || (v.questionMode === "inherit" && v.questions.length)) return {ok:false,error:"Daftar soal remidi tidak valid."};
  /** @type {Array<{id:string,revision:string}>} */ const questions=[]; const seenQuestions=new Set();
  for (const item of v.questions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return {ok:false,error:"Daftar soal remidi tidak valid."};
    const row=/** @type {Record<string,unknown>} */(item), id=validDataId(row.id), revision=validTopicRevision(row.revision);
    if (!id || !revision || seenQuestions.has(id)) return {ok:false,error:"Soal ganda atau versi soal tidak valid. Muat ulang halaman."};
    seenQuestions.add(id); questions.push({id,revision});
  }
  return {ok:true,value:{testId,testRevision,planRevision:v.planRevision,runId,runRevision,kind:v.kind,label,sessionNumber:/** @type {number|null} */(v.sessionNumber),startsAt:schedule.value.startsAt,timeZone:schedule.value.zone,durationMinutes:v.durationMinutes,questionMode:v.questionMode,participants,questions}};
}

/** @param {unknown} raw @returns {{ok:true,value:{testId:string,testRevision:string,planRevision:string|null,runId:string,runRevision:string,operation:'publish'|'unpublish'|'delete'}}|{ok:false,error:string}} */
export function validateExamRunOperation(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {ok:false,error:"Permintaan tidak valid."};
  const v=/** @type {Record<string,unknown>} */(raw);
  const testId=validDataId(v.testId),testRevision=validTopicRevision(v.testRevision),runId=validDataId(v.runId),runRevision=validTopicRevision(v.runRevision);
  if (!testId || !testRevision || !validPlanRevision(v.planRevision) || !runId || !runRevision || (v.operation !== "publish" && v.operation !== "unpublish" && v.operation !== "delete")) return {ok:false,error:"Identitas, versi, atau tindakan tidak valid. Muat ulang halaman."};
  return {ok:true,value:{testId,testRevision,planRevision:v.planRevision,runId,runRevision,operation:v.operation}};
}
