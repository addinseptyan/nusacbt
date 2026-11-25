import { Award, CircleAlert, Clock3, Info } from "lucide-react";

import { ScoreCategoryControl, type ScoreCategory } from "@/app/data-tes/pengaturan-pengerjaan/score-category-control";
import { SettingForm } from "@/app/data-tes/pengaturan-pengerjaan/setting-form";
import { AccessDenied } from "@/components/access-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { requireAdminAccess } from "@/lib/admin-auth";
import { getPostgresPool } from "@/lib/postgres";

export const metadata = { title: "Pengaturan Pengerjaan — NusaCBT", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function WorkSettingsPage() {
  const { allowed } = await requireAdminAccess("exam_controls.manage");
  if (!allowed) return <AccessDenied section="Data tes" title="Pengaturan Pengerjaan" />;
  let data: { minutes: number; revision: string }; let categories: ScoreCategory[];
  try {
    const result = await getPostgresPool().query<{ minutes: number; revision: string }>(
      'SELECT submission_window_minutes AS minutes,revision::text AS revision FROM exam_work_settings WHERE id=1',
    );
    if (result.rowCount !== 1) throw new Error("Pengaturan belum tersedia.");
    data = result.rows[0];
    categories = (await getPostgresPool().query<ScoreCategory>(
      `SELECT kind,visible_to_participants AS visible,revision::text AS revision
       FROM exam_score_category_visibility
       ORDER BY CASE kind WHEN 'regular' THEN 1 WHEN 'makeup' THEN 2 ELSE 3 END`,
    )).rows;
    if (categories.length !== 3 || categories.map((item) => item.kind).join(",") !== "regular,makeup,remedial") throw new Error("Pengaturan kategori belum lengkap.");
  } catch {
    return <div className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-bold">Pengaturan Pengerjaan</h1><Alert variant="destructive" className="mt-5"><CircleAlert className="size-4" /><AlertTitle>Pengaturan belum dapat dimuat</AlertTitle><AlertDescription>Periksa PostgreSQL dan migrasi terbaru, lalu muat ulang.</AlertDescription></Alert></div>;
  }
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-9">
    <div className="mb-6 flex items-start gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"><Clock3 className="size-5" /></span><div><p className="text-[10px] font-bold tracking-[0.15em] text-primary uppercase">Data tes</p><h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">Pengaturan Pengerjaan</h1><p className="mt-2 text-[13px] leading-6 text-muted-foreground">Atur pengumpulan manual dan visibilitas nilai per kategori.</p></div></div>
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
      <Card className="min-w-0 gap-0 rounded-[22px] p-5 sm:p-6"><h2 className="text-base font-bold">Pengumpulan tes</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Peserta dapat menekan tombol selesai kapan saja, tetapi baru dapat mengumpulkan pada sejumlah menit terakhir sebelum batas jadwal. Waktu habis tetap dikumpulkan otomatis.</p>
        <Alert className="my-5 rounded-xl"><Info className="size-4" /><AlertTitle>Berlaku untuk semua tes</AlertTitle><AlertDescription className="text-xs leading-5">Perubahan langsung berlaku juga bagi pengerjaan yang sedang berlangsung. Jika batas lebih besar daripada sisa durasi, peserta dapat mengumpulkan segera. Keputusan mengikuti jam server, bukan jam perangkat siswa.</AlertDescription></Alert>
        <SettingForm key={data.revision} minutes={data.minutes} revision={data.revision} />
      </Card>
      <Card className="min-w-0 gap-0 rounded-[22px] p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-bold"><Award className="size-5 text-indigo-600 dark:text-indigo-300" /> Visibilitas nilai peserta</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Nilai satu pengerjaan tersedia setelah selesai dan secara awal disamarkan. Pilihan ini berlaku langsung untuk seluruh tes dalam kategori tersebut, termasuk hasil lama.</p>
        <Alert className="my-5 rounded-xl"><Info className="size-4" /><AlertTitle>Berlaku untuk semua tes</AlertTitle><AlertDescription className="text-xs leading-5">Default ketiga kategori adalah ditampilkan. Hanya pemilik pengerjaan yang sudah selesai dapat menerima nilai. Nilai akhir yang ditetapkan hanya dibagikan jika semua kategori pengerjaan penyumbangnya ditampilkan. Menyembunyikan mencegah pengiriman berikutnya, tetapi tidak menarik kembali nilai yang sudah dilihat. Samaran visual bukan pembatas keamanan.</AlertDescription></Alert>
        <div className="space-y-3">{categories.map((category) => <ScoreCategoryControl key={`${category.kind}-${category.revision}`} {...category} />)}</div>
      </Card>
    </div>
  </div>;
}
