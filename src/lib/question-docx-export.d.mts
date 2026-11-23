export class QuestionDocxExportError extends Error {}

export type ExportQuestionInput = {
  topicName?: string;
  promptText: string;
  promptRich?: unknown;
  promptImage?: Buffer | null;
  promptImageMime?: string | null;
  options: Array<{
    text: string;
    rich?: unknown;
    image?: Buffer | null;
    imageMime?: string | null;
  }>;
  correctOption: "A" | "B" | "C" | "D" | "E";
};

export function buildQuestionDocx(
  questions: ExportQuestionInput[],
  options?: { title?: string; includeKeys?: boolean },
): Promise<Buffer>;
