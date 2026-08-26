export type PointKind = "discipline" | "praise";

/** One row of public.point_categories (supabase/20260826_point_categories.sql). Admins manage the
 * list at runtime, so nothing in the app may assume a fixed set of names. */
export type PointCategory = {
  id: string;
  kind: PointKind;
  name: string;
  pointHint: string | null;
  sortOrder: number;
  active: boolean;
};

/** Seed list kept in sync with the migration's initial rows. Only used as a fallback for the grant
 * form when the category API can't be reached -- the DB table is the source of truth. */
export const DEFAULT_DISCIPLINE_CATEGORIES = [
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

/** Reference point values shown next to a category in the grant form (e.g. "거짓말 (10/5점)").
 * Purely informational -- the points field stays freely editable, it doesn't constrain the input to
 * these values. Categories with no hint show none. */
export const DEFAULT_DISCIPLINE_CATEGORY_POINT_HINTS: Record<string, string> = {
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

export const DEFAULT_PRAISE_CATEGORIES = [
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
export const POINT_KIND_SHORT_LABELS: Record<PointKind, string> = { discipline: "훈계", praise: "칭찬" };
export const DEFAULT_POINT_VALUE = 1;
/** Discipline points stay capped -- raised from 20 to fit the 친구·교사간 폭행 category's 10~30
 * range. Praise points are uncapped (see isValidPointValue), so this constant only applies to
 * discipline; kept exported for the grant form's number input max attribute. */
export const MAX_DISCIPLINE_POINT_VALUE = 30;
export const CUSTOM_CATEGORY = "직접 입력";
export const MAX_CATEGORY_NAME_LENGTH = 40;
export const MAX_CATEGORY_HINT_LENGTH = 20;

export function isPointKind(value: unknown): value is PointKind {
  return value === "discipline" || value === "praise";
}

export function isValidPointValue(kind: PointKind, value: number): boolean {
  if (!Number.isInteger(value) || value < 1) return false;
  return kind === "discipline" ? value <= MAX_DISCIPLINE_POINT_VALUE : true;
}

/** Fallback list for the grant form, used only when the category API call fails. Includes the
 * CUSTOM_CATEGORY sentinel so it shows up as a selectable dropdown option. */
export function fallbackCategoriesForKind(kind: PointKind): PointCategory[] {
  const names = kind === "discipline" ? DEFAULT_DISCIPLINE_CATEGORIES : DEFAULT_PRAISE_CATEGORIES;
  return names.map((name, index) => ({
    id: `fallback-${kind}-${index}`,
    kind,
    name,
    pointHint: kind === "discipline" ? DEFAULT_DISCIPLINE_CATEGORY_POINT_HINTS[name] ?? null : null,
    sortOrder: (index + 1) * 10,
    active: true,
  }));
}

/** The label shown in the grant form dropdown: "거짓말 (10/5점)" when a hint exists, else the name. */
export function categoryOptionLabel(category: Pick<PointCategory, "name" | "pointHint">): string {
  return category.pointHint ? `${category.name} (${category.pointHint})` : category.name;
}

/** Normalizes an admin-entered category name. Returns null when it can't be used. */
export function normalizeCategoryName(value: unknown): string | null {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > MAX_CATEGORY_NAME_LENGTH) return null;
  // The sentinel drives the free-text branch of the grant form, so it can't also be a real row.
  if (name === CUSTOM_CATEGORY) return null;
  return name;
}

/** Normalizes an admin-entered point hint. Empty input clears the hint. */
export function normalizeCategoryHint(value: unknown): string | null {
  const hint = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!hint) return null;
  return hint.slice(0, MAX_CATEGORY_HINT_LENGTH);
}
