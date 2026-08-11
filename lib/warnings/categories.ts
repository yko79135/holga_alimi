export type PointKind = "discipline" | "praise";

export const DISCIPLINE_CATEGORIES = [
  "숙제·과제 미이행",
  "준비물·교재 미지참",
  "시험 성적 미달·미응시",
  "지각·시간 미준수",
  "말씀묵상·QT·경건생활 미이행",
  "교사 지시 불응",
  "수업·예배 태도 불량·장난",
  "거짓말·부정행위",
  "친구·타인에게 부적절한 행동",
  "학교 규정·물품 관련 위반",
] as const;

export const PRAISE_CATEGORIES = [
  "성적 우수",
  "과제·활동 성실 수행",
  "발표 우수",
  "질문에 훌륭히 답변",
  "친구를 도와줌",
  "수업 태도 우수",
  "말씀묵상 성실",
  "교사 지도에 잘 따름",
] as const;

export const POINT_KIND_LABELS: Record<PointKind, string> = { discipline: "훈계 점수", praise: "칭찬 점수" };
export const DEFAULT_POINT_VALUE = 1;
export const MAX_POINT_VALUE = 20;

export function isValidPointValue(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_POINT_VALUE;
}

export function categoriesForKind(kind: PointKind): readonly string[] {
  return kind === "discipline" ? DISCIPLINE_CATEGORIES : PRAISE_CATEGORIES;
}

export function isValidCategory(kind: PointKind, category: string): boolean {
  return (categoriesForKind(kind) as readonly string[]).includes(category);
}

export function kindForCategory(category: string | null): PointKind | null {
  if (!category) return null;
  if ((PRAISE_CATEGORIES as readonly string[]).includes(category)) return "praise";
  if ((DISCIPLINE_CATEGORIES as readonly string[]).includes(category)) return "discipline";
  return null;
}
