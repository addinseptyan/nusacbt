import { normalizeAdminUsername } from "./admin-username.mjs";

const MAX_PASSWORD_BYTES = 512;
const utf8Encoder = new TextEncoder();

function validNewAdminPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128 &&
    utf8Encoder.encode(password).byteLength <= MAX_PASSWORD_BYTES
  );
}

export const ADMIN_PERMISSION_DEFINITIONS = [
  {
    key: "topics.manage",
    section: "Data Modul",
    label: "Topik / Mata Pelajaran",
    description: "Menambah, mengubah, mencari, dan menghapus topik atau mata pelajaran.",
    sensitive: false,
  },
  {
    key: "questions.manage",
    section: "Data Modul",
    label: "Manajemen Soal",
    description: "Melihat gambar/kunci soal serta menambah, mengubah, dan menghapus soal.",
    sensitive: false,
  },
  {
    key: "questions.import",
    section: "Data Modul",
    label: "Impor Soal Word",
    description: "Memeriksa pratinjau dan mengimpor soal dari dokumen Word (.docx).",
    sensitive: false,
  },
  {
    key: "questions.export",
    section: "Data Modul",
    label: "Ekspor Soal Word",
    description: "Memilih dan mengunduh bank soal ke dokumen Word (.docx).",
    sensitive: false,
  },
  {
    key: "academic_years.manage",
    section: "Data Peserta",
    label: "Tahun Ajaran & Perpindahan",
    description: "Mengelola tahun ajaran aktif serta perpindahan siswa antar-tahun.",
    sensitive: false,
  },
  {
    key: "periods.manage",
    section: "Data Peserta",
    label: "Periode Ujian",
    description: "Mengelola periode ujian dan mengaktifkan/menonaktifkan periode login peserta.",
    sensitive: false,
  },
  {
    key: "classes.manage",
    section: "Data Peserta",
    label: "Kelas / Jurusan",
    description: "Mengelola daftar jurusan dan kelas atau rombongan belajar.",
    sensitive: false,
  },
  {
    key: "students.manage",
    section: "Data Peserta",
    label: "Data Siswa & Impor Excel",
    description: "Mengelola data siswa, penempatan tahun ajaran, dan impor siswa dari Excel.",
    sensitive: false,
  },
  {
    key: "participant_accounts.manage",
    section: "Data Peserta",
    label: "Akun Peserta (Identitas & Buka Kunci)",
    description: "Mengatur nomor peserta, username, serta membuka penguncian login peserta.",
    sensitive: false,
  },
  {
    key: "participant_passwords.manage",
    section: "Data Peserta",
    label: "Sandi Peserta & Cetak Kartu Bersandi",
    description: "Melihat, membuat, dan me-reset sandi peserta serta menyertakan sandi pada kartu A4.",
    sensitive: true,
  },
  {
    key: "participant_cards.print",
    section: "Data Peserta",
    label: "Cetak Kartu Peserta (Tanpa Sandi)",
    description: "Menyiapkan pratinjau dan mencetak kartu login peserta tanpa menyertakan sandi.",
    sensitive: false,
  },
  {
    key: "exams.manage",
    section: "Data Tes",
    label: "Daftar Tes, Sesi & Pelaksanaan",
    description: "Mengelola rancangan tes, kelompok sesi, jadwal pelaksanaan, dan rilis jadwal.",
    sensitive: false,
  },
  {
    key: "exam_controls.manage",
    section: "Data Tes",
    label: "Pengaturan Pengerjaan & Visibilitas Nilai",
    description: "Mengatur batas waktu pengumpulan manual dan visibilitas nilai per kategori.",
    sensitive: false,
  },
  {
    key: "monitoring.view",
    section: "Data Tes",
    label: "Monitoring Hasil Tes & Ekspor Excel",
    description: "Melihat status pengerjaan, nilai dasar, dan mengunduh Excel monitoring.",
    sensitive: false,
  },
  {
    key: "grading_overrides.manage",
    section: "Data Tes",
    label: "Izin Mengulang & Nilai Akhir",
    description: "Memberikan/mencabut izin ulang serta mengubah metode, menetapkan, dan membuka nilai akhir.",
    sensitive: true,
  },
  {
    key: "tokens.manage",
    section: "Data Tes",
    label: "Pengelolaan Token Ujian",
    description: "Menerbitkan, melihat kode aktif, mencabut, dan meninjau riwayat token ujian.",
    sensitive: false,
  },
  {
    key: "reports.view",
    section: "Laporan",
    label: "Rekap Hasil Tes & Ekspor Excel",
    description: "Membuka matriks rekap siswa × tes dan mengunduh rekap Excel.",
    sensitive: false,
  },
  {
    key: "tools.manage",
    section: "Tool",
    label: "Backup & Pemulihan Database",
    description: "Mengakses modul backup dan pemulihan database sekolah.",
    sensitive: true,
  },
  {
    key: "app_settings.manage",
    section: "Pengaturan",
    label: "Pengaturan Aplikasi & Branding",
    description: "Mengubah nama aplikasi, nama sekolah, info peserta, logo, kop surat, dan warna.",
    sensitive: true,
  },
  {
    key: "users.manage",
    section: "Pengaturan",
    label: "Pengaturan User",
    description: "Menambah akun operator, mengubah profil/peran, menonaktifkan akun, dan reset sandi.",
    sensitive: true,
  },
  {
    key: "roles.manage",
    section: "Pengaturan",
    label: "Pengaturan Hak Akses",
    description: "Membuat, mengubah matriks hak akses peran, dan menghapus peran tak terpakai.",
    sensitive: true,
  },
];

