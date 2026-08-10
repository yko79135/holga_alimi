import { ATTENDANCE_STATUS_LABELS, type AttendanceCellChange, type AttendanceExceptionStatus } from "./types";

export function attendanceChangeType(newStatus: string) {
  return newStatus === "present" ? "correction" : "exception";
}

export function buildAttendanceNotice(studentName: string, changes: AttendanceCellChange[], monthCounts: Record<AttendanceExceptionStatus, number>) {
  const corrections = changes.filter((change) => change.newStatus === "present");
  const exceptions = changes.filter((change) => change.newStatus !== "present");
  const title = exceptions.length && !corrections.length ? "출결 상태가 등록되었습니다" : corrections.length && !exceptions.length ? "출결 상태가 정정되었습니다" : "출결 상태가 업데이트되었습니다";
  const lines = [`${studentName} 학생의 출결 상태가 업데이트되었습니다.`, ""];
  for (const change of changes) lines.push(`${change.date}: ${ATTENDANCE_STATUS_LABELS[change.previousStatus]} → ${ATTENDANCE_STATUS_LABELS[change.newStatus]}`);
  const summary = Object.entries(monthCounts).filter(([, count]) => count > 0).map(([status, count]) => `${ATTENDANCE_STATUS_LABELS[status as AttendanceExceptionStatus]} ${count}회`).join(", ");
  if (summary) lines.push("", `이번 달 출결 현황: ${summary}`);
  const reasons = Array.from(new Set(changes.map((change) => change.parentVisibleReason?.trim()).filter(Boolean))).join("\n");
  if (reasons) lines.push("", "사유:", reasons);
  lines.push("", "자세한 내용은 포털에서 확인해 주세요.");
  return { title, body: lines.join("\n") };
}
