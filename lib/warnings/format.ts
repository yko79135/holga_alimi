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
  lines.push("", isPraise ? "가정에서도 함께 축하하고 격려해 주세요." : "가정에서도 따뜻한 관심과 격려 부탁드립니다.", "자세한 내용은 포털에서 확인해 주세요.");
  return { title, body: lines.join("\n") };
}

export function buildPointNotice(params: { kind: PointKind; studentName: string; category: string; className: string | null; detail: string; monthlyTotal: number }) {
  const { kind, studentName, category, className, detail, monthlyTotal } = params;
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
  if (detail) lines.push("", "세부 내용", detail);
  lines.push("", `이번 달 ${isPraise ? "칭찬" : "훈계"} 점수 합계: ${monthlyTotal}점`, "");
  lines.push(isPraise ? "가정에서도 함께 축하하고 격려해 주세요." : "가정에서도 따뜻한 관심과 격려 부탁드립니다.");
  lines.push("자세한 내용은 포털에서 확인해 주세요.");
  return { title, body: lines.join("\n") };
}
