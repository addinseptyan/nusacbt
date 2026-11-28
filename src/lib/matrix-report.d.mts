import type { FinalGradeMethod } from './exam-final-grade.mjs';
import type { MonitoringKind } from './monitoring-filter.mjs';
export type MatrixAttempt = { id:string; studentId:string; student:string; nisn:string; className:string; yearId:string|null; year:string|null; testId:string; testName:string; testTags?:string[]; period:string; kind:MonitoringKind; method:FinalGradeMethod; correct:number; questions:number; completed:string };
export type MatrixCell = { kind:MonitoringKind|'conflict'; score:number|null; attempts:number };
export type MatrixColumn = { id:string; name:string; period:string; year:string|null; tags:string[] };
export type MatrixRow = { key:string; studentId:string; name:string; nisn:string; className:string; year:string|null; cells:Record<string,MatrixCell>; average:number|null; scoredCount:number; conflicts:number };
export function buildResultMatrix(attempts:MatrixAttempt[],merge:boolean):{columns:MatrixColumn[];rows:MatrixRow[]};
