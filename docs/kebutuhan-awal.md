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
3. **Data Peserta:** Periode Ujian, Kelas/Jurusan, Data Siswa, Identitas Peserta, Sandi Peserta, Import Data Peserta, Cetak Kartu Peserta.
4. **Data Tes:** Daftar Tes, Hasil/Monitoring Tes, Token.
5. **Laporan:** Rekap Hasil Tes dengan filter rombel/kelas, siswa, tes, dan rentang tanggal-waktu.
6. **Tool:** Backup Database dan Upload/Pemulihan Database.
7. **Pengaturan:** aplikasi ujian, pengguna, dan hak akses.

Pengaturan aplikasi mencakup nama dan keterangan aplikasi, informasi untuk peserta, palet warna, logo sekolah, nama sekolah, dan gambar kop surat.

## 3. Peserta, periode, dan identitas

- Data peserta mencakup nama, NISN, rombel/kelas, nomor peserta, username, dan kata sandi. Sesuai pilihan pemilik proyek, **NISN wajib tepat 10 digit dan unik**, disimpan sebagai teks agar nol di depan tidak hilang.
- Jurusan dikelola dalam daftar tersendiri, misalnya `AK`, `BD`, dan `TKR`. Kelas dibentuk dari tingkat dan jurusan, misalnya `X AK`, `XI BD`, atau `XII TKR`; pada kebutuhan saat ini tidak ada nomor kelas paralel. Satu kombinasi tingkat–jurusan hanya dapat dibuat sekali dan disiapkan untuk digunakan lintas periode. Nama jurusan yang sama tanpa membedakan huruf besar/kecil ditolak; jurusan yang masih digunakan kelas tidak dapat dihapus.
- Data siswa manual dan penempatan kelas per siswa/periode tersedia. Satu siswa hanya memiliki satu penempatan aktif dalam satu periode; periode lain dapat mempunyai penempatannya sendiri. Mengganti atau mengakhiri penempatan menyimpan baris lama sebagai riwayat. Nama kelas disalin saat penempatan sehingga perubahan nama daftar tidak menulis ulang riwayat. Waktu yang dicatat adalah waktu operasi, bukan tanggal efektif perpindahan sekolah. Siswa, periode, atau kelas dengan riwayat penempatan tidak dapat dihapus pada tahap ini; penghapusan riwayat belum tersedia.
- Impor siswa Excel tersedia dengan kolom `Nomor`, `Nama`, `NISN`, `Kelas` dan satu periode yang dipilih admin. Nomor hanya urut. NISN pada sel Excel wajib berupa teks tepat 10 digit; nol yang telah hilang tidak ditebak. Pratinjau menunjukkan duplikasi, validasi, dan konflik sebelum menyimpan satu transaksi. Siswa lama dengan nama sesuai digunakan kembali tanpa menimpa; jika kelas aktif sama, tidak berubah; jika nama atau kelas aktif berbeda, perbaiki terlebih dahulu. Batasnya 512 KB dan 1.000 baris; kelas harus sudah tersedia. Nomor peserta dan akun login belum dibuat oleh impor ini.
- Nomor peserta dan username dapat diisi manual atau dibuat otomatis sebagai pasangan, boleh sama atau berbeda, dan masing-masing unik **per periode** tanpa membedakan huruf besar/kecil. Username yang sama boleh digunakan di periode berbeda; login peserta nantinya harus memilih periode. Nomor dan username memiliki ruang keunikan masing-masing. Nomor disimpan sebagai teks 1–64 karakter, username 3–64 karakter; diawali huruf/angka ASCII, selanjutnya dapat memakai titik, garis bawah, atau tanda hubung.
- Pola otomatis awal: `{prefix}{YYYYMM}{acak3}`; tahun-bulan mengacu pada tanggal mulai periode dan angka acak dari `000`–`999`. Admin dapat mengubah pola nomor dan username secara terpisah. `{acak3}` wajib tepat sekali, `{prefix}` dan `{YYYYMM}` opsional masing-masing maksimal sekali. Pola sama menghasilkan nomor dan username sama; pola berbeda dibuat terpisah. Generator mengacak kemungkinan tanpa pengulangan, memeriksa tabrakan, dan tidak menimpa identitas yang sudah ada.
- Pembuatan otomatis hanya untuk siswa yang memiliki kelas aktif dan belum memiliki pasangan identitas di periode itu, maksimal 1.000 siswa per batch, tidak terpengaruh pencarian. Tiga digit memberi paling banyak 1.000 kombinasi per pola yang telah diisi prefix/bulan; jika tidak cukup, seluruh batch dibatalkan dan admin dapat mengubah prefix/pola. Untuk menggabungkan nilai otomatis dan manual, buat pasangan otomatis lalu ubah salah satunya secara sengaja.
- Penempatan yang diakhiri tidak menghapus identitas; nilainya tetap dianggap telah digunakan dalam periode dan tidak dapat diubah tanpa kelas aktif. Siswa dan periode dengan identitas tidak dapat dihapus. Impor Excel tidak membuat atau mengubah identitas maupun sandi. Login peserta dan kartu masih belum tersedia.
- Kata sandi siswa per periode dapat dibuat manual atau otomatis, dilihat kembali oleh admin, dan di-reset. Daftar tersamarkan; penampilan berhasil, pembuatan, dan reset dicatat tanpa rahasia. Pembuatan otomatis maksimal 25 siswa per batch dan tidak menimpa sandi. Ketika kelas tidak aktif, sandi tetap tersimpan tetapi tidak dapat dikelola atau ditampilkan sampai siswa ditempatkan kembali. Rincian dan batasan keamanan ada di bagian 8 dan README.
- Kategori **reguler, susulan, atau remidi** ditentukan **per peserta untuk setiap tes**.
- Kartu login dapat dicetak per siswa, per rombel, dan per kategori ujian.

