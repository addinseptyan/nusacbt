export type ExamTimeZone = "WIB" | "WITA" | "WIT";
export type ExamPeriodOption = { id: string; name: string; startDate: string; endDate: string | null; isActive?: boolean };
export type ExamTest = {
  id: string; revision: string; name: string; periodId: string; periodName: string;
  startLocal: string; endLocal: string; timeZone: ExamTimeZone; durationMinutes: number;
  shuffleQuestions: boolean; shuffleOptions: boolean; questionIds: string[];
};
