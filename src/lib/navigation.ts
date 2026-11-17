import {
  BarChart3,
  BookOpenText,
  ClipboardList,
  LayoutDashboard,
  Settings2,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavigationPage = {
  title: string;
  href: string;
  description: string;
  template?: { href: string; label: string; detail: string };
};

type NavigationSection = {
  title: string;
  icon: LucideIcon;
  href?: string;
  pages?: NavigationPage[];
};

export const navigation: NavigationSection[] = [
  { title: "Dashboard", icon: LayoutDashboard, href: "/" },
  {
    title: "Data Modul",
    icon: BookOpenText,
    pages: [
      { title: "Topik / Mata Pelajaran", href: "/data-modul/topik", description: "Kelola topik dan mata pelajaran untuk mengelompokkan bank soal." },
      { title: "Manajemen Soal", href: "/data-modul/soal", description: "Susun dan kelola soal pilihan ganda beserta kunci jawabannya." },
      { title: "Import Soal Word", href: "/data-modul/import-soal", description: "Tambahkan soal dari dokumen Word sesuai template yang disepakati.", template: { href: "/templates/template-soal-nusacbt.docx", label: "Unduh template Word", detail: "Berisi soal contoh, lima pilihan, kunci 1/0, dan gambar." } },
      { title: "Export Soal Word", href: "/data-modul/export-soal", description: "Ekspor soal yang dipilih ke dalam dokumen Word." },
    ],
  },
  {
    title: "Data Peserta",
    icon: UsersRound,
    pages: [
      { title: "Periode Ujian", href: "/data-peserta/periode", description: "Atur periode sebagai dasar pengelolaan peserta dan ujian." },
      { title: "Kelas / Jurusan", href: "/data-peserta/kelas", description: "Kelola kelas, rombongan belajar, dan jurusan." },
      { title: "Data Siswa", href: "/data-peserta/siswa", description: "Kelola data siswa dan penempatan kelas per periode." },
      { title: "Import Data Peserta", href: "/data-peserta/import", description: "Tambahkan peserta dari spreadsheet Excel sesuai format yang disepakati.", template: { href: "/templates/template-peserta-nusacbt.xlsx", label: "Unduh template Excel", detail: "Berisi contoh kolom nomor, nama, NISN sebagai teks, dan kelas." } },
      { title: "Cetak Kartu Peserta", href: "/data-peserta/kartu", description: "Siapkan kartu login berdasarkan siswa, rombel, atau kategori ujian." },
    ],
  },
  {
    title: "Data Tes",
    icon: ClipboardList,
    pages: [
      { title: "Daftar Tes", href: "/data-tes/daftar", description: "Buat dan kelola jadwal serta pengaturan tes." },
      { title: "Hasil / Monitoring Tes", href: "/data-tes/monitoring", description: "Pantau pengerjaan peserta dan simpan riwayat hasil tes." },
      { title: "Token", href: "/data-tes/token", description: "Kelola token untuk satu tes atau seluruh tes dengan masa aktif tertentu." },
    ],
  },
  {
    title: "Laporan",
    icon: BarChart3,
    pages: [
      { title: "Rekap Hasil Tes", href: "/laporan/rekap", description: "Lihat rekap hasil dengan filter kelas, siswa, tes, dan rentang waktu." },
    ],
  },
  {
    title: "Tool",
    icon: Wrench,
    pages: [
      { title: "Backup Database", href: "/tool/backup", description: "Siapkan cadangan database dan file unggahan yang diperlukan." },
      { title: "Upload Database", href: "/tool/pemulihan", description: "Pulihkan cadangan melalui proses yang dibatasi untuk admin." },
    ],
  },
  {
    title: "Pengaturan",
    icon: Settings2,
    pages: [
      { title: "Pengaturan Aplikasi", href: "/pengaturan/aplikasi", description: "Atur identitas sekolah, informasi peserta, logo, kop surat, dan palet warna." },
      { title: "Pengaturan User", href: "/pengaturan/user", description: "Kelola pengguna yang memiliki akses ke panel." },
      { title: "Pengaturan Hak Akses", href: "/pengaturan/hak-akses", description: "Atur hak akses pengguna untuk fitur dan tindakan yang diizinkan." },
    ],
  },
];

export function findNavigationPage(href: string) {
  for (const section of navigation) {
    const page = section.pages?.find((item) => item.href === href);
    if (page) return { ...page, section: section.title };
  }
  return undefined;
}
