# NusaCBT — spesifikasi kebutuhan awal

- **Status:** draf untuk ditinjau; belum merupakan aplikasi yang telah selesai.
- **Sumber:** kebutuhan dan keputusan pemilik proyek, serta dua contoh dalam bentuk PDF.
- **Repository tujuan:** `https://github.com/addinseptyan/nusacbt` (public).

## 1. Tujuan dan batasan

- Aplikasi ujian berbasis web menggunakan **Next.js**, **PostgreSQL**, dan komponen/pola antarmuka **shadcn/ui**.
- Aplikasi berjalan di server lokal sekolah dan tetap dapat digunakan melalui LAN saat internet terputus, setelah instalasi dan dependensi tersedia.
- Perangkat peserta berupa komputer atau laptop. Target awal pengujian: **30 peserta mengerjakan secara bersamaan**; kapasitas riil perlu diuji di server dan jaringan sekolah.
- Sistem mendukung **light mode** yang clean dan colorful, **dark mode**, serta pengaturan palet warna aplikasi.
- Server yang direncanakan: Windows 10 Pro 64-bit, RAM 8 GB dan SSD. Pengguna telah memverifikasi PostgreSQL 18.7 dan layanan `postgresql-x64-18` berstatus berjalan. Perhatikan status dukungan dan pembaruan keamanan sistem operasi.

## 2. Struktur menu admin

Ada tujuh menu utama. Submenu berada di dalam menu utama yang dapat dibuka atau ditutup.

1. **Dashboard**.
2. **Data Modul:** Topik/Mata Pelajaran, Manajemen Soal, Import Soal Word, Export Soal Word.
3. **Data Peserta:** Periode Ujian, Kelas/Jurusan, Data Siswa, Import Data Peserta, Cetak Kartu Peserta.
4. **Data Tes:** Daftar Tes, Hasil/Monitoring Tes, Token.
5. **Laporan:** Rekap Hasil Tes dengan filter rombel/kelas, siswa, tes, dan rentang tanggal-waktu.
6. **Tool:** Backup Database dan Upload/Pemulihan Database.
7. **Pengaturan:** aplikasi ujian, pengguna, dan hak akses.

Pengaturan aplikasi mencakup nama dan keterangan aplikasi, informasi untuk peserta, palet warna, logo sekolah, nama sekolah, dan gambar kop surat.

## 3. Peserta, periode, dan identitas

- Data peserta mencakup nama, NISN, rombel/kelas, nomor peserta, username, dan kata sandi. **NISN wajib unik**.
- Jurusan dikelola dalam daftar tersendiri, misalnya `AK`, `BD`, dan `TKR`. Kelas dibentuk dari tingkat dan jurusan, misalnya `X AK`, `XI BD`, atau `XII TKR`; pada kebutuhan saat ini tidak ada nomor kelas paralel. Satu kombinasi tingkat–jurusan hanya dapat dibuat sekali dan disiapkan untuk digunakan lintas periode. Nama jurusan yang sama tanpa membedakan huruf besar/kecil ditolak; jurusan yang masih digunakan kelas tidak dapat dihapus.
- Rencana tahap siswa: penempatan kelas dicatat per siswa dan periode beserta salinan nama kelas saat penempatan, sehingga kenaikan kelas atau perubahan nama daftar tidak mengubah riwayat lama. Penempatan dan riwayat ini **belum diimplementasikan**; hubungan data perlu mencegah penghapusan yang merusak referensi.
- Data peserta dapat diimpor dari Excel dengan kolom nama, NISN, dan rombel/kelas. Impor harus memvalidasi data dan menunjukkan masalah sebelum disimpan. NISN diperlakukan sebagai teks agar angka nol di depan tidak hilang; angka nol yang sudah hilang dari sumber tidak dapat ditebak dengan aman.
- Nomor peserta dan username dapat dibuat otomatis atau diisi secara manual, dapat sama atau berbeda, dan dibuat/ditetapkan per periode.
- Pola otomatis awal: `{prefix}{YYYYMM}{3 angka acak}`; tahun-bulan mengacu pada tanggal mulai periode. Operator dapat mengubah pola otomatis serta mengisi atau mengubah nilai identitas secara manual.
- Generator perlu memeriksa tabrakan dan mengulang pengambilan angka saat perlu. Tiga digit memberikan paling banyak 1.000 kombinasi untuk kombinasi prefix dan tahun-bulan yang sama; jika ruangnya habis, sistem harus memberi pesan, bukan diam-diam membuat nilai duplikat.
- Kata sandi siswa dapat dibuat manual atau otomatis, dilihat kembali oleh pihak berwenang, dan di-reset. Rancangan keamanan dijelaskan di bagian 8.
- Kategori **reguler, susulan, atau remidi** ditentukan **per peserta untuk setiap tes**.
- Kartu login dapat dicetak per siswa, per rombel, dan per kategori ujian.

