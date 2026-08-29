import { requestTypeLabel, usesDismissalTime, type EarlyDismissalRequestType } from "./types";

type RequestSummary = {
  type: EarlyDismissalRequestType;
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

/** Index of the last syllable's final consonant (0 when there is none, -1 when not hangul). */
function finalConsonant(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 ? code % 28 : -1;
}

/** 조퇴를 / 결석을 -- the object particle follows the last syllable's final consonant. */
export function withObjectParticle(word: string) {
  return `${word}${finalConsonant(word) > 0 ? "을" : "를"}`;
}

/** 조퇴가 / 결석이 -- the subject particle follows the last syllable's final consonant. */
export function withSubjectParticle(word: string) {
  return `${word}${finalConsonant(word) > 0 ? "이" : "가"}`;
}

/** 조퇴로 / 결석으로 -- 으 is dropped after a vowel and after ㄹ (final consonant 8). */
export function withMeansParticle(word: string) {
  const final = finalConsonant(word);
  return `${word}${final > 0 && final !== 8 ? "으로" : "로"}`;
}

/** Staff-facing push text for a newly submitted request. */
export function buildSubmissionNotice(request: RequestSummary, parentName: string, homeroomTeacherName: string) {
  const label = requestTypeLabel(request.type);
  const timed = usesDismissalTime(request.type);
  return {
    title: `[${label} 신청] ${request.studentGrade} ${request.studentName}`,
    body: [
      `${parentName} 학부모님이 ${withObjectParticle(label)} 신청했습니다.`,
      timed ? `일시: ${formatDismissalMoment(request.dismissalDate, request.dismissalTime)}` : `날짜: ${request.dismissalDate}`,
      homeroomTeacherName ? `홈룸: ${homeroomTeacherName} 선생님` : null,
      request.guardianName ? `인솔자: ${request.guardianName}` : null,
      timed && request.returnsSameDay ? "당일 복귀 예정입니다." : null,
      `사유: ${request.reason}`,
    ].filter(Boolean).join("\n"),
  };
}

export function buildCancellationNotice(request: RequestSummary, parentName: string) {
  const label = requestTypeLabel(request.type);
  return {
    title: `[${label} 취소] ${request.studentGrade} ${request.studentName}`,
    body: `${parentName} 학부모님이 ${formatDismissalMoment(request.dismissalDate, usesDismissalTime(request.type) ? request.dismissalTime : null)} ${label} 신청을 취소했습니다.`,
  };
}
