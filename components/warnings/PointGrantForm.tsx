"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { categoriesForKind, isValidPointValue, CUSTOM_CATEGORY, DEFAULT_POINT_VALUE, MAX_POINT_VALUE, POINT_KIND_LABELS, type PointKind } from "@/lib/warnings/categories";

type Student = { id: string; name: string; grade: string; active?: boolean };
type ClassPeriod = { id: string; name: string; active: boolean };

const KIND_META: Record<PointKind, { eyebrow: string; title: string; description: string; categoryLabel: string; successVerb: string }> = {
  discipline: { eyebrow: "GIVE DISCIPLINE POINT", title: "훈계 점수 부여", description: "학생과 사유를 선택하면 학부모에게 즉시 안내됩니다.", categoryLabel: "훈계 카테고리", successVerb: "훈계 점수가" },
  praise: { eyebrow: "GIVE STICKER POINT", title: "칭찬 점수 부여", description: "칭찬 내용을 선택하면 학부모에게 즉시 안내됩니다.", categoryLabel: "칭찬 카테고리", successVerb: "칭찬 점수가" },
};

export default function PointGrantForm({ role, kind, students }: { role: string; kind: PointKind; students: Student[] }) {
  const meta = KIND_META[kind];
  const categories = categoriesForKind(kind);
  const activeStudents = useMemo(() => students.filter((s) => s.active !== false).sort((a, b) => a.grade.localeCompare(b.grade) || a.name.localeCompare(b.name)), [students]);

  const [grade, setGrade] = useState("");
  const [studentId, setStudentId] = useState("");
  const [category, setCategory] = useState("");
  const [customCategoryLabel, setCustomCategoryLabel] = useState("");
  const [classPeriodId, setClassPeriodId] = useState("");
  const [points, setPoints] = useState(String(DEFAULT_POINT_VALUE));
  const [detail, setDetail] = useState("");
  const [classPeriods, setClassPeriods] = useState<ClassPeriod[]>([]);
  const [newClassName, setNewClassName] = useState("");
  const [pending, setPending] = useState(false);
  const [classPending, setClassPending] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const loadClassPeriods = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/class-periods", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "수업 목록을 불러오지 못했습니다.");
      setClassPeriods(result.classPeriods || []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "수업 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => { void loadClassPeriods(); }, [loadClassPeriods]);
  useLiveRefresh({ channelName: `point-grant-classes-${role}`, tables: [{ table: "class_periods" }], onRefresh: () => { void loadClassPeriods(); } });

  const grades = useMemo(() => Array.from(new Set(activeStudents.map((s) => s.grade))).sort(), [activeStudents]);
  const visibleStudents = useMemo(() => (grade ? activeStudents.filter((s) => s.grade === grade) : activeStudents), [activeStudents, grade]);
  const selectableClasses = role === "admin" ? classPeriods : classPeriods.filter((c) => c.active);

  const pointsValue = Number(points);
  const pointsValid = isValidPointValue(pointsValue);
  const isCustomCategory = category === CUSTOM_CATEGORY;
  const customCategoryValid = !isCustomCategory || customCategoryLabel.trim().length > 0;

  async function submit() {
    if (!studentId || !category || !classPeriodId || !pointsValid || !customCategoryValid || pending) return;
    setPending(true);
    setErr("");
    setMsg("");
    try {
      const response = await fetch("/api/warnings/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, studentId, category, customCategoryLabel: isCustomCategory ? customCategoryLabel.trim() : undefined, classPeriodId, points: pointsValue, detail: detail.trim(), idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "저장하지 못했습니다. 다시 시도해 주세요.");
      setMsg(result.message || `${meta.successVerb} 저장되었습니다.`);
      setCategory("");
      setCustomCategoryLabel("");
      setClassPeriodId("");
      setPoints(String(DEFAULT_POINT_VALUE));
      setDetail("");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  async function addClassPeriod() {
    const name = newClassName.trim();
    if (!name || classPending) return;
    setClassPending(true);
    setErr("");
    try {
      const response = await fetch("/api/admin/class-periods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "수업을 추가하지 못했습니다.");
      setNewClassName("");
      void loadClassPeriods();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "수업을 추가하지 못했습니다.");
    } finally {
      setClassPending(false);
    }
  }

  async function toggleClassPeriod(classPeriod: ClassPeriod) {
    setClassPending(true);
    setErr("");
    try {
      const response = await fetch(`/api/admin/class-periods/${classPeriod.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !classPeriod.active }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "수업 상태를 변경하지 못했습니다.");
      void loadClassPeriods();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "수업 상태를 변경하지 못했습니다.");
    } finally {
      setClassPending(false);
    }
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{meta.eyebrow}</p>
          <h2>{meta.title}</h2>
          <p className="muted">{meta.description}</p>
        </div>
      </div>

      {role === "admin" && (
        <div className="warning-toolbar">
          <label>수업 관리<input value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="새 수업 이름" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addClassPeriod(); } }} /></label>
          <button type="button" className="secondary" onClick={addClassPeriod} disabled={!newClassName.trim() || classPending}>추가</button>
          {!!classPeriods.length && (
            <div className="account-meta">
              {classPeriods.map((c) => (
                <span className="pill class-period-pill" key={c.id}>
                  {c.name}{!c.active ? " (비활성)" : ""}
                  <button type="button" className="secondary" onClick={() => toggleClassPeriod(c)} disabled={classPending}>
                    {c.active ? "비활성화" : "활성화"}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="form-panel">
        <div className="two-columns">
          <label>학년
            <select value={grade} onChange={(e) => { setGrade(e.target.value); setStudentId(""); }}>
              <option value="">전체 학년</option>
              {grades.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label>학생
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">학생 선택</option>
              {visibleStudents.map((s) => <option key={s.id} value={s.id}>{s.grade} · {s.name}</option>)}
            </select>
          </label>
          <label>{meta.categoryLabel}
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">카테고리 선택</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {isCustomCategory && (
            <label>직접 입력 사유
              <input value={customCategoryLabel} onChange={(e) => setCustomCategoryLabel(e.target.value)} placeholder="학부모에게 전달될 사유를 입력해 주세요." />
            </label>
          )}
          <label>수업
            <select value={classPeriodId} onChange={(e) => setClassPeriodId(e.target.value)}>
              <option value="">수업 선택</option>
              {selectableClasses.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.active ? " (비활성)" : ""}</option>)}
            </select>
          </label>
          <label>점수
            <input type="number" min={1} max={MAX_POINT_VALUE} step={1} value={points} onChange={(e) => setPoints(e.target.value)} />
          </label>
        </div>

        <label>세부사항 (선택)
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="필요한 경우 구체적인 상황을 적어주세요." />
        </label>
      </div>

      {!pointsValid && points !== "" && <p className="form-error">점수는 1~{MAX_POINT_VALUE} 사이의 정수로 입력해 주세요.</p>}
      {isCustomCategory && !customCategoryValid && <p className="form-error">직접 입력한 사유를 작성해 주세요.</p>}
      {err && <p className="form-error">{err}</p>}
      {msg && <p className="success-message">{msg}</p>}

      <div className="warning-actions">
        <button className="primary" onClick={submit} disabled={!studentId || !category || !classPeriodId || !pointsValid || !customCategoryValid || pending}>
          {pending ? "전송 중..." : "전송"}
        </button>
      </div>

      {!classPeriods.length && <p className="muted">등록된 수업이 없습니다. {role === "admin" ? "위에서 수업을 추가해 주세요." : "관리자에게 수업 등록을 요청해 주세요."}</p>}
    </section>
  );
}
