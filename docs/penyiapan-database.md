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
CREATE DATABASE nusacbt OWNER nusacbt_app;
\q
```

Perintah `\password` meminta kata sandi untuk user database secara tersembunyi. Ini **bukan** kata sandi login admin aplikasi. Jika user atau database tersebut sudah ada, jangan menimpa atau menghapusnya; gunakan nama database/user khusus lain dan sesuaikan pengaturan di bawah.

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

Migrasi aman dijalankan lagi: migrasi yang sudah diterapkan dan tidak berubah akan dilewati. Untuk memperbarui instalasi yang sudah memiliki database dan admin, pertahankan `.env.local`, jalankan `npm run db:migrate`, lalu gunakan akun admin yang sama; **jangan membuat ulang database atau admin**. Migrasi periode, jurusan, dan kelas menambahkan tabel baru tanpa menghapus akun admin atau data periode. Pembuatan admin ini hanya untuk akun pertama dan tidak akan menimpa akun yang sudah ada. Pengaturan user dan reset password admin belum tersedia pada tahap ini.

Buka `http://localhost:3000` pada komputer tersebut dan masuk sebagai admin. Jika PostgreSQL tidak dapat diakses, periksa layanan, port, user, kata sandi, dan nama database secara lokal. Jangan menyalin kredensial ke laporan error.

## 4. Keamanan jaringan

- `npm run dev` dan HTTP digunakan hanya untuk uji lokal terisolasi tanpa data asli. HTTP menampilkan password dan cookie kepada pihak yang dapat menyadap jaringan.
- Pada production cookie menggunakan `Secure` secara default. Siapkan HTTPS dengan sertifikat yang dipercaya setiap perangkat; proxy dan sertifikat tersebut belum disediakan proyek ini. HTTPS tidak memerlukan internet jika infrastruktur sertifikat dan jaringan lokal sudah tersedia. Proxy tepercaya harus menimpa header `Host`/`X-Forwarded-*` yang masuk dari klien agar tidak dapat dipalsukan.
- `NUSACBT_COOKIE_SECURE=false` mengizinkan pengujian HTTP, tetapi menurunkan keamanan. Jangan gunakan untuk operasional dengan data asli.
- Server PostgreSQL sebaiknya hanya menerima koneksi dari komputer aplikasi, bukan dibuka langsung untuk perangkat siswa. Simpan dan backup file rahasia secara terpisah dari repository.
- Akun admin terkunci 15 menit setelah lima percobaan gagal. Pembatasan trafik berbasis IP, pemulihan akun, audit keamanan, dan pengujian operasional sekolah masih perlu dibuat/dituntaskan.

## Pengujian browser

Tes browser mengubah sesi serta membuat/menghapus akun, periode, jurusan, dan kelas **fiktif**, sehingga wajib memakai database terpisah bernama `nusacbt_test`, bukan database sekolah. Siapkan user/database uji, atur `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, dan `PGDATABASE=nusacbt_test` pada lingkungan pengujian, lalu jalankan migrasi. Buat akun fiktif pertama dengan `npm run admin:create -- admin_tes`.

Di PowerShell yang sama, tetapkan `TEST_ADMIN_USERNAME=admin_tes`, `TEST_ADMIN_PASSWORD` dengan kata sandi **fiktif** akun tes, dan `NUSACBT_COOKIE_SECURE=false`. Instal browser sekali dengan `npx playwright install chromium`, jalankan `npm run build`, lalu `npm run test:e2e -- --workers=1`. Tes memulai server production pada port 3100. Jangan menyimpan kata sandi asli di variabel test atau membagikan output yang mengandung rahasia. CI menyediakan database dan akun fiktifnya sendiri.
