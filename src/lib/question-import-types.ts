export type QuestionImportPart = { text: string; rich: unknown; imageUrl: string | null };
export type QuestionImportPreview = {
  operationId: string;
  token: string;
  topicId: string;
  topicName: string;
  questions: { number: number; prompt: QuestionImportPart; options: QuestionImportPart[]; correctOption: string }[];
};
export type QuestionImportPreviewResult = { ok: true; preview: QuestionImportPreview } | { ok: false; error: string };
export type QuestionImportSaveResult = { ok: true; count: number; alreadySaved: boolean } | { ok: false; error: string };
