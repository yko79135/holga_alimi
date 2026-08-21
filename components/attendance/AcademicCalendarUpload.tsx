"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CalendarException = { date: string; label: string; isClosure: boolean };
type Feedback = { type: "success" | "error"; text: string };
type TermDates = { startDate: string; endDate: string };
/** originalStart/originalEnd/originalLabel/originalIsClosure identify the pre-edit run being
 * replaced (all null for a brand-new entry) -- saving clears that exact run first (matched by date
 * range AND label/isClosure, since a date can now carry more than one concurrent event) so shrinking
 * or moving a multi-day range doesn't leave stale days behind and doesn't touch any OTHER event that
 * happens to share some of the same dates, then (re)writes startDate..endDate. */
type DayEditorState = {
  originalStart: string | null;
  originalEnd: string | null;
  originalLabel: string | null;
  originalIsClosure: boolean | null;
  startDate: string;
  endDate: string;
  label: string;
  isClosure: boolean;
};

const now = new Date();
const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
// Only 가을학기 (semester 2) is exposed in this UI -- see the header copy below. Kept as the
// DB's semester number (not renamed) so it still round-trips through the shared academic_terms
// API, which other parts of the app (attendance stats) still key by semester 1/2.
const AUTUMN_SEMESTER = 2 as const;
const MAX_RANGE_DAYS = 366;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function addDaysISO(dateISO: string, delta: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function daysBetween(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/** The 1st of dateISO's month -- the term's actual start date can fall mid-month (e.g. semester 2
 * officially starting 8/26), but the calendar still renders that whole month starting from the
 * 1st, so "visible" for label purposes has to mean the rendered month, not the exact term date. */
function startOfMonth(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

function defaultAutumnTerm(academicYear: number): TermDates {
  return { startDate: `${academicYear}-08-01`, endDate: `${academicYear + 1}-02-28` };
}

/** Every (year, month) from startISO's month through endISO's month, inclusive. */
function monthsInRange(startISO: string, endISO: string): { year: number; month: number }[] {
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const months: { year: number; month: number }[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  let guard = 0;
  while (cursor <= stop && guard++ < 24) {
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** A date can now carry more than one concurrent event/closure (e.g. 중간고사 26-30 overlapping
 * 종교개혁 기념일 on the 30th), so exceptionInfo maps each date to a *list*. runId identifies which
 * contiguous run (same label+isClosure, adjacent dates) a given day belongs to, independent of any
 * OTHER run that happens to share some of the same dates. */
type DayInfo = { label: string; isClosure: boolean; showLabel: boolean; runId: string };
type BarSegment = { weekIndex: number; startCol: number; endCol: number; label: string; isClosure: boolean; showLabel: boolean; lane: number };

/** Turns a month's day cells into one bar per (week row, run) instead of one mark per date, so a
 * multi-day range renders as a single rectangle spanning its columns -- a CSS grid item spanning
 * multiple column tracks automatically bridges the gap between them, which is what makes the bar
 * look continuous. Bars never span across week rows (or months) -- each row's segment is fully
 * rounded, matching how Google Calendar closes off every week's portion of a multi-week event
 * instead of leaving it visually cut open, but only the segment containing the run's first visible
 * day (per exceptionInfo's showLabel) carries the text, not every row.
 *
 * Multiple runs can be "open" at once now (concurrent events on overlapping dates), tracked by
 * runId rather than by label/isClosure equality alone -- two unrelated events could otherwise
 * coincidentally share a label. Once a row's segments are known, they're packed into the fewest
 * "lanes" (stacked sub-rows) needed so no two overlapping segments share a lane, the same greedy
 * interval-scheduling approach calendar UIs generally use for concurrent-event layout. */
function computeBarSegments(cells: (number | null)[], year: number, month: number, exceptionInfo: Map<string, DayInfo[]>): BarSegment[] {
  type OpenRun = { weekIndex: number; startCol: number; lastCol: number; label: string; isClosure: boolean; showLabel: boolean; runId: string };
  const rawSegments: Omit<BarSegment, "lane">[] = [];
  let opens: OpenRun[] = [];

  const closeAll = () => {
    for (const run of opens) rawSegments.push({ weekIndex: run.weekIndex, startCol: run.startCol, endCol: run.lastCol, label: run.label, isClosure: run.isClosure, showLabel: run.showLabel });
    opens = [];
  };

  for (let i = 0; i < cells.length; i++) {
    const weekIndex = Math.floor(i / 7);
    const col = i % 7;
    if (col === 0) closeAll(); // bars never span across week rows

    const day = cells[i];
    const infos = day === null ? [] : exceptionInfo.get(`${year}-${pad(month)}-${pad(day)}`) || [];
    const remaining = [...infos];
    const stillOpen: OpenRun[] = [];
    for (const run of opens) {
      const idx = remaining.findIndex((info) => info.runId === run.runId);
      if (idx !== -1) {
        run.lastCol = col;
        run.showLabel = run.showLabel || remaining[idx].showLabel;
        stillOpen.push(run);
        remaining.splice(idx, 1);
      } else {
        rawSegments.push({ weekIndex: run.weekIndex, startCol: run.startCol, endCol: run.lastCol, label: run.label, isClosure: run.isClosure, showLabel: run.showLabel });
      }
    }
    opens = stillOpen;
    for (const info of remaining) opens.push({ weekIndex, startCol: col, lastCol: col, label: info.label, isClosure: info.isClosure, showLabel: info.showLabel, runId: info.runId });
  }
  closeAll();

  const byWeek = new Map<number, Omit<BarSegment, "lane">[]>();
  for (const seg of rawSegments) {
    const list = byWeek.get(seg.weekIndex);
    if (list) list.push(seg);
    else byWeek.set(seg.weekIndex, [seg]);
  }
  const result: BarSegment[] = [];
  for (const segs of byWeek.values()) {
    const sorted = [...segs].sort((a, b) => a.startCol - b.startCol);
    const laneEndCols: number[] = [];
    for (const seg of sorted) {
      let lane = laneEndCols.findIndex((end) => end < seg.startCol);
      if (lane === -1) { lane = laneEndCols.length; laneEndCols.push(seg.endCol); }
      else laneEndCols[lane] = seg.endCol;
      result.push({ ...seg, lane });
    }
  }
  return result;
}

function MonthGrid({ year, month, exceptionInfo, canEdit, onDayClick }: {
  year: number;
  month: number;
  exceptionInfo: Map<string, DayInfo[]>;
  canEdit: boolean;
  onDayClick: (date: string) => void;
}) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeksCount = cells.length / 7;
  const barSegments = useMemo(() => computeBarSegments(cells, year, month, exceptionInfo), [cells, year, month, exceptionInfo]);
  // Reserved uniformly across every week in the month (simpler than recomputing per row) -- a week
  // with fewer concurrent events just gets a little unused space below its bars.
  const lanesForMonth = useMemo(() => Math.max(1, ...barSegments.map((s) => s.lane + 1)), [barSegments]);
  // Explicit per-track sizes instead of letting spanning day cells share implicit "auto" rows --
  // when several grid items all span the same set of auto rows with nothing sized to an individual
  // row alone, browsers can concentrate all the height into just one of those rows instead of
  // distributing it, collapsing the others to ~0 and hiding/overlapping whatever sits in them.
  const gridTemplateRows = useMemo(
    () => ["auto", ...Array.from({ length: weeksCount }, () => ["34px", ...Array.from({ length: lanesForMonth }, () => "19px")]).flat()].join(" "),
    [weeksCount, lanesForMonth],
  );

  return (
    <div className="calendar-month">
      <h4>{year}년 {month}월</h4>
      <div className="calendar-grid" style={{ gridTemplateRows }}>
        {DOW_LABELS.map((d, i) => <div key={d} className={`calendar-dow ${i === 0 || i === 6 ? "weekend" : ""}`} style={{ gridColumn: i + 1, gridRow: 1 }}>{d}</div>)}
        {cells.map((day, i) => {
          // Every cell gets an explicit grid position, matching the bars below -- CSS Grid places
          // all explicitly-positioned items first and only then auto-places the rest into whatever
          // cells are left, so leaving these to auto-placement would scatter them away from their
          // correct day whenever a bar claims most of a row (e.g. a week fully inside a closure).
          const weekIndex = Math.floor(i / 7);
          const rowStart = 2 + weekIndex * (1 + lanesForMonth);
          const col = (i % 7) + 1;
          if (day === null) return <div key={`empty-${i}`} className="calendar-day empty" style={{ gridColumn: col, gridRow: `${rowStart} / ${rowStart + 1 + lanesForMonth}` }} />;
          const dateISO = `${year}-${pad(month)}-${pad(day)}`;
          const isWeekend = i % 7 === 0 || i % 7 === 6;
          const entries = exceptionInfo.get(dateISO) || [];
          const hasClosure = entries.some((e) => e.isClosure);
          const hasEvent = entries.some((e) => !e.isClosure);
          const stateClass = hasClosure ? "exception" : hasEvent ? "event" : "";
          // Clickable for admins on any day (to add/edit), and for everyone else once the day
          // actually has something on it -- tapping shows the full, untruncated event list, which
          // matters most on mobile where a long event name gets cut off inside the bar.
          const clickable = canEdit || entries.length > 0;
          return (
            <div
              key={dateISO}
              className={`calendar-day ${isWeekend ? "weekend" : ""} ${stateClass}`}
              style={{ gridColumn: col, gridRow: `${rowStart} / ${rowStart + 1 + lanesForMonth}` }}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={() => clickable && onDayClick(dateISO)}
              onKeyDown={(e) => { if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onDayClick(dateISO); } }}
            >
              <span className="calendar-day-num">{day}</span>
            </div>
          );
        })}
        {barSegments.map((seg) => (
          <div
            key={`${seg.weekIndex}-${seg.startCol}-${seg.lane}`}
            className={`calendar-event-bar ${seg.isClosure ? "exception" : "event"}`}
            style={{ gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`, gridRow: 2 + seg.weekIndex * (1 + lanesForMonth) + 1 + seg.lane }}
          >
            {seg.showLabel && seg.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AcademicCalendarUpload({ canEdit }: { canEdit: boolean }) {
  const [academicYear, setAcademicYear] = useState(now.getFullYear());
  const [exceptions, setExceptions] = useState<CalendarException[]>([]);
  const [term, setTerm] = useState<TermDates>(defaultAutumnTerm(now.getFullYear()));
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [dayPopup, setDayPopup] = useState<string | null>(null);
  const [dayEditor, setDayEditor] = useState<DayEditorState | null>(null);

  const loadSaved = useCallback(async (year: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/academic-calendar?year=${year}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학사일정을 불러오지 못했습니다.");
      setExceptions(result.exceptions || []);
      const fallback = defaultAutumnTerm(year);
      const saved = (result.terms || []).find((t: any) => t.semester === AUTUMN_SEMESTER);
      setTerm({ startDate: saved?.startDate || fallback.startDate, endDate: saved?.endDate || fallback.endDate });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "학사일정을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, []);

  // uploadPdf sets academicYear itself when the PDF is for a different year than currently
  // selected; skip the resulting auto-reload once so it doesn't immediately overwrite the
  // freshly parsed (not yet saved) preview with whatever's already on file for that year.
  const skipNextLoad = useRef(false);
  useEffect(() => {
    if (skipNextLoad.current) { skipNextLoad.current = false; return; }
    void loadSaved(academicYear);
  }, [academicYear, loadSaved]);

  async function uploadPdf(file: File) {
    setParsing(true);
    setFeedback(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/admin/academic-calendar/parse", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "PDF를 분석하지 못했습니다.");
      if (result.academicYear !== academicYear) skipNextLoad.current = true;
      setAcademicYear(result.academicYear);
      setExceptions(result.exceptions || []);
      const fallback = defaultAutumnTerm(result.academicYear);
      const saved = (result.terms || []).find((t: any) => t.semester === AUTUMN_SEMESTER);
      setTerm({ startDate: saved?.startDate || fallback.startDate, endDate: saved?.endDate || fallback.endDate });
      setFeedback({ type: "success", text: `${result.academicYear}학년도 학사일정에서 휴교일 ${(result.exceptions || []).length}건을 찾아 아래 캘린더에 반영했습니다. 자동 인식은 완벽하지 않을 수 있으니, 날짜를 클릭해 확인하고 저장해 주세요.` });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "PDF를 분석하지 못했습니다." });
    } finally {
      setParsing(false);
    }
  }

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarException[]>();
    for (const e of exceptions) {
      const list = map.get(e.date);
      if (list) list.push(e);
      else map.set(e.date, [e]);
    }
    return map;
  }, [exceptions]);

  // Each date can carry more than one concurrent run now, so runs are found by grouping same
  // label+isClosure exceptions together first (a date can belong to at most one run per group),
  // then splitting each group into contiguous date chains. showLabel marks only a run's *first
  // visible* day -- the earliest day of that run that's actually on-screen -- so the label appears
  // once per run instead of once per week row, while still showing up even when the run's true
  // start is scrolled off before the first rendered month (the visibility floor is that month's
  // 1st, not the exact term start date -- e.g. semester 2 officially starting 8/26 shouldn't hide
  // 여름방학 days earlier in August, since the whole month still renders).
  const visibleFloor = startOfMonth(term.startDate);
  const exceptionInfo = useMemo(() => {
    const groups = new Map<string, CalendarException[]>();
    for (const e of exceptions) {
      const key = `${e.isClosure ? "1" : "0"} ${e.label}`;
      const list = groups.get(key);
      if (list) list.push(e);
      else groups.set(key, [e]);
    }
    const runs: { runId: string; label: string; isClosure: boolean; dates: string[] }[] = [];
    for (const rows of groups.values()) {
      const uniqueDates = Array.from(new Set(rows.map((r) => r.date))).sort();
      let run: string[] = [];
      const flush = () => { if (run.length) runs.push({ runId: `${rows[0].label}|${rows[0].isClosure}|${run[0]}`, label: rows[0].label, isClosure: rows[0].isClosure, dates: run }); };
      for (const date of uniqueDates) {
        if (run.length && addDaysISO(run[run.length - 1], 1) === date) run.push(date);
        else { flush(); run = [date]; }
      }
      flush();
    }
    const map = new Map<string, DayInfo[]>();
    for (const run of runs) {
      const firstVisible = run.dates.find((d) => d >= visibleFloor);
      for (const date of run.dates) {
        const list = map.get(date) || [];
        list.push({ label: run.label, isClosure: run.isClosure, showLabel: firstVisible === date, runId: run.runId });
        map.set(date, list);
      }
    }
    return map;
  }, [exceptions, visibleFloor]);

  function findRunBounds(dateISO: string, label: string, isClosure: boolean): { start: string; end: string } {
    const matches = (d: string) => (byDate.get(d) || []).some((e) => e.label === label && e.isClosure === isClosure);
    let start = dateISO;
    while (matches(addDaysISO(start, -1))) start = addDaysISO(start, -1);
    let end = dateISO;
    while (matches(addDaysISO(end, 1))) end = addDaysISO(end, 1);
    return { start, end };
  }

  function handleDayClick(dateISO: string) {
    const entries = byDate.get(dateISO) || [];
    if (!entries.length) {
      if (canEdit) openNewEventEditor(dateISO);
      return;
    }
    setDayPopup(dateISO);
  }

  function openNewEventEditor(dateISO: string) {
    setDayPopup(null);
    setDayEditor({ originalStart: null, originalEnd: null, originalLabel: null, originalIsClosure: null, startDate: dateISO, endDate: dateISO, label: "", isClosure: false });
  }

  function openEditEventEditor(dateISO: string, entry: CalendarException) {
    const { start, end } = findRunBounds(dateISO, entry.label, entry.isClosure);
    setDayPopup(null);
    setDayEditor({ originalStart: start, originalEnd: end, originalLabel: entry.label, originalIsClosure: entry.isClosure, startDate: start, endDate: end, label: entry.label, isClosure: entry.isClosure });
  }

  function deleteRun(dateISO: string, entry: CalendarException) {
    const { start, end } = findRunBounds(dateISO, entry.label, entry.isClosure);
    setExceptions((current) => current.filter((e) => !(e.date >= start && e.date <= end && e.label === entry.label && e.isClosure === entry.isClosure)));
  }

  function saveDayEditor() {
    if (!dayEditor) return;
    const { startDate, endDate, label, isClosure, originalStart, originalEnd, originalLabel, originalIsClosure } = dayEditor;
    if (startDate > endDate) {
      setFeedback({ type: "error", text: "시작일이 종료일보다 늦을 수 없습니다." });
      return;
    }
    const dayCount = daysBetween(startDate, endDate);
    if (dayCount > MAX_RANGE_DAYS) {
      setFeedback({ type: "error", text: "날짜 범위가 너무 깁니다. 1년 이내로 설정해 주세요." });
      return;
    }
    const trimmed = label.trim();
    const finalLabel = trimmed || "휴교";
    setExceptions((current) => {
      let rest = current;
      // Remove only the exact run being edited -- matched by its ORIGINAL label/isClosure, not the
      // (possibly just-changed) draft values, and never touching any other concurrent event that
      // happens to share some of the same dates.
      if (originalStart && originalEnd && originalLabel !== null && originalIsClosure !== null) {
        rest = rest.filter((e) => !(e.date >= originalStart && e.date <= originalEnd && e.label === originalLabel && e.isClosure === originalIsClosure));
      }
      // Avoid an exact-duplicate row if the target range already carries this same label+isClosure
      // from a different (now-adjacent) run -- they'd just merge into one run on the next render.
      rest = rest.filter((e) => !(e.date >= startDate && e.date <= endDate && e.label === finalLabel && e.isClosure === isClosure));
      if (!trimmed && !isClosure) return rest; // blank label + not a closure => delete-only
      const newRows: CalendarException[] = [];
      for (let d = startDate, i = 0; i < dayCount; i++, d = addDaysISO(d, 1)) newRows.push({ date: d, label: finalLabel, isClosure });
      return [...rest, ...newRows].sort((a, b) => a.date.localeCompare(b.date));
    });
    setDayEditor(null);
  }

  function deleteDayEditorEntry() {
    if (!dayEditor?.originalStart || !dayEditor.originalEnd || dayEditor.originalLabel === null || dayEditor.originalIsClosure === null) return;
    const { originalStart, originalEnd, originalLabel, originalIsClosure } = dayEditor;
    setExceptions((current) => current.filter((e) => !(e.date >= originalStart && e.date <= originalEnd && e.label === originalLabel && e.isClosure === originalIsClosure)));
    setDayEditor(null);
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/academic-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academicYear, exceptions, terms: [{ semester: AUTUMN_SEMESTER, startDate: term.startDate, endDate: term.endDate }] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학사일정을 저장하지 못했습니다.");
      setFeedback({ type: "success", text: result.message || "학사일정을 저장했습니다." });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "학사일정을 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  const visibleMonths = useMemo(() => monthsInRange(term.startDate, term.endDate), [term]);
  const closureCount = useMemo(() => exceptions.filter((e) => e.isClosure && e.date >= term.startDate && e.date <= term.endDate).length, [exceptions, term]);
  const eventCount = useMemo(() => exceptions.filter((e) => !e.isClosure && e.date >= term.startDate && e.date <= term.endDate).length, [exceptions, term]);
  const dayPopupEntries = dayPopup ? byDate.get(dayPopup) || [] : [];

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACADEMIC CALENDAR</p>
          <h2>학사일정</h2>
          <p className="muted">
            {canEdit
              ? "날짜를 클릭하면 그날의 이벤트와 휴교 여부를 등록·수정할 수 있고, 시작일·종료일을 지정해 여러 날에 걸친 일정을 한 번에 등록할 수 있습니다. 한 날짜에 여러 일정이 겹쳐도 함께 등록할 수 있습니다. 휴교일은 빨간색, 기타 이벤트는 파란색으로 표시됩니다. PDF를 업로드하면 휴교일을 자동으로 찾아 반영하니, 저장 전 꼭 확인해 주세요."
              : "학교의 학사일정을 확인할 수 있습니다. 휴교일은 빨간색, 기타 이벤트는 파란색으로 표시됩니다. 날짜를 누르면 그날의 일정을 전체 이름으로 볼 수 있습니다. 수정은 관리자만 할 수 있습니다."}
          </p>
        </div>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} /></label>
        <label>학기<select value={AUTUMN_SEMESTER} onChange={() => {}}><option value={AUTUMN_SEMESTER}>가을학기</option></select></label>
        {canEdit && (
          <label>PDF 업로드
            <input type="file" accept="application/pdf" disabled={parsing} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadPdf(file); e.target.value = ""; }} />
          </label>
        )}
        {parsing && <span className="muted">분석 중...</span>}
        {loading && <span className="muted">불러오는 중...</span>}
      </div>

      {feedback && <p className={feedback.type === "success" ? "success-message" : "form-error"}>{feedback.text}</p>}

      <div className="two-columns">
        <label>가을학기 시작일<input type="date" value={term.startDate} disabled={!canEdit} onChange={(e) => setTerm((current) => ({ ...current, startDate: e.target.value }))} /></label>
        <label>가을학기 종료일<input type="date" value={term.endDate} disabled={!canEdit} onChange={(e) => setTerm((current) => ({ ...current, endDate: e.target.value }))} /></label>
      </div>
      <p className="muted">휴교일 {closureCount}건 · 이벤트 {eventCount}건</p>

      <div className={`calendar-months${canEdit ? "" : " calendar-readonly"}`}>
        {visibleMonths.map(({ year, month }) => (
          <MonthGrid key={`${year}-${month}`} year={year} month={month} exceptionInfo={exceptionInfo} canEdit={canEdit} onDayClick={handleDayClick} />
        ))}
        {!visibleMonths.length && <p className="muted">학기 시작일과 종료일을 확인해 주세요.</p>}
      </div>

      {canEdit && (
        <div className="warning-actions">
          <button className="primary" onClick={save} disabled={saving}>{saving ? "저장 중..." : `${academicYear}학년도 학사일정 저장`}</button>
        </div>
      )}

      {dayPopup && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDayPopup(null); }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="day-popup-title">
            <button type="button" className="modal-close" aria-label="닫기" onClick={() => setDayPopup(null)}>×</button>
            <p className="eyebrow">CALENDAR DAY</p>
            <h2 id="day-popup-title">{dayPopup}</h2>
            <ul className="day-popup-list">
              {dayPopupEntries.map((entry, i) => (
                <li key={`${entry.label}-${entry.isClosure}-${i}`} className="day-popup-item">
                  <span className={`day-popup-badge ${entry.isClosure ? "exception" : "event"}`}>{entry.isClosure ? "휴교" : "이벤트"}</span>
                  <span className="day-popup-label">{entry.label}</span>
                  {canEdit && (
                    <div className="day-popup-item-actions">
                      <button type="button" className="secondary" onClick={() => openEditEventEditor(dayPopup, entry)}>수정</button>
                      <button type="button" className="danger-outline-button" onClick={() => deleteRun(dayPopup, entry)}>삭제</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setDayPopup(null)}>닫기</button>
              {canEdit && <button type="button" className="primary" onClick={() => openNewEventEditor(dayPopup)}>새 일정 추가</button>}
            </div>
          </div>
        </div>
      )}

      {dayEditor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDayEditor(null); }}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="day-editor-title">
            <button type="button" className="modal-close" aria-label="닫기" onClick={() => setDayEditor(null)}>×</button>
            <p className="eyebrow">CALENDAR EVENT</p>
            <h2 id="day-editor-title">{dayEditor.originalStart ? "일정 수정" : "일정 등록"}</h2>
            <div className="two-columns">
              <label>시작일<input type="date" value={dayEditor.startDate} onChange={(e) => setDayEditor((current) => (current ? { ...current, startDate: e.target.value } : current))} /></label>
              <label>종료일<input type="date" value={dayEditor.endDate} onChange={(e) => setDayEditor((current) => (current ? { ...current, endDate: e.target.value } : current))} /></label>
            </div>
            <label className="day-editor-field">
              이벤트 / 사유
              <input
                value={dayEditor.label}
                onChange={(e) => setDayEditor((current) => (current ? { ...current, label: e.target.value } : current))}
                placeholder="예: 체육대회, 재량휴교"
                autoFocus
              />
            </label>
            <label className="day-editor-checkbox">
              <input
                type="checkbox"
                checked={dayEditor.isClosure}
                onChange={(e) => setDayEditor((current) => (current ? { ...current, isClosure: e.target.checked } : current))}
              />
              휴교일 (등교하지 않음)
            </label>
            <div className="modal-actions">
              {dayEditor.originalStart && <button type="button" className="danger-outline-button" onClick={deleteDayEditorEntry}>삭제</button>}
              <button type="button" className="secondary" onClick={() => setDayEditor(null)}>취소</button>
              <button type="button" className="primary" onClick={saveDayEditor}>저장</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
