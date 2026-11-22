import type { CardFilters } from "@/lib/participant-card-filter.mjs";
import type { IdentityPeriod } from "@/lib/participant-identity-types";
import type { PasswordCandidate } from "@/lib/participant-password-types";

export type CardListRow = {
  studentId: string;
  studentName: string;
  nisn: string;
  classId: string;
  classLabel: string;
  participantNumber: string | null;
  username: string | null;
  hasPassword: boolean;
  candidate: PasswordCandidate | null;
};
export type CardPageData = {
  filters: CardFilters;
  periods: IdentityPeriod[];
  selected: IdentityPeriod | null;
  loginPeriodId: string | null;
  loginPeriodName: string | null;
  classes: Array<{ id: string; label: string }>;
  tests: Array<{ id: string; name: string }>;
  rows: CardListRow[];
  total: number;
  page: number;
  pages: number;
};
export type PreparedCard = {
  studentName: string;
  nisn: string;
  classLabel: string;
  participantNumber: string;
  username: string;
  password: string | null;
};
export type PreparedCards = {
  periodName: string;
  preparedAt: string;
  cards: PreparedCard[];
};
