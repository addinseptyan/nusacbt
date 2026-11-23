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

import type { AdminPermission } from "@/lib/admin-permissions.mjs";

export type NavigationPage = {
  title: string;
  href: string;
  description: string;
  permissions?: readonly AdminPermission[];
  template?: { href: string; label: string; detail: string };
};

export type NavigationSection = {
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
      {
        title: "Topik / Mata Pelajaran",
        href: "/data-modul/topik",
        description: "Kelola topik dan mata pelajaran untuk mengelompokkan bank soal.",
        permissions: ["topics.manage"],
      },
      {
        title: "Manajemen Soal",
        href: "/data-modul/soal",
        description: "Susun dan kelola soal pilihan ganda beserta kunci jawabannya.",
        permissions: ["questions.manage"],
      },
      {
        title: "Import Soal Word",
        href: "/data-modul/import-soal",
        description: "Tambahkan soal dari dokumen Word sesuai template yang disepakati.",
        permissions: ["questions.import"],
        template: {
          href: "/templates/template-soal-nusacbt.docx",
          label: "Unduh template Word",
          detail: "Berisi soal contoh, lima pilihan, kunci 1/0, dan gambar.",
        },
      },
      {
        title: "Export Soal Word",
        href: "/data-modul/export-soal",
        description: "Ekspor soal yang dipilih ke dalam dokumen Word.",
        permissions: ["questions.export"],
      },
    ],
  },
  {
    title: "Data Peserta",
    icon: UsersRound,
    pages: [
      {
        title: "Tahun Ajaran",
        href: "/data-peserta/tahun-ajaran",
        description: "Kelola tahun aktif dan perpindahan siswa.",
        permissions: ["academic_years.manage"],
      },
      {
        title: "Periode Ujian",
        href: "/data-peserta/periode",
        description: "Kelola periode ujian di dalam tahun ajaran.",
        permissions: ["periods.manage"],
      },
      {
        title: "Kelas / Jurusan",
        href: "/data-peserta/kelas",
        description: "Kelola kelas, rombongan belajar, dan jurusan.",
        permissions: ["classes.manage"],
      },
      {
        title: "Data Siswa",
        href: "/data-peserta/siswa",
        description: "Kelola data siswa dan penempatan kelas per tahun ajaran.",
        permissions: ["students.manage"],
      },
      {
        title: "Akun Peserta",
        href: "/data-peserta/akun",
        description: "Kelola identitas, sandi, dan penguncian login peserta per periode.",
        permissions: ["participant_accounts.manage", "participant_passwords.manage"],
      },
      {
        title: "Import Data Peserta",
        href: "/data-peserta/import",
        description: "Impor siswa dan penempatan per tahun ajaran dari Excel dengan pratinjau.",
        permissions: ["students.manage"],
        template: {
          href: "/templates/template-peserta-nusacbt.xlsx",
          label: "Unduh template Excel",
          detail: "Berisi contoh kolom nomor, nama, NISN sebagai teks, dan kelas.",
        },
      },
      {
        title: "Cetak Kartu Peserta",
        href: "/data-peserta/kartu",
        description: "Siapkan kartu login berdasarkan siswa atau rombel pada periode login aktif.",
        permissions: ["participant_cards.print"],
      },
    ],
  },
  {
    title: "Data Tes",
    icon: ClipboardList,
    pages: [
      {
        title: "Daftar Tes",
        href: "/data-tes/daftar",
        description: "Buat dan kelola jadwal serta pengaturan tes.",
        permissions: ["exams.manage"],
      },
      {
        title: "Pengaturan Pengerjaan",
        href: "/data-tes/pengaturan-pengerjaan",
        description: "Atur pengumpulan manual dan visibilitas nilai per kategori.",
        permissions: ["exam_controls.manage"],
      },
      {
        title: "Hasil / Monitoring Tes",
        href: "/data-tes/monitoring",
        description: "Pantau pengerjaan peserta dan simpan riwayat hasil tes.",
        permissions: ["monitoring.view", "grading_overrides.manage"],
      },
      {
        title: "Token",
        href: "/data-tes/token",
        description: "Kelola token untuk satu tes atau seluruh tes dengan masa aktif tertentu.",
        permissions: ["tokens.manage"],
      },
    ],
  },
  {
    title: "Laporan",
    icon: BarChart3,
    pages: [
      {
        title: "Rekap Hasil Tes",
        href: "/laporan/rekap",
        description: "Lihat rekap hasil dengan filter kelas, siswa, tes, dan rentang waktu.",
        permissions: ["reports.view"],
      },
    ],
  },
  {
    title: "Tool",
    icon: Wrench,
    pages: [
      {
        title: "Backup Database",
        href: "/tool/backup",
        description: "Siapkan cadangan database dan file unggahan yang diperlukan.",
        permissions: ["tools.manage"],
      },
      {
        title: "Upload Database",
        href: "/tool/pemulihan",
        description: "Pulihkan cadangan melalui proses yang dibatasi untuk admin.",
        permissions: ["tools.manage"],
      },
    ],
  },
  {
    title: "Pengaturan",
    icon: Settings2,
    pages: [
      {
        title: "Pengaturan Aplikasi",
        href: "/pengaturan/aplikasi",
        description: "Atur identitas sekolah, informasi peserta, logo, kop surat, dan palet warna.",
        permissions: ["app_settings.manage"],
      },
      {
        title: "Pengaturan User",
        href: "/pengaturan/user",
        description: "Kelola pengguna yang memiliki akses ke panel.",
        permissions: ["users.manage"],
      },
      {
        title: "Pengaturan Hak Akses",
        href: "/pengaturan/hak-akses",
        description: "Atur hak akses pengguna untuk fitur dan tindakan yang diizinkan.",
        permissions: ["roles.manage"],
      },
    ],
  },
];

