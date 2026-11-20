export type SessionPeriod = { id: string; name: string; startDate: string };
export type SessionGroup = { sessionNumber: number; capacity: number };
export type SessionStudent = {
  studentId: string; studentName: string; nisn: string;
  placementId: string; classId: string; classLabel: string;
  active: boolean; sessionNumber: number | null;
};
export type SessionPlanPage = {
  periods: SessionPeriod[]; selected: SessionPeriod | null; selectionMissing: boolean;
  revision: string | null; groups: SessionGroup[]; students: SessionStudent[];
};
export type ScheduleActionResult = { ok: true; message: string } | { ok: false; error: string; reload?: boolean };
export type ExamRunKind = "regular" | "makeup" | "remedial";
export type ExamRun = {
  id: string; revision: string; kind: ExamRunKind; label: string; sessionNumber: number | null;
  startLocal: string; endLocal: string; timeZone: "WIB" | "WITA" | "WIT"; durationMinutes: number;
  questionMode: "inherit" | "custom"; participantIds: string[]; customQuestionIds: string[];
  publishedAt: string | null; publishedBy: string | null;
};
