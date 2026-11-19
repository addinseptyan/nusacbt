# Penyiapan PostgreSQL dan login admin

Panduan ini untuk lingkungan pengembangan Windows. Jangan gunakan versi ini untuk ujian sungguhan atau data siswa asli.

## 1. Buat database khusus

Pastikan layanan PostgreSQL berjalan di komputer yang juga menjalankan NusaCBT. Buka PowerShell, lalu jalankan:

```powershell
psql -h 127.0.0.1 -U postgres
```

Masukkan kata sandi PostgreSQL saat diminta; jangan kirim ke chat atau masukkan ke Git. Di prompt `psql`, jalankan satu per satu:

```sql
CREATE USER nusacbt_app;
\password nusacbt_app
CREATE DATABASE nusacbt OWNER nusacbt_app ENCODING 'UTF8' TEMPLATE template0;
\q
```

Perintah `\password` meminta kata sandi untuk user database secara tersembunyi. Ini **bukan** kata sandi login admin aplikasi. Jika user atau database tersebut sudah ada, jangan menimpa atau menghapusnya; gunakan nama database/user khusus lain dan sesuaikan pengaturan di bawah.

**Database harus memakai UTF8.** Sebelum migrasi, periksa target yang sesungguhnya, misalnya `psql -h 127.0.0.1 -U nusacbt_app -d nusacbt -c "SHOW server_encoding;"`. Hasilnya harus `UTF8`. Migrator menolak `SQL_ASCII` atau encoding lain sebelum membuat tabel riwayat atau menjalankan migrasi, karena teks Arab, emoji, dan simbol dapat diproses keliru. Jika hasilnya bukan `UTF8`, berhenti dan minta panduan pemindahan data yang aman; jangan mengubah encoding di tempat atau membuat ulang database berisi data. Untuk data yang sudah ada, backup beserta pengujian pemulihan tetap diperlukan.

## 2. Siapkan konfigurasi lokal

Di PowerShell pada folder clone NusaCBT, bila `.env.local` belum ada:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Atur `PGDATABASE` dan `PGUSER` sesuai database/user yang dibuat, dan isi `PGPASSWORD` dengan kata sandi user database. `PGHOST=127.0.0.1` hanya benar jika PostgreSQL berada di komputer yang sama dengan aplikasi. `PGPORT` biasanya `5432` tetapi sesuaikan bila instalasi berbeda.

Bungkus nilai yang mengandung karakter khusus dengan tanda kutip; di file env Next.js, tulis tanda dolar sebagai `\$` agar tidak dianggap variabel. Jangan bagikan file `.env.local` atau commit ke Git. Berkas contoh tidak berisi kata sandi. Setelah mengubahnya, restart server aplikasi.

## 3. Migrasi dan akun admin

```powershell
npm ci
npm run db:migrate
npm run admin:create -- adminsekolah
npm run dev
```

Anda boleh mengganti `adminsekolah` dengan username pilihan: 3–64 karakter huruf/angka, titik, garis bawah, atau tanda hubung. Username disimpan dalam huruf kecil. Saat diminta, ketik kata sandi **admin aplikasi** dan konfirmasinya; input disamarkan. Panjang 12–128 karakter. Jangan tulis kata sandi sebagai argumen perintah atau kirim ke chat.

