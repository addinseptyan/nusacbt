import { validDataId } from "./class-validation.mjs";

export const SESSION_MAX_GROUPS = 24;
export const SESSION_MAX_STUDENTS = 5000;
export const SESSION_MAX_CAPACITY = 5000;

/** Menghasilkan bilangan seragam; tidak menyimpan seed/identitas peserta. */
export function sessionRandomInt(max) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 0x100000000) throw new Error("Batas acak tidak valid.");
  const limit = Math.floor(0x100000000 / max) * max;
  const bytes = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % max;
}

/** @template T @param {T[]} input @param {(max: number) => number} random */
function shuffled(input, random) {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("Hasil acak tidak valid.");
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Pertahankan pembagian siswa yang sudah disimpan; acak hanya siswa baru.
 * Kelas diseimbangkan relatif terhadap kapasitas, lalu total tiap sesi.
 * Total kapasitas adalah batas keras. Sesi tersimpan yang melebihi kapasitas
 * baru tetap ditampilkan untuk dipindah; validasi penyimpanan menolaknya.
 * @param {Array<{studentId: string, classId: string, sessionNumber: number | null}>} students
 * @param {number[]} capacities
 * @param {(max: number) => number} [random]
 * @returns {{ok: true, assignments: Array<{studentId: string, sessionNumber: number}>} | {ok: false, error: string}}
 */
export function distributeExamSessions(students, capacities, random = sessionRandomInt) {
  if (!Array.isArray(students) || students.length > SESSION_MAX_STUDENTS ||
      !Array.isArray(capacities) || capacities.length < 1 || capacities.length > SESSION_MAX_GROUPS ||
      capacities.some((n) => !Number.isInteger(n) || n < 1 || n > SESSION_MAX_CAPACITY)) {
    return { ok: false, error: "Jumlah sesi, kapasitas, atau peserta tidak valid." };
  }
  if (new Set(students.map((s) => s.studentId)).size !== students.length || students.some((s) => !validDataId(s.studentId) || !validDataId(s.classId))) {
    return { ok: false, error: "Daftar peserta tidak valid atau berisi siswa ganda." };
  }
  if (students.length > capacities.reduce((sum, n) => sum + n, 0)) return { ok: false, error: "Total kapasitas sesi kurang dari jumlah peserta." };
  const counts = capacities.map(() => 0);
  /** @type {Map<string, number[]>} */
  const byClass = new Map();
  /** @type {Map<string, number>} */
  const assigned = new Map();
  /** @type {Map<string, typeof students>} */
  const waiting = new Map();
  for (const student of students) {
    if (!byClass.has(student.classId)) byClass.set(student.classId, capacities.map(() => 0));
    if (student.sessionNumber !== null) {
      const index = student.sessionNumber - 1;
      if (!Number.isInteger(index) || index < 0 || index >= capacities.length) {
        return { ok: false, error: "Sesi yang sudah tersimpan tidak tersedia. Pindahkan siswa lalu simpan sebelum menghapus sesi." };
      }
      // Pertahankan siswa tersimpan sekalipun kapasitas baru lebih kecil agar
      // pratinjau dapat menunjukkan kelebihan dan admin bisa memindahkannya.
      // Validasi penyimpanan tetap menolak setiap sesi yang melebihi kapasitas.
      counts[index] += 1;
      byClass.get(student.classId)[index] += 1;
      assigned.set(student.studentId, index + 1);
    } else {
      if (!waiting.has(student.classId)) waiting.set(student.classId, []);
      waiting.get(student.classId).push(student);
    }
  }
  // Perbandingan pecahan menggunakan perkalian silang agar tidak bergantung
  // pembulatan floating point saat kapasitas sesi berbeda.
  for (const classId of shuffled([...waiting.keys()], random)) {
    const classCounts = byClass.get(classId);
    for (const student of shuffled(waiting.get(classId), random)) {
      let best = -1;
      /** @type {number[]} */ const ties = [];
      for (let i = 0; i < capacities.length; i += 1) {
        if (counts[i] >= capacities[i]) continue;
        if (best < 0) { best = i; ties.push(i); continue; }
        const classDifference = classCounts[i] * capacities[best] - classCounts[best] * capacities[i];
        const totalDifference = counts[i] * capacities[best] - counts[best] * capacities[i];
        if (classDifference < 0 || (classDifference === 0 && totalDifference < 0)) { best = i; ties.length = 0; ties.push(i); }
        else if (classDifference === 0 && totalDifference === 0) ties.push(i);
      }
      if (best < 0) return { ok: false, error: "Kapasitas sesi tidak cukup." };
      const index = ties.length === 1 ? best : ties[random(ties.length)];
      counts[index] += 1; classCounts[index] += 1; assigned.set(student.studentId, index + 1);
    }
  }
  return { ok: true, assignments: students.map((s) => ({ studentId: s.studentId, sessionNumber: assigned.get(s.studentId) })) };
}

/**
 * @param {unknown} raw
 * @returns {{ok: true, value: {periodId:string, expectedRevision:string|null, capacities:number[], assignments:Array<{studentId:string,placementId:string,sessionNumber:number}>}} | {ok:false,error:string}}
 */
export function validateSessionPlan(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Data kelompok sesi tidak valid." };
  const value = /** @type {Record<string, unknown>} */ (raw);
  const periodId = validDataId(value.periodId);
  const revision = value.expectedRevision;
  if (!periodId || !(revision === null || (typeof revision === "string" && /^(0|[1-9]\d{0,18})$/.test(revision) && BigInt(revision) < BigInt("9223372036854775807")))) {
    return { ok: false, error: "Periode atau versi kelompok tidak valid. Muat ulang halaman." };
  }
  if (!Array.isArray(value.capacities) || value.capacities.length < 1 || value.capacities.length > SESSION_MAX_GROUPS ||
      value.capacities.some((n) => !Number.isInteger(n) || n < 1 || n > SESSION_MAX_CAPACITY)) {
    return { ok: false, error: `Pilih 1–${SESSION_MAX_GROUPS} sesi dengan kapasitas 1–${SESSION_MAX_CAPACITY} per sesi.` };
  }
  if (!Array.isArray(value.assignments) || value.assignments.length > SESSION_MAX_STUDENTS) {
    return { ok: false, error: `Pilih maksimal ${SESSION_MAX_STUDENTS} siswa dalam satu periode.` };
  }
  const capacities = /** @type {number[]} */ (value.capacities);
  const counts = capacities.map(() => 0); const seen = new Set();
  /** @type {Array<{studentId:string,placementId:string,sessionNumber:number}>} */
  const assignments = [];
  for (const item of value.assignments) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Data peserta tidak valid." };
    const row = /** @type {Record<string, unknown>} */ (item);
    const studentId = validDataId(row.studentId); const placementId = validDataId(row.placementId); const sessionNumber = row.sessionNumber;
    if (!studentId || !placementId || seen.has(studentId) || typeof sessionNumber !== "number" || !Number.isInteger(sessionNumber) || sessionNumber < 1 || sessionNumber > capacities.length) {
      return { ok: false, error: "Peserta, penempatan, atau sesi tidak valid atau siswa muncul lebih dari sekali." };
    }
    seen.add(studentId); counts[sessionNumber - 1] += 1;
    assignments.push({ studentId, placementId, sessionNumber });
  }
  if (counts.some((count, i) => count > capacities[i])) return { ok: false, error: "Jumlah siswa pada sesi melebihi kapasitasnya." };
  return { ok: true, value: { periodId, expectedRevision: revision, capacities, assignments } };
}
