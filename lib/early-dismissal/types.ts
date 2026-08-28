export type EarlyDismissalDecision = "pending" | "approved" | "rejected";
export type EarlyDismissalStatus = EarlyDismissalDecision | "cancelled";
export type ApproverRole = "homeroom" | "vice_principal";

export const APPROVER_ROLES: ApproverRole[] = ["homeroom", "vice_principal"];

export const APPROVER_ROLE_LABELS: Record<ApproverRole, string> = {
  homeroom: "홈룸 선생님",
  vice_principal: "교감 선생님",
};

export const DECISION_LABELS: Record<EarlyDismissalDecision, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

export const STATUS_LABELS: Record<EarlyDismissalStatus, string> = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려됨",
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
  status: EarlyDismissalStatus;
  homeroom: DecisionState;
  vicePrincipal: DecisionState;
  homeroomTeacherName: string;
  vicePrincipalName: string;
  createdAt: string;
  acknowledgedBy: Array<{ id: string; name: string; at: string }>;
};

export type DecisionState = {
  decision: EarlyDismissalDecision;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
};

/** Mirrors the public.early_dismissal_sync_status() trigger so the UI can show the status a
 * pending decision would produce without waiting for a round trip. */
export function overallStatus(homeroom: EarlyDismissalDecision, vicePrincipal: EarlyDismissalDecision): EarlyDismissalStatus {
  if (homeroom === "rejected" || vicePrincipal === "rejected") return "rejected";
  if (homeroom === "approved" && vicePrincipal === "approved") return "approved";
  return "pending";
}

export function isDecision(value: unknown): value is EarlyDismissalDecision {
  return value === "pending" || value === "approved" || value === "rejected";
}

export function isApproverRole(value: unknown): value is ApproverRole {
  return value === "homeroom" || value === "vice_principal";
}

export const MAX_REASON_LENGTH = 500;
export const MAX_COMMENT_LENGTH = 300;
export const MAX_NAME_LENGTH = 40;
export const MAX_CONTACT_LENGTH = 40;
