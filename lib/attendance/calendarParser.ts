import "server-only";

/** Parses the school's annual 학사일정 PDF (a fixed template: 12 month-cards laid out 2-per-row
 * from March through the following February, each with a mini calendar grid and a sidebar list of
 * "day(s) label" event lines) into calendar exceptions (school-closed dates) and semester date
 * ranges. Tuned to this specific template's text layout -- see the day-tracking comment below for
 * the one genuinely tricky part. Output is always meant to go through an admin review step before
 * being saved; this is a best-effort extraction, not a guaranteed-correct one. */

const MONTHS = ["March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February"] as const;
const MONTH_NUM: Record<(typeof MONTHS)[number], number> = { March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12, January: 1, February: 2 };

const STRICT_HOLIDAY_KEYWORDS = ["신정", "설날", "삼일절", "어린이날", "석가탄신일", "현충일", "광복절", "추석", "개천절", "한글날", "크리스마스", "근로자의날"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** A day is closed if explicitly tagged "(휴교)", or is a well-known statutory holiday, or falls
 * within a named 여름/겨울 방학 block. School events held ON a holiday (labelled "...행사") and
 * the opening/closing ceremony days themselves (개학식/방학식/오리엔테이션) are NOT closures --
 * students are present for those. */
function isClosureLabel(label: string): boolean {
  if (label.includes("휴교")) return true;
  if (label.includes("행사")) return false;
  if (/방학식|개학식|오리엔테이션/.test(label)) return false;
  if (STRICT_HOLIDAY_KEYWORDS.some((kw) => label.includes(kw))) return true;
  if (/여름\s*방학|겨울\s*방학/.test(label)) return true;
  return false;
}

type RawEvent = { monthIdx: number; day1: number; day2: number; label: string };

function parseEvents(text: string): { academicYear: number; events: RawEvent[] } {
  const yearMatch = text.match(/(\d{4})\s*학년도/);
  const academicYear = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const eventRe = /^(\d{1,2})(?:-(\d{1,2}))?\s+(.*\S)$/;

  let monthIdx = -1; // index into MONTHS; -1 = before the first header (March)
  let lastDay = 0;
  // The document's 2-column layout puts an even ("B-slot": April/June/Aug/Oct/Dec/Feb) month's
  // own trailing events AND the next odd ("A-slot") month's leading events in one combined text
  // span, in that order but with no separator. We detect the boundary by day-of-month decreasing,
  // then switch buckets ONCE and stay switched for the rest of the span -- a second decrease
  // inside the second month's own (occasionally out-of-order) list must not flip back.
  let switchedToNextMonth = false;
  const events: RawEvent[] = [];

  for (const line of lines) {
    if ((MONTHS as readonly string[]).includes(line)) {
      monthIdx = MONTHS.indexOf(line as (typeof MONTHS)[number]);
      lastDay = 0;
      switchedToNextMonth = false;
      continue;
    }
    const m = line.match(eventRe);
    if (!m) continue;
    const label = m[3];
    if (/^[\d\s]+$/.test(label)) continue; // guards against a mis-split calendar-grid row
    const day1 = Number(m[1]);
    const day2 = m[2] ? Number(m[2]) : day1;

    let targetIdx: number;
    if (monthIdx === -1) {
      targetIdx = 0; // before any header seen -> belongs to March
    } else if (monthIdx % 2 === 1) {
      if (!switchedToNextMonth && day1 < lastDay) switchedToNextMonth = true;
      targetIdx = switchedToNextMonth ? monthIdx + 1 : monthIdx;
      lastDay = day1;
    } else {
      targetIdx = monthIdx; // odd ("A-slot") header just seen -> its own events, unambiguous
    }
    if (targetIdx > 11) continue;
    events.push({ monthIdx: targetIdx, day1, day2, label });
  }
  return { academicYear, events };
}

function eventDates(academicYear: number, monthIdx: number, day1: number, day2: number): string[] {
  const monthNum = MONTH_NUM[MONTHS[monthIdx]];
  const calYear = monthNum <= 2 ? academicYear + 1 : academicYear; // Jan/Feb roll into the next calendar year
  const dates: string[] = [];
  for (let d = day1; d <= day2; d++) dates.push(`${calYear}-${pad(monthNum)}-${pad(d)}`);
  return dates;
}

export type CalendarException = { date: string; label: string };
export type CalendarTerm = { semester: 1 | 2; startDate: string; endDate: string };
export type ParsedCalendar = { academicYear: number; exceptions: CalendarException[]; terms: CalendarTerm[] };

export function parseAcademicCalendarText(text: string): ParsedCalendar {
  const { academicYear, events } = parseEvents(text);

  const exceptionMap = new Map<string, string>();
  for (const e of events) {
    if (!isClosureLabel(e.label)) continue;
    for (const date of eventDates(academicYear, e.monthIdx, e.day1, e.day2)) {
      if (!exceptionMap.has(date)) exceptionMap.set(date, e.label);
    }
  }
  const exceptions = Array.from(exceptionMap.entries()).map(([date, label]) => ({ date, label })).sort((a, b) => a.date.localeCompare(b.date));

  // Semester boundaries: 개학식 (opening ceremony) marks a start, 방학식 (closing ceremony) marks
  // an end. This template shows one 개학식 (semester 2's, since semester 1 continues from before
  // the visible calendar) and two 방학식 occurrences (semester 1's mid-year one, semester 2's
  // year-end one) -- default semester 1 to start March 1 when no earlier 개학식 is found.
  // events[] is in document order, so the *first* 개학식/방학식 hit is this school year's own
  // semester-2 start / semester-1 end; a second 개학식 near the very end of the document (as in
  // this template's February "개학식 및 오리엔테이션") is next year's orientation, not this
  // year's data, so we deliberately only look at the first occurrence of each.
  const openings = events.filter((e) => e.label.includes("개학식"));
  const closings = events.filter((e) => e.label.includes("방학식"));
  const [firstOpening] = openings;
  const [firstClosing, secondClosing] = closings;

  const semester1Start = `${academicYear}-03-01`;
  const semester2Start = firstOpening ? eventDates(academicYear, firstOpening.monthIdx, firstOpening.day1, firstOpening.day1)[0] : `${academicYear}-08-01`;
  const semester1End = firstClosing ? eventDates(academicYear, firstClosing.monthIdx, firstClosing.day1, firstClosing.day1)[0] : `${academicYear}-07-31`;
  const semester2End = secondClosing ? eventDates(academicYear, secondClosing.monthIdx, secondClosing.day1, secondClosing.day1)[0] : `${academicYear + 1}-02-28`;

  const terms: CalendarTerm[] = [
    { semester: 1, startDate: semester1Start, endDate: semester1End },
    { semester: 2, startDate: semester2Start, endDate: semester2End },
  ];

  return { academicYear, exceptions, terms };
}
