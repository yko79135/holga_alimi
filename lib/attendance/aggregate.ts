import type { AttendanceStatus } from "./types";

type RawAttendanceEntry = { student_id: string; attendance_date: string; new_status: AttendanceStatus; created_at: string };
type LatestStatus = { status: AttendanceStatus; created_at: string };

/** Attendance is a mutable per-day status, not a running sum like warnings, so "current" means
 * the most recently written entry for that (student, date) pair -- earlier entries stay as history. */
export function latestStatusByStudentDate(entries: RawAttendanceEntry[]): Map<string, LatestStatus> {
  const map = new Map<string, LatestStatus>();
  for (const entry of entries) {
    const key = `${entry.student_id}:${entry.attendance_date}`;
    const current = map.get(key);
    if (!current || entry.created_at > current.created_at) map.set(key, { status: entry.new_status, created_at: entry.created_at });
  }
  return map;
}

export function currentStatus(map: Map<string, LatestStatus>, studentId: string, date: string): AttendanceStatus {
  return map.get(`${studentId}:${date}`)?.status ?? "present";
}
