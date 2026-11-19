# NusaCBT

NusaCBT adalah proyek aplikasi ujian berbasis web untuk sekolah, dirancang berjalan pada server lokal dan diakses melalui jaringan sekolah tanpa koneksi internet saat ujian.

> **Status: dalam pengembangan, belum untuk ujian sungguhan atau data asli.** Login admin, daftar topik/mata pelajaran, soal pilihan ganda berformat, impor Word terbatas, pengelolaan periode, jurusan, kelas, siswa, impor Excel, identitas, dan sandi peserta per periode tersedia untuk diuji. **Word 2013 dan dokumen asli belum diuji langsung.** Login peserta, ekspor soal, kartu, ujian, penilaian, backup, dan laporan **belum diimplementasikan**.

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

### Topik dan mata pelajaran

Buka **Data Modul → Topik / Mata Pelajaran**. Admin dapat menambah, mencari, mengubah, dan menghapus kategori dengan konfirmasi. Ini **satu daftar fleksibel lintas periode**, bukan hierarki: `Matematika` dan `Aljabar` dapat menjadi kategori yang setara. Nama wajib 1–100 karakter Unicode tanpa karakter kontrol; spasi di awal dan akhir dibersihkan, sementara spasi di tengah dipertahankan. Nama yang hanya berbeda kapitalisasi ditolak berdasarkan `lower` dan kolasi PostgreSQL; perbedaan spasi di tengah atau bentuk normalisasi Unicode tidak disatukan secara otomatis.

Jika data berubah ketika formulir terbuka, simpan atau hapus ditolak agar tidak menimpa perubahan lain; gunakan **Muat ulang daftar** lalu periksa kembali. Kategori yang masih digunakan soal tidak dapat dihapus. Soal merujuk ID kategori dengan `ON DELETE RESTRICT`; mengganti nama kategori tidak mengubah ID-nya.

### Manajemen soal manual

1. Setelah `npm ci` dan migrasi sampai `010`, buat setidaknya satu kategori di **Data Modul → Topik / Mata Pelajaran**. Buka **Manajemen Soal → Tambah soal**, pilih satu kategori, isi soal dan pilihan **A–E**, lalu tandai tepat satu jawaban benar.
2. Isi soal dan setiap pilihan wajib mengandung teks, gambar, atau keduanya. Editor pada keenam bagian mendukung tebal, miring, garis bawah, sub/superskrip, daftar, perataan, arah RTL/LTR, dan pembuatan/pengubahan tabel. Letakkan kursor pada paragraf Arab, lalu pilih **RTL**; periksa pula susunan campuran Arab, angka, dan simbol. Rumus yang didukung dapat ditampilkan, tetapi belum dapat diedit sebagai rumus. Baca langkah penempelan di bawah.
3. Isi berformat disimpan sebagai struktur tervalidasi serta salinan teks untuk pencarian, bukan HTML bebas. Teks pencarian maksimal 5.000 karakter Unicode untuk soal dan 2.000 per pilihan. Tabel maksimal 30 baris, 12 kolom, dan 250 sel per bagian. Data soal lama yang belum memiliki format tetap dapat dibaca dan diubah.
4. Setiap bagian dapat memiliki maksimal **satu gambar**: satu untuk soal dan satu untuk masing-masing pilihan; **PNG/JPEG statis**, maksimal **1 MiB per gambar sebelum dan sesudah diproses**, maksimal 4.000 piksel tiap sisi dan 8 megapiksel. SVG, WebP, APNG, gambar rusak, atau gambar yang terlalu besar ditolak. Gambar tampil setelah teks/tabel, tidak di posisi semula. Jika hasil pemrosesan melebihi 1 MiB, perkecil/kompres gambar dan pilih ulang.
5. Klik **Simpan soal** dan tunggu pesan berhasil. File baru terlihat setelah penyimpanan; perubahan yang hanya ada di formulir belum tersimpan. Daftar dapat dicari berdasarkan teks atau difilter berdasarkan kategori; tombol **Lihat** menampilkan pilihan dan kunci untuk admin. **Ubah** mempertahankan gambar lama kecuali dipilih pengganti atau dicentang untuk dihapus. Pilih salah satu, bukan penggantian dan penghapusan sekaligus. Hapus soal memerlukan konfirmasi dan menghapus gambar yang melekat.
6. Saat ada perubahan atau penghapusan oleh sesi lain, operasi pada formulir usang ditolak. Gunakan **Muat ulang daftar**, periksa kembali, dan isi ulang perubahan yang diperlukan. Jika hasil belum dapat dipastikan karena gangguan koneksi, periksa daftar sebelum mencoba lagi agar tidak membuat duplikat. Format tersimpan yang tidak valid diblokir agar tidak tertimpa diam-diam.

