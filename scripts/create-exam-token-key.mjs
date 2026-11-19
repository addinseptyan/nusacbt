import { fileURLToPath } from "node:url";
import { createParticipantKeyFile, ParticipantKeyFileError } from "../src/lib/participant-password-crypto.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const target = process.argv[2];
try {
  if (!target || process.argv.length !== 3) throw new ParticipantKeyFileError("missing");
  await createParticipantKeyFile(target, projectRoot);
  console.log("File kunci token tes berhasil dibuat. Batasi akses file dan simpan cadangan aman secara terpisah.");
  console.log("Kunci tidak ditampilkan. Jangan memasukkan file tersebut ke repository atau database.");
} catch (error) {
  const reason = error instanceof ParticipantKeyFileError ? error.reason : "unreadable";
  const messages = {
    missing: "Gunakan: npm run token:key:create -- <path-absolut-di-luar-proyek>.",
    invalid: "Path harus absolut dan valid.",
    inside_project: "Simpan kunci di luar direktori proyek dan repository Git.",
    unreadable: "Direktori belum tersedia atau file tidak dapat dibuat. Periksa izin lokal.",
    exists: "File sudah ada; kunci lama tidak ditimpa. Gunakan file tersebut atau pilih lokasi baru.",
  };
  console.error(`Kunci tidak dibuat: ${messages[reason]}`); process.exitCode = 1;
}
