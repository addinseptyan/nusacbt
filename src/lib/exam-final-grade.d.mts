export type FinalGradeMethod = 'highest' | 'average';
export type FinalGradeAttempt = { correctCount: number; questionCount: number };
export function calculateFinalGrade(method: FinalGradeMethod, attempts: FinalGradeAttempt[]): number | null;
export function formatFinalGrade(score: number): string;