Gambar didekode dan dienkode ulang untuk membuang metadata, lalu disimpan di PostgreSQL bersama soal dalam satu transaksi; file aslinya tidak disimpan dan isi soal/gambar tidak dienkripsi oleh aplikasi. Jika ada proxy, pastikan batas body-nya mengizinkan permintaan hingga 8 MB untuk enam gambar. Pencarian dan paginasi pada tahap ini dilakukan di browser setelah semua teks soal dimuat; kinerja bank soal besar belum diuji. Semua admin yang login dapat melihat kunci dan gambar. Halaman dan gambar tidak dimaksudkan untuk akses publik; gunakan HTTPS tepercaya dan perangkat admin yang aman, serta batasi akses server/database. Log database dapat memuat isi soal saat terjadi kesalahan: batasi akses dan masa simpan log, serta hindari merekam body permintaan/respons di proxy. Backup database harus mencakup gambar ini, disimpan aman dan diuji pemulihannya. Fitur backup aplikasi belum tersedia.

### Menempel rumus dari Word

1. Di Word, pilih sebuah Equation bawaan, buka **Equation Tools / Design → Tools → Equation Options** (tombol panah kecil), dan aktifkan **Copy MathML to the clipboard as plain text**. Nama/menu dapat sedikit berbeda menurut versi Word.
2. Pilih **satu rumus lengkap saja**, salin, lalu tempel pada posisi kursor di editor soal atau pilihan. Salin teks dan tabel terpisah dari rumus; tempelan yang terdeteksi mengandung campuran rumus/gambar dan teks ditolak, bukan sebagian ditempel. Unggah gambar dengan tombol file. Jika hasil berupa teks linear, hapus dan periksa kembali pengaturan Word.
3. Periksa hasil sebelum menyimpan. Sebagian MathML dasar, seperti pecahan, akar, pangkat, subskrip, dan kurung, dapat dirender; bentuk yang tidak didukung ditolak. Font, spasi, dan tata letak dapat berbeda dari Word. Rumus hanya untuk ditampilkan, tidak diedit dengan editor rumus aplikasi.

**Batas penting:** cara ini telah diuji dengan data clipboard MathML fiktif di Chromium, bukan menyalin langsung dari Word 2013/Windows. Dukungan semua bentuk Equation dan hasil identik dengan Word belum dijamin.

### Impor soal Word (.docx)

