export type ExamPeriod = {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  revision: string;
  yearId: string | null;
  yearName: string | null;
  isActive: boolean;
};
