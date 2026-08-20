/** Default semester length used until an admin sets a school-specific total via the
 * academic_terms table (see app/api/admin/academic-terms/route.ts), or uploads a calendar (see
 * countSchoolDays below, which supersedes this once a term has start/end dates on file). */
export const DEFAULT_TOTAL_INSTRUCTIONAL_DAYS = 90;

/** Counts weekdays in [startISO, endISO] (inclusive) that aren't in exceptionDates. Used to turn
 * an uploaded academic_calendar_exceptions set + a term's start/end dates into an actual
 * present-day count, instead of the flat total_instructional_days approximation. */
export function countSchoolDays(startISO: string, endISO: string, exceptionDates: ReadonlySet<string>): number {
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  let count = 0;
  for (const d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    if (exceptionDates.has(d.toISOString().slice(0, 10))) continue;
    count++;
  }
  return count;
}

/** Turns a term row + that year's calendar exceptions + a student's exception-day count into a
 * 출석 estimate. Prefers actual day-by-day counting (school days elapsed so far this semester,
 * capped at the term's end date) when the term has start/end dates on file; falls back to the
 * flat total_instructional_days approximation otherwise (e.g. a term nobody has uploaded a
 * calendar for yet). */
export function computePresentEstimate(params: {
  term: { start_date: string | null; end_date: string | null; total_instructional_days: number | null } | null;
  exceptionDates: ReadonlySet<string>;
  semesterExceptionTotal: number;
}): number {
  const { term, exceptionDates, semesterExceptionTotal } = params;
  if (term?.start_date && term?.end_date) {
    const todayISO = new Date().toISOString().slice(0, 10);
    const effectiveEnd = term.end_date < todayISO ? term.end_date : todayISO;
    const schoolDaysSoFar = effectiveEnd < term.start_date ? 0 : countSchoolDays(term.start_date, effectiveEnd, exceptionDates);
    return Math.max(0, schoolDaysSoFar - semesterExceptionTotal);
  }
  return Math.max(0, (term?.total_instructional_days ?? DEFAULT_TOTAL_INSTRUCTIONAL_DAYS) - semesterExceptionTotal);
}