## 4. Bank soal dan contoh berkas

- Bank soal dikelompokkan berdasarkan topik/mata pelajaran.
- Tahap awal menggunakan soal pilihan ganda dan penilaian otomatis. Admin dapat membuat dan mengelola soal serta melakukan impor/ekspor Word.
- Contoh soal yang diterima saat analisis masih berupa PDF: 50 soal dalam tabel dengan kolom `No`, `Jenis`, `Isi`, dan `Jawaban`. Baris `SOAL` diikuti baris `JAWABAN`; `1` menandakan jawaban benar dan `0` jawaban salah. Contoh memiliki lima pilihan per soal dan beberapa gambar.
- Contoh peserta yang diterima juga berupa PDF, dengan kolom `Nomor`, `Nama`, `NISN`, dan `Kelas`.
- Arena tidak menerima unggahan `.docx`/`.xlsx` dari pengguna dalam sesi ini. Template Word dan Excel telah dibuat berdasarkan PDF dengan data fiktif; PDF merupakan referensi visual, bukan bukti struktur dokumen asli. Format template baru perlu ditinjau pengguna dan diuji saat fitur impor/ekspor dibuat.
- Contoh/data peserta asli tidak dimasukkan ke repository public. Gunakan contoh fiktif untuk pengujian yang dibagikan.

## 5. Tes, pengerjaan, dan token

- Admin dapat membuat, melihat, memperbarui, dan menghapus tes serta memantau hasil/status pengerjaan.
- Urutan soal dan urutan pilihan jawaban dapat diatur untuk diacak atau tidak. Pada pengerjaan yang sama, urutan yang sudah diberikan sebaiknya tetap konsisten ketika peserta memuat ulang halaman atau melanjutkan sesi.
- Jawaban disimpan selama pengerjaan. Antarmuka harus membedakan jawaban yang sudah dikonfirmasi tersimpan di server dari perubahan yang belum tersimpan; perubahan yang belum berhasil dikirim tidak boleh dianggap aman.
- Peserta dapat mengulang tes hanya di bawah kontrol operator. Setiap pengerjaan dan nilainya disimpan; pengulangan tidak menghapus riwayat nilai sebelumnya.
- Token dapat berlaku untuk satu tes atau untuk seluruh tes, dengan masa aktif antara **5 menit dan 1 hari**.
- Token harus valid ketika peserta memulai ujian. Aturan ketika token global dan token tes sama-sama aktif masih perlu dipastikan.
- Timer mengikuti waktu server. Batas akhir mengikuti waktu mulai terjadwal ditambah durasi; peserta yang terlambat hanya memperoleh waktu yang masih tersisa. Pengulangan atas izin operator hanya dapat dimulai selama jadwal awal masih berlangsung dan tetap berakhir pada batas akhir yang sama; tidak dapat dimulai setelahnya.
- Usulan yang belum dikonfirmasi: peserta dapat melanjutkan pengerjaan yang sama setelah koneksi pulih selama pengerjaan tersebut masih dapat dilanjutkan.

## 6. Nilai akhir dan visibilitas

- Operator menentukan kapan seorang peserta tidak lagi dapat mengulang suatu tes. Semua nilai dari pengerjaan tetap tersimpan.
- Nilai akhir awalnya menggunakan **nilai tertinggi**. Metode dapat diubah menjadi **rata-rata** atau kembali ke nilai tertinggi, dengan pengaturan **per tes**.
- Ketika metode suatu tes diubah, nilai akhir yang sudah ditetapkan untuk tes tersebut dihitung ulang dari nilai pengerjaan yang sah. Perubahan ini dapat memengaruhi laporan dan nilai yang sudah pernah ditampilkan; antarmuka perlu memberi peringatan dan mencatat perubahan.
- Nilai **tidak otomatis terlihat** oleh siswa. Admin/operator mengatur tampil atau sembunyikan nilai **per tes** untuk seluruh peserta tes tersebut. Pembatasan harus diterapkan di server, bukan hanya dengan menyembunyikan elemen antarmuka.
- Aturan pembulatan rata-rata, perlakuan pengerjaan yang belum selesai atau dibatalkan, dan tampilan nilai sebelum peserta dinyatakan selesai mengulang masih perlu disepakati.
- Nilai minus bersifat opsional; penalti jawaban salah dapat diatur dan nilai satu pengerjaan minimal 0. Jawaban kosong tidak mendapat poin dan tidak dikenai penalti. Rumus nilai dasar serta satuan/besaran penalti masih perlu disepakati.

