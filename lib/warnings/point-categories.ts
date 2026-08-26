import "server-only";

import type { PointCategory } from "./categories";

export const CATEGORY_COLUMNS = "id,kind,name,point_hint,sort_order,active";

export type PointCategoryRow = { id: string; kind: string; name: string; point_hint: string | null; sort_order: number; active: boolean };

export function toPointCategory(row: PointCategoryRow): PointCategory {
  return {
    id: row.id,
    kind: row.kind === "praise" ? "praise" : "discipline",
    name: row.name,
    pointHint: row.point_hint,
    sortOrder: row.sort_order,
    active: row.active,
  };
}
