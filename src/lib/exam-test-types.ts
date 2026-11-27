export type ExamTimeZone = "WIB" | "WITA" | "WIT";
export type ExamPeriodOption = { id: string; name: string; startDate: string; endDate: string | null; isActive?: boolean };
export type ExamTestRunStatusSummary = { draft: number; published: number };
export type ExamTestRunSummary = {
  regular: ExamTestRunStatusSummary;
  makeup: ExamTestRunStatusSummary;
  remedial: ExamTestRunStatusSummary;
};
export type ExamTest = {
  id: string;
  revision: string;
  name: string;
  tags: string[];
  periodId: string;
  periodName: string;
  periodStartDate?: string;
  periodEndDate?: string | null;
  startLocal: string;
  endLocal: string;
  timeZone: ExamTimeZone;
  durationMinutes: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  questionIds: string[];
  runSummary?: ExamTestRunSummary;
};
