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

Sebelum migrasi pada database yang sudah berisi data, pastikan target, backup database yang teruji, dan kunci yang cocok. Perintah menerapkan **semua migrasi tertunda** secara berurutan, termasuk `012`–`016` jika belum tercatat, lalu `017`; tiap file memakai transaksi terpisah. Migrasi yang sudah diterapkan dengan checksum sama akan dilewati. Untuk memperbarui instalasi yang sudah memiliki database dan admin, pertahankan `.env.local`, jalankan `npm ci` bila dependensi berubah dan `npm run db:migrate`, lalu gunakan akun admin yang sama; **jangan membuat ulang database atau admin**.

Migrasi siswa `004_students.sql` menambahkan tabel siswa dan riwayat penempatan; impor Excel memakai tabel tersebut tanpa migrasi baru. Migrasi `005_participant_identities.sql` menambahkan identitas; `006_participant_passwords.sql` menambahkan penyimpanan sandi dan audit tanpa membuat sandi secara otomatis. Migrasi `007_question_topics.sql` menambahkan kategori, `008_question_bank.sql` menambahkan soal dan gambar, `009_question_rich_content.sql` menambahkan enam kolom berformat opsional, dan `010_question_import_batches.sql` mencatat operasi impor Word. Migrasi `011`–`013` menambahkan rancangan tes dan token admin; `014_participant_login.sql` menambahkan sesi dan pembatas login tanpa membuat akun atau mengganti sandi/kunci.

