export type SchoolMajor = {
  id: string;
  name: string;
};

export type SchoolClass = {
  id: string;
  level: string;
  majorId: string;
  majorName: string;
};
