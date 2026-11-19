import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Konfigurasi dimuat dari direktori aplikasi saat server dimulai, termasuk
// ketika `next start <direktori>` dijalankan dari working directory lain.
// Variabel internal ini hanya dipakai server, bukan nilai dari .env pengguna.
process.env.NUSACBT_INTERNAL_PROJECT_ROOT = typeof __dirname === "string"
  ? __dirname
  : fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  // The local preview proxy and loopback browser tests need access to dev assets.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.e2b.app"],
  // Maksimum enam gambar masing-masing 1 MiB plus teks dan overhead multipart.
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
  devIndicators: false,
  async headers() {
    // Halaman sandi dan bank soal admin dapat berisi data sensitif.
    const privateHeaders = [
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
    ];
    return [
      { source: "/peserta", headers: privateHeaders },
      { source: "/peserta/:path*", headers: privateHeaders },
      { source: "/data-peserta/sandi", headers: privateHeaders },
      { source: "/data-modul/soal", headers: privateHeaders },
      { source: "/data-modul/import-soal", headers: privateHeaders },
      { source: "/data-tes/daftar", headers: privateHeaders },
      { source: "/data-tes/token", headers: privateHeaders },
      { source: "/data-tes/token/riwayat", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
