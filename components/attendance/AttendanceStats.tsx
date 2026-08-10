"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { ATTENDANCE_EXCEPTION_STATUSES, ATTENDANCE_STATUS_LABELS, type AttendanceExceptionStatus } from "@/lib/attendance/types";
import type { MonthlyAttendanceBreakdown } from "@/lib/attendance/stats";

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  parentCount: number;
  semesterCounts: Record<AttendanceExceptionStatus, number>;
  semesterTotal: number;
  monthly: MonthlyAttendanceBreakdown[];
};

const now = new Date();
const columnCount = ATTENDANCE_EXCEPTION_STATUSES.length + 4;

export default function AttendanceStats({ role }: { role: string }) {
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
      const response = await fetch(`/api/attendance/stats?year=${year}&semester=${semester}&grade=${encodeURIComponent(grade)}&student=${encodeURIComponent(q)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "출결 통계를 불러오지 못했습니다.");
      setRows(result.students || []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "출결 통계를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [year, semester, grade, q]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({ channelName: `attendance-stats-${role}`, tables: [{ table: "attendance_entries" }, { table: "students" }], onRefresh: () => { void load(); } });

  const grades = useMemo(() => Array.from(new Set(rows.map((row) => row.grade))).sort(), [rows]);
  const totalExceptions = rows.reduce((sum, row) => sum + row.semesterTotal, 0);

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ATTENDANCE STATS</p>
          <h2>출석 통계</h2>
          <p className="muted">학생을 선택하면 월별 출결 예외 내역을 확인할 수 있습니다.</p>
        </div>
        <span className="pill">학기 예외 합계 {totalExceptions}건</span>
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
        <table className="warning-grid attendance-stats-grid">
          <thead>
            <tr>
              <th className="sticky grade">학년</th>
              <th className="sticky name">학생</th>
              {ATTENDANCE_EXCEPTION_STATUSES.map((status) => <th key={status}>{ATTENDANCE_STATUS_LABELS[status]}</th>)}
              <th>학기 합계</th>
              <th>학부모</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expandedId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className="attendance-stats-row" aria-expanded={isOpen} onClick={() => setExpandedId(isOpen ? null : row.id)}>
                    <td className="sticky grade"><b>{row.grade}</b></td>
                    <td className="sticky name">{row.name}</td>
                    {ATTENDANCE_EXCEPTION_STATUSES.map((status) => <td key={status}>{row.semesterCounts[status]}</td>)}
                    <td><b>{row.semesterTotal}</b></td>
                    <td>{row.parentCount ? `${row.parentCount}명` : "연결 없음"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="attendance-stats-detail-row">
                      <td colSpan={columnCount}>
                        {row.monthly.length ? (
                          <table className="attendance-stats-detail">
                            <thead>
                              <tr>
                                <th>월</th>
                                {ATTENDANCE_EXCEPTION_STATUSES.map((status) => <th key={status}>{ATTENDANCE_STATUS_LABELS[status]}</th>)}
                                <th>합계</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.monthly.map((entry) => (
                                <tr key={entry.month}>
                                  <td>{entry.month}월</td>
                                  {ATTENDANCE_EXCEPTION_STATUSES.map((status) => <td key={status}>{entry.counts[status]}</td>)}
                                  <td><b>{entry.total}</b></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="muted">이번 학기 출결 예외 기록이 없습니다.</p>
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
