"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { CategoryShare, StudentRankingReport } from "@/lib/warnings/student-rankings";
import { SELECTABLE_SEMESTERS, SEMESTER_LABELS, defaultSemester } from "@/lib/semester";

type Kind = "praise" | "discipline";
type Report = StudentRankingReport & { grades: string[] };

const KIND_LABELS: Record<Kind, string> = { praise: "칭찬", discipline: "훈계" };
const OVERALL_CATEGORY_LIMIT = 10;

function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** 항목별 가로 막대. 한 계열(칭찬 또는 훈계)만 그리므로 색은 하나이고, 항목 이름과 값은 막대 옆에 글자로 붙인다. */
function CategoryBars({ items, kind, limit }: { items: CategoryShare[]; kind: Kind; limit?: number }) {
  if (!items.length) return <p className="muted">기록이 없습니다.</p>;
  const shown = limit ? items.slice(0, limit) : items;
  const rest = limit ? items.slice(limit) : [];
  const rows = rest.length
    ? [...shown, { name: `기타 ${rest.length}개 항목`, points: rest.reduce((sum, item) => sum + item.points, 0), count: rest.reduce((sum, item) => sum + item.count, 0) }]
    : shown;
  const total = items.reduce((sum, item) => sum + item.points, 0);
  const max = Math.max(...rows.map((item) => item.points), 1);
  return (
    <ul className="rank-bars">
      {rows.map((item) => (
        <li key={item.name} title={`${item.name} · ${item.points}점 · ${item.count}건 · ${percent(item.points, total)}%`}>
          <span className="rank-bar-label">{item.name}</span>
          <span className="rank-bar-track"><span className={`rank-bar-fill ${kind}`} style={{ width: `${(item.points / max) * 100}%` }} /></span>
          <span className="rank-bar-value"><b>{item.points}점</b> <span className="muted">{percent(item.points, total)}%</span></span>
        </li>
      ))}
    </ul>
  );
}

export default function StudentPointRankings() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [semester, setSemester] = useState<number>(defaultSemester());
  const [kind, setKind] = useState<Kind>("praise");
  const [grade, setGrade] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams({ year: String(year), semester: String(semester), kind });
      if (grade) params.set("grade", grade);
      const response = await fetch(`/api/warnings/student-rankings?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학생 순위를 불러오지 못했습니다.");
      setReport(result);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "학생 순위를 불러오지 못했습니다.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [year, semester, kind, grade]);

  useEffect(() => { void load(); }, [load]);

  const label = KIND_LABELS[kind];
  const students = report?.students || [];
  const columnCount = 6;

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">STUDENT RANKING</p>
          <h2>학생 순위</h2>
          <p className="muted">이번 학기 {label} 점수가 높은 순서입니다. 학생을 누르면 어떤 항목으로 받았는지 막대그래프로 볼 수 있습니다. 희월 정산·조정은 빼고 셉니다.</p>
        </div>
        {report && <span className="pill">{label} 받은 학생 {students.length}명</span>}
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value))}>{SELECTABLE_SEMESTERS.map((value) => <option key={value} value={value}>{SEMESTER_LABELS[value]}</option>)}</select></label>
        <label>기준<select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setExpandedId(null); }}><option value="praise">칭찬 점수</option><option value="discipline">훈계 점수</option></select></label>
        <label>학년<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">전체</option>{(report?.grades || []).map((g) => <option key={g}>{g}</option>)}</select></label>
      </div>

      {err && <p className="form-error">{err}</p>}
      {loading && <p className="muted">불러오는 중...</p>}

      {report && (
        <div className="trend-overall">
          <div className="trend-legend"><h3>{grade ? `${grade} ` : "전체 "}{label} 항목별 점수</h3></div>
          <CategoryBars items={report.categories} kind={kind} limit={OVERALL_CATEGORY_LIMIT} />
        </div>
      )}

      <div className="warning-grid-wrap stat-cards-wrap">
        <table className="warning-grid stat-cards-grid">
          <thead>
            <tr>
              <th className="sticky grade">순위</th>
              <th className="sticky name">학생</th>
              <th>학년</th>
              <th>{label} 점수</th>
              <th>가장 많이 받은 항목</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const isOpen = expandedId === student.id;
              const top = student.categories[0];
              return (
                <Fragment key={student.id}>
                  <tr className="attendance-stats-row" aria-expanded={isOpen} onClick={() => setExpandedId(isOpen ? null : student.id)}>
                    <td className="sticky grade"><b>{student.rank}위</b></td>
                    <td className="sticky name">{student.name}</td>
                    <td data-label="학년">{student.grade}</td>
                    <td data-label={`${label} 점수`}><span><b>{student.points}점</b> <span className="muted">{student.count}건</span></span></td>
                    <td data-label="가장 많이 받은 항목" className="rank-top-cell">
                      {top ? <span>{top.name} <span className="muted">{top.points}점 · {percent(top.points, student.points)}%</span></span> : "-"}
                    </td>
                    <td className="stat-cards-toggle">{isOpen ? "닫기" : "항목 보기"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="attendance-stats-detail-row">
                      <td colSpan={columnCount} className="stat-cards-detail-cell">
                        <CategoryBars items={student.categories} kind={kind} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!students.length && !loading && (
              <tr><td colSpan={columnCount} className="empty-state">이번 학기 {label} 점수를 받은 학생이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {report && report.withoutPoints > 0 && <p className="muted trend-footnote">{label} 점수가 없는 학생 {report.withoutPoints}명은 순위에서 뺐습니다. 같은 점수는 같은 순위입니다.</p>}
    </section>
  );
}
