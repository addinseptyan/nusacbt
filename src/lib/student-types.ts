export type Student = {
  id: string;
  name: string;
  nisn: string;
  version: string;
};

export type PlacementPeriod = {
  id: string;
  name: string;
  startDate: string;
};

export type PlacementClass = {
  id: string;
  label: string;
};

export type StudentPlacement = {
  id: string;
  studentId: string;
  periodId: string;
  periodName: string;
  periodStart: string;
  classId: string;
  classNameSnapshot: string;
  startedLabel: string;
  endedLabel: string | null;
};
