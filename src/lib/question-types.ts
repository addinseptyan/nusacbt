export const QUESTION_LETTERS = ["A", "B", "C", "D", "E"] as const;
export const QUESTION_IMAGE_SLOTS = ["prompt", ...QUESTION_LETTERS] as const;

export type QuestionLetter = (typeof QUESTION_LETTERS)[number];
export type QuestionImageSlot = (typeof QUESTION_IMAGE_SLOTS)[number];

export type QuestionTopicOption = { id: string; name: string };
export type QuestionOption = { letter: QuestionLetter; text: string; rich: unknown | null; hasImage: boolean };
export type Question = {
  id: string;
  revision: string;
  topicId: string;
  topicName: string;
  prompt: string;
  promptRich: unknown | null;
  hasPromptImage: boolean;
  options: QuestionOption[];
  correctOption: QuestionLetter;
};

export type QuestionActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; reload?: boolean };