## 4. Bank soal dan contoh berkas

- Daftar **Topik/Mata Pelajaran** tersedia sebagai satu daftar kategori setara yang digunakan lintas periode. Mata pelajaran (`Matematika`) dan topik (`Aljabar`) dapat dicatat berdampingan; tidak ada hierarki atau subtopik pada tahap ini. Admin dapat menambah, mencari, mengubah, dan menghapus kategori dengan konfirmasi. Nama wajib 1–100 karakter, spasi tepi dibersihkan, dan nama unik tanpa membedakan kapitalisasi sesuai aturan `lower`/kolasi database.
- Formulir usang tidak menimpa perubahan admin lain. Jika ada data yang mereferensikan kategori dengan foreign key pembatas, penghapusan ditolak. Bank soal belum tersedia; modul soal mendatang harus mereferensikan ID kategori dengan `ON DELETE RESTRICT`, bukan menyalin nama atau menghapus soal secara berantai.
- Bank soal nantinya dikelompokkan berdasarkan topik/mata pelajaran. Tahap awal direncanakan menggunakan soal pilihan ganda dan penilaian otomatis; manajemen soal serta impor/ekspor Word belum diimplementasikan.
- Contoh soal yang diterima saat analisis masih berupa PDF: 50 soal dalam tabel dengan kolom `No`, `Jenis`, `Isi`, dan `Jawaban`. Baris `SOAL` diikuti baris `JAWABAN`; `1` menandakan jawaban benar dan `0` jawaban salah. Contoh memiliki lima pilihan per soal dan beberapa gambar.
- Contoh peserta yang diterima juga berupa PDF, dengan kolom `Nomor`, `Nama`, `NISN`, dan `Kelas`.
- Arena tidak menerima unggahan `.docx`/`.xlsx` dari pengguna dalam sesi ini. Template Word dan Excel dibuat berdasarkan PDF dengan data fiktif; PDF merupakan referensi visual, bukan bukti struktur dokumen asli. Pemilik memilih kolom Excel `Nomor`, `Nama`, `NISN`, `Kelas` untuk impor siswa. Template Word dan fitur impor/ekspor soal masih perlu ditinjau dan disepakati.
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

- Melihat kata sandi siswa kembali memiliki risiko lebih tinggi daripada penyimpanan hash saja. Implementasi menyimpan hash scrypt untuk verifikasi login mendatang dan salinan AES-256-GCM terenkripsi untuk tampilan yang diizinkan. Login peserta belum tersedia.
- File kunci acak berada di luar database dan repository dan harus dicadangkan secara terpisah. Database mengikat kunci pertama; kunci yang tidak cocok ditolak. Kehilangan kunci membuat salinan terenkripsi tidak dapat ditampilkan; rotasi dan pemulihan setelah kehilangan permanen belum tersedia.
- Sandi peserta tersamarkan secara default; semua admin yang memiliki sesi sah dapat meminta tampilan, belum ada autentikasi ulang/otorisasi khusus per admin. Penampilan berhasil, pembuatan, dan reset dicatat tanpa nilai rahasia; percobaan gagal belum dicatat dan tabel audit belum kebal-ubah bagi pengelola database. Kata sandi admin tetap disimpan sebagai hash yang tidak dapat dipulihkan.
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

- Tinjau template soal `.docx` yang dibuat berdasarkan PDF dan konfirmasi apakah sesuai.
- Bagaimana aturan token global dan token tes ketika keduanya aktif?
- Bagaimana rumus nilai dasar serta satuan/besaran penalti opsional?
- Bagaimana kelanjutan sesi setelah koneksi pulih, pembulatan rata-rata, serta perlakuan pengerjaan yang belum selesai atau dibatalkan?
- Apa yang ditampilkan kepada siswa jika nilai tes dibuka sebelum kesempatan mengulang ditutup?
- Apakah operator adalah peran tersendiri atau admin dengan hak operasional?
- Tentukan identitas author Git dan lisensi repository sebelum publikasi kode.
