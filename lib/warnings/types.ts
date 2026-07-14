export type WarningCellChange = {
  studentId: string;
  date: string | null;
  entryType: "daily" | "grace_adjustment";
  previousValue: number;
  newValue: number;
  parentVisibleReason?: string;
  teacherNote?: string;
};

export type WarningGridStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  parentCount: number;
  daily: Record<string, number>;
  graceAdjustment: number;
  monthlyTotal: number;
  semesterTotal: number;
  lastUpdatedAt: string | null;
};