1. Buka **Data Modul → Import Soal Word**, unduh `template-soal-nusacbt.docx`, dan hapus/ganti **keempat soal fiktif** di dalamnya. Satu file digunakan untuk satu kategori yang dipilih di aplikasi. File harus `.docx` maksimal **6 MiB** dan **100 soal**; `.doc`, `.docm`, dan PDF tidak diimpor.
2. Gunakan **satu tabel utama** dengan kolom `No`, `Jenis`, `Isi`, `Jawaban`. Untuk setiap soal, satu baris `SOAL` (kolom Jawaban kosong) diikuti **lima** baris `JAWABAN`. Isi `1` pada tepat satu jawaban benar dan `0` pada empat lainnya. Urutan baris menjadi pilihan A–E; `No` hanya penanda, bukan ID database. Gabungan vertikal pada kolom No dapat dipakai. Semua soal yang diimpor harus berada di tabel utama; teks di luar tabel tidak diimpor.
3. Editor membaca teks berformat dasar, Arab, tabel di dalam sel isi, sebagian Equation Word (pecahan dasar, akar, pangkat/subskrip, kurung, dan fungsi), serta maksimal satu gambar PNG/JPEG per soal/pilihan. Total gambar setelah diproses maksimal **16 MiB per file**, termasuk setiap pemakaian ulang gambar yang sama; jika lebih, bagi dokumen menjadi beberapa file. Tabel isi mengikuti batas di atas, tidak boleh berisi tabel atau gambar di dalamnya. Daftar otomatis Word, objek tertanam, gambar tertaut, serta Equation seperti integral, sigma, matriks dan bentuk lain yang belum didukung dapat menyebabkan **seluruh file ditolak**, bukan disimpan sebagian. Ubah bentuk/struktur tersebut atau masukkan gambar secara manual. Bentuk font, ukuran, warna, dan penempatan gambar dapat berbeda; periksa setiap halaman pratinjau.
4. Pilih file dan kategori, klik **Periksa pratinjau**, periksa soal, pilihan, kunci, tabel, gambar, dan rumus di semua halaman, lalu **Simpan hasil impor → Ya, simpan impor**. Seluruh soal disimpan dalam satu transaksi; soal lama tidak ditimpa. Pratinjau ulang sebagai operasi baru menambahkan soal yang sama lagi.
5. Jika hasil simpan belum pasti, **jangan muat ulang halaman atau ganti file/kategori**; periksa Manajemen Soal dan coba tombol simpan pada pratinjau yang sama. Percobaan ulang pada pratinjau yang sama tidak menambahkan duplikat. Pratinjau dan ID operasinya hilang setelah halaman dimuat ulang atau pilihan diganti; periksa daftar sebelum membuat pratinjau baru.

Template fiktif dan parser telah diuji secara otomatis, serta satu struktur Equation dari contoh Word publik yang lebih lama diperiksa; **dokumen asli dan Word 2013/Windows belum diuji langsung**. PDF acuan tidak membuktikan struktur internal `.docx`. Uji salinan fiktif di komputer sasaran dan bandingkan seluruh pratinjau dengan Word sebelum mempercayai hasil. Ekspor Word belum tersedia; soal juga belum dapat digunakan untuk tes atau login peserta.

### Data peserta

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
6. Saat penempatan diakhiri, identitas tetap tersimpan dan nilainya tetap digunakan di periode tersebut; kembalikan penempatan kelas untuk mengubahnya. Siswa dan periode yang memiliki identitas juga tidak dapat dihapus. Identitas dan sandi ini belum merupakan akun login aktif: login peserta dan kartu belum dibuat.

### Kunci dan sandi peserta

**Siapkan kunci sebelum membuat sandi.** Kunci adalah file acak 32 byte yang disimpan **di luar direktori proyek, repository, database, dan backup database**. Buat folder yang hanya dapat diakses akun layanan aplikasi dan pengelola server. Contoh Windows PowerShell (sesuaikan lokasi; pastikan folder bukan bagian checkout):

```powershell
New-Item -ItemType Directory -Force -Path 'C:\ProgramData\NusaCBT\keys'
npm run participant:key:create -- 'C:\ProgramData\NusaCBT\keys\participant.key'
```

Perintah tidak mencetak kunci dan **menolak menimpa file yang sudah ada**. Pemeriksaan juga menolak path di dalam direktori aplikasi atau direktori dengan penanda repository `.git`; tetap pastikan lokasi dan cadangannya benar-benar di luar repository dan database. Di sistem Unix file baru dibuat dengan mode `0600`; di Windows atur ACL NTFS folder dan file agar hanya akun layanan dan pengelola berwenang yang dapat membacanya. Periksa izin backup, direktori induk, dan akun layanan secara lokal. Jangan unggah file kunci atau isi file ke Git, chat, log, atau perangkat bersama.

Tambahkan **path**, bukan isi kunci, ke `.env.local`, lalu restart aplikasi. Pada Windows contoh berikut memakai garis miring agar aman untuk file env; sesuaikan dengan lokasi sebenarnya:

