import { APPROVER_ROLE_LABELS, STATUS_LABELS, type ApproverRole, type EarlyDismissalStatus } from "./types";

type RequestSummary = {
  studentName: string;
  studentGrade: string;
  dismissalDate: string;
  dismissalTime: string | null;
  reason: string;
  guardianName?: string | null;
  returnsSameDay?: boolean;
};

/** "14:30:00" (Postgres time) and "14:30" (HTML time input) both render as "14:30". */
export function formatDismissalTime(time: string | null | undefined) {
  if (!time) return null;
  const [hour, minute] = time.split(":");
  if (hour === undefined || minute === undefined) return time;
  return `${hour}:${minute}`;
}

export function formatDismissalMoment(date: string, time: string | null | undefined) {
  const clock = formatDismissalTime(time);
  return clock ? `${date} ${clock}` : date;
}

/** Staff-facing push and notice text for a newly submitted request. */
export function buildSubmissionNotice(request: RequestSummary, parentName: string) {
  return {
    title: `[조퇴 신청] ${request.studentGrade} ${request.studentName}`,
    body: [
      `${parentName} 학부모님이 조퇴를 신청했습니다.`,
      `일시: ${formatDismissalMoment(request.dismissalDate, request.dismissalTime)}`,
      request.guardianName ? `인솔자: ${request.guardianName}` : null,
      request.returnsSameDay ? "당일 복귀 예정입니다." : null,
      `사유: ${request.reason}`,
      "홈룸 선생님과 교감 선생님의 승인이 필요합니다.",
    ].filter(Boolean).join("\n"),
  };
}

/** Parent-facing text for one approver's decision. */
export function buildDecisionNotice(request: RequestSummary, role: ApproverRole, decision: "approved" | "rejected", deciderName: string, comment: string | null, status: EarlyDismissalStatus) {
  const roleLabel = APPROVER_ROLE_LABELS[role];
  const verb = decision === "approved" ? "승인" : "반려";
  return {
    title: `[조퇴 ${verb}] ${request.studentName} ${formatDismissalMoment(request.dismissalDate, request.dismissalTime)}`,
    body: [
      `${roleLabel}(${deciderName})이 조퇴 신청을 ${verb}했습니다.`,
      comment ? `의견: ${comment}` : null,
      `현재 상태: ${STATUS_LABELS[status]}`,
      status === "pending" ? "남은 결재가 완료되면 다시 안내드리겠습니다." : null,
    ].filter(Boolean).join("\n"),
  };
}

/** Sent to the other approver so the second signature isn't left waiting unnoticed. */
export function buildApproverReminder(request: RequestSummary, role: ApproverRole, decision: "approved" | "rejected", deciderName: string) {
  return {
    title: `[조퇴 결재] ${request.studentGrade} ${request.studentName}`,
    body: `${APPROVER_ROLE_LABELS[role]}(${deciderName})이 ${decision === "approved" ? "승인" : "반려"}했습니다. ${formatDismissalMoment(request.dismissalDate, request.dismissalTime)} 조퇴 건의 결재를 확인해 주세요.`,
  };
}

export function buildCancellationNotice(request: RequestSummary, parentName: string) {
  return {
    title: `[조퇴 취소] ${request.studentGrade} ${request.studentName}`,
    body: `${parentName} 학부모님이 ${formatDismissalMoment(request.dismissalDate, request.dismissalTime)} 조퇴 신청을 취소했습니다.`,
  };
}
