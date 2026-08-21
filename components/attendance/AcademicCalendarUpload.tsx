"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CalendarException = { date: string; label: string };
type CalendarTerm = { semester: 1 | 2; startDate: string; endDate: string };
type Feedback = { type: "success" | "error"; text: string };
type TermDates = { startDate: string; endDate: string };

const now = new Date();
const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function defaultTermDates(academicYear: number): Record<1 | 2, TermDates> {
  return {
    1: { startDate: `${academicYear}-03-01`, endDate: `${academicYear}-07-31` },
    2: { startDate: `${academicYear}-08-01`, endDate: `${academicYear + 1}-02-28` },
  };
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

function MonthGrid({ year, month, exceptionMap, canEdit, onToggle, onLabelChange, onLabelBlur }: {
  year: number;
  month: number;
  exceptionMap: Map<string, string>;
  canEdit: boolean;
  onToggle: (date: string) => void;
  onLabelChange: (date: string, label: string) => void;
  onLabelBlur: (date: string) => void;
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
          const label = exceptionMap.get(dateISO);
          const isException = label !== undefined;
          const clickable = canEdit && !isWeekend;
          return (
            <div
              key={dateISO}
              className={`calendar-day ${isWeekend ? "weekend" : ""} ${isException ? "exception" : ""}`}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={() => clickable && onToggle(dateISO)}
              onKeyDown={(e) => { if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(dateISO); } }}
            >
              <span className="calendar-day-num">{day}</span>
              {isException && canEdit && (
                <input
                  className="calendar-day-label"
                  value={label}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onLabelChange(dateISO, e.target.value)}
                  onBlur={() => onLabelBlur(dateISO)}
                />
              )}
              {isException && !canEdit && <span className="calendar-day-label calendar-day-label-static">{label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AcademicCalendarUpload({ canEdit }: { canEdit: boolean }) {
  const [academicYear, setAcademicYear] = useState(now.getFullYear());
  const [semester, setSemester] = useState<1 | 2>(now.getMonth() < 7 ? 1 : 2);
  const [exceptions, setExceptions] = useState<CalendarException[]>([]);
  const [terms, setTerms] = useState<Record<1 | 2, TermDates>>(defaultTermDates(now.getFullYear()));
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadSaved = useCallback(async (year: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/academic-calendar?year=${year}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학사일정을 불러오지 못했습니다.");
      setExceptions(result.exceptions || []);
      const fallback = defaultTermDates(year);
      const nextTerms: Record<1 | 2, TermDates> = { 1: fallback[1], 2: fallback[2] };
      for (const t of result.terms || []) if (t.semester === 1 || t.semester === 2) {
        nextTerms[t.semester as 1 | 2] = { startDate: t.startDate || fallback[t.semester as 1 | 2].startDate, endDate: t.endDate || fallback[t.semester as 1 | 2].endDate };
      }
      setTerms(nextTerms);
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
      const fallback = defaultTermDates(result.academicYear);
      const nextTerms: Record<1 | 2, TermDates> = { 1: fallback[1], 2: fallback[2] };
      for (const t of result.terms || []) if (t.semester === 1 || t.semester === 2) nextTerms[t.semester as 1 | 2] = { startDate: t.startDate || fallback[t.semester as 1 | 2].startDate, endDate: t.endDate || fallback[t.semester as 1 | 2].endDate };
      setTerms(nextTerms);
      setFeedback({ type: "success", text: `${result.academicYear}학년도 학사일정에서 휴교일 ${(result.exceptions || []).length}건을 찾아 아래 캘린더에 반영했습니다. 달력을 확인하고, 잘못된 날짜는 클릭해서 다시 등교일로 바꾼 후 저장해 주세요.` });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "PDF를 분석하지 못했습니다." });
    } finally {
      setParsing(false);
    }
  }

  function toggleDay(dateISO: string) {
    setExceptions((current) => {
      if (current.some((e) => e.date === dateISO)) return current.filter((e) => e.date !== dateISO);
      return [...current, { date: dateISO, label: "휴교" }].sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  function updateLabel(dateISO: string, label: string) {
    setExceptions((current) => current.map((e) => (e.date === dateISO ? { ...e, label } : e)));
  }

  function blurLabel(dateISO: string) {
    setExceptions((current) => current.map((e) => (e.date === dateISO && !e.label.trim() ? { ...e, label: "휴교" } : e)));
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const termsPayload: CalendarTerm[] = ([1, 2] as const)
        .filter((s) => terms[s].startDate && terms[s].endDate)
        .map((s) => ({ semester: s, startDate: terms[s].startDate, endDate: terms[s].endDate }));
      const response = await fetch("/api/admin/academic-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academicYear, exceptions, terms: termsPayload }),
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

  const exceptionMap = useMemo(() => new Map(exceptions.map((e) => [e.date, e.label])), [exceptions]);
  const visibleMonths = useMemo(() => monthsInRange(terms[semester].startDate, terms[semester].endDate), [terms, semester]);
  const semesterExceptionCount = useMemo(() => exceptions.filter((e) => e.date >= terms[semester].startDate && e.date <= terms[semester].endDate).length, [exceptions, terms, semester]);

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACADEMIC CALENDAR</p>
          <h2>학사일정</h2>
          <p className="muted">
            {canEdit
              ? "학사일정 PDF를 업로드하면 휴교일(방학·재량휴교·공휴일)을 자동으로 찾아 아래 캘린더에 반영합니다. 자동 인식은 완벽하지 않을 수 있으니 저장 전 꼭 확인해 주세요. 평일 칸을 클릭하면 등교일 ↔ 휴교일이 전환되고, 휴교일 칸의 사유는 직접 입력해 고칠 수 있습니다."
              : "학교의 학사일정을 확인할 수 있습니다. 수정은 관리자만 할 수 있습니다."}
          </p>
        </div>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value) as 1 | 2)}><option value={1}>1학기</option><option value={2}>2학기</option></select></label>
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
        <label>{semester}학기 시작일<input type="date" value={terms[semester].startDate} disabled={!canEdit} onChange={(e) => setTerms((current) => ({ ...current, [semester]: { ...current[semester], startDate: e.target.value } }))} /></label>
        <label>{semester}학기 종료일<input type="date" value={terms[semester].endDate} disabled={!canEdit} onChange={(e) => setTerms((current) => ({ ...current, [semester]: { ...current[semester], endDate: e.target.value } }))} /></label>
      </div>
      <p className="muted">{semester}학기 휴교일 {semesterExceptionCount}건</p>

      <div className="calendar-months">
        {visibleMonths.map(({ year, month }) => (
          <MonthGrid key={`${year}-${month}`} year={year} month={month} exceptionMap={exceptionMap} canEdit={canEdit} onToggle={toggleDay} onLabelChange={updateLabel} onLabelBlur={blurLabel} />
        ))}
        {!visibleMonths.length && <p className="muted">학기 시작일과 종료일을 확인해 주세요.</p>}
      </div>

      {canEdit && (
        <div className="warning-actions">
          <button className="primary" onClick={save} disabled={saving}>{saving ? "저장 중..." : `${academicYear}학년도 학사일정 저장`}</button>
        </div>
      )}
    </section>
  );
}
