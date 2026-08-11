const SEMESTER_RANGES: Record<1 | 2, { startMonth: number; endMonth: number }> = {
  1: { startMonth: 1, endMonth: 7 },
  2: { startMonth: 8, endMonth: 12 },
};

/** No school-calendar/holiday data exists in this app, so "instructional days elapsed" is
 * approximated as Mon-Fri calendar days from the semester's start month through today (or the
 * semester's end, whichever is earlier). Used only to derive a "출석" (present) count alongside
 * the exception counts that are actually recorded. */
export function countElapsedWeekdays(year: number, semester: 1 | 2, today: Date = new Date()): number {
  const range = SEMESTER_RANGES[semester];
  const start = new Date(Date.UTC(year, range.startMonth - 1, 1));
  const semesterEnd = new Date(Date.UTC(year, range.endMonth, 0));
  const end = today < semesterEnd ? today : semesterEnd;
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
