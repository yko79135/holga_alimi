"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import type { MonthlyWarningBreakdown, WarningStudentSummary } from "@/lib/warnings/stats";
import { sortGrades } from "@/lib/grade-sort";

type AuditEntry = {
  id: string;
  warning_date: string | null;
  entry_type: "daily" | "grace_adjustment" | "grace_conversion";
  kind: "discipline" | "praise" | null;
  category: string | null;
  delta: number;
  parent_visible_reason: string | null;
  teacher_note: string | null;
  created_at: string;
  profiles?: { full_name: string } | null;
  class_periods?: { name: string } | null;
};

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  parentCount: number;
  discipline: WarningStudentSummary;
  praise: WarningStudentSummary;
  graceTotal: number;
};

const GRACE_UNIT_PRAISE_COST = 20;
const now = new Date();

function mergeMonthly(discipline: MonthlyWarningBreakdown[], praise: MonthlyWarningBreakdown[]) {
  const months = Array.from(new Set([...discipline.map((m) => m.month), ...praise.map((m) => m.month)])).sort((a, b) => a - b);
  return months.map((month) => ({
    month,
    discipline: discipline.find((m) => m.month === month)?.total ?? 0,
    praise: praise.find((m) => m.month === month)?.total ?? 0,
  }));
}

/** entries arrive newest-first; compute each row's running semester total by walking oldest-first,
 * then hand back newest-first again so the display order and the "합계" column both make sense. */
function withRunningTotal(entries: AuditEntry[]) {
  const chronological = [...entries].reverse();
  let sum = 0;
  const withTotals = chronological.map((entry) => {
    sum += Number(entry.delta || 0);
    return { entry, total: sum };
  });
  return withTotals.reverse();
}

function entryDateLabel(entry: AuditEntry) {
  if (entry.warning_date) return new Date(entry.warning_date).toLocaleDateString("ko-KR");
  if (entry.entry_type === "grace_conversion") return "희월 정산";
  if (entry.entry_type === "grace_adjustment") return "희월·조정";
  return "-";
}

