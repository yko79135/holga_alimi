export type AttendanceStatus = "present" | "late" | "excused_late" | "absent" | "early_leave" | "sick_leave" | "suspension";
export type AttendanceExceptionStatus = Exclude<AttendanceStatus, "present">;

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["present", "late", "excused_late", "absent", "early_leave", "sick_leave", "suspension"];
export const ATTENDANCE_EXCEPTION_STATUSES: AttendanceExceptionStatus[] = ["late", "excused_late", "absent", "early_leave", "sick_leave", "suspension"];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "출석",
  // 지각은 사유가 인정되지 않는 지각, 인정지각은 사유가 인정되는 지각(학부모 지각 신청 포함).
  // 둘은 통계에서 따로 센다.
  late: "지각",
  excused_late: "인정지각",
  absent: "결석",
  early_leave: "조퇴",
  sick_leave: "병결",
  suspension: "정학",
};

export function emptyExceptionCounts(): Record<AttendanceExceptionStatus, number> {
  return { late: 0, excused_late: 0, absent: 0, early_leave: 0, sick_leave: 0, suspension: 0 };
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
