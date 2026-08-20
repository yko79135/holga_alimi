export type PointKind = "discipline" | "praise";

export const DISCIPLINE_CATEGORIES = [
  "숙제·과제 미이행",
  "준비물·교재 미지참",
  "시험 성적 미달·미응시",
  "지각·시간 미준수",
  "말씀묵상·QT·경건생활 미이행",
  "교사 지시 불응",
  "수업·예배 태도 불량·장난",
  "거짓말",
  "부정행위",
  "친구·교사간 폭행",
  "미디어 규정",
] as const;

/** Reference point values shown next to each discipline category in the grant form (e.g.
 * "거짓말 (10/5점)"). Purely informational -- the points field stays freely editable, it doesn't
 * constrain the input to these values. Categories with no entry here show no hint. */
export const DISCIPLINE_CATEGORY_POINT_HINTS: Partial<Record<(typeof DISCIPLINE_CATEGORIES)[number], string>> = {
  "숙제·과제 미이행": "1점",
  "준비물·교재 미지참": "1점",
  "시험 성적 미달·미응시": "1점",
  "지각·시간 미준수": "1점",
  "말씀묵상·QT·경건생활 미이행": "1점",
  "교사 지시 불응": "1점",
  "수업·예배 태도 불량·장난": "1점",
  "거짓말": "10/5점",
  "부정행위": "20/10점",
  "친구·교사간 폭행": "10~30점",
  "미디어 규정": "5점",
};

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
/** Discipline points stay capped -- raised from 20 to fit the 친구·교사간 폭행 category's 10~30
 * range. Praise points are uncapped (see isValidPointValue), so this constant only applies to
 * discipline; kept exported for the grant form's number input max attribute. */
export const MAX_DISCIPLINE_POINT_VALUE = 30;
export const CUSTOM_CATEGORY = "직접 입력";

export function isValidPointValue(kind: PointKind, value: number): boolean {
  if (!Number.isInteger(value) || value < 1) return false;
  return kind === "discipline" ? value <= MAX_DISCIPLINE_POINT_VALUE : true;
}

/** Includes the CUSTOM_CATEGORY sentinel so it shows up as a selectable dropdown option. */
export function categoriesForKind(kind: PointKind): readonly string[] {
  return [...(kind === "discipline" ? DISCIPLINE_CATEGORIES : PRAISE_CATEGORIES), CUSTOM_CATEGORY];
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
