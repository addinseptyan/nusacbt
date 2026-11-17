# NusaCBT

NusaCBT adalah proyek aplikasi ujian berbasis web untuk sekolah, dirancang berjalan pada server lokal dan diakses melalui jaringan sekolah tanpa koneksi internet saat ujian.

> **Status: dalam pengembangan, belum untuk ujian sungguhan.** Navigasi panel admin, light/dark mode, template contoh, koneksi PostgreSQL, login/logout admin, pengelolaan periode ujian, kelas, dan jurusan tersedia. Data siswa, login peserta, impor, ujian, penilaian, backup, dan laporan **belum diimplementasikan**.

## Cakupan proyek

- Tujuh menu admin: Dashboard, Data Modul, Data Peserta, Data Tes, Laporan, Tool, dan Pengaturan.
- Ujian pilihan ganda dengan token, timer berbasis server, pengulangan terkontrol, riwayat nilai, dan pengaturan visibilitas nilai direncanakan.
- Next.js, PostgreSQL, dan komponen shadcn/ui dengan tema terang dan gelap.
- Target pengujian awal: 30 peserta bersamaan di server dan jaringan sekolah. Kapasitas dan operasi LAN tanpa internet belum teruji.

Lihat [spesifikasi kebutuhan awal](docs/kebutuhan-awal.md) untuk rincian dan keputusan yang masih terbuka.

## Penyiapan pratinjau

Persyaratan: Node.js 20.18.1 atau lebih baru dan npm; Node.js 26 LTS disarankan. PostgreSQL harus sudah berjalan. Lihat [panduan PostgreSQL dan akun admin](docs/penyiapan-database.md) untuk langkah Windows, file `.env.local`, migrasi, dan pembuatan akun.

Ringkasan setelah database dan `.env.local` disiapkan:

```bash
npm ci
npm run db:migrate
npm run admin:create -- adminsekolah
npm run dev
```

Buka `http://localhost:3000` di komputer yang menjalankan aplikasi. Kata sandi admin dimasukkan secara tersembunyi di terminal, tidak di argumen perintah. Tidak ada akun atau kata sandi bawaan. Akun pertama saja dapat dibuat dengan perintah ini; pengaturan pengguna dan reset admin belum tersedia.

Jika database dan admin sudah disiapkan pada versi sebelumnya, pertahankan `.env.local` dan akun admin yang ada, lalu jalankan `npm run db:migrate` untuk migrasi baru. Tidak perlu membuat ulang admin. Setelah masuk, buka **Data Peserta → Periode Ujian**: admin dapat menambah, mengubah, dan menghapus periode dengan konfirmasi. Nama dan tanggal mulai wajib diisi; tanggal akhir opsional dan tidak boleh lebih awal dari tanggal mulai.

Pada **Data Peserta → Kelas / Jurusan**, admin mengelola daftar jurusan terpisah, lalu membuat kelas dari tingkat dan jurusan, misalnya `X AK`. Nama jurusan tidak boleh sama tanpa membedakan huruf besar/kecil, dan satu kombinasi tingkat–jurusan hanya dapat dibuat sekali. Jurusan yang masih digunakan oleh kelas tidak dapat dihapus. Daftar disiapkan untuk lintas periode; data siswa, penempatan dan riwayat kelas per periode, serta pembuatan identitas peserta belum terhubung.

## Verifikasi

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Tes browser membutuhkan **database pengujian terpisah** bernama `nusacbt_test` dan akun fiktif. Jangan arahkan tes ke data sekolah; lihat [petunjuk pengujian](docs/penyiapan-database.md#pengujian-browser). Workflow GitHub Actions menyiapkan PostgreSQL uji dan menjalankan migrasi, pemeriksaan kode, build, serta Playwright. Versi workflow baru perlu diverifikasi pada PR.

## Keamanan dan privasi

- Hash kata sandi admin menggunakan scrypt (N=2^15, r=8, p=3), salah satu konfigurasi [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt); sesi memakai token acak, dengan hash token disimpan di PostgreSQL. Setelah lima kegagalan, akun dikunci selama 15 menit. Ini belum menggantikan pengujian keamanan menyeluruh atau pembatasan trafik berbasis IP.
- Cookie sesi `HttpOnly` dan `SameSite=Strict`; pada production cookie `Secure` aktif secara default dan memerlukan HTTPS yang tepercaya. HTTP hanya untuk uji lokal terisolasi tanpa data asli. Perlindungan HTTPS/proxy untuk LAN sekolah masih harus disiapkan dan diuji.
- Template pada `public/templates` berisi data fiktif dan tetap dapat diunduh tanpa login. Data asli, soal rahasia, password, `.env.local`, kunci, dan backup tidak boleh dimasukkan ke repository publik.
- Hak akses operator terpisah, login siswa, dan kebutuhan menampilkan kembali password siswa belum diimplementasikan. Rancangannya berbeda dari password admin dan dicatat di spesifikasi.

## Alur kontribusi

Lihat [CONTRIBUTING.md](CONTRIBUTING.md). Perubahan dibuat melalui branch dan pull request, diperiksa, lalu digabungkan. Branch yang sudah digabung dapat dihapus setelah diverifikasi.
