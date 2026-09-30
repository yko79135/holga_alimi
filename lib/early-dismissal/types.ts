import type { AttendanceStatus } from "@/lib/attendance/types";

/** A request is open until the parent withdraws it. There is no approval step: submitting
 * notifies every teacher, and a teacher records it on the attendance sheet when appropriate. */
export type EarlyDismissalState = "submitted" | "recorded" | "cancelled";

export const STATE_LABELS: Record<EarlyDismissalState, string> = {
  submitted: "접수됨",
  recorded: "출석부 기록됨",
  cancelled: "취소됨",
};

/** A parent asks for one of three things on a given day. They share one form, one notification
 * path, and one attendance write; only the label, what the clock on the form means, and the
 * status a teacher records differ. */
export type EarlyDismissalRequestType = "early_dismissal" | "absence" | "tardy";

/** Display order on the parent's form: the two kinds that carry a clock, then the whole-day 결석. */
export const REQUEST_TYPES: EarlyDismissalRequestType[] = ["early_dismissal", "tardy", "absence"];

export const REQUEST_TYPE_LABELS: Record<EarlyDismissalRequestType, string> = {
  early_dismissal: "조퇴",
  absence: "결석",
  // 인정지각인지 무단지각인지는 교사가 출석부에 기록할 때 고르므로, 신청 자체는 그냥 지각이다.
  tardy: "지각",
};

/** "조퇴 · 지각 · 결석" and "조퇴·지각·결석 신청" -- headings and tab buttons name every kind so a
 * parent can tell one tab covers all of them. Derived from REQUEST_TYPES so adding a kind can
 * never leave a stale label behind. */
export const REQUEST_TYPES_SUMMARY = REQUEST_TYPES.map((type) => REQUEST_TYPE_LABELS[type]).join(" · ");
export const REQUEST_TYPES_TAB_LABEL = `${REQUEST_TYPES.map((type) => REQUEST_TYPE_LABELS[type]).join("·")} 신청`;

/** The statuses a teacher may record each kind as, one button each, in display order. A 지각 or
 * 결석 is recorded as 인정 or 무단 at the teacher's judgement of the reason; a 조퇴 has one form.
 * The 무단 button says so outright, but the status it writes is the plain 지각/결석, which is how
 * the attendance sheet and every statistic already name an unexcused day. */
export const REQUEST_TYPE_RECORD_OPTIONS: Record<EarlyDismissalRequestType, Array<{ status: AttendanceStatus; label: string }>> = {
  early_dismissal: [{ status: "early_leave", label: "조퇴" }],
  tardy: [{ status: "excused_late", label: "인정지각" }, { status: "late", label: "무단지각" }],
  absence: [{ status: "excused_absent", label: "인정결석" }, { status: "absent", label: "무단결석" }],
};

export function isRecordableStatus(type: EarlyDismissalRequestType, status: unknown): status is AttendanceStatus {
  return REQUEST_TYPE_RECORD_OPTIONS[type].some((option) => option.status === status);
}

/** What a request recorded before the teacher could choose was written as. Only a fallback for
 * rows whose attendance_recorded_status is empty; the migration fills those in as well. */
const LEGACY_RECORDED_STATUS: Record<EarlyDismissalRequestType, AttendanceStatus> = {
  early_dismissal: "early_leave",
  absence: "absent",
  tardy: "excused_late",
};

/** The status a recorded request put on the attendance sheet. */
export function recordedStatusOf(type: EarlyDismissalRequestType, stored: unknown): AttendanceStatus {
  return isRecordableStatus(type, stored) ? stored : LEGACY_RECORDED_STATUS[type];
}

/** The label a recorded request shows: "무단지각" rather than the sheet's plain "지각", so the
 * choice the teacher made reads the same on the card as on the button. */
export function recordedStatusLabel(type: EarlyDismissalRequestType, status: AttendanceStatus): string {
  return REQUEST_TYPE_RECORD_OPTIONS[type].find((option) => option.status === status)?.label ?? REQUEST_TYPE_LABELS[type];
}

/** What the optional clock means for each kind, and null for the kind that has none: a 결석 covers
 * the whole day, a 조퇴 records when the child leaves, a 지각 when they are expected to arrive.
 * All of them share the one dismissal_time column. */
export const REQUEST_TYPE_TIME_LABELS: Record<EarlyDismissalRequestType, string | null> = {
  early_dismissal: "조퇴 시각",
  absence: null,
  tardy: "등교 예정 시각",
};

/** How the date and clock are introduced together in a notification. */
export const REQUEST_TYPE_MOMENT_LABELS: Record<EarlyDismissalRequestType, string> = {
  early_dismissal: "일시",
  absence: "날짜",
  tardy: "등교 예정",
};

/** Whether the kind carries a clock at all -- a whole-day 결석 does not. */
export function usesDismissalTime(type: EarlyDismissalRequestType) {
  return REQUEST_TYPE_TIME_LABELS[type] !== null;
}

export function timeFieldLabel(type: EarlyDismissalRequestType) {
  return REQUEST_TYPE_TIME_LABELS[type];
}

export function momentLabel(type: EarlyDismissalRequestType) {
  return REQUEST_TYPE_MOMENT_LABELS[type];
}

/** Only a 조퇴 sends a child home mid-day, so only a 조퇴 asks whether they come back. A 지각 has
 * a clock but no return question: the child is arriving, not leaving. */
export function usesReturnsSameDay(type: EarlyDismissalRequestType) {
  return type === "early_dismissal";
}

export function isRequestType(value: unknown): value is EarlyDismissalRequestType {
  return REQUEST_TYPES.includes(value as EarlyDismissalRequestType);
}

export function requestTypeLabel(type: EarlyDismissalRequestType) {
  return REQUEST_TYPE_LABELS[type];
}

export type EarlyDismissalRequest = {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string;
  parentId: string;
  parentName: string;
  type: EarlyDismissalRequestType;
  dismissalDate: string;
  dismissalTime: string | null;
  reason: string;
  guardianName: string | null;
  guardianContact: string | null;
  returnsSameDay: boolean;
  state: EarlyDismissalState;
  cancelledAt: string | null;
  attendanceRecordedAt: string | null;
  /** What the teacher recorded the day as; null until recorded. */
  attendanceRecordedStatus: AttendanceStatus | null;
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
