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

/** School-wide offices on the homeroom card, in display order. Display-only: neither designation
 * grants any permission, so adding an office here is all it takes to show and edit it. */
export const SCHOOL_OFFICER_ROLES = [
  { key: "principal", label: "교장 선생님" },
  { key: "vice_principal", label: "교감 선생님" },
] as const;

export type SchoolOfficerRoleKey = (typeof SCHOOL_OFFICER_ROLES)[number]["key"];

export function isSchoolOfficerRoleKey(value: unknown): value is SchoolOfficerRoleKey {
  return SCHOOL_OFFICER_ROLES.some((role) => role.key === value);
}

export function schoolOfficerLabel(key: SchoolOfficerRoleKey): string {
  return SCHOOL_OFFICER_ROLES.find((role) => role.key === key)!.label;
}
