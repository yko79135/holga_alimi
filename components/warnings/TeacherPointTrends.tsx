"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { CategoryCount, KindTotals, TeacherTrendReport, WeeklyPoint } from "@/lib/warnings/teacher-trends";
import { SELECTABLE_SEMESTERS, SEMESTER_LABELS, defaultSemester } from "@/lib/semester";

const RECENT_WEEKS = 4;

function weekLabel(week: string) {
  const [, month, day] = week.split("-").map(Number);
  return `${month}/${day}`;
}

function sumWeeks(weekly: WeeklyPoint[], kind: "discipline" | "praise") {
  return weekly.reduce((sum, point) => sum + point[kind], 0);
}

/** 최근 4주 합계와, 그 앞 4주가 다 있으면 그와 비교한 증감. 학기 초에는 합계만 보인다. */
function ChangeLabel({ weekly, kind }: { weekly: WeeklyPoint[]; kind: "discipline" | "praise" }) {
  if (!weekly.length) return <span className="muted">-</span>;
  const recent = sumWeeks(weekly.slice(-RECENT_WEEKS), kind);
  if (weekly.length < RECENT_WEEKS * 2) return <span className="trend-change">{recent}점</span>;
  const before = sumWeeks(weekly.slice(-RECENT_WEEKS * 2, -RECENT_WEEKS), kind);
  const diff = recent - before;
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "–";
  return (
    <span className="trend-change" title={`최근 ${RECENT_WEEKS}주 ${recent}점 / 그 전 ${RECENT_WEEKS}주 ${before}점`}>
      {recent}점 <span className="muted">{arrow}{diff ? Math.abs(diff) : ""}</span>
    </span>
  );
}

/** 주별 칭찬·훈계 막대. 같은 축(0~max)에 두 계열을 나란히 그리고, 막대마다 툴팁을 단다. */
function WeeklyBars({ weekly, max, compact = false }: { weekly: WeeklyPoint[]; max: number; compact?: boolean }) {
  if (!weekly.length) return <span className="muted">기록 없음</span>;
  const scale = max > 0 ? max : 1;
  return (
    <div className={`trend-bars${compact ? " compact" : ""}`} role="img" aria-label="주별 칭찬·훈계 점수">
      {weekly.map((point) => (
        <div key={point.week} className="trend-week" title={`${weekLabel(point.week)} 주 · 칭찬 ${point.praise}점 · 훈계 ${point.discipline}점`}>
          <div className="trend-week-bars">
            <span className="trend-bar praise" style={{ height: `${Math.max(0, point.praise) / scale * 100}%` }} />
            <span className="trend-bar discipline" style={{ height: `${Math.max(0, point.discipline) / scale * 100}%` }} />
          </div>
          {!compact && <span className="trend-week-label">{weekLabel(point.week)}</span>}
        </div>
      ))}
    </div>
  );
}

function TotalsCell({ totals }: { totals: KindTotals }) {
  return (
    <span className="trend-totals">
      <b>{totals.points}점</b>
      <span className="muted">{totals.count}건{totals.count ? ` · 건당 ${(totals.points / totals.count).toFixed(1)}점` : ""} · {totals.students}명</span>
    </span>
  );
}

function CategoryList({ heading, items }: { heading: string; items: CategoryCount[] }) {
  return (
    <div className="trend-categories">
      <h4>{heading}</h4>
      {items.length ? (
        <ol>{items.map((item) => <li key={item.name}><span>{item.name}</span><b>{item.points}점</b><span className="muted">{item.count}건</span></li>)}</ol>
      ) : (
        <p className="muted">기록이 없습니다.</p>
      )}
    </div>
  );
}

function maxWeekly(weekly: WeeklyPoint[]) {
  return weekly.reduce((max, point) => Math.max(max, point.praise, point.discipline), 0);
}