`015_participant_password_and_active_period.sql` memperluas batas ciphertext dan menambahkan pengaturan periode login yang **awalnya kosong saat 015 pertama diterapkan**; sandi, kunci, dan data lama tidak di-reset. Admin harus memilih periode login setelah 015 pertama kali diterapkan; pengaktifan/pergantian periode mengakhiri sesi peserta lama. `016_participant_login_unlock.sql` hanya memperluas nilai peristiwa yang diterima pada audit; tidak mengubah periode yang sudah aktif, sesi, sandi, kunci, atau pembatas login. `017_exam_sessions_and_schedules.sql` menambahkan kelompok serta jadwal pelaksanaan tanpa menghapus tes lama; **jadwal rancangan lama tidak lagi tampak pada halaman peserta sampai pelaksanaannya diatur dan dirilis**. Siapkan file kunci terpisah sesuai [panduan sandi](../README.md#kunci-dan-sandi-peserta) sebelum menggunakan fitur. Cadangkan database dan file kunci secara terpisah sebelum pembaruan, lalu uji pemulihan cadangannya. Pembuatan admin ini hanya untuk akun pertama dan tidak menimpa akun yang sudah ada. Pengaturan user dan reset password admin belum tersedia.

Buka `http://localhost:3000` pada komputer tersebut dan masuk sebagai admin. Jika PostgreSQL tidak dapat diakses, periksa layanan, port, user, kata sandi, dan nama database secara lokal. Jangan menyalin kredensial ke laporan error.

## 4. Keamanan jaringan

- `npm run dev` dan HTTP digunakan hanya untuk uji lokal terisolasi tanpa data asli. HTTP menampilkan password dan cookie kepada pihak yang dapat menyadap jaringan.
- Pada production cookie menggunakan `Secure` secara default. Siapkan HTTPS dengan sertifikat yang dipercaya setiap perangkat; proxy dan sertifikat tersebut belum disediakan proyek ini. HTTPS tidak memerlukan internet jika infrastruktur sertifikat dan jaringan lokal sudah tersedia. Proxy tepercaya harus menimpa header `Host`/`X-Forwarded-*` yang masuk dari klien agar tidak dapat dipalsukan.
- `NUSACBT_COOKIE_SECURE=false` mengizinkan pengujian HTTP, tetapi menurunkan keamanan. Jangan gunakan untuk operasional dengan data asli.
- Server PostgreSQL sebaiknya hanya menerima koneksi dari komputer aplikasi, bukan dibuka langsung untuk perangkat siswa. Simpan dan backup file rahasia secara terpisah dari repository.
- Akun admin terkunci 15 menit setelah lima percobaan gagal. Login peserta juga dibatasi lima kegagalan per periode/username selama 15 menit dan 180 permintaan berformat valid per menit secara global. Admin dapat membuka satu penguncian aktif lewat **Akun Peserta** dengan konfirmasi dan audit; pembatas global tetap berlaku dan dapat menghambat semua peserta. Audit tindakan sandi/buka kunci hanya mencatat keberhasilan dan belum kebal-ubah; audit keamanan menyeluruh, proteksi trafik/IP, pemulihan akun, dan pengujian operasional sekolah masih perlu dituntaskan.

## Pengujian browser

Tes browser mengubah sesi dan pembatas login serta membuat/menghapus akun, periode, jurusan, kelas, siswa, penempatan, identitas, kategori, soal, rancangan, kelompok sesi, pelaksanaan, dan token **fiktif**, sehingga wajib memakai database terpisah bernama `nusacbt_test`, bukan database sekolah. Siapkan user/database uji, atur `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, dan `PGDATABASE=nusacbt_test` pada lingkungan pengujian, lalu jalankan migrasi. Buat akun fiktif pertama dengan `npm run admin:create -- admin_tes`.

Di PowerShell yang sama, tetapkan `TEST_ADMIN_USERNAME=admin_tes`, `TEST_ADMIN_PASSWORD` dengan kata sandi **fiktif** akun tes, dan `NUSACBT_COOKIE_SECURE=false`. Buat dua file kunci **khusus uji yang berbeda** di luar proyek dengan `npm run participant:key:create -- <path-absolut-sandi-uji>` dan `npm run token:key:create -- <path-absolut-token-uji>`. Tetapkan path masing-masing sebagai `NUSACBT_PARTICIPANT_KEY_FILE` dan `NUSACBT_EXAM_TOKEN_KEY_FILE`. Jangan gunakan database atau kunci sekolah untuk tes; database uji mengikat masing-masing kunci pada penyimpanan pertama. Instal browser sekali dengan `npx playwright install chromium`, jalankan `npm run build`, lalu `npm run test:e2e -- --workers=1`. Tes memulai server production pada port 3100. Jangan menyimpan kata sandi asli di variabel test atau membagikan output yang mengandung rahasia. CI membuat database, akun, dan file kunci fiktifnya sendiri.

### Pengujian upgrade 014 → terbaru

Tes upgrade terpisah memerlukan **database kosong UTF8 yang baru**, bernama tepat `nusacbt_upgrade_015_test`. Siapkan database ini di server uji, bukan server/database sekolah. Tes **mengisi database tersebut** dengan migrasi dan data fiktif; tes menolak database dengan tabel yang sudah ada dan tidak membuat atau menghapus database. Siapkan variabel koneksi uji, instal Chromium dan jalankan `npm run build` terlebih dahulu. Di PowerShell atur `$env:PGDATABASE='nusacbt_upgrade_015_test'` dan `$env:NUSACBT_CONFIRM_TEST_DATABASE='nusacbt_upgrade_015_test'`, lalu jalankan `npm run test:upgrade`. Tes membuat file kunci fiktif sementara di luar proyek, memeriksa data sebelum/sesudah migrasi, dan mencoba aplikasi. Untuk mengulang, siapkan database uji kosong lagi; jangan mengosongkan database yang berisi data penting. CI membuat database uji ini secara terpisah. Migrator menerapkan semua versi sampai `017`.

### Pengujian upgrade 015 → terbaru

Gunakan database **kosong UTF8 yang lain** bernama tepat `nusacbt_upgrade_016_test`, hanya pada server uji. Atur `$env:PGDATABASE='nusacbt_upgrade_016_test'` dan `$env:NUSACBT_CONFIRM_TEST_DATABASE='nusacbt_upgrade_016_test'`, lalu jalankan `npm run test:upgrade-016`. Tes membuat fixture fiktif pada versi `015`, menjalankan migrator dua kali, memeriksa data dan sequence, sandi/sesi/periode/pembatas, serta constraint audit. Tes menolak database yang tidak kosong dan tidak membuat atau menghapus database. Untuk mengulang siapkan lagi database uji kosong; jangan kosongkan data sekolah.

### Pengujian upgrade 016 → terbaru

Gunakan database **kosong UTF8 terpisah** bernama tepat `nusacbt_upgrade_017_test` pada server uji. Atur `$env:PGDATABASE='nusacbt_upgrade_017_test'` dan `$env:NUSACBT_CONFIRM_TEST_DATABASE='nusacbt_upgrade_017_test'`, lalu jalankan `npm run test:upgrade-017`. Tes menyiapkan data fiktif sampai `016`, menjalankan migrator dua kali, membandingkan tabel dan sequence lama, memeriksa sandi/token serta menguji constraint baru dengan rollback. Tes lama tetap ada tetapi tidak otomatis dirilis. Tes mengisi database tersebut, menolak yang tidak kosong, serta tidak membuat atau menghapus database.
