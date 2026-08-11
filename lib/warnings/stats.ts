export type MonthlyWarningBreakdown = { month: number; total: number };

export type WarningStudentSummary = { semesterTotal: number; monthly: MonthlyWarningBreakdown[] };

type RawWarningEntry = { student_id: string; month: number; delta: number };

/** Sums each student's warning deltas by calendar month, for a semester's worth of
 * entries already scoped by the caller's academic_year/semester query. */
export function summarizeWarningsForStudents(entries: RawWarningEntry[], studentIds: string[]): Record<string, WarningStudentSummary> {
  const monthlyByStudent = new Map<string, Map<number, number>>();
  for (const id of studentIds) monthlyByStudent.set(id, new Map());

  for (const entry of entries) {
    const monthly = monthlyByStudent.get(entry.student_id);
    if (!monthly) continue;
    monthly.set(entry.month, (monthly.get(entry.month) || 0) + entry.delta);
  }

  const result: Record<string, WarningStudentSummary> = {};
  for (const id of studentIds) {
    const monthly = Array.from(monthlyByStudent.get(id)!.entries())
      .sort(([a], [b]) => a - b)
      .map(([month, total]) => ({ month, total }));
    result[id] = { semesterTotal: monthly.reduce((sum, entry) => sum + entry.total, 0), monthly };
  }
  return result;
}
