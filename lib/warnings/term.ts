/** Semester split used across the point ledger: 1~7월 is 1학기, 8~12월 is 2학기 -- the same rule
 * the grant/stats screens apply to "today" (see app/api/warnings/grant/route.ts#currentTerm). */
export function semesterForMonth(month: number): 1 | 2 {
  return month <= 7 ? 1 : 2;
}

/** warning_entries stores academic_year/semester/month alongside warning_date, and 점수 통계
 * queries by those three columns -- so an edited date has to re-derive them or the entry would
 * silently stay filed under the old month. */
export function termForDate(dateOnly: string) {
  const [year, month] = dateOnly.split("-").map(Number);
  return { academicYear: year, semester: semesterForMonth(month), month };
}

/** Accepts a calendar date the <input type="date"> can produce, rejecting both malformed text
 * and impossible days (2026-02-31 parses into March otherwise). */
export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}
