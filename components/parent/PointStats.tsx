"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import type { MonthlyWarningBreakdown } from "@/lib/warnings/stats";
import type { PointKind } from "@/lib/warnings/categories";

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  semesterTotal: number;
  monthly: MonthlyWarningBreakdown[];
};

const now = new Date();
const KIND_META: Record<PointKind, { eyebrow: string; title: string; unit: string; description: string; empty: string }> = {
  discipline: { eyebrow: "DISCIPLINE STATS", title: "훈계 통계", unit: "점", description: "자녀별 학기 훈계 점수 합계를 확인할 수 있습니다.", empty: "이번 학기 훈계 점수 기록이 없습니다." },
  praise: { eyebrow: "PRAISE STATS", title: "칭찬 통계", unit: "점", description: "자녀별 학기 칭찬 점수 합계를 확인할 수 있습니다.", empty: "이번 학기 칭찬 점수 기록이 없습니다." },
};

export default function ParentPointStats({ kind }: { kind: PointKind }) {
  const meta = KIND_META[kind];
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
      const response = await fetch(`/api/parent/point-stats?year=${year}&semester=${semester}&kind=${kind}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "통계를 불러오지 못했습니다.");
      setRows(result.students || []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "통계를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [year, semester, kind]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({ channelName: `parent-point-stats-${kind}`, tables: [{ table: "warning_entries" }], onRefresh: () => { void load(); } });

  const total = rows.reduce((sum, row) => sum + row.semesterTotal, 0);

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
                <span className="pill">학기 합계 {row.semesterTotal}{meta.unit}</span>
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
                        <dd>{entry.total}{meta.unit}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted">{meta.empty}</p>
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
