"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CalendarException = { date: string; label: string; isClosure: boolean };
type Feedback = { type: "success" | "error"; text: string };
type TermDates = { startDate: string; endDate: string };
type DayEditorState = { date: string; label: string; isClosure: boolean };

const now = new Date();
const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
// Only 가을학기 (semester 2) is exposed in this UI -- see the header copy below. Kept as the
// DB's semester number (not renamed) so it still round-trips through the shared academic_terms
// API, which other parts of the app (attendance stats) still key by semester 1/2.
const AUTUMN_SEMESTER = 2 as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function defaultAutumnTerm(academicYear: number): TermDates {
  return { startDate: `${academicYear}-08-01`, endDate: `${academicYear + 1}-02-28` };
}

function formatDayHeading(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DOW_LABELS[d.getUTCDay()]})`;
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

function MonthGrid({ year, month, exceptionMap, canEdit, onDayClick }: {
  year: number;
  month: number;
  exceptionMap: Map<string, { label: string; isClosure: boolean }>;
  canEdit: boolean;
  onDayClick: (date: string) => void;
}) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="calendar-month">
      <h4>{year}년 {month}월</h4>
      <div className="calendar-grid">
        {DOW_LABELS.map((d, i) => <div key={d} className={`calendar-dow ${i === 0 || i === 6 ? "weekend" : ""}`}>{d}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} className="calendar-day empty" />;
          const dateISO = `${year}-${pad(month)}-${pad(day)}`;
          const isWeekend = i % 7 === 0 || i % 7 === 6;
          const entry = exceptionMap.get(dateISO);
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
              {entry && <span className="calendar-day-label">{entry.label}</span>}
            </div>
          );
        })}
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

  const exceptionMap = useMemo(() => new Map(exceptions.map((e) => [e.date, { label: e.label, isClosure: e.isClosure }])), [exceptions]);

  function openDayEditor(dateISO: string) {
    const existing = exceptionMap.get(dateISO);
    setDayEditor({ date: dateISO, label: existing?.label || "", isClosure: existing?.isClosure ?? false });
  }

  function saveDayEditor() {
    if (!dayEditor) return;
    const trimmed = dayEditor.label.trim();
    setExceptions((current) => {
      const rest = current.filter((e) => e.date !== dayEditor.date);
      if (!trimmed && !dayEditor.isClosure) return rest;
      return [...rest, { date: dayEditor.date, label: trimmed || "휴교", isClosure: dayEditor.isClosure }].sort((a, b) => a.date.localeCompare(b.date));
    });
    setDayEditor(null);
  }

  function deleteDayEditorEntry() {
    if (!dayEditor) return;
    setExceptions((current) => current.filter((e) => e.date !== dayEditor.date));
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
              ? "날짜를 클릭하면 그날의 이벤트와 휴교 여부를 등록·수정할 수 있습니다. 휴교일은 빨간색, 기타 이벤트는 파란색으로 표시됩니다. PDF를 업로드하면 휴교일을 자동으로 찾아 반영하니, 저장 전 꼭 확인해 주세요."
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
          <MonthGrid key={`${year}-${month}`} year={year} month={month} exceptionMap={exceptionMap} canEdit={canEdit} onDayClick={openDayEditor} />
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
            <p className="eyebrow">CALENDAR DAY</p>
            <h2 id="day-editor-title">{formatDayHeading(dayEditor.date)}</h2>
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
              {exceptionMap.has(dayEditor.date) && <button type="button" className="danger-outline-button" onClick={deleteDayEditorEntry}>삭제</button>}
              <button type="button" className="secondary" onClick={() => setDayEditor(null)}>취소</button>
              <button type="button" className="primary" onClick={saveDayEditor}>저장</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
