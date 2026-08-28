/** A request is open until the parent withdraws it. There is no approval step: submitting
 * notifies every teacher, and a teacher records it on the attendance sheet when appropriate. */
export type EarlyDismissalState = "submitted" | "recorded" | "cancelled";

export const STATE_LABELS: Record<EarlyDismissalState, string> = {
  submitted: "접수됨",
  recorded: "출석부 기록됨",
  cancelled: "취소됨",
};

export type EarlyDismissalRequest = {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string;
  parentId: string;
  parentName: string;
  dismissalDate: string;
  dismissalTime: string | null;
  reason: string;
  guardianName: string | null;
  guardianContact: string | null;
  returnsSameDay: boolean;
  state: EarlyDismissalState;
  cancelledAt: string | null;
  attendanceRecordedAt: string | null;
  attendanceRecordedByName: string | null;
  homeroomTeacherName: string;
  createdAt: string;
  acknowledgedBy: Array<{ id: string; name: string; at: string }>;
};

export function requestState(row: { cancelled_at: string | null; attendance_recorded_at: string | null }): EarlyDismissalState {
  if (row.cancelled_at) return "cancelled";
  if (row.attendance_recorded_at) return "recorded";
  return "submitted";
}

export const MAX_REASON_LENGTH = 500;
export const MAX_NAME_LENGTH = 40;
export const MAX_CONTACT_LENGTH = 40;