export const ADMIN_PERMISSION_KEYS = ADMIN_PERMISSION_DEFINITIONS.map((item) => item.key);
export const ADMIN_PERMISSION_KEY_SET = new Set(ADMIN_PERMISSION_KEYS);

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function isValidAdminPermission(key) {
  return typeof key === "string" && ADMIN_PERMISSION_KEY_SET.has(key);
}

export function normalizePermissionList(keys) {
  if (!Array.isArray(keys)) return [];
  const chosen = new Set();
  for (const key of keys) {
    if (isValidAdminPermission(key)) chosen.add(key);
  }
  return ADMIN_PERMISSION_KEYS.filter((key) => chosen.has(key));
}

export function adminHasPermission(user, permission) {
  if (!user) return false;
  if (user.isSuperuser) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function adminHasAnyPermission(user, required) {
  if (!user) return false;
  if (user.isSuperuser) return true;
  if (!Array.isArray(required) || required.length === 0) return true;
  return required.some((perm) => Array.isArray(user.permissions) && user.permissions.includes(perm));
}

export function canActorManagePermissions(actor, permissions) {
  if (!actor) return false;
  if (actor.isSuperuser) return true;
  return permissions.every((perm) => Array.isArray(actor.permissions) && actor.permissions.includes(perm));
}

export function validateAdminFullName(raw) {
  if (typeof raw !== "string") return { ok: false, error: "Nama lengkap pengguna wajib teks yang valid." };
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (CONTROL_CHARS.test(cleaned)) return { ok: false, error: "Nama lengkap tidak boleh mengandung karakter kontrol." };
  const length = Array.from(cleaned).length;
  if (length < 1 || length > 100) return { ok: false, error: "Nama lengkap harus berisi 1–100 karakter." };
  return { ok: true, value: cleaned };
}

export function validateAdminRoleInput(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "Data peran tidak valid." };
  const rawName = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  const rawDesc = typeof input.description === "string" ? input.description.replace(/\s+/g, " ").trim() : "";
  if (CONTROL_CHARS.test(rawName)) return { ok: false, error: "Nama peran tidak boleh mengandung karakter kontrol." };
  if (CONTROL_CHARS.test(rawDesc)) return { ok: false, error: "Keterangan peran tidak boleh mengandung karakter kontrol." };
  const nameLen = Array.from(rawName).length;
  if (nameLen < 1 || nameLen > 60) return { ok: false, error: "Nama peran harus berisi 1–60 karakter." };
  if (Array.from(rawDesc).length > 200) return { ok: false, error: "Keterangan peran maksimal 200 karakter." };
  if (!Array.isArray(input.permissions)) return { ok: false, error: "Daftar hak akses peran tidak valid." };
  for (const item of input.permissions) {
    if (!isValidAdminPermission(item)) {
      return { ok: false, error: "Terdapat kode hak akses yang tidak dikenal." };
    }
  }
  return {
    ok: true,
    value: {
      name: rawName,
      description: rawDesc,
      permissions: normalizePermissionList(input.permissions),
    },
  };
}

