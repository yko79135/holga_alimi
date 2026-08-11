"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import type { MonthlyWarningBreakdown, WarningStudentSummary } from "@/lib/warnings/stats";

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  parentCount: number;
  discipline: WarningStudentSummary;
  praise: WarningStudentSummary;
};

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

  const grades = useMemo(() => Array.from(new Set(rows.map((row) => row.grade))).sort(), [rows]);
  const disciplineTotal = rows.reduce((sum, row) => sum + (row.discipline?.semesterTotal || 0), 0);
  const praiseTotal = rows.reduce((sum, row) => sum + (row.praise?.semesterTotal || 0), 0);
  const columnCount = 6;

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
              <th>학부모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expandedId === row.id;
              const monthly = mergeMonthly(row.discipline?.monthly || [], row.praise?.monthly || []);
              return (
                <Fragment key={row.id}>
                  <tr className="attendance-stats-row" aria-expanded={isOpen} onClick={() => setExpandedId(isOpen ? null : row.id)}>
                    <td className="sticky grade"><b>{row.grade}</b></td>
                    <td className="sticky name">{row.name}</td>
                    <td><b>{row.discipline?.semesterTotal ?? 0}점</b></td>
                    <td><b>{row.praise?.semesterTotal ?? 0}점</b></td>
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
