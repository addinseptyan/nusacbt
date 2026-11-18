# NusaCBT

NusaCBT adalah proyek aplikasi ujian berbasis web untuk sekolah, dirancang berjalan pada server lokal dan diakses melalui jaringan sekolah tanpa koneksi internet saat ujian.

> **Status: dalam pengembangan, belum untuk ujian sungguhan atau data siswa asli.** Login admin, pengelolaan periode, jurusan, kelas, siswa, impor Excel dengan pratinjau, serta nomor peserta dan username per periode tersedia. Kata sandi dan login peserta, impor soal, kartu, ujian, penilaian, backup, dan laporan **belum diimplementasikan**.

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

Pada **Data Peserta → Kelas / Jurusan**, admin mengelola daftar jurusan terpisah, lalu membuat kelas dari tingkat dan jurusan, misalnya `X AK`. Nama jurusan tidak boleh sama tanpa membedakan huruf besar/kecil, dan satu kombinasi tingkat–jurusan hanya dapat dibuat sekali. Jurusan yang masih digunakan oleh kelas tidak dapat dihapus.

Pada **Data Peserta → Data Siswa**, admin dapat menambah, mencari, dan mengubah siswa secara manual. Nama dan NISN wajib diisi; NISN harus unik dan tepat 10 digit, disimpan sebagai teks. Identitas siswa berlaku lintas periode, sehingga perubahan nama/NISN terlihat di semua periode. Setelah periode dan kelas tersedia, pilih **Penempatan** pada siswa untuk mengatur satu kelas aktif dalam setiap periode. Siswa yang sama dapat memiliki penempatan pada beberapa periode.

Mengganti kelas atau mengakhiri penempatan menyimpan catatan lama sebagai riwayat. Nama kelas dicatat ketika penempatan dibuat; perubahan nama jurusan atau kelas tidak menulis ulang nama pada riwayat tersebut. Waktu riwayat menunjukkan kapan perubahan dicatat, dalam UTC, bukan tanggal efektif perpindahan sekolah. Siswa, kelas, dan periode yang memiliki riwayat penempatan tidak dapat dihapus, termasuk jika penempatannya sudah berakhir; penghapusan permanen riwayat belum tersedia.

### Impor siswa dari Excel

1. Siapkan periode serta kelas/jurusan di aplikasi. Buka **Data Peserta → Import Data Peserta** dan unduh template fiktif. Hapus baris contoh sebelum digunakan.
2. Pada sheet `Peserta`, gunakan urutan kolom `Nomor`, `Nama`, `NISN`, `Kelas`. Nomor hanya nomor urut. Isi nama, NISN, dan kelas yang sudah ada; cocokkan nama kelas dengan daftar kelas. Pilih satu periode untuk seluruh file.
3. **Sel NISN harus berupa teks** berisi tepat 10 digit. Jangan mengandalkan format angka dengan nol tampilan: nol yang sudah hilang tidak dapat dipulihkan dengan aman. Kolom NISN pada template disiapkan sebagai teks untuk baris 2–1001; saat menempel data, pastikan format teks tetap terjaga.
4. Pilih file `.xlsx` maksimal 512 KB dan 1.000 baris data. Rumus pada nama/NISN/kelas, sel gabungan, baris data tersembunyi, serta data pada kolom tambahan tidak didukung. Baris yang tidak memiliki isi pada kolom selain Nomor diabaikan.
5. Klik **Periksa pratinjau**. Duplikat NISN dalam file, data tidak valid, kelas yang tidak ditemukan/ambigu, serta konflik dengan siswa lama harus diperbaiki seluruhnya sebelum penyimpanan. Nama yang sudah ada harus sama setelah spasi tepi dibuang dan normalisasi Unicode; kelas dicocokkan tanpa membedakan huruf besar/kecil dan kelebihan spasi.
6. Jika nama siswa lama sesuai dan belum ada kelas aktif pada periode tersebut, penempatan baru ditambahkan. Jika kelas aktif sudah sama, baris tidak mengubah apa pun. Nama atau kelas aktif yang berbeda **tidak ditimpa**; perbaiki file atau kelola data secara manual. Setelah konfirmasi, semua perubahan disimpan dalam satu transaksi. Bila data berubah sejak pratinjau, periksa ulang file.

Aplikasi tidak menyimpan berkas impor ke repository. Impor **tidak** membuat atau mengubah nomor peserta, username, kata sandi, atau kartu. Atur identitas secara terpisah setelah impor. Gunakan data fiktif sampai pengujian keamanan dan operasional selesai.

### Nomor peserta dan username

1. Buka **Data Peserta → Identitas Peserta**, lalu pilih satu periode. Daftar menampilkan siswa yang memiliki kelas aktif pada periode tersebut, serta identitas yang tersimpan meskipun kelasnya tidak lagi aktif.
2. Pilih **Atur identitas** untuk mengisi nomor dan username sekaligus, atau **Ubah identitas** untuk mengubahnya secara sengaja. Keduanya berupa teks dan boleh sama atau berbeda. Nomor 1–64 karakter; username 3–64 karakter. Karakter awal harus huruf atau angka ASCII; setelahnya boleh juga titik, garis bawah, atau tanda hubung. Nol di depan dipertahankan.
3. Nomor peserta harus unik dalam periode dan username juga harus unik dalam periode, **tanpa membedakan huruf besar/kecil**. Nilai yang sama boleh digunakan lagi pada periode lain. Nomor dan username masing-masing mempunyai aturan unik tersendiri; satu nilai boleh menjadi nomor seorang siswa dan username siswa lain.
4. **Buat otomatis** menawarkan konfirmasi untuk siswa dengan kelas aktif yang **belum memiliki pasangan identitas**. Tombol ini tidak dipengaruhi pencarian dan tidak pernah mengubah identitas yang sudah ada. Maksimal 1.000 siswa diproses dalam sekali batch, menurut urutan nama; bila masih ada, ulangi setelah daftar diperbarui. Untuk menggabungkan nilai otomatis dan nilai manual, buat pasangan otomatis lalu ubah salah satunya secara sengaja.
5. Pola awal untuk keduanya adalah `{prefix}{YYYYMM}{acak3}`. `{YYYYMM}` berasal dari tanggal mulai periode dan `{acak3}` adalah angka acak `000`–`999`. Prefix opsional; pola nomor dan username dapat diubah terpisah. Setiap pola wajib berisi `{acak3}` tepat sekali; `{prefix}` dan `{YYYYMM}` boleh digunakan masing-masing sekali. Pola yang sama menghasilkan nomor dan username yang sama; pola berbeda menghasilkan nilai secara terpisah. Maksimal 1.000 kombinasi untuk satu pola yang sudah diisi prefix dan bulan; nilai yang sudah dipakai mengurangi kapasitas. Jika tidak cukup atau data berubah saat penyimpanan, seluruh batch dibatalkan.
6. Saat penempatan diakhiri, identitas tetap tersimpan dan nilainya tetap digunakan di periode tersebut; kembalikan penempatan kelas untuk mengubahnya. Siswa dan periode yang memiliki identitas juga tidak dapat dihapus. Identitas ini belum merupakan akun login: kata sandi, login peserta, dan kartu belum dibuat.

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
