"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CalendarException = { date: string; label: string; isClosure: boolean };
type Feedback = { type: "success" | "error"; text: string };
type TermDates = { startDate: string; endDate: string };
/** originalStart/originalEnd is the pre-edit range being replaced (null for a brand-new entry) --
 * saving clears that whole original range first so shrinking or moving a multi-day range doesn't
 * leave stale days behind, then (re)writes startDate..endDate. */
type DayEditorState = { originalStart: string | null; originalEnd: string | null; startDate: string; endDate: string; label: string; isClosure: boolean };

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

type DayInfo = { label: string; isClosure: boolean; isRunStart: boolean; isRunEnd: boolean };
type BarSegment = { weekIndex: number; startCol: number; endCol: number; label: string; isClosure: boolean; roundLeft: boolean; roundRight: boolean; showLabel: boolean };

/** Turns a month's day cells into one bar per (week row, same-label/closure run) instead of one
 * mark per date, so a multi-day range renders as a single rectangle spanning its columns -- a
 * CSS grid item spanning multiple column tracks automatically bridges the gap between them, which
 * is what makes the bar look continuous. Bars never span across week rows (or months); a run's
 * true start/end (from exceptionInfo, computed globally so it's correct at month boundaries too)
 * gets a rounded cap and the label, a wrapped continuation gets a flat edge and no repeated text. */
function computeBarSegments(cells: (number | null)[], year: number, month: number, exceptionInfo: Map<string, DayInfo>): BarSegment[] {
  const segments: BarSegment[] = [];
  let open: { weekIndex: number; startCol: number; label: string; isClosure: boolean; roundLeft: boolean; lastCol: number; lastRunEnd: boolean } | null = null;

  const closeOpen = () => {
    if (!open) return;
    segments.push({ weekIndex: open.weekIndex, startCol: open.startCol, endCol: open.lastCol, label: open.label, isClosure: open.isClosure, roundLeft: open.roundLeft, roundRight: open.lastRunEnd, showLabel: open.roundLeft });
    open = null;
  };

  for (let i = 0; i < cells.length; i++) {
    const weekIndex = Math.floor(i / 7);
    const col = i % 7;
    if (col === 0) closeOpen(); // bars never span across week rows

    const day = cells[i];
    const info = day === null ? undefined : exceptionInfo.get(`${year}-${pad(month)}-${pad(day)}`);
    if (!info) { closeOpen(); continue; }

    if (open && open.label === info.label && open.isClosure === info.isClosure) {
      open.lastCol = col;
      open.lastRunEnd = info.isRunEnd;
    } else {
      closeOpen();
      open = { weekIndex, startCol: col, label: info.label, isClosure: info.isClosure, roundLeft: info.isRunStart, lastCol: col, lastRunEnd: info.isRunEnd };
    }
  }
  closeOpen();
  return segments;
}

