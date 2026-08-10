import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from "./types";

export function buildAttendanceReasonTemplate(params: { studentName: string; date: string; previousStatus: AttendanceStatus; newStatus: AttendanceStatus }) {
  const prevLabel = ATTENDANCE_STATUS_LABELS[params.previousStatus];
  const newLabel = ATTENDANCE_STATUS_LABELS[params.newStatus];
  if (params.newStatus === "present") return `${params.studentName} ${params.date} 출석 정정 (${prevLabel} → ${newLabel}) - `;
  return `${params.studentName} ${params.date} ${newLabel} 등록 - `;
}

export function hasMeaningfulReasonAfterTemplate(value: string, template: string) {
  const trimmedValue = value.trim();
  const trimmedTemplate = template.trim();
  if (!trimmedValue || !trimmedTemplate) return false;
  if (trimmedValue.startsWith(trimmedTemplate)) return trimmedValue.slice(trimmedTemplate.length).trim().length > 0;
  const finalHyphen = trimmedValue.lastIndexOf("-");
  return finalHyphen >= 0 ? trimmedValue.slice(finalHyphen + 1).trim().length > 0 : trimmedValue.length > 0;
}

export function attendanceReasonErrorMessage(newStatus: AttendanceStatus) {
  return newStatus === "present" ? "정정 사유를 입력해 주세요." : "출결 사유를 입력해 주세요.";
}
