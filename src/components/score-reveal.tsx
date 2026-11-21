import { Eye, EyeOff } from "lucide-react";

/**
 * Penyamaran visual, bukan kontrol akses. Nilai hanya boleh diberikan oleh
 * server setelah memeriksa sesi, kepemilikan, status selesai, dan kebijakan.
 * <details> tetap bisa dibuka dengan keyboard maupun tanpa JavaScript.
 */
export function ScoreReveal({ score }: { score: string }) {
  return <details className="group min-w-0" data-testid="score-reveal">
    <summary className="flex w-fit cursor-pointer list-none flex-wrap items-center gap-2 rounded-lg py-1 text-sm font-semibold text-emerald-800 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:text-emerald-200 [&::-webkit-details-marker]:hidden">
      <span className="group-open:hidden"><span aria-hidden="true" className="inline-block select-none text-2xl font-bold tabular-nums blur-[5px]">88,88</span><span className="sr-only">Nilai disamarkan. </span></span>
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-background px-2.5 py-1.5 group-open:hidden dark:border-emerald-700"><Eye className="size-4" aria-hidden="true" /> Perlihatkan nilai</span>
      <span className="hidden items-center gap-1.5 rounded-lg border border-emerald-300 bg-background px-2.5 py-1.5 group-open:inline-flex dark:border-emerald-700"><EyeOff className="size-4" aria-hidden="true" /> Samarkan nilai</span>
    </summary>
    <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-900 dark:text-emerald-100" data-testid="score-value">{score}</p>
  </details>;
}
