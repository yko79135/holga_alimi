"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import type { MonthlyWarningBreakdown, WarningStudentSummary } from "@/lib/warnings/stats";

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

  async function applyGrace(row: StatsStudent) {
    setApplyingGraceId(row.id);
    setGraceMessage(null);
    try {
      const response = await fetch("/api/warnings/grace-settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: row.id, academicYear: year, semester, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "희월 적용에 실패했습니다.");
      setGraceMessage({ studentId: row.id, type: "success", text: result.message || "희월을 적용했습니다." });
      void load();
      if (entriesByStudent[row.id]) void loadEntries(row.id);
    } catch (error) {
      setGraceMessage({ studentId: row.id, type: "error", text: error instanceof Error ? error.message : "희월 적용에 실패했습니다." });
    } finally {
      setApplyingGraceId(null);
    }
  }

  const grades = useMemo(() => Array.from(new Set(rows.map((row) => row.grade))).sort(), [rows]);
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
              const canApplyGrace = disciplineNow >= 1 && praiseNow >= GRACE_UNIT_PRAISE_COST;
              const message = graceMessage?.studentId === row.id ? graceMessage : null;
              return (
                <Fragment key={row.id}>
                  <tr className="attendance-stats-row" aria-expanded={isOpen} onClick={() => toggleStudentRow(row.id)}>
                    <td className="sticky grade"><b>{row.grade}</b></td>
                    <td className="sticky name">{row.name}</td>
                    <td><b>{disciplineNow}점</b></td>
                    <td><b>{praiseNow}점</b></td>
                    <td>{row.graceTotal || 0}점</td>
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

                        <div className="grace-apply" onClick={(e) => e.stopPropagation()}>
                          <p className="eyebrow">GRACE CONVERSION</p>
                          <h3>희월 정산</h3>
                          <p className="muted">희월 1점을 적용하면 칭찬 점수 {GRACE_UNIT_PRAISE_COST}점, 훈계 점수 1점이 차감됩니다. 둘 중 하나라도 0점 밑으로 내려가면 적용되지 않습니다. 적용 시 학부모에게 알림이 발송됩니다.</p>
                          <button type="button" className="secondary" onClick={() => applyGrace(row)} disabled={!canApplyGrace || applyingGraceId === row.id}>
                            {applyingGraceId === row.id ? "적용 중..." : "희월 1점 적용"}
                          </button>
                          {!canApplyGrace && <p className="muted">칭찬 점수 {GRACE_UNIT_PRAISE_COST}점 이상, 훈계 점수 1점 이상일 때만 적용할 수 있습니다.</p>}
                          {message && <p className={message.type === "success" ? "success-message" : "form-error"}>{message.text}</p>}
                        </div>

                        <div className="point-history">
                          <p className="eyebrow">POINT HISTORY</p>
                          <h3>칭찬·훈계 상세 내역</h3>
                          {entriesLoadingId === row.id && <p className="muted">불러오는 중...</p>}
                          {entriesError && entriesLoadingId !== row.id && <p className="form-error">{entriesError}</p>}
                          {entriesLoadingId !== row.id && (entriesByStudent[row.id]?.length ? (
                            <ul className="point-history-list">
                              {entriesByStudent[row.id]!.map((entry) => (
                                <li className="point-history-item" key={entry.id}>
                                  <div className="point-history-top">
                                    <span className={`tag ${entry.kind === "praise" ? "praise" : "warning"}`}>{entry.kind === "praise" ? "칭찬" : "훈계"}</span>
                                    <b>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}점</b>
                                    <span className="muted">{entry.warning_date ? new Date(entry.warning_date).toLocaleDateString("ko-KR") : entry.entry_type === "grace_conversion" ? "희월 정산" : entry.entry_type === "grace_adjustment" ? "희월·조정" : "-"}</span>
                                  </div>
                                  <p>{entry.parent_visible_reason || entry.category || "사유 없음"}</p>
                                  <small className="muted">{entry.profiles?.full_name ? `${entry.profiles.full_name} · ` : ""}{new Date(entry.created_at).toLocaleString("ko-KR")}</small>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            !entriesError && <p className="muted">개별 이력이 없습니다.</p>
                          ))}
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
