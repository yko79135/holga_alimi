"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { ATTENDANCE_EXCEPTION_STATUSES, ATTENDANCE_STATUS_LABELS, type AttendanceExceptionStatus } from "@/lib/attendance/types";
import { SELECTABLE_SEMESTERS, SEMESTER_LABELS, defaultSemester } from "@/lib/semester";

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  presentEstimate: number;
  semesterCounts: Record<AttendanceExceptionStatus, number>;
};

const now = new Date();

export default function ParentAttendanceStats() {
  const [year, setYear] = useState(now.getFullYear());
  const [semester, setSemester] = useState<number>(defaultSemester());
  const [rows, setRows] = useState<StatsStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

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

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ATTENDANCE STATS</p>
          <h2>출석 통계</h2>
          <p className="muted">자녀의 이번 학기 출결 현황을 한눈에 볼 수 있습니다.</p>
        </div>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value))}>{SELECTABLE_SEMESTERS.map((value) => <option key={value} value={value}>{SEMESTER_LABELS[value]}</option>)}</select></label>
      </div>

      {err && <p className="form-error">{err}</p>}
      {loading && <p className="muted">불러오는 중...</p>}

      {rows.map((row) => (
        <div key={row.id} className="parent-stat-block">
          <h3>{row.name} <span className="pill">{row.grade}{row.homeroom ? ` · ${row.homeroom}` : ""}</span></h3>
          <div className="stats-row">
            <div className="stat-card"><span>출석</span><strong>{row.presentEstimate}</strong></div>
            {ATTENDANCE_EXCEPTION_STATUSES.map((status) => (
              <div className="stat-card" key={status}><span>{ATTENDANCE_STATUS_LABELS[status]}</span><strong>{row.semesterCounts?.[status] ?? 0}</strong></div>
            ))}
          </div>
        </div>
      ))}
      {!rows.length && !loading && <p className="muted">연결된 학생이 없습니다.</p>}
    </section>
  );
}
