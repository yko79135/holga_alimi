"use client";

import { useCallback, useEffect, useState } from "react";

type CalendarException = { date: string; label: string };
type CalendarTerm = { semester: 1 | 2; startDate: string; endDate: string };
type Feedback = { type: "success" | "error"; text: string };

const now = new Date();

export default function AcademicCalendarUpload() {
  const [academicYear, setAcademicYear] = useState(now.getFullYear());
  const [exceptions, setExceptions] = useState<CalendarException[]>([]);
  const [terms, setTerms] = useState<Record<1 | 2, { startDate: string; endDate: string }>>({ 1: { startDate: "", endDate: "" }, 2: { startDate: "", endDate: "" } });
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");
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
      const nextTerms: Record<1 | 2, { startDate: string; endDate: string }> = { 1: { startDate: "", endDate: "" }, 2: { startDate: "", endDate: "" } };
      for (const t of result.terms || []) if (t.semester === 1 || t.semester === 2) nextTerms[t.semester as 1 | 2] = { startDate: t.startDate || "", endDate: t.endDate || "" };
      setTerms(nextTerms);
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "학사일정을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSaved(academicYear); }, [academicYear, loadSaved]);

  async function uploadPdf(file: File) {
    setParsing(true);
    setFeedback(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/admin/academic-calendar/parse", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "PDF를 분석하지 못했습니다.");
      setAcademicYear(result.academicYear);
      setExceptions(result.exceptions || []);
      const nextTerms: Record<1 | 2, { startDate: string; endDate: string }> = { 1: { startDate: "", endDate: "" }, 2: { startDate: "", endDate: "" } };
      for (const t of result.terms || []) if (t.semester === 1 || t.semester === 2) nextTerms[t.semester as 1 | 2] = { startDate: t.startDate, endDate: t.endDate };
      setTerms(nextTerms);
      setFeedback({ type: "success", text: `${result.academicYear}학년도 학사일정에서 휴교일 ${(result.exceptions || []).length}건을 찾았습니다. 아래 목록을 확인·수정한 후 저장해 주세요.` });
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "PDF를 분석하지 못했습니다." });
    } finally {
      setParsing(false);
    }
  }

  function removeException(date: string) {
    setExceptions((current) => current.filter((e) => e.date !== date));
  }

  function addException() {
    if (!newDate || !newLabel.trim()) return;
    setExceptions((current) => [...current.filter((e) => e.date !== newDate), { date: newDate, label: newLabel.trim() }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewDate("");
    setNewLabel("");
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

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ACADEMIC CALENDAR</p>
          <h2>학사일정 업로드</h2>
          <p className="muted">학사일정 PDF를 업로드하면 휴교일(방학·재량휴교·공휴일)을 자동으로 찾아 아래에 보여줍니다. 자동 인식은 완벽하지 않을 수 있으니, 저장 전 목록을 꼭 확인하고 필요하면 직접 추가·삭제해 주세요.</p>
        </div>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} /></label>
        <label>PDF 업로드
          <input type="file" accept="application/pdf" disabled={parsing} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadPdf(file); e.target.value = ""; }} />
        </label>
        {parsing && <span className="muted">분석 중...</span>}
        {loading && <span className="muted">불러오는 중...</span>}
      </div>

      {feedback && <p className={feedback.type === "success" ? "success-message" : "form-error"}>{feedback.text}</p>}

      <div className="two-columns">
        {([1, 2] as const).map((s) => (
          <div key={s} className="account-meta">
            <strong>{s}학기</strong>
            <label>시작일<input type="date" value={terms[s].startDate} onChange={(e) => setTerms((current) => ({ ...current, [s]: { ...current[s], startDate: e.target.value } }))} /></label>
            <label>종료일<input type="date" value={terms[s].endDate} onChange={(e) => setTerms((current) => ({ ...current, [s]: { ...current[s], endDate: e.target.value } }))} /></label>
          </div>
        ))}
      </div>

      <div className="warning-toolbar">
        <label>날짜<input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></label>
        <label>사유<input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="예: 재량휴교" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addException(); } }} /></label>
        <button type="button" className="secondary" onClick={addException} disabled={!newDate || !newLabel.trim()}>휴교일 추가</button>
      </div>

      <div className="warning-grid-wrap">
        <table className="warning-grid">
          <thead><tr><th>날짜</th><th>사유</th><th></th></tr></thead>
          <tbody>
            {exceptions.map((e) => (
              <tr key={e.date}>
                <td>{e.date}</td>
                <td>{e.label}</td>
                <td><button type="button" className="secondary" onClick={() => removeException(e.date)}>삭제</button></td>
              </tr>
            ))}
            {!exceptions.length && <tr><td colSpan={3} className="empty-state">등록된 휴교일이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="warning-actions">
        <button className="primary" onClick={save} disabled={saving}>{saving ? "저장 중..." : `${academicYear}학년도 학사일정 저장`}</button>
      </div>
    </section>
  );
}
