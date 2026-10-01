import type { PointKind } from "./categories";

/** One daily 칭찬·훈계 entry as the teacher-trend report reads it. 희월 정산/조정 rows are left out by
 * the caller: they move points between ledgers rather than record a teacher giving points. */
export type TeacherTrendEntry = {
  author_id: string;
  student_id: string;
  warning_date: string;
  kind: PointKind | null;
  category: string | null;
  custom_category_label: string | null;
  delta: number;
};

export type KindTotals = { points: number; count: number; students: number };

export type WeeklyPoint = { week: string; discipline: number; praise: number };

export type CategoryCount = { name: string; points: number; count: number };

export type TeacherTrend = {
  id: string;
  name: string;
  discipline: KindTotals;
  praise: KindTotals;
  weekly: WeeklyPoint[];
  topDiscipline: CategoryCount[];
  topPraise: CategoryCount[];
};

export type TeacherTrendReport = {
  weeks: string[];
  overall: { discipline: KindTotals; praise: KindTotals; weekly: WeeklyPoint[] };
  teachers: TeacherTrend[];
};

const TOP_CATEGORY_LIMIT = 5;

/** Monday of the week the date falls in, as YYYY-MM-DD. Works on the date-only string in UTC so the
 * server's time zone can't shift an entry into the neighbouring week. */
export function weekStart(dateOnly: string): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function weekRange(first: string, last: string): string[] {
  const weeks: string[] = [];
  const cursor = new Date(`${weekStart(first)}T00:00:00Z`);
  const end = weekStart(last);
  while (cursor.toISOString().slice(0, 10) <= end) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

function categoryName(entry: TeacherTrendEntry) {
  return entry.custom_category_label || entry.category || "사유 없음";
}

type Bucket = {
  points: Record<PointKind, number>;
  count: Record<PointKind, number>;
  students: Record<PointKind, Set<string>>;
  weekly: Map<string, Record<PointKind, number>>;
  categories: Record<PointKind, Map<string, CategoryCount>>;
};

function emptyBucket(): Bucket {
  return {
    points: { discipline: 0, praise: 0 },
    count: { discipline: 0, praise: 0 },
    students: { discipline: new Set(), praise: new Set() },
    weekly: new Map(),
    categories: { discipline: new Map(), praise: new Map() },
  };
}

function addToBucket(bucket: Bucket, entry: TeacherTrendEntry) {
  const kind: PointKind = entry.kind === "praise" ? "praise" : "discipline";
  const delta = Number(entry.delta || 0);
  bucket.points[kind] += delta;
  // A grid 정정 can write a negative delta; it changes the total but is not a new grant.
  if (delta > 0) {
    bucket.count[kind] += 1;
    bucket.students[kind].add(entry.student_id);
  }
  const week = weekStart(entry.warning_date);
  const weekly = bucket.weekly.get(week) || { discipline: 0, praise: 0 };
  weekly[kind] += delta;
  bucket.weekly.set(week, weekly);
  const name = categoryName(entry);
  const category = bucket.categories[kind].get(name) || { name, points: 0, count: 0 };
  category.points += delta;
  if (delta > 0) category.count += 1;
  bucket.categories[kind].set(name, category);
}

function totals(bucket: Bucket, kind: PointKind): KindTotals {
  return { points: bucket.points[kind], count: bucket.count[kind], students: bucket.students[kind].size };
}

function weeklySeries(bucket: Bucket, weeks: string[]): WeeklyPoint[] {
  return weeks.map((week) => ({ week, discipline: bucket.weekly.get(week)?.discipline ?? 0, praise: bucket.weekly.get(week)?.praise ?? 0 }));
}

function topCategories(bucket: Bucket, kind: PointKind): CategoryCount[] {
  return Array.from(bucket.categories[kind].values())
    .filter((category) => category.points !== 0 || category.count > 0)
    .sort((a, b) => b.points - a.points || b.count - a.count || a.name.localeCompare(b.name, "ko"))
    .slice(0, TOP_CATEGORY_LIMIT);
}

/** Groups a semester's daily entries by the teacher who wrote them (author_id) and by week.
 * `staff` lists every teacher/admin so a teacher who gave no points still shows up with zeros;
 * `lastDate` caps the week axis (today, for the semester in progress). */
export function buildTeacherTrendReport(
  entries: TeacherTrendEntry[],
  staff: Array<{ id: string; name: string }>,
  lastDate: string,
): TeacherTrendReport {
  const overall = emptyBucket();
  const byTeacher = new Map<string, Bucket>();
  for (const member of staff) byTeacher.set(member.id, emptyBucket());

  let first: string | null = null;
  let last: string | null = null;
  for (const entry of entries) {
    if (!entry.warning_date) continue;
    addToBucket(overall, entry);
    if (!byTeacher.has(entry.author_id)) byTeacher.set(entry.author_id, emptyBucket());
    addToBucket(byTeacher.get(entry.author_id)!, entry);
    if (!first || entry.warning_date < first) first = entry.warning_date;
    if (!last || entry.warning_date > last) last = entry.warning_date;
  }

  const weeks = first && last ? weekRange(first, last > lastDate ? last : lastDate) : [];
  const names = new Map(staff.map((member) => [member.id, member.name]));
  const teachers = Array.from(byTeacher.entries())
    .map(([id, bucket]) => ({
      id,
      name: names.get(id) || "(알 수 없는 계정)",
      discipline: totals(bucket, "discipline"),
      praise: totals(bucket, "praise"),
      weekly: weeklySeries(bucket, weeks),
      topDiscipline: topCategories(bucket, "discipline"),
      topPraise: topCategories(bucket, "praise"),
    }))
    .sort((a, b) => (b.praise.count + b.discipline.count) - (a.praise.count + a.discipline.count) || a.name.localeCompare(b.name, "ko"));

  return {
    weeks,
    overall: { discipline: totals(overall, "discipline"), praise: totals(overall, "praise"), weekly: weeklySeries(overall, weeks) },
    teachers,
  };
}
