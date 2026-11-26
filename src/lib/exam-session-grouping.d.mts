import type { SessionStudent } from "./exam-session-types";

export type SessionClassGroup = {
  classId: string;
  classLabel: string;
  students: SessionStudent[];
};

export function groupSessionStudentsByClass(students: SessionStudent[]): SessionClassGroup[];

export function filterSessionClassGroups(
  groups: SessionClassGroup[],
  query: string,
  sessionFilter?: string,
  chosen?: Set<string>,
  assignments?: Map<string, number>,
): SessionClassGroup[];

export function applyClassCheckboxToggle(
  studentsInGroup: SessionStudent[],
  chosen: Set<string>,
  assignments: Map<string, number>,
  checked: boolean,
  defaultSession?: number,
): { nextChosen: Set<string>; nextAssignments: Map<string, number> };

export function applyClassSessionAssignment(
  studentsInGroup: SessionStudent[],
  chosen: Set<string>,
  assignments: Map<string, number>,
  sessionNumber: number,
): { nextChosen: Set<string>; nextAssignments: Map<string, number> };

export function summarizeClassSelection(
  studentsInGroup: SessionStudent[],
  chosen: Set<string>,
  assignments: Map<string, number>,
  maxSessions: number,
): {
  activeCount: number;
  checkedCount: number;
  checkedActiveCount: number;
  allActiveChecked: boolean;
  indeterminate: boolean;
  classSessionValue: string;
};
