"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import type { WarningStudentSummary } from "@/lib/warnings/stats";
import { SEMESTER_LABELS, SEMESTERS } from "@/lib/semester";

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  discipline: WarningStudentSummary;
  praise: WarningStudentSummary;
  graceTotal: number;
};

const now = new Date();

export default function ParentPointStats() {
  const [year, setYear] = useState(now.getFullYear());
  const [semester, setSemester] = useState(now.getMonth() < 7 ? 1 : 2);
  const [rows, setRows] = useState<StatsStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const response = await fetch(`/api/parent/point-stats?year=${year}&semester=${semester}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "점수 통계를 불러오지 못했습니다.");
      setRows(result.students || []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "점수 통계를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [year, semester]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({ channelName: "parent-point-stats", tables: [{ table: "warning_entries" }], onRefresh: () => { void load(); } });

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">POINT STATS</p>
          <h2>점수 통계</h2>
          <p className="muted">자녀의 이번 학기 칭찬 점수·훈계 점수 합계를 한눈에 볼 수 있습니다.</p>
          <p className="muted">매월 말, 칭찬 점수 20점마다 훈계 점수 1점을 상쇄할 수 있으며 이렇게 상쇄된 점수를 희월 점수라고 합니다.</p>
        </div>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value))}>{SEMESTERS.map((value) => <option key={value} value={value}>{SEMESTER_LABELS[value]}</option>)}</select></label>
      </div>

      {err && <p className="form-error">{err}</p>}
      {loading && <p className="muted">불러오는 중...</p>}

      {rows.map((row) => (
        <div key={row.id} className="parent-stat-block">
          <h3>{row.name} <span className="pill">{row.grade}{row.homeroom ? ` · ${row.homeroom}` : ""}</span></h3>
          <div className="stats-row three">
            <div className="stat-card"><span>칭찬 점수</span><strong>{row.praise?.semesterTotal ?? 0}점</strong></div>
            <div className="stat-card"><span>훈계 점수</span><strong>{row.discipline?.semesterTotal ?? 0}점</strong></div>
            <div className="stat-card"><span>희월</span><strong>{row.graceTotal ?? 0}점</strong></div>
          </div>
        </div>
      ))}
      {!rows.length && !loading && <p className="muted">연결된 학생이 없습니다.</p>}
    </section>
  );
}