type NavigationMatch = NavigationPage & {
  section: string;
  parent?: Pick<NavigationPage, "title" | "href">;
};

const examListParent = { title: "Daftar Tes", href: "/data-tes/daftar" };
const examListChild = /^\/data-tes\/daftar\/[^/]+$/;

/** Halaman anak tetap menandai item induknya di sidebar. */
export function navigationPageContains(href: string, pathname: string): boolean {
  return pathname === href ||
    (href === examListParent.href && examListChild.test(pathname)) ||
    (href === "/data-tes/token" && pathname === "/data-tes/token/riwayat") ||
    (href === "/data-peserta/akun" && ["/data-peserta/identitas", "/data-peserta/sandi"].includes(pathname));
}

export function findNavigationPage(href: string): NavigationMatch | undefined {
  if (href === "/data-tes/daftar/sesi") {
    return {
      title: "Kelompok Sesi",
      href,
      description: "Pengaturan kelompok sesi per periode.",
      section: "Data Tes",
      parent: examListParent,
      permissions: ["exams.manage"],
    };
  }
  if (examListChild.test(href)) {
    return {
      title: "Pelaksanaan Tes",
      href,
      description: "Pengaturan jadwal dan peserta tes.",
      section: "Data Tes",
      parent: examListParent,
      permissions: ["exams.manage"],
    };
  }
  // Riwayat dapat dibuka dari Token, tanpa menambah item menu terpisah.
  if (href === "/data-tes/token/riwayat") {
    return {
      title: "Riwayat token",
      href,
      description: "Catatan penerbitan dan status token.",
      section: "Data Tes",
      permissions: ["tokens.manage"],
    };
  }
  // Tautan lama tetap dapat dibuka, tetapi hanya ada satu menu Akun Peserta.
  if (href === "/data-peserta/identitas") {
    return {
      title: "Identitas Peserta (tautan lama)",
      href,
      description: "Gunakan menu Akun Peserta untuk daftar gabungan.",
      section: "Data Peserta",
      permissions: ["participant_accounts.manage"],
    };
  }
  if (href === "/data-peserta/sandi") {
    return {
      title: "Sandi Peserta (tautan lama)",
      href,
      description: "Gunakan menu Akun Peserta untuk daftar gabungan.",
      section: "Data Peserta",
      permissions: ["participant_passwords.manage"],
    };
  }
  for (const section of navigation) {
    const page = section.pages?.find((item) => item.href === href);
    if (page) return { ...page, section: section.title };
  }
  return undefined;
}
