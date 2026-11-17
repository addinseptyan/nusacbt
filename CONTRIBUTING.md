# Kontribusi ke NusaCBT

1. Buat branch dari `main` yang terbaru, misalnya `feat/nama-fitur`, `fix/nama-perbaikan`, atau `docs/nama-dokumen`.
2. Batasi perubahan sesuai tujuan yang disepakati. Tambahkan atau perbarui pengujian untuk perilaku yang berubah.
3. Jalankan `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`, dan `npm run test:e2e`. Tes browser wajib menggunakan database uji terpisah; lihat [panduan penyiapan](docs/penyiapan-database.md#pengujian-browser).
4. Periksa autentikasi dan otorisasi pada setiap halaman, Server Action, dan Route Handler yang mengakses data sensitif. Pemeriksaan pada halaman tidak otomatis melindungi endpoint atau action.
5. Push branch dan buat pull request dengan ringkasan, hasil pengujian, dan tangkapan layar bila antarmuka berubah.
6. Setelah pemeriksaan lulus dan perubahan direview, lakukan merge. Hapus hanya branch yang sudah digabung dan tidak lagi diperlukan.

Jangan sertakan data siswa nyata, soal rahasia, kredensial, kunci enkripsi, atau backup database dalam commit, pengujian, tangkapan layar, maupun deskripsi pull request.
