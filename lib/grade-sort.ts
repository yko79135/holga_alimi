/** Natural sort for grade labels like "G1".."G12" so G10-G12 don't land
 * between G1 and G2 the way a plain string sort (or localeCompare) would. */
export function compareGrades(a: string, b: string): number {
  const match = /^(\D*)(\d+)?(.*)$/;
  const [, prefixA = "", numA, restA = ""] = a.match(match) || [];
  const [, prefixB = "", numB, restB = ""] = b.match(match) || [];

  const prefixCompare = prefixA.localeCompare(prefixB);
  if (prefixCompare !== 0) return prefixCompare;

  if (numA !== undefined && numB !== undefined) {
    const diff = Number(numA) - Number(numB);
    if (diff !== 0) return diff;
  } else if (numA !== numB) {
    return numA === undefined ? -1 : 1;
  }

  return restA.localeCompare(restB);
}

export function sortGrades<T extends string>(grades: readonly T[]): T[] {
  return [...grades].sort(compareGrades);
}

/** Students listed as if their name were another's, so they sit right after that student instead
 * of in plain 가나다 order. G7's 김수하 and 임수아 are easy to mix up, and teachers asked for them to
 * be listed together rather than with 오시온 between them (2026-09-28). */
const NAME_SORT_OVERRIDES: Record<string, string> = {
  "임수아": "김수하",
};

/** Compares student names in display order: 가나다, except for NAME_SORT_OVERRIDES. */
export function compareStudentNames(a: string, b: string): number {
  return (NAME_SORT_OVERRIDES[a] ?? a).localeCompare(NAME_SORT_OVERRIDES[b] ?? b) || a.localeCompare(b);
}

/** Order student rows the way the teacher screens display them: by grade
 * (natural, so G12 follows G9 rather than G1) and then by name. Postgres
 * `order("grade")` sorts the label as text, so rows must be re-sorted here. */
export function sortStudentsByGrade<T extends { grade: string; name: string }>(students: readonly T[]): T[] {
  return [...students].sort((a, b) => compareGrades(a.grade, b.grade) || compareStudentNames(a.name, b.name));
}