export function makeRoleSlug(name, suffix = "") {
  const base = String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let candidate = base.length >= 2 && /^[a-z]/.test(base) ? base : `role_${base || "custom"}`;
  if (suffix) {
    const cleanSuffix = String(suffix).toLowerCase().replace(/[^a-z0-9_]/g, "");
    candidate = `${candidate.slice(0, Math.max(2, 47 - cleanSuffix.length))}_${cleanSuffix}`;
  }
  return candidate.slice(0, 48);
}

export function validateAdminUserCreate(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "Data pengguna tidak valid." };
  const username = normalizeAdminUsername(input.username);
  if (!username) {
    return {
      ok: false,
      error: "Username harus 3–64 karakter (diawali huruf/angka ASCII, boleh berisi titik, garis bawah, atau tanda hubung).",
    };
  }
  const fullNameResult = validateAdminFullName(input.fullName);
  if (!fullNameResult.ok) return fullNameResult;
  if (typeof input.password !== "string" || !validNewAdminPassword(input.password)) {
    return { ok: false, error: "Kata sandi harus 12–128 karakter dan maksimal 512 byte." };
  }
  if (input.password !== input.passwordConfirmation) {
    return { ok: false, error: "Kata sandi dan konfirmasi kata sandi tidak sama." };
  }
  const isSuperuser = Boolean(input.isSuperuser);
  const isActive = input.isActive !== false;
  const roleId = typeof input.roleId === "string" && /^[1-9]\d{0,18}$/.test(input.roleId) ? input.roleId : null;
  if (!isSuperuser && !roleId) {
    return { ok: false, error: "Pilih peran hak akses untuk pengguna non-superadmin." };
  }
  return {
    ok: true,
    value: {
      username,
      fullName: fullNameResult.value,
      password: input.password,
      isSuperuser,
      isActive,
      roleId: isSuperuser ? null : roleId,
    },
  };
}

export function validateAdminUserUpdate(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "Data pembaruan pengguna tidak valid." };
  const fullNameResult = validateAdminFullName(input.fullName);
  if (!fullNameResult.ok) return fullNameResult;
  const isSuperuser = Boolean(input.isSuperuser);
  const isActive = Boolean(input.isActive);
  const roleId = typeof input.roleId === "string" && /^[1-9]\d{0,18}$/.test(input.roleId) ? input.roleId : null;
  if (!isSuperuser && !roleId) {
    return { ok: false, error: "Pilih peran hak akses untuk pengguna non-superadmin." };
  }
  return {
    ok: true,
    value: {
      fullName: fullNameResult.value,
      isSuperuser,
      isActive,
      roleId: isSuperuser ? null : roleId,
    },
  };
}

export function validateAdminPasswordReset(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "Permintaan reset sandi tidak valid." };
  if (typeof input.password !== "string" || !validNewAdminPassword(input.password)) {
    return { ok: false, error: "Kata sandi baru harus 12–128 karakter dan maksimal 512 byte." };
  }
  if (input.password !== input.passwordConfirmation) {
    return { ok: false, error: "Kata sandi baru dan konfirmasinya tidak sama." };
  }
  return { ok: true, value: input.password };
}