Sebelum migrasi pada database yang sudah berisi data, pastikan target, backup database yang teruji, dan kunci yang cocok. Perintah menerapkan **semua migrasi tertunda** secara berurutan, termasuk `012` atau `013` jika belum tercatat, lalu `014`; tiap file memakai transaksi terpisah. Migrasi yang sudah diterapkan dengan checksum sama akan dilewati. Untuk memperbarui instalasi yang sudah memiliki database dan admin, pertahankan `.env.local`, jalankan `npm ci` bila dependensi berubah dan `npm run db:migrate`, lalu gunakan akun admin yang sama; **jangan membuat ulang database atau admin**. Migrasi siswa `004_students.sql` menambahkan tabel siswa dan riwayat penempatan; impor Excel memakai tabel tersebut tanpa migrasi baru. Migrasi `005_participant_identities.sql` menambahkan identitas; `006_participant_passwords.sql` menambahkan penyimpanan sandi dan audit tanpa membuat sandi secara otomatis. Migrasi `007_question_topics.sql` menambahkan kategori, `008_question_bank.sql` menambahkan soal dan gambar, `009_question_rich_content.sql` menambahkan enam kolom berformat opsional, dan `010_question_import_batches.sql` mencatat operasi impor Word untuk percobaan ulang yang aman. Migrasi `011`–`013` menambahkan rancangan tes dan token admin; `014_participant_login.sql` menambahkan sesi dan pembatas login tanpa membuat akun atau mengganti sandi/kunci. Soal lama tidak dihapus atau ditulis ulang oleh migrasi ini. Siapkan file kunci terpisah sesuai [panduan sandi](../README.md#kunci-dan-sandi-peserta) sebelum menggunakan fitur. Cadangkan database yang berisi data penting dan file kunci secara terpisah sebelum pembaruan, lalu uji pemulihan cadangannya. Pembuatan admin ini hanya untuk akun pertama dan tidak akan menimpa akun yang sudah ada. Pengaturan user dan reset password admin belum tersedia pada tahap ini.

Buka `http://localhost:3000` pada komputer tersebut dan masuk sebagai admin. Jika PostgreSQL tidak dapat diakses, periksa layanan, port, user, kata sandi, dan nama database secara lokal. Jangan menyalin kredensial ke laporan error.

## 4. Keamanan jaringan

- `npm run dev` dan HTTP digunakan hanya untuk uji lokal terisolasi tanpa data asli. HTTP menampilkan password dan cookie kepada pihak yang dapat menyadap jaringan.
- Pada production cookie menggunakan `Secure` secara default. Siapkan HTTPS dengan sertifikat yang dipercaya setiap perangkat; proxy dan sertifikat tersebut belum disediakan proyek ini. HTTPS tidak memerlukan internet jika infrastruktur sertifikat dan jaringan lokal sudah tersedia. Proxy tepercaya harus menimpa header `Host`/`X-Forwarded-*` yang masuk dari klien agar tidak dapat dipalsukan.
- `NUSACBT_COOKIE_SECURE=false` mengizinkan pengujian HTTP, tetapi menurunkan keamanan. Jangan gunakan untuk operasional dengan data asli.
- Server PostgreSQL sebaiknya hanya menerima koneksi dari komputer aplikasi, bukan dibuka langsung untuk perangkat siswa. Simpan dan backup file rahasia secara terpisah dari repository.
- Akun admin terkunci 15 menit setelah lima percobaan gagal. Login peserta juga dibatasi lima kegagalan per periode/username selama 15 menit dan 180 permintaan berformat valid per menit secara global. Pembatas global dapat menghambat semua peserta dan belum merupakan pembatas per IP. Audit sandi peserta hanya mencatat tindakan berhasil dan belum kebal-ubah; audit keamanan menyeluruh, proteksi trafik/IP, pemulihan akun, dan pengujian operasional sekolah masih perlu dibuat/dituntaskan.

## Pengujian browser

Tes browser mengubah sesi dan pembatas login serta membuat/menghapus akun, periode, jurusan, kelas, siswa, penempatan, identitas, kategori, soal, rancangan tes, dan token **fiktif**, sehingga wajib memakai database terpisah bernama `nusacbt_test`, bukan database sekolah. Siapkan user/database uji, atur `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, dan `PGDATABASE=nusacbt_test` pada lingkungan pengujian, lalu jalankan migrasi. Buat akun fiktif pertama dengan `npm run admin:create -- admin_tes`.

Di PowerShell yang sama, tetapkan `TEST_ADMIN_USERNAME=admin_tes`, `TEST_ADMIN_PASSWORD` dengan kata sandi **fiktif** akun tes, dan `NUSACBT_COOKIE_SECURE=false`. Buat dua file kunci **khusus uji yang berbeda** di luar proyek dengan `npm run participant:key:create -- <path-absolut-sandi-uji>` dan `npm run token:key:create -- <path-absolut-token-uji>`. Tetapkan path masing-masing sebagai `NUSACBT_PARTICIPANT_KEY_FILE` dan `NUSACBT_EXAM_TOKEN_KEY_FILE`. Jangan gunakan database atau kunci sekolah untuk tes; database uji mengikat masing-masing kunci pada penyimpanan pertama. Instal browser sekali dengan `npx playwright install chromium`, jalankan `npm run build`, lalu `npm run test:e2e -- --workers=1`. Tes memulai server production pada port 3100. Jangan menyimpan kata sandi asli di variabel test atau membagikan output yang mengandung rahasia. CI membuat database, akun, dan file kunci fiktifnya sendiri.
