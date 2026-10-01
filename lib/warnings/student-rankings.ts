import type { PointKind } from "./categories";

/** One daily 칭찬·훈계 entry as the student ranking reads it. 희월 정산/조정 rows are left out by
 * the caller, the same as the teacher-trend report (lib/warnings/teacher-trends.ts). */
export type StudentRankingEntry = {
  student_id: string;
  kind: PointKind | null;
  category: string | null;
  custom_category_label: string | null;
  delta: number;
};

export type CategoryShare = { name: string; points: number; count: number };

export type RankedStudent = {
  id: string;
  name: string;
  grade: string;
  rank: number;
  points: number;
  count: number;
  categories: CategoryShare[];
};

export type StudentRankingReport = {
  kind: PointKind;
  students: RankedStudent[];
  /** 이번 학기 해당 점수가 하나도 없는 학생 수 (순위에서 빠진다). */
  withoutPoints: number;
  categories: CategoryShare[];
};

function categoryName(entry: StudentRankingEntry) {
  return entry.custom_category_label || entry.category || "사유 없음";
}

function sortCategories(map: Map<string, CategoryShare>) {
  return Array.from(map.values())
    .filter((category) => category.points > 0)
    .sort((a, b) => b.points - a.points || b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

function addCategory(map: Map<string, CategoryShare>, entry: StudentRankingEntry) {
  const name = categoryName(entry);
  const category = map.get(name) || { name, points: 0, count: 0 };
  category.points += Number(entry.delta || 0);
  // A grid 정정 can write a negative delta; it changes the total but is not a new grant.
  if (Number(entry.delta || 0) > 0) category.count += 1;
  map.set(name, category);
}

/** Ranks students by their net points of one kind for the semester, highest first. Ties share a
 * rank (1, 2, 2, 4). Students with no positive total are counted but not ranked. */
export function buildStudentRanking(
  entries: StudentRankingEntry[],
  students: Array<{ id: string; name: string; grade: string }>,
  kind: PointKind,
): StudentRankingReport {
  const byStudent = new Map<string, Map<string, CategoryShare>>();
  const overall = new Map<string, CategoryShare>();
  const known = new Set(students.map((student) => student.id));
  for (const entry of entries) {
    if ((entry.kind === "praise" ? "praise" : "discipline") !== kind) continue;
    if (!known.has(entry.student_id)) continue;
    if (!byStudent.has(entry.student_id)) byStudent.set(entry.student_id, new Map());
    addCategory(byStudent.get(entry.student_id)!, entry);
    addCategory(overall, entry);
  }

  const totals = students.map((student) => {
    const categories = byStudent.get(student.id) || new Map<string, CategoryShare>();
    let points = 0;
    let count = 0;
    for (const category of categories.values()) {
      points += category.points;
      count += category.count;
    }
    return { ...student, points, count, categories: sortCategories(categories) };
  });

  const ranked = totals
    .filter((student) => student.points > 0)
    .sort((a, b) => b.points - a.points || b.count - a.count || a.name.localeCompare(b.name, "ko"));

  let previousPoints: number | null = null;
  let previousRank = 0;
  const rankedStudents: RankedStudent[] = ranked.map((student, index) => {
    const rank = student.points === previousPoints ? previousRank : index + 1;
    previousPoints = student.points;
    previousRank = rank;
    return { ...student, rank };
  });

  return { kind, students: rankedStudents, withoutPoints: totals.length - ranked.length, categories: sortCategories(overall) };
}
