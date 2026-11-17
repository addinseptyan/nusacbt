# NusaCBT

NusaCBT adalah proyek aplikasi ujian berbasis web untuk sekolah, dirancang berjalan pada server lokal dan diakses melalui jaringan sekolah tanpa koneksi internet saat ujian.

> **Status: fondasi / pratinjau.** Navigasi panel admin, light/dark mode, serta template contoh Word dan Excel sudah tersedia. Login, integrasi PostgreSQL, impor, ujian, penilaian, backup, dan laporan **belum diimplementasikan**. Jangan gunakan versi ini untuk ujian sungguhan.

## Cakupan proyek

- Tujuh menu admin: Dashboard, Data Modul, Data Peserta, Data Tes, Laporan, Tool, dan Pengaturan.
- Ujian pilihan ganda dengan token, timer berbasis server, pengulangan terkontrol, riwayat nilai, dan pengaturan visibilitas nilai.
- Next.js, PostgreSQL, dan komponen shadcn/ui dengan tema terang dan gelap.
- Target pengujian awal: 30 peserta bersamaan di server dan jaringan sekolah.

Lihat [spesifikasi kebutuhan awal](docs/kebutuhan-awal.md) untuk rincian dan keputusan yang masih terbuka.

## Menjalankan pratinjau

Persyaratan: Node.js 20.18.1 atau lebih baru dan npm; Node.js 26 LTS disarankan. Server sekolah yang direncanakan memakai Node.js 26 serta PostgreSQL 18.7. Database belum diperlukan untuk pratinjau ini.

```bash
npm ci
npm run dev
```

Buka `http://localhost:3000` pada komputer yang menjalankan aplikasi. Template contoh juga dapat diunduh dari dashboard. Font dan aset pratinjau dikemas bersama proyek; pengujian operasi tanpa internet di jaringan sekolah tetap diperlukan.

## Verifikasi

```bash
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Tes browser mencakup navigasi, tema, dialog, unduhan template, dan layar kecil. Workflow GitHub Actions tersedia di `.github/workflows/ci.yml` untuk menjalankan pemeriksaan setelah perubahan dipublikasikan.

## Alur kontribusi

Lihat [CONTRIBUTING.md](CONTRIBUTING.md). Setelah commit dasar tersedia di branch utama, perubahan dibuat melalui branch dan pull request, diperiksa, lalu digabungkan. Branch yang sudah digabung dapat dihapus setelah diverifikasi.

## Privasi dan keamanan

Jangan memasukkan data peserta asli, soal rahasia, kata sandi, kunci enkripsi, isi `.env`, atau backup database ke repository. Template memakai data fiktif dan bukan salinan data siswa dari contoh yang diberikan.
