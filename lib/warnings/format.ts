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
    "가정에서도 함께 축하하고 격려해 주세요.",
    "자세한 내용은 포털에서 확인해 주세요.",
  ];
  return { title, body: lines.join("\n") };
}
