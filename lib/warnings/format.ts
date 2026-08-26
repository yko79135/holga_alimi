import type { WarningCellChange } from "./types";
import type { PointKind } from "./categories";

export function changeType(delta: number, entryType: "daily" | "grace_adjustment") {
  if (entryType === "grace_adjustment") return "grace_adjustment";
  if (delta > 0) return "addition";
  if (delta < 0 && Math.abs(delta) >= 1) return "correction";
  return "correction";
}

export function buildWarningNotice(studentName: string, changes: WarningCellChange[], monthlyTotal: number, kind: PointKind = "discipline") {
  const isPraise = kind === "praise";
  const label = isPraise ? "칭찬 점수" : "훈계 점수";
  const positives = changes.filter((c) => c.newValue - c.previousValue > 0);
  const negatives = changes.filter((c) => c.newValue - c.previousValue < 0);
  const onlyCorrection = negatives.length > 0 && positives.length === 0;
  const gradeLabel = isPraise ? "칭찬 조정" : "은혜의 희월";
  const dates = changes.map((c) => c.entryType === "grace_adjustment" ? gradeLabel : c.date).filter(Boolean).join(", ");
  const title = onlyCorrection ? `${label}가 정정되었습니다` : `${label} 안내`;
  const reasons = Array.from(new Set(changes.map((c) => c.parentVisibleReason?.trim()).filter(Boolean))).join("\n");
  const lines = [
    `안녕하세요, ${studentName} 학생과 관련하여 안내드립니다.`,
    "",
    `${onlyCorrection ? "정정된 날짜" : "해당 날짜"}: ${dates}`,
    `이번 달 ${label} 합계: ${monthlyTotal}점`,
  ];
  if (reasons) lines.push("", onlyCorrection ? "정정 사유" : "사유", reasons);
  lines.push("");
  if (isPraise) lines.push("가정에서도 함께 축하하고 격려해 주세요.");
  lines.push("자세한 내용은 포털에서 확인해 주세요.");
  return { title, body: lines.join("\n") };
}

export function buildPointNotice(params: { kind: PointKind; studentName: string; category: string; className: string | null; detail: string; points: number; monthlyTotal: number }) {
  const { kind, studentName, category, className, detail, points, monthlyTotal } = params;
  const isPraise = kind === "praise";
  const title = isPraise ? "칭찬 점수 안내" : "훈계 점수 안내";
  const lines = [
    isPraise
      ? `안녕하세요, ${studentName} 학생에게 칭찬 점수가 부여되었습니다!`
      : `안녕하세요, ${studentName} 학생과 관련하여 안내드립니다.`,
    "",
    `${isPraise ? "칭찬 내용" : "사유"}: ${category}`,
  ];
  if (className) lines.push(`수업: ${className}`);
  lines.push(`${isPraise ? "부여 점수" : "차감 점수"}: ${points}점`);
  if (detail) lines.push("", "세부 내용", detail);
  lines.push("", `이번 달 ${isPraise ? "칭찬" : "훈계"} 점수 합계: ${monthlyTotal}점`, "");
  if (isPraise) lines.push("가정에서도 함께 축하하고 격려해 주세요.");
  lines.push("자세한 내용은 포털에서 확인해 주세요.");
  return { title, body: lines.join("\n") };
}

/** 희월 settlement: every 20 accumulated praise points converts into 1 unit that cancels 1
 * discipline point (see app/api/warnings/grace-settlement/route.ts for the conversion math). */
export function buildGraceConversionNotice(params: { studentName: string; appliedUnits: number; praiseTotal: number; disciplineTotal: number }) {
  const { studentName, appliedUnits, praiseTotal, disciplineTotal } = params;
  const praiseUsed = appliedUnits * 20;
  const title = "희월 점수 안내";
  const lines = [
    `안녕하세요, ${studentName} 학생과 관련하여 안내드립니다.`,
    "",
    `그동안 쌓인 칭찬 점수 ${praiseUsed}점이 은혜의 희월 ${appliedUnits}점으로 전환되어, 훈계 점수 ${appliedUnits}점이 차감되었습니다.`,
    "",
    `현재 칭찬 점수 합계: ${praiseTotal}점`,
    `현재 훈계 점수 합계: ${disciplineTotal}점`,
    "",
    "자세한 내용은 포털에서 확인해 주세요.",
  ];
  return { title, body: lines.join("\n") };
}

/** Marks the regenerated section a corrected multi-entry notice ends with, so repeated edits
 * replace that section instead of stacking one 정정 안내 block per edit. */
export const POINT_CORRECTION_MARKER = "── 정정 안내 ──";

export function pointNoticeBaseBody(body: string) {
  return body.split(`\n${POINT_CORRECTION_MARKER}\n`)[0].trimEnd();
}

/** Rebuilds a single-entry point notice after a teacher corrects that entry in 점수 통계, so the
 * 학부모 안내문 carries the corrected values rather than what first went out. Kept a separate
 * template from buildPointNotice: the original push is already delivered, so the notice says it
 * is a 정정 instead of quietly reading like the first announcement. */
export function buildPointCorrectionNotice(params: { kind: PointKind; studentName: string; reason: string; className: string | null; points: number; monthlyTotal: number; correctedOn: string }) {
  const { kind, studentName, reason, className, points, monthlyTotal, correctedOn } = params;
  const isPraise = kind === "praise";
  const label = isPraise ? "칭찬" : "훈계";
  const lines = [
    `안녕하세요, ${studentName} 학생의 ${label} 점수 내역이 정정되어 다시 안내드립니다.`,
    "",
    `${isPraise ? "칭찬 내용" : "사유"}: ${reason}`,
  ];
  if (className) lines.push(`수업: ${className}`);
  lines.push(`적용 점수: ${points > 0 ? `+${points}` : points}점`);
  lines.push("", `이번 달 ${label} 점수 합계: ${monthlyTotal}점`, "", `정정일: ${correctedOn}`, "");
  if (isPraise) lines.push("가정에서도 함께 축하하고 격려해 주세요.");
  lines.push("자세한 내용은 포털에서 확인해 주세요.");
  return { title: `${label} 점수 안내 (정정)`, body: lines.join("\n") };
}

/** Appends (or replaces) the 정정 안내 section of a notice that covers several entries -- a grid
 * save's notice, where rewriting the whole body from one edited row would drop the others. The
 * section lists every entry the notice still covers, so it is the same text no matter which row
 * was edited or how many times. */
export function buildPointCorrectionFooter(params: { body: string; entries: Array<{ dateLabel: string; reason: string; points: number }>; kindLabel: string; monthlyTotal: number; correctedOn: string }) {
  const { body, entries, kindLabel, monthlyTotal, correctedOn } = params;
  const lines = [
    pointNoticeBaseBody(body),
    "",
    POINT_CORRECTION_MARKER,
    `${correctedOn} 기준으로 아래와 같이 정정되었습니다.`,
    ...entries.map((entry) => `- ${entry.dateLabel} ${entry.reason}: ${entry.points > 0 ? `+${entry.points}` : entry.points}점`),
    `이번 달 ${kindLabel} 점수 합계: ${monthlyTotal}점`,
  ];
  return lines.join("\n");
}