function MonthGrid({ year, month, exceptionInfo, canEdit, onDayClick }: {
  year: number;
  month: number;
  exceptionInfo: Map<string, DayInfo>;
  canEdit: boolean;
  onDayClick: (date: string) => void;
}) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const barSegments = useMemo(() => computeBarSegments(cells, year, month, exceptionInfo), [cells, year, month, exceptionInfo]);

  return (
    <div className="calendar-month">
      <h4>{year}년 {month}월</h4>
      <div className="calendar-grid">
        {DOW_LABELS.map((d, i) => <div key={d} className={`calendar-dow ${i === 0 || i === 6 ? "weekend" : ""}`}>{d}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} className="calendar-day empty" />;
          const dateISO = `${year}-${pad(month)}-${pad(day)}`;
          const isWeekend = i % 7 === 0 || i % 7 === 6;
          const entry = exceptionInfo.get(dateISO);
          const stateClass = entry ? (entry.isClosure ? "exception" : "event") : "";
          return (
            <div
              key={dateISO}
              className={`calendar-day ${isWeekend ? "weekend" : ""} ${stateClass}`}
              role={canEdit ? "button" : undefined}
              tabIndex={canEdit ? 0 : undefined}
              onClick={() => canEdit && onDayClick(dateISO)}
              onKeyDown={(e) => { if (canEdit && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onDayClick(dateISO); } }}
            >
              <span className="calendar-day-num">{day}</span>
            </div>
          );
        })}
        {barSegments.map((seg) => (
          <div
            key={`${seg.weekIndex}-${seg.startCol}`}
            className={`calendar-event-bar ${seg.isClosure ? "exception" : "event"} ${seg.roundLeft ? "round-left" : ""} ${seg.roundRight ? "round-right" : ""}`}
            style={{ gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`, gridRow: seg.weekIndex + 2 }}
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

  const byDate = useMemo(() => new Map(exceptions.map((e) => [e.date, e])), [exceptions]);

  // isRunStart/isRunEnd mark whether a date's predecessor/successor continues the same
  // label+closure run, computed globally (not per visible month) so a range spanning a month
  // boundary still gets correct flat/rounded bar caps in each month's own grid.
  const exceptionInfo = useMemo(() => {
    const map = new Map<string, DayInfo>();
    for (const e of exceptions) {
      const prev = byDate.get(addDaysISO(e.date, -1));
      const next = byDate.get(addDaysISO(e.date, 1));
      const isRunStart = !(prev && prev.label === e.label && prev.isClosure === e.isClosure);
      const isRunEnd = !(next && next.label === e.label && next.isClosure === e.isClosure);
      map.set(e.date, { label: e.label, isClosure: e.isClosure, isRunStart, isRunEnd });
    }
    return map;
  }, [exceptions, byDate]);

  function findRunBounds(dateISO: string, label: string, isClosure: boolean): { start: string; end: string } {
    let start = dateISO;
    for (;;) {
      const prevDate = addDaysISO(start, -1);
      const prev = byDate.get(prevDate);
      if (prev && prev.label === label && prev.isClosure === isClosure) start = prevDate;
      else break;
    }
    let end = dateISO;
    for (;;) {
      const nextDate = addDaysISO(end, 1);
      const next = byDate.get(nextDate);
      if (next && next.label === label && next.isClosure === isClosure) end = nextDate;
      else break;
    }
    return { start, end };
  }

  function openDayEditor(dateISO: string) {
    const existing = byDate.get(dateISO);
    if (existing) {
      const { start, end } = findRunBounds(dateISO, existing.label, existing.isClosure);
      setDayEditor({ originalStart: start, originalEnd: end, startDate: start, endDate: end, label: existing.label, isClosure: existing.isClosure });
    } else {
      setDayEditor({ originalStart: null, originalEnd: null, startDate: dateISO, endDate: dateISO, label: "", isClosure: false });
    }
  }

  function saveDayEditor() {
    if (!dayEditor) return;
    const { startDate, endDate, label, isClosure, originalStart, originalEnd } = dayEditor;
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
    setExceptions((current) => {
      let rest = current;
      if (originalStart && originalEnd) rest = rest.filter((e) => !(e.date >= originalStart && e.date <= originalEnd));
      rest = rest.filter((e) => !(e.date >= startDate && e.date <= endDate));
      if (!trimmed && !isClosure) return rest;
      const newRows: CalendarException[] = [];
      for (let d = startDate, i = 0; i < dayCount; i++, d = addDaysISO(d, 1)) newRows.push({ date: d, label: trimmed || "휴교", isClosure });
      return [...rest, ...newRows].sort((a, b) => a.date.localeCompare(b.date));
    });
    setDayEditor(null);
  }

  function deleteDayEditorEntry() {
    if (!dayEditor?.originalStart || !dayEditor.originalEnd) return;
    const { originalStart, originalEnd } = dayEditor;
    setExceptions((current) => current.filter((e) => !(e.date >= originalStart && e.date <= originalEnd)));
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

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACADEMIC CALENDAR</p>
          <h2>학사일정</h2>
          <p className="muted">
            {canEdit
              ? "날짜를 클릭하면 그날의 이벤트와 휴교 여부를 등록·수정할 수 있고, 시작일·종료일을 지정해 여러 날에 걸친 일정을 한 번에 등록할 수 있습니다. 휴교일은 빨간색, 기타 이벤트는 파란색으로 표시됩니다. PDF를 업로드하면 휴교일을 자동으로 찾아 반영하니, 저장 전 꼭 확인해 주세요."
              : "학교의 학사일정을 확인할 수 있습니다. 휴교일은 빨간색, 기타 이벤트는 파란색으로 표시됩니다. 수정은 관리자만 할 수 있습니다."}
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
          <MonthGrid key={`${year}-${month}`} year={year} month={month} exceptionInfo={exceptionInfo} canEdit={canEdit} onDayClick={openDayEditor} />
        ))}
        {!visibleMonths.length && <p className="muted">학기 시작일과 종료일을 확인해 주세요.</p>}
      </div>

      {canEdit && (
        <div className="warning-actions">
          <button className="primary" onClick={save} disabled={saving}>{saving ? "저장 중..." : `${academicYear}학년도 학사일정 저장`}</button>
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
