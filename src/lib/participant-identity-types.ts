export type IdentityPeriod = {
  id: string;
  name: string;
  startDate: string;
  version: string;
};

export type ParticipantIdentityRow = {
  studentId: string;
  studentName: string;
  nisn: string;
  studentVersion: string;
  placementId: string | null;
  classId: string | null;
  classLabel: string | null;
  identityId: string | null;
  participantNumber: string | null;
  username: string | null;
  identityVersion: string | null;
};

export type IdentityBatch = {
  studentIds: string[];
  token: string;
  totalMissing: number;
};

export type IdentityPageData = {
  periods: IdentityPeriod[];
  selected: IdentityPeriod | null;
  rows: ParticipantIdentityRow[];
  batch: IdentityBatch | null;
  selectionMissing: boolean;
};

export type IdentityActionResult = { ok: true; message: string } | { ok: false; error: string };
