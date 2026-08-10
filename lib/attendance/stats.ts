import { latestStatusByStudentDate } from "./aggregate";
import { emptyExceptionCounts, type AttendanceExceptionStatus, type AttendanceStatus } from "./types";

type RawAttendanceEntry = { student_id: string; attendance_date: string; new_status: AttendanceStatus; created_at: string };

export type MonthlyAttendanceBreakdown = { month: number; counts: Record<AttendanceExceptionStatus, number>; total: number };

export type AttendanceStudentSummary = {
  semesterCounts: Record<AttendanceExceptionStatus, number>;
  semesterTotal: number;
  monthly: MonthlyAttendanceBreakdown[];
};

/** Groups each student's *current* (latest-per-date) attendance exceptions by calendar month,
 * for a semester's worth of entries already scoped by the caller's academic_year/semester query. */
export function summarizeAttendanceForStudents(entries: RawAttendanceEntry[], studentIds: string[]): Record<string, AttendanceStudentSummary> {
  const latestMap = latestStatusByStudentDate(entries);
  const monthlyByStudent = new Map<string, Map<number, Record<AttendanceExceptionStatus, number>>>();
  const semesterByStudent = new Map<string, Record<AttendanceExceptionStatus, number>>();
  for (const id of studentIds) {
    monthlyByStudent.set(id, new Map());
    semesterByStudent.set(id, emptyExceptionCounts());
  }

  for (const [key, entry] of latestMap) {
    if (entry.status === "present") continue;
    const [studentId, date] = key.split(":");
    const monthly = monthlyByStudent.get(studentId);
    const semesterCounts = semesterByStudent.get(studentId);
    if (!monthly || !semesterCounts) continue;
    const month = Number(date.slice(5, 7));
    const status = entry.status as AttendanceExceptionStatus;
    if (!monthly.has(month)) monthly.set(month, emptyExceptionCounts());
    monthly.get(month)![status]++;
    semesterCounts[status]++;
  }

  const result: Record<string, AttendanceStudentSummary> = {};
  for (const id of studentIds) {
    const monthlyMap = monthlyByStudent.get(id)!;
    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([month, counts]) => ({ month, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) }));
    const semesterCounts = semesterByStudent.get(id)!;
    result[id] = { semesterCounts, semesterTotal: Object.values(semesterCounts).reduce((sum, count) => sum + count, 0), monthly };
  }
  return result;
}
