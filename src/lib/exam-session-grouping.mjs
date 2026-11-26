/**
 * Helper murni pengelompokan siswa per kelas dan penyesuaian multiselect/sesi
 * untuk halaman Kelompok Sesi (/data-tes/daftar/sesi).
 */

/**
 * @typedef {{
 *   studentId: string,
 *   studentName: string,
 *   nisn: string,
 *   placementId: string,
 *   classId: string,
 *   classLabel: string,
 *   active: boolean,
 *   sessionNumber: number | null,
 * }} SessionStudentRow
 *
 * @typedef {{
 *   classId: string,
 *   classLabel: string,
 *   students: SessionStudentRow[],
 * }} SessionClassGroup
 */

/**
 * Mengelompokkan daftar siswa berdasarkan kelas dan mengurutkan kelas secara alami.
 * @param {SessionStudentRow[]} students
 * @returns {SessionClassGroup[]}
 */
export function groupSessionStudentsByClass(students) {
  /** @type {Map<string, { classId: string, classLabel: string, hasActiveLabel: boolean, students: SessionStudentRow[] }>} */
  const byClass = new Map();
  for (const row of students) {
    const existing = byClass.get(row.classId);
    if (!existing) {
      byClass.set(row.classId, {
        classId: row.classId,
        classLabel: row.classLabel,
        hasActiveLabel: row.active,
        students: [row],
      });
    } else {
      if (row.active && !existing.hasActiveLabel) {
        existing.classLabel = row.classLabel;
        existing.hasActiveLabel = true;
      }
      existing.students.push(row);
    }
  }
  return [...byClass.values()]
    .map(({ classId, classLabel, students: classStudents }) => ({
      classId,
      classLabel,
      students: classStudents,
    }))
    .sort((a, b) => a.classLabel.localeCompare(b.classLabel, "id", { numeric: true, sensitivity: "base" }));
}

/**
 * Menyaring kelompok kelas dan siswa berdasarkan pencarian dan filter status/sesi.
 * @param {SessionClassGroup[]} groups
 * @param {string} query
 * @param {string} sessionFilter
 * @param {Set<string>} chosen
 * @param {Map<string, number>} assignments
 * @returns {SessionClassGroup[]}
 */
export function filterSessionClassGroups(groups, query, sessionFilter = "all", chosen = new Set(), assignments = new Map()) {
  const normalized = query.trim().toLowerCase();
  /** @type {SessionClassGroup[]} */
  const result = [];
  for (const group of groups) {
    const classMatchesQuery = !normalized || group.classLabel.toLowerCase().includes(normalized);
    const matchedStudents = group.students.filter((row) => {
      const textMatches =
        classMatchesQuery ||
        row.studentName.toLowerCase().includes(normalized) ||
        row.nisn.toLowerCase().includes(normalized);
      if (!textMatches) return false;
      if (sessionFilter === "all") return true;
      const isChosen = chosen.has(row.studentId);
      if (sessionFilter === "selected") return isChosen;
      if (sessionFilter === "unselected") return !isChosen;
      if (sessionFilter.startsWith("session:")) {
        const target = Number(sessionFilter.slice("session:".length));
        return isChosen && assignments.get(row.studentId) === target;
      }
      return true;
    });
    if (matchedStudents.length > 0) {
      result.push({ classId: group.classId, classLabel: group.classLabel, students: matchedStudents });
    }
  }
  return result;
}

/**
 * Mencontreng atau menghapus centang seluruh siswa aktif dalam satu kelas.
 * @param {SessionStudentRow[]} studentsInGroup
 * @param {Set<string>} chosen
 * @param {Map<string, number>} assignments
 * @param {boolean} checked
 * @param {number} [defaultSession]
 * @returns {{ nextChosen: Set<string>, nextAssignments: Map<string, number> }}
 */
export function applyClassCheckboxToggle(studentsInGroup, chosen, assignments, checked, defaultSession = 1) {
  const nextChosen = new Set(chosen);
  const nextAssignments = new Map(assignments);
  for (const row of studentsInGroup) {
    if (!row.active) continue;
    if (checked) {
      nextChosen.add(row.studentId);
      if (!nextAssignments.has(row.studentId)) {
        nextAssignments.set(row.studentId, row.sessionNumber ?? defaultSession);
      }
    } else {
      nextChosen.delete(row.studentId);
      nextAssignments.delete(row.studentId);
    }
  }
  return { nextChosen, nextAssignments };
}

/**
 * Menetapkan sesi untuk seluruh siswa aktif yang tercentang di kelas ini
 * (atau otomatis mencentang dan menetapkan semua siswa aktif jika belum ada yang tercentang).
 * @param {SessionStudentRow[]} studentsInGroup
 * @param {Set<string>} chosen
 * @param {Map<string, number>} assignments
 * @param {number} sessionNumber
 * @returns {{ nextChosen: Set<string>, nextAssignments: Map<string, number> }}
 */
export function applyClassSessionAssignment(studentsInGroup, chosen, assignments, sessionNumber) {
  const nextChosen = new Set(chosen);
  const nextAssignments = new Map(assignments);
  const activeStudents = studentsInGroup.filter((row) => row.active);
  const checkedActive = activeStudents.filter((row) => nextChosen.has(row.studentId));
  const targets = checkedActive.length > 0 ? checkedActive : activeStudents;
  for (const row of targets) {
    nextChosen.add(row.studentId);
    nextAssignments.set(row.studentId, sessionNumber);
  }
  return { nextChosen, nextAssignments };
}

/**
 * Ringkasan status centang dan sesi seragam pada satu kelompok kelas.
 * @param {SessionStudentRow[]} studentsInGroup
 * @param {Set<string>} chosen
 * @param {Map<string, number>} assignments
 * @param {number} maxSessions
 */
export function summarizeClassSelection(studentsInGroup, chosen, assignments, maxSessions) {
  let activeCount = 0;
  let checkedCount = 0;
  let checkedActiveCount = 0;
  /** @type {Set<number>} */
  const sessions = new Set();
  let hasInvalidSession = false;

  for (const row of studentsInGroup) {
    const isChosen = chosen.has(row.studentId);
    if (isChosen) checkedCount += 1;
    if (row.active) {
      activeCount += 1;
      if (isChosen) {
        checkedActiveCount += 1;
        const assigned = assignments.get(row.studentId);
        if (assigned !== undefined && Number.isInteger(assigned) && assigned >= 1 && assigned <= maxSessions) {
          sessions.add(assigned);
        } else {
          hasInvalidSession = true;
        }
      }
    }
  }

  const allActiveChecked = activeCount > 0 && checkedActiveCount === activeCount;
  const indeterminate = !allActiveChecked && checkedCount > 0;
  let classSessionValue = "";
  if (checkedActiveCount > 0) {
    if (hasInvalidSession || sessions.size > 1) {
      classSessionValue = "mixed";
    } else if (sessions.size === 1) {
      classSessionValue = String([...sessions][0]);
    }
  }

  return {
    activeCount,
    checkedCount,
    checkedActiveCount,
    allActiveChecked,
    indeterminate,
    classSessionValue,
  };
}
