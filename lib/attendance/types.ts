export type AttendanceStatus = "present" | "late" | "absent" | "early_leave" | "sick_leave" | "suspension";
export type AttendanceExceptionStatus = Exclude<AttendanceStatus, "present">;

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["present", "late", "absent", "early_leave", "sick_leave", "suspension"];
export const ATTENDANCE_EXCEPTION_STATUSES: AttendanceExceptionStatus[] = ["late", "absent", "early_leave", "sick_leave", "suspension"];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  early_leave: "조퇴",
  sick_leave: "병결",
  suspension: "정학",
};

export function emptyExceptionCounts(): Record<AttendanceExceptionStatus, number> {
  return { late: 0, absent: 0, early_leave: 0, sick_leave: 0, suspension: 0 };
}

export type AttendanceCellChange = {
  studentId: string;
  date: string;
  previousStatus: AttendanceStatus;
  newStatus: AttendanceStatus;
  parentVisibleReason?: string;
  teacherNote?: string;
};

export type AttendanceGridStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  parentCount: number;
  daily: Record<string, AttendanceStatus>;
  monthlyCounts: Record<AttendanceExceptionStatus, number>;
  semesterCounts: Record<AttendanceExceptionStatus, number>;
  lastUpdatedAt: string | null;
};
