import type { WarningCellChange } from "./types";

export function changeType(delta: number, entryType: "daily" | "grace_adjustment") {
  if (entryType === "grace_adjustment") return "grace_adjustment";
  if (delta > 0) return "addition";
  if (delta < 0 && Math.abs(delta) >= 1) return "correction";
  return "correction";
}

export function buildWarningNotice(studentName: string, changes: WarningCellChange[], monthlyTotal: number) {
  const positives = changes.filter((c) => c.newValue - c.previousValue > 0);
  const negatives = changes.filter((c) => c.newValue - c.previousValue < 0);
  const dates = changes.map((c) => c.entryType === "grace_adjustment" ? "은혜의 희월" : c.date).filter(Boolean).join(", ");
  const title = positives.length && negatives.length ? "경고 내역이 업데이트되었습니다" : negatives.length ? "경고 내역이 정정되었습니다" : "경고 내역이 등록되었습니다";
  const reasons = Array.from(new Set(changes.map((c) => c.parentVisibleReason?.trim()).filter(Boolean))).join("\n");
  const lines = [`${studentName} 학생의 경고 내역이 ${negatives.length && !positives.length ? "정정" : "업데이트"}되었습니다.`, "", `${negatives.length && !positives.length ? "정정된 날짜" : "등록일"}: ${dates}`, `이번 달 경고 합계: ${monthlyTotal}`];
  if (reasons) lines.push("", negatives.length && !positives.length ? "정정 사유:" : "사유:", reasons);
  lines.push("", "자세한 내용은 포털에서 확인해 주세요.");
  return { title, body: lines.join("\n") };
}
