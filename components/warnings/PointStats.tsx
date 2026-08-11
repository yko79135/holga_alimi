"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import type { MonthlyWarningBreakdown } from "@/lib/warnings/stats";
import type { PointKind } from "@/lib/warnings/categories";

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  parentCount: number;
  semesterTotal: number;
  monthly: MonthlyWarningBreakdown[];
};

const now = new Date();
const KIND_META: Record<PointKind, { eyebrow: string; title: string; unit: string; description: string; empty: string }> = {
  discipline: { eyebrow: "DISCIPLINE STATS", title: "훈계 통계", unit: "점", description: "학생을 선택하면 월별 훈계 점수 내역을 확인할 수 있습니다.", empty: "이번 학기 훈계 점수 기록이 없습니다." },
  praise: { eyebrow: "STICKER STATS", title: "스티커 통계", unit: "점", description: "학생을 선택하면 월별 칭찬 점수(스티커) 내역을 확인할 수 있습니다.", empty: "이번 학기 칭찬 점수 기록이 없습니다." },
};

export default function PointStats({ role, kind }: { role: string; kind: PointKind }) {
  const meta = KIND_META[kind];
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
      const response = await fetch(`/api/warnings/points-stats?year=${year}&semester=${semester}&grade=${encodeURIComponent(grade)}&student=${encodeURIComponent(q)}&kind=${kind}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "통계를 불러오지 못했습니다.");
      setRows(result.students || []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "통계를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [year, semester, grade, q, kind]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({ channelName: `point-stats-${kind}-${role}`, tables: [{ table: "warning_entries" }, { table: "students" }], onRefresh: () => { void load(); } });

  const grades = useMemo(() => Array.from(new Set(rows.map((row) => row.grade))).sort(), [rows]);
  const total = rows.reduce((sum, row) => sum + row.semesterTotal, 0);
  const columnCount = 5;

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{meta.eyebrow}</p>
          <h2>{meta.title}</h2>
          <p className="muted">{meta.description}</p>
        </div>
        <span className="pill">학기 합계 {total}{meta.unit}</span>
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
              <th>학기 합계</th>
              <th>학부모</th>
              <th></th>
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
                    <td><b>{row.semesterTotal}{meta.unit}</b></td>
                    <td>{row.parentCount ? `${row.parentCount}명` : "연결 없음"}</td>
                    <td>{isOpen ? "닫기" : "월별 보기"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="attendance-stats-detail-row">
                      <td colSpan={columnCount}>
                        {row.monthly.length ? (
                          <table className="attendance-stats-detail">
                            <thead><tr><th>월</th><th>합계</th></tr></thead>
                            <tbody>
                              {row.monthly.map((entry) => (
                                <tr key={entry.month}><td>{entry.month}월</td><td><b>{entry.total}{meta.unit}</b></td></tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="muted">{meta.empty}</p>
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
