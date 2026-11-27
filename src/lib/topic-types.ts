export type QuestionTopic = {
  id: string;
  name: string;
  tags: string[];
  questionCount?: number;
  // Versi baris untuk menolak perubahan atau penghapusan dari halaman usang.
  revision: string;
};

export type TopicActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; reload?: boolean };
