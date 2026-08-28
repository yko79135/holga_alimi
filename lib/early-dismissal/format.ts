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

/** Staff-facing push text for a newly submitted request. */
export function buildSubmissionNotice(request: RequestSummary, parentName: string, homeroomTeacherName: string) {
  return {
    title: `[조퇴 신청] ${request.studentGrade} ${request.studentName}`,
    body: [
      `${parentName} 학부모님이 조퇴를 신청했습니다.`,
      `일시: ${formatDismissalMoment(request.dismissalDate, request.dismissalTime)}`,
      homeroomTeacherName ? `홈룸: ${homeroomTeacherName} 선생님` : null,
      request.guardianName ? `인솔자: ${request.guardianName}` : null,
      request.returnsSameDay ? "당일 복귀 예정입니다." : null,
      `사유: ${request.reason}`,
    ].filter(Boolean).join("\n"),
  };
}

export function buildCancellationNotice(request: RequestSummary, parentName: string) {
  return {
    title: `[조퇴 취소] ${request.studentGrade} ${request.studentName}`,
    body: `${parentName} 학부모님이 ${formatDismissalMoment(request.dismissalDate, request.dismissalTime)} 조퇴 신청을 취소했습니다.`,
  };
}
