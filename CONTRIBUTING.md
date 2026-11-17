# Kontribusi ke NusaCBT

1. Buat branch dari `main` yang terbaru, misalnya `feat/nama-fitur`, `fix/nama-perbaikan`, atau `docs/nama-dokumen`.
2. Batasi perubahan sesuai tujuan yang disepakati. Tambahkan atau perbarui pengujian untuk perilaku yang berubah.
3. Jalankan `npm run lint`, `npm run typecheck`, `npm run build`, dan `npm run test:e2e` sebelum meminta review.
4. Push branch dan buat pull request dengan ringkasan, hasil pengujian, dan tangkapan layar bila antarmuka berubah.
5. Setelah pemeriksaan lulus dan perubahan direview, lakukan merge. Hapus hanya branch yang sudah digabung dan tidak lagi diperlukan.

Repository kosong memerlukan satu commit awal untuk membuat branch dasar sebelum pull request pertama dapat dibuka.

Jangan sertakan data siswa nyata, soal rahasia, kredensial, kunci enkripsi, atau backup database dalam commit, pengujian, tangkapan layar, maupun deskripsi pull request.
