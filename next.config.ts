import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Konfigurasi dimuat dari direktori aplikasi saat server dimulai, termasuk
// ketika `next start <direktori>` dijalankan dari working directory lain.
// Variabel internal ini hanya dipakai server, bukan nilai dari .env pengguna.
const projectDir = typeof __dirname === "string"
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));
process.env.NUSACBT_INTERNAL_PROJECT_ROOT = projectDir;

let packageVersion = "1.0.1";
try {
  const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
  if (typeof pkg?.version === "string" && pkg.version.trim()) {
    packageVersion = pkg.version.trim();
  }
} catch {
  // Gunakan fallback versi bawaan jika metadata paket tidak dapat dibaca.
}

const nextConfig: NextConfig = {
  output: process.env.NUSACBT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingIncludes: {
    "*": ["./node_modules/next/dist/compiled/next-server/*.runtime.prod.js"],
  },
  outputFileTracingExcludes: {
    "*": ["./.git/**", "./.env*", "./tests/**", "./desktop/**", "./installer/**", "./dist/**"],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || packageVersion,
    NEXT_PUBLIC_APP_BUILD_SHA: process.env.NEXT_PUBLIC_APP_BUILD_SHA || "",
    NEXT_PUBLIC_APP_BUILD_DATE: process.env.NEXT_PUBLIC_APP_BUILD_DATE || "",
  },
  // The local preview proxy and loopback browser tests need access to dev assets.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.e2b.app"],
  // Maksimum enam gambar masing-masing 1 MiB plus teks dan overhead multipart.
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
  devIndicators: false,
  async headers() {
    // Halaman akun, kartu, dan bank soal admin dapat berisi data sensitif.
    const privateHeaders = [
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
    ];
    return [
      { source: "/peserta", headers: privateHeaders },
      { source: "/peserta/:path*", headers: privateHeaders },
      // Form mulai tanpa JavaScript membutuhkan Origin same-origin pada POST.
      // Rujukan tetap tidak dikirim ke origin lain dan halaman tetap no-store.
      { source: "/peserta/jadwal/:path*", headers: [{ key: "Referrer-Policy", value: "same-origin" }] },
      { source: "/data-peserta/identitas", headers: privateHeaders },
      { source: "/data-peserta/sandi", headers: privateHeaders },
      { source: "/data-peserta/akun", headers: privateHeaders },
      { source: "/data-peserta/siswa", headers: privateHeaders },
      { source: "/data-peserta/tahun-ajaran", headers: privateHeaders },
      { source: "/laporan/rekap", headers: privateHeaders },
      { source: "/laporan/rekap/:path*", headers: privateHeaders },
      { source: "/data-peserta/kartu", headers: privateHeaders },
      { source: "/data-peserta/kartu/:path*", headers: privateHeaders },
      { source: "/data-modul/soal", headers: privateHeaders },
      { source: "/data-modul/import-soal", headers: privateHeaders },
      { source: "/data-tes/daftar", headers: privateHeaders },
      { source: "/data-tes/daftar/:path*", headers: privateHeaders },
      { source: "/data-tes/monitoring", headers: privateHeaders },
      { source: "/data-tes/monitoring/:path*", headers: privateHeaders },
      { source: "/data-tes/pengaturan-pengerjaan", headers: privateHeaders },
      { source: "/data-tes/token", headers: privateHeaders },
      { source: "/data-tes/token/riwayat", headers: privateHeaders },
      { source: "/tool", headers: privateHeaders },
      { source: "/tool/:path*", headers: privateHeaders },
      { source: "/pengaturan", headers: privateHeaders },
      { source: "/pengaturan/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