```dotenv
NUSACBT_PARTICIPANT_KEY_FILE=C:/ProgramData/NusaCBT/keys/participant.key
```

Cadangkan file kunci secara aman dan **terpisah** dari database, dan uji pemulihannya di lingkungan terisolasi. Gunakan kunci yang sama untuk seluruh proses aplikasi yang memakai database yang sama. Database mengikat kunci pertama saat sandi pertama dibuat; kunci yang berbeda ditolak dan tidak boleh dipakai untuk reset maupun membuat sandi baru. Jika kunci hilang, salinan sandi lama tidak dapat dibuka; pulihkan file kunci yang benar. **Rotasi kunci dan prosedur reset seluruh sandi setelah kehilangan permanen belum tersedia**: jangan menghapus pengikat, mengganti file, atau mengubah tabel secara sembarangan. Simpan backup database dan kunci yang cocok, dengan kontrol akses terpisah.

1. Setelah migrasi `006_participant_passwords.sql`, buat penempatan dan identitas siswa. Buka **Data Peserta → Sandi Peserta**, lalu pilih periode. Semua admin yang sudah login berwenang dalam tahap ini; peran operator/hak khusus belum ada.
2. **Buat sandi** untuk satu siswa secara otomatis atau manual. Manual membutuhkan 12–128 karakter Unicode, maksimal 512 byte, tanpa karakter kontrol; spasi dipertahankan dan sandi harus dikonfirmasi. Generator memakai 16 karakter acak yang sukar ditebak. Hindari sandi manual yang mudah ditebak.
3. **Buat otomatis** memproses maksimal 25 identitas berkelas aktif yang belum memiliki sandi, menurut urutan nama, terlepas dari pencarian. Ulangi bila ada sisanya. Hashing sengaja mahal sehingga batch memerlukan waktu. Jika data berubah, seluruh batch dibatalkan; sandi yang ada tidak pernah ditimpa.
4. Daftar menyamarkan sandi secara default. Pilih **Lihat sandi → Tampilkan sandi** hanya bila diperlukan. Penampilan berhasil dicatat dengan admin, peserta, dan waktu, tanpa nilai sandi. Tampilan ditutup otomatis setelah 60 detik atau saat halaman tidak aktif. Audit juga mencatat pembuatan dan reset; 20 peristiwa terbaru per periode ditampilkan. Upaya yang gagal tidak dicatat, dan tabel audit ini belum kebal perubahan oleh pengelola database.
5. **Reset sandi** mengganti hash dan salinan terenkripsi untuk satu peserta setelah konfirmasi; sandi lama tidak lagi cocok. Bila kelas tidak aktif, sandi tetap tersimpan tetapi tindakan dinonaktifkan sampai siswa ditempatkan kembali. Database tidak otomatis menghapus riwayat audit atau sandi saat kelas berakhir.

Hash scrypt dipersiapkan untuk verifikasi login di masa depan; salinan terpisah dienkripsi AES-256-GCM dengan kunci tersebut. Sandi tidak dikirim ke halaman daftar awal, URL, atau catatan audit. Sandi manual dikirim ke server saat disimpan dan sandi yang dibuka dikirim ke browser; gunakan HTTPS tepercaya, perangkat admin yang aman, dan konfigurasi proxy yang tidak mencatat isi permintaan/respons. Jangan gunakan data asli sampai keamanan dan operasional diuji. Sesi admin saat ini cukup untuk melihat sandi; belum ada autentikasi ulang khusus untuk setiap penampilan.

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
- Login siswa dan hak akses operator terpisah belum diimplementasikan. Semua admin yang memiliki sesi sah dapat mengelola dan melihat sandi peserta; akses sensitif dicatat di database, tetapi log tersebut belum kebal-ubah. File kunci dan cadangannya harus dikelola terpisah sesuai petunjuk di atas.

## Alur kontribusi

Lihat [CONTRIBUTING.md](CONTRIBUTING.md). Perubahan dibuat melalui branch dan pull request, diperiksa, lalu digabungkan. Branch yang sudah digabung dapat dihapus setelah diverifikasi.
