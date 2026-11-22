export type AcademicClass = { id: string; label: string; level: string; majorId: string };
export type RolloverChoice = { studentId: string; action: 'promoted' | 'repeated' | 'graduated' | 'left' | 'keep'; classId: string };
export function validateAcademicYearName(value: unknown): { ok: true; value: string } | { ok: false; error: string };
export function suggestedPromotion(source: { level: string; majorId: string }, classes: AcademicClass[]): string | null;
export function parseRolloverChoices(raw: unknown): RolloverChoice[] | null;