export default function TeacherPointTrends() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [semester, setSemester] = useState<number>(defaultSemester());
  const [report, setReport] = useState<TeacherTrendReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hideIdle, setHideIdle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const response = await fetch(`/api/warnings/teacher-trends?year=${year}&semester=${semester}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "선생님별 추이를 불러오지 못했습니다.");
      setReport(result);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "선생님별 추이를 불러오지 못했습니다.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [year, semester]);

  useEffect(() => { void load(); }, [load]);

  const teachers = (report?.teachers || []).filter((t) => !hideIdle || t.praise.count + t.discipline.count > 0);
  const teacherMax = Math.max(0, ...(report?.teachers || []).map((t) => maxWeekly(t.weekly)));
  const overall = report?.overall;
  const columnCount = 6;

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TEACHER TRENDS</p>
          <h2>선생님별 칭찬·훈계 추이</h2>
          <p className="muted">선생님마다 이번 학기에 준 칭찬·훈계 점수와 주별 흐름입니다. 희월 정산·조정은 빼고, 날짜가 있는 부여 기록만 셉니다.</p>
        </div>
        {overall && <span className="pill">칭찬 {overall.praise.points}점 · 훈계 {overall.discipline.points}점</span>}
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value))}>{SELECTABLE_SEMESTERS.map((value) => <option key={value} value={value}>{SEMESTER_LABELS[value]}</option>)}</select></label>
        <label className="checkbox-label"><input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} />기록 없는 선생님 숨기기</label>
      </div>

      {err && <p className="form-error">{err}</p>}
      {loading && <p className="muted">불러오는 중...</p>}

      {overall && (
        <>
          <div className="stats-row trend-stats">
            <div className="stat-card"><span>칭찬 점수</span><strong>{overall.praise.points}점</strong><span>{overall.praise.count}건 · 학생 {overall.praise.students}명</span></div>
            <div className="stat-card"><span>훈계 점수</span><strong>{overall.discipline.points}점</strong><span>{overall.discipline.count}건 · 학생 {overall.discipline.students}명</span></div>
            <div className="stat-card"><span>칭찬 : 훈계 (건수)</span><strong>{overall.discipline.count ? (overall.praise.count / overall.discipline.count).toFixed(1) : "-"} : 1</strong><span>훈계 1건당 칭찬 건수</span></div>
            <div className="stat-card"><span>점수를 준 선생님</span><strong>{report!.teachers.filter((t) => t.praise.count + t.discipline.count > 0).length}명</strong><span>전체 {report!.teachers.length}명</span></div>
          </div>

          <div className="trend-overall">
            <div className="trend-legend">
              <h3>학교 전체 주별 추이</h3>
              <span><i className="trend-swatch praise" />칭찬</span>
              <span><i className="trend-swatch discipline" />훈계</span>
            </div>
            <WeeklyBars weekly={overall.weekly} max={maxWeekly(overall.weekly)} />
          </div>
        </>
      )}

      <div className="warning-grid-wrap stat-cards-wrap">
        <table className="warning-grid stat-cards-grid teacher-trends-grid">
          <thead>
            <tr>
              <th className="sticky name">선생님</th>
              <th>칭찬</th>
              <th>훈계</th>
              <th>최근 {RECENT_WEEKS}주 칭찬 / 훈계</th>
              <th>주별 추이</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((teacher) => {
              const isOpen = expandedId === teacher.id;
              return (
                <Fragment key={teacher.id}>
                  <tr className="attendance-stats-row" aria-expanded={isOpen} onClick={() => setExpandedId(isOpen ? null : teacher.id)}>
                    <td className="sticky name">{teacher.name}</td>
                    <td data-label="칭찬"><TotalsCell totals={teacher.praise} /></td>
                    <td data-label="훈계"><TotalsCell totals={teacher.discipline} /></td>
                    <td data-label={`최근 ${RECENT_WEEKS}주`}><ChangeLabel weekly={teacher.weekly} kind="praise" /> / <ChangeLabel weekly={teacher.weekly} kind="discipline" /></td>
                    <td data-label="주별 추이" className="trend-cell"><WeeklyBars weekly={teacher.weekly} max={teacherMax} compact /></td>
                    <td className="stat-cards-toggle">{isOpen ? "닫기" : "자세히"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="attendance-stats-detail-row">
                      <td colSpan={columnCount} className="stat-cards-detail-cell">
                        <WeeklyBars weekly={teacher.weekly} max={maxWeekly(teacher.weekly)} />
                        <div className="trend-category-columns">
                          <CategoryList heading="칭찬 사유 상위" items={teacher.topPraise} />
                          <CategoryList heading="훈계 사유 상위" items={teacher.topDiscipline} />
                        </div>
                        {teacher.weekly.length > 0 && (
                          <table className="attendance-stats-detail">
                            <thead><tr><th>주(월요일)</th><th>칭찬</th><th>훈계</th></tr></thead>
                            <tbody>
                              {teacher.weekly.filter((point) => point.praise || point.discipline).reverse().map((point) => (
                                <tr key={point.week}><td>{weekLabel(point.week)}</td><td><b>{point.praise}점</b></td><td><b>{point.discipline}점</b></td></tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!teachers.length && !loading && (
              <tr><td colSpan={columnCount} className="empty-state">표시할 선생님이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted trend-footnote">점수는 정정(음수)까지 반영한 합계이고, 건수·학생 수는 새로 준 기록만 셉니다. 건당 점수는 한 번에 몇 점씩 주는지 보여 줍니다. 막대는 모든 선생님이 같은 눈금을 씁니다.</p>
    </section>
  );
}
