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
  const onlyCorrection = negatives.length > 0 && positives.length === 0;
  const dates = changes.map((c) => c.entryType === "grace_adjustment" ? "은혜의 희월" : c.date).filter(Boolean).join(", ");
  const title = onlyCorrection ? "벌점이 정정되었습니다" : "벌점 안내";
  const reasons = Array.from(new Set(changes.map((c) => c.parentVisibleReason?.trim()).filter(Boolean))).join("\n");
  const lines = [
    `안녕하세요, ${studentName} 학생과 관련하여 안내드립니다.`,
    "",
    `${onlyCorrection ? "정정된 날짜" : "해당 날짜"}: ${dates}`,
    `이번 달 벌점 합계: ${monthlyTotal}점`,
  ];
  if (reasons) lines.push("", onlyCorrection ? "정정 사유" : "사유", reasons);
  lines.push("", "가정에서도 따뜻한 관심과 격려 부탁드립니다.", "자세한 내용은 포털에서 확인해 주세요.");
  return { title, body: lines.join("\n") };
}
