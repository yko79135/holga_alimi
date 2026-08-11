"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { ATTENDANCE_EXCEPTION_STATUSES, ATTENDANCE_STATUS_LABELS, type AttendanceExceptionStatus } from "@/lib/attendance/types";
import type { MonthlyAttendanceBreakdown } from "@/lib/attendance/stats";

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  semesterCounts: Record<AttendanceExceptionStatus, number>;
  semesterTotal: number;
  monthly: MonthlyAttendanceBreakdown[];
};

const now = new Date();

export default function ParentAttendanceStats() {
  const [year, setYear] = useState(now.getFullYear());
  const [semester, setSemester] = useState(now.getMonth() < 7 ? 1 : 2);
  const [rows, setRows] = useState<StatsStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const response = await fetch(`/api/parent/attendance-stats?year=${year}&semester=${semester}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "출석 통계를 불러오지 못했습니다.");
      setRows(result.students || []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "출석 통계를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [year, semester]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({ channelName: "parent-attendance-stats", tables: [{ table: "attendance_entries" }], onRefresh: () => { void load(); } });

  const totalExceptions = rows.reduce((sum, row) => sum + row.semesterTotal, 0);

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ATTENDANCE STATS</p>
          <h2>출석 통계</h2>
          <p className="muted">자녀별 학기 출결 예외 내역을 확인할 수 있습니다.</p>
        </div>
        <span className="pill">학기 예외 합계 {totalExceptions}건</span>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value))}><option value={1}>1학기</option><option value={2}>2학기</option></select></label>
      </div>

      {err && <p className="form-error">{err}</p>}
      {loading && <p className="muted">불러오는 중...</p>}

      <div className="account-list">
        {rows.map((row) => {
          const isOpen = expandedId === row.id;
          return (
            <article className="account-card" key={row.id}>
              <div className="account-meta">
                <strong>{row.name}</strong>
                <span className="pill">{row.grade}{row.homeroom ? ` · ${row.homeroom}` : ""}</span>
                <span className="pill">학기 합계 {row.semesterTotal}건</span>
              </div>
              <div className="account-meta">
                {ATTENDANCE_EXCEPTION_STATUSES.map((status) => (
                  <span className="pill" key={status}>{ATTENDANCE_STATUS_LABELS[status]} {row.semesterCounts[status]}</span>
                ))}
              </div>
              <div className="account-actions">
                <button type="button" className="secondary" onClick={() => setExpandedId(isOpen ? null : row.id)}>
                  {isOpen ? "닫기" : "월별 보기"}
                </button>
              </div>
              {isOpen && (
                row.monthly.length ? (
                  <dl className="reset-target-details">
                    {row.monthly.map((entry) => (
                      <div key={entry.month}>
                        <dt>{entry.month}월</dt>
                        <dd>{ATTENDANCE_EXCEPTION_STATUSES.map((status) => `${ATTENDANCE_STATUS_LABELS[status]} ${entry.counts[status]}`).join(" · ")} (합계 {entry.total})</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted">이번 학기 출결 예외 기록이 없습니다.</p>
                )
              )}
            </article>
          );
        })}
        {!rows.length && !loading && <p className="muted">연결된 학생이 없습니다.</p>}
      </div>
    </section>
  );
}
