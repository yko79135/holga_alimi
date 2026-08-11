import type { WarningCellChange } from "./types";
import type { PointKind } from "./categories";

export type WarningEntryType = WarningCellChange["entryType"];

export function warningDelta(previousValue: number, newValue: number) {
  return Number(newValue) - Number(previousValue);
}

export function buildWarningReasonTemplate(params: { studentName: string; previousValue: number; newValue: number; entryType: WarningEntryType; kind?: PointKind }) {
  const delta = warningDelta(params.previousValue, params.newValue);
  const label = params.kind === "praise" ? "칭찬 점수" : "훈계 점수";
  if (params.entryType === "grace_adjustment") return `${params.studentName} ${params.kind === "praise" ? "칭찬 조정" : "은혜의 희월 조정"} - `;
  if (delta < 0) return `${params.studentName} ${label} ${Math.abs(delta)}점 정정 - `;
  return `${params.studentName} ${label} ${delta}점 부여 - `;
}

export function hasMeaningfulReasonAfterTemplate(value: string, template: string) {
  const trimmedValue = value.trim();
  const trimmedTemplate = template.trim();
  if (!trimmedValue || !trimmedTemplate) return false;
  if (trimmedValue.startsWith(trimmedTemplate)) return trimmedValue.slice(trimmedTemplate.length).trim().length > 0;
  const finalHyphen = trimmedValue.lastIndexOf("-");
  return finalHyphen >= 0 ? trimmedValue.slice(finalHyphen + 1).trim().length > 0 : trimmedValue.length > 0;
}

export function warningReasonErrorMessage(entryType: WarningEntryType, delta: number, kind?: PointKind) {
  if (entryType === "grace_adjustment" || delta < 0) return "정정 사유를 입력해 주세요.";
  return kind === "praise" ? "칭찬 점수 사유를 입력해 주세요." : "훈계 점수 사유를 입력해 주세요.";
}