## 7. Laporan, backup, dan pengaturan

- Laporan hasil dapat difilter per rombel/kelas, siswa, tes, dan rentang tanggal-waktu.
- Backup dan pemulihan mencakup database serta file unggahan yang disimpan di luar database. Kunci enkripsi dicadangkan secara aman dan terpisah.
- Pemulihan dibatasi untuk admin, memerlukan konfirmasi, dan harus diuji pada data uji sebelum digunakan pada data sekolah. Jangan melakukan pemulihan saat ujian aktif tanpa prosedur pemeliharaan yang disepakati.
- Pengaturan pengguna dan hak akses tersedia. Akses sensitif seperti melihat/reset kata sandi siswa, perubahan nilai jika diizinkan, dan pemulihan database dibatasi untuk admin. Apakah operator merupakan peran tersendiri atau pengguna admin masih perlu diperjelas.

## 8. Keamanan dan operasional

- Kebutuhan melihat kata sandi siswa kembali memiliki risiko yang lebih tinggi daripada penyimpanan hash saja. Rancangan yang diusulkan: hash untuk verifikasi login dan salinan terenkripsi untuk tampilan yang diizinkan.
- Kunci enkripsi tidak disimpan dalam database atau repository. Akses untuk melihat kata sandi dicatat tanpa mencatat nilai kata sandinya. Kehilangan kunci menyebabkan salinan terenkripsi tidak dapat ditampilkan kembali.
- Kata sandi admin disimpan sebagai hash, bukan dalam bentuk yang dapat dipulihkan. Disarankan kata sandi siswa tersamarkan secara default dan hanya ditampilkan oleh admin yang berwenang.
- Penggunaan HTTPS dengan sertifikat yang dipercaya perangkat peserta disarankan untuk melindungi data login di jaringan lokal. Database sebaiknya tidak dibuka langsung ke perangkat peserta.
- Data asli, kredensial, kunci, file `.env`, dan backup tidak boleh dipublikasikan di repository.

## 9. Kriteria verifikasi awal

1. Tujuh menu utama dan submenu tersedia; light/dark mode dan pengaturan warna berfungsi sesuai desain yang disepakati.
2. Impor Excel mendeteksi NISN duplikat dan memvalidasi format. Nomor peserta serta username dapat dibuat otomatis atau manual tanpa duplikasi yang melanggar aturan yang disepakati.
3. Impor dan ekspor Word diuji dengan **template `.docx` yang disepakati**, termasuk soal bergambar dan kunci jawaban; impor Excel diuji dengan template `.xlsx` fiktif yang sesuai.
4. Acak soal/pilihan dapat diaktifkan atau dimatikan; jawaban yang tersimpan tetap terhubung pada soal dan opsi yang benar ketika peserta melanjutkan sesi.
5. Pengulangan hanya dapat dimulai atas izin operator sebelum jadwal awal berakhir dan tetap mengikuti batas akhir tersebut; semua nilai pengerjaan tetap ada. Contoh: nilai 60 dan 80 menghasilkan nilai tertinggi 80 atau rata-rata 70 sesuai metode tes. Ketika penalti diaktifkan, nilai satu pengerjaan tidak boleh kurang dari 0; jawaban kosong tidak menambah maupun mengurangi nilai.
6. Mengubah metode tes menghitung ulang nilai akhir yang relevan. Nilai yang disembunyikan tidak dapat diakses siswa melalui antarmuka maupun respons server.
7. Backup dipulihkan dan diperiksa pada lingkungan uji, termasuk file unggahan yang diperlukan.
8. Aplikasi diuji tanpa internet di LAN dan dengan 30 sesi peserta bersamaan pada server target. Jawaban yang telah dikonfirmasi tersimpan harus tetap ada setelah halaman dimuat ulang dan peserta masuk kembali.

## 10. Pertanyaan terbuka

- Tinjau template `.docx` dan `.xlsx` yang dibuat berdasarkan PDF dan konfirmasi apakah sesuai.
- Bagaimana aturan token global dan token tes ketika keduanya aktif?
- Bagaimana rumus nilai dasar serta satuan/besaran penalti opsional?
- Bagaimana kelanjutan sesi setelah koneksi pulih, pembulatan rata-rata, serta perlakuan pengerjaan yang belum selesai atau dibatalkan?
- Apa yang ditampilkan kepada siswa jika nilai tes dibuka sebelum kesempatan mengulang ditutup?
- Apakah operator adalah peran tersendiri atau admin dengan hak operasional?
- Tentukan identitas author Git dan lisensi repository sebelum publikasi kode.