export default function PointStats({ role }: { role: string }) {
  const [year, setYear] = useState(now.getFullYear());
  const [semester, setSemester] = useState(now.getMonth() < 7 ? 1 : 2);
  const [grade, setGrade] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<StatsStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entriesByStudent, setEntriesByStudent] = useState<Record<string, AuditEntry[]>>({});
  const [entriesLoadingId, setEntriesLoadingId] = useState<string | null>(null);
  const [entriesError, setEntriesError] = useState("");
  const [graceDraft, setGraceDraft] = useState<Record<string, number>>({});
  const [applyingGraceId, setApplyingGraceId] = useState<string | null>(null);
  const [graceMessage, setGraceMessage] = useState<{ studentId: string; type: "success" | "error"; text: string } | null>(null);

  const loadEntries = useCallback(async (studentId: string) => {
    setEntriesLoadingId(studentId);
    setEntriesError("");
    try {
      const response = await fetch(`/api/warnings/audit?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "이력을 불러오지 못했습니다.");
      setEntriesByStudent((current) => ({ ...current, [studentId]: result.entries || [] }));
    } catch (error) {
      setEntriesError(error instanceof Error ? error.message : "이력을 불러오지 못했습니다.");
    } finally {
      setEntriesLoadingId(null);
    }
  }, []);

  function toggleStudentRow(studentId: string) {
    const next = expandedId === studentId ? null : studentId;
    setExpandedId(next);
    if (next && !entriesByStudent[next]) void loadEntries(next);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const response = await fetch(`/api/warnings/points-stats?year=${year}&semester=${semester}&grade=${encodeURIComponent(grade)}&student=${encodeURIComponent(q)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "통계를 불러오지 못했습니다.");
      setRows(result.students || []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "통계를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [year, semester, grade, q]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({ channelName: `point-stats-${role}`, tables: [{ table: "warning_entries" }, { table: "students" }], onRefresh: () => { void load(); } });

  function bumpGrace(studentId: string, delta: number) {
    setGraceDraft((current) => ({ ...current, [studentId]: Math.max(0, (current[studentId] || 0) + delta) }));
  }

  async function applyGrace(row: StatsStudent) {
    const units = graceDraft[row.id] || 0;
    if (units <= 0) return;
    setApplyingGraceId(row.id);
    setGraceMessage(null);
    try {
      const response = await fetch("/api/warnings/grace-settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: row.id, units, academicYear: year, semester, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "희월 적용에 실패했습니다.");
      setGraceMessage({ studentId: row.id, type: "success", text: result.message || "희월을 적용했습니다." });
      setGraceDraft((current) => ({ ...current, [row.id]: 0 }));
      void load();
      if (entriesByStudent[row.id]) void loadEntries(row.id);
    } catch (error) {
      setGraceMessage({ studentId: row.id, type: "error", text: error instanceof Error ? error.message : "희월 적용에 실패했습니다." });
    } finally {
      setApplyingGraceId(null);
    }
  }

  const grades = useMemo(() => sortGrades(Array.from(new Set(rows.map((row) => row.grade)))), [rows]);
  const disciplineTotal = rows.reduce((sum, row) => sum + (row.discipline?.semesterTotal || 0), 0);
  const praiseTotal = rows.reduce((sum, row) => sum + (row.praise?.semesterTotal || 0), 0);
  const columnCount = 7;

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">POINT STATS</p>
          <h2>점수 통계</h2>
          <p className="muted">학생을 선택하면 월별 훈계 점수·칭찬 점수 내역을 함께 확인할 수 있습니다.</p>
        </div>
        <span className="pill">훈계 {disciplineTotal}점 · 칭찬 {praiseTotal}점</span>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value))}><option value={1}>1학기</option><option value={2}>2학기</option></select></label>
        <label>학년<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">전체</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label>학생 검색<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 이름" /></label>
      </div>

      {err && <p className="form-error">{err}</p>}
      {loading && <p className="muted">불러오는 중...</p>}

      <div className="warning-grid-wrap">
        <table className="warning-grid">
          <thead>
            <tr>
              <th className="sticky grade">학년</th>
              <th className="sticky name">학생</th>
              <th>훈계 점수</th>
              <th>칭찬 점수</th>
              <th>희월</th>
              <th>학부모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expandedId === row.id;
              const monthly = mergeMonthly(row.discipline?.monthly || [], row.praise?.monthly || []);
              const disciplineNow = row.discipline?.semesterTotal ?? 0;
              const praiseNow = row.praise?.semesterTotal ?? 0;
              const draftUnits = graceDraft[row.id] || 0;
              const canIncrease = praiseNow - GRACE_UNIT_PRAISE_COST * (draftUnits + 1) >= 0 && disciplineNow - (draftUnits + 1) >= 0;
              const message = graceMessage?.studentId === row.id ? graceMessage : null;
              const disciplineEntries = withRunningTotal((entriesByStudent[row.id] || []).filter((entry) => entry.kind !== "praise"));
              const praiseEntries = withRunningTotal((entriesByStudent[row.id] || []).filter((entry) => entry.kind === "praise"));
              return (
                <Fragment key={row.id}>
                  <tr className="attendance-stats-row" aria-expanded={isOpen} onClick={() => toggleStudentRow(row.id)}>
                    <td className="sticky grade"><b>{row.grade}</b></td>
                    <td className="sticky name">{row.name}</td>
                    <td><b>{disciplineNow}점</b></td>
                    <td><b>{praiseNow}점</b></td>
                    <td className="grace-cell" onClick={(e) => e.stopPropagation()}>
                      <div className="grace-stepper">
                        <div className="grace-stepper-value">
                          <b>{row.graceTotal || 0}점</b>
                          {draftUnits > 0 && <span className="muted"> · +{draftUnits} 대기 (칭찬 -{draftUnits * GRACE_UNIT_PRAISE_COST}, 훈계 -{draftUnits})</span>}
                        </div>
                        <div className="grace-stepper-controls">
                          <button type="button" className="grace-arrow" onClick={() => bumpGrace(row.id, 1)} disabled={!canIncrease} aria-label="희월 올리기">▲</button>
                          <button type="button" className="grace-arrow" onClick={() => bumpGrace(row.id, -1)} disabled={draftUnits <= 0} aria-label="희월 내리기">▼</button>
                          <button type="button" className="secondary" onClick={() => applyGrace(row)} disabled={draftUnits <= 0 || applyingGraceId === row.id}>{applyingGraceId === row.id ? "적용 중..." : "적용"}</button>
                        </div>
                        {message && <p className={message.type === "success" ? "success-message" : "form-error"}>{message.text}</p>}
                      </div>
                    </td>
                    <td>{row.parentCount ? `${row.parentCount}명` : "연결 없음"}</td>
                    <td>{isOpen ? "닫기" : "월별 보기"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="attendance-stats-detail-row">
                      <td colSpan={columnCount}>
                        {monthly.length ? (
                          <table className="attendance-stats-detail">
                            <thead><tr><th>월</th><th>훈계 점수</th><th>칭찬 점수</th></tr></thead>
                            <tbody>
                              {monthly.map((entry) => (
                                <tr key={entry.month}><td>{entry.month}월</td><td><b>{entry.discipline}점</b></td><td><b>{entry.praise}점</b></td></tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="muted">이번 학기 기록이 없습니다.</p>
                        )}

                        <div className="point-history">
                          <p className="eyebrow">POINT HISTORY</p>
                          <h3>칭찬·훈계 상세 내역</h3>
                          {entriesLoadingId === row.id && <p className="muted">불러오는 중...</p>}
                          {entriesError && entriesLoadingId !== row.id && <p className="form-error">{entriesError}</p>}
                          {entriesLoadingId !== row.id && !entriesError && (
                            <div className="point-history-tables">
                              <div>
                                <h4>훈계 점수</h4>
                                {disciplineEntries.length ? (
                                  <table className="attendance-stats-detail">
                                    <thead><tr><th>적용 점수</th><th>날짜</th><th>수업</th><th>사유</th><th>총 점수</th></tr></thead>
                                    <tbody>
                                      {disciplineEntries.map(({ entry, total }) => (
                                        <tr key={entry.id}>
                                          <td>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}점</td>
                                          <td>{entryDateLabel(entry)}</td>
                                          <td>{entry.class_periods?.name || "-"}</td>
                                          <td>{entry.parent_visible_reason || entry.category || "사유 없음"}</td>
                                          <td><b>{total}점</b></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="muted">훈계 점수 이력이 없습니다.</p>
                                )}
                              </div>
                              <div>
                                <h4>칭찬 점수</h4>
                                {praiseEntries.length ? (
                                  <table className="attendance-stats-detail">
                                    <thead><tr><th>적용 점수</th><th>날짜</th><th>수업</th><th>사유</th><th>총 점수</th></tr></thead>
                                    <tbody>
                                      {praiseEntries.map(({ entry, total }) => (
                                        <tr key={entry.id}>
                                          <td>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}점</td>
                                          <td>{entryDateLabel(entry)}</td>
                                          <td>{entry.class_periods?.name || "-"}</td>
                                          <td>{entry.parent_visible_reason || entry.category || "사유 없음"}</td>
                                          <td><b>{total}점</b></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="muted">칭찬 점수 이력이 없습니다.</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={columnCount} className="empty-state">표시할 학생이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
