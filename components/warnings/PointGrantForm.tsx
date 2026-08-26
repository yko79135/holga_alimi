"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { categoryOptionLabel, fallbackCategoriesForKind, isValidPointValue, CUSTOM_CATEGORY, DEFAULT_POINT_VALUE, MAX_CATEGORY_HINT_LENGTH, MAX_CATEGORY_NAME_LENGTH, MAX_DISCIPLINE_POINT_VALUE, POINT_KIND_LABELS, POINT_KIND_SHORT_LABELS, type PointCategory, type PointKind } from "@/lib/warnings/categories";
import { compareGrades, sortGrades } from "@/lib/grade-sort";

type Student = { id: string; name: string; grade: string; active?: boolean };
type ClassPeriod = { id: string; name: string; active: boolean };

const KIND_META: Record<PointKind, { eyebrow: string; title: string; description: string; categoryLabel: string; successVerb: string }> = {
  discipline: { eyebrow: "GIVE DISCIPLINE POINT", title: "훈계 점수 부여", description: "학생과 사유를 선택하면 학부모에게 즉시 안내됩니다.", categoryLabel: "훈계 카테고리", successVerb: "훈계 점수가" },
  praise: { eyebrow: "GIVE STICKER POINT", title: "칭찬 점수 부여", description: "칭찬 내용을 선택하면 학부모에게 즉시 안내됩니다.", categoryLabel: "칭찬 카테고리", successVerb: "칭찬 점수가" },
};

export default function PointGrantForm({ role, kind, students }: { role: string; kind: PointKind; students: Student[] }) {
  const meta = KIND_META[kind];
  const activeStudents = useMemo(() => students.filter((s) => s.active !== false).sort((a, b) => compareGrades(a.grade, b.grade) || a.name.localeCompare(b.name)), [students]);

  const [pickerGrade, setPickerGrade] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [category, setCategory] = useState("");
  const [customCategoryLabel, setCustomCategoryLabel] = useState("");
  const [classPeriodId, setClassPeriodId] = useState("");
  const [points, setPoints] = useState(String(DEFAULT_POINT_VALUE));
  const [detail, setDetail] = useState("");
  const [classPeriods, setClassPeriods] = useState<ClassPeriod[]>([]);
  const [categories, setCategories] = useState<PointCategory[]>([]);
  // False while showing the seeded fallback list, whose rows have no DB id to manage.
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryHint, setNewCategoryHint] = useState("");
  const [categoryPending, setCategoryPending] = useState(false);
  const [categoryMsg, setCategoryMsg] = useState("");
  const [categoryErr, setCategoryErr] = useState("");
  const [deletingCategory, setDeletingCategory] = useState<PointCategory | null>(null);
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

  /** The category list is admin-managed at runtime, so it comes from the API rather than a
   * constant. On failure we fall back to the seeded defaults so teachers can still grant points. */
  const loadCategories = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/point-categories?kind=${kind}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "카테고리 목록을 불러오지 못했습니다.");
      setCategories(result.categories || []);
      setCategoriesLoaded(true);
      setCategoryErr("");
    } catch (error) {
      setCategories(fallbackCategoriesForKind(kind));
      setCategoriesLoaded(false);
      setCategoryErr(error instanceof Error ? error.message : "카테고리 목록을 불러오지 못했습니다.");
    }
  }, [kind]);

  useEffect(() => { void loadClassPeriods(); }, [loadClassPeriods]);
  useEffect(() => { void loadCategories(); }, [loadCategories]);
  useLiveRefresh({ channelName: `point-grant-classes-${role}`, tables: [{ table: "class_periods" }], onRefresh: () => { void loadClassPeriods(); } });
  useLiveRefresh({ channelName: `point-grant-categories-${kind}-${role}`, tables: [{ table: "point_categories" }], onRefresh: () => { void loadCategories(); } });

  const grades = useMemo(() => sortGrades(Array.from(new Set(activeStudents.map((s) => s.grade)))), [activeStudents]);
  const filteredStudents = useMemo(
    () => activeStudents.filter((s) => (!pickerGrade || s.grade === pickerGrade) && (!pickerSearch.trim() || s.name.toLowerCase().includes(pickerSearch.trim().toLowerCase()))),
    [activeStudents, pickerGrade, pickerSearch],
  );
  const selectableClasses = role === "admin" ? classPeriods : classPeriods.filter((c) => c.active);
  // Inactive categories stay out of the dropdown for everyone -- the grant API rejects them too.
  const selectableCategories = useMemo(() => categories.filter((c) => c.active), [categories]);

  // A category the admin just deactivated or deleted must not stay selected.
  useEffect(() => {
    if (!category || category === CUSTOM_CATEGORY) return;
    if (!selectableCategories.some((c) => c.name === category)) setCategory("");
  }, [category, selectableCategories]);

  const pointsValue = Number(points);
  const pointsValid = isValidPointValue(kind, pointsValue);
  const isCustomCategory = category === CUSTOM_CATEGORY;
  const customCategoryValid = !isCustomCategory || customCategoryLabel.trim().length > 0;
  const canSubmit = studentIds.length > 0 && !!category && !!classPeriodId && pointsValid && customCategoryValid;

  function toggleStudent(studentId: string) {
    setStudentIds((current) => (current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]));
  }

  function selectAllFiltered() {
    setStudentIds((current) => Array.from(new Set([...current, ...filteredStudents.map((s) => s.id)])));
  }

  async function submit() {
    if (!studentIds.length || pending) return;
    setPending(true);
    setErr("");
    setMsg("");
    try {
      const response = await fetch("/api/warnings/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, studentIds, category, customCategoryLabel: isCustomCategory ? customCategoryLabel.trim() : undefined, classPeriodId, points: pointsValue, detail: detail.trim(), idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "저장하지 못했습니다. 다시 시도해 주세요.");
      setMsg(result.message || `${meta.successVerb} 저장되었습니다.`);
      setCategory("");
      setCustomCategoryLabel("");
      setClassPeriodId("");
      setPoints(String(DEFAULT_POINT_VALUE));
      setDetail("");
      setStudentIds([]);
      setConfirmingBulk(false);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmitClick() {
    if (!canSubmit) return;
    if (studentIds.length > 1) { setConfirmingBulk(true); return; }
    void submit();
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

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name || categoryPending) return;
    setCategoryPending(true);
    setCategoryErr("");
    setCategoryMsg("");
    try {
      const response = await fetch("/api/admin/point-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, pointHint: newCategoryHint.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "카테고리를 추가하지 못했습니다.");
      setNewCategoryName("");
      setNewCategoryHint("");
      setCategoryMsg(`"${result.category?.name || name}" 카테고리를 추가했습니다.`);
      await loadCategories();
    } catch (error) {
      setCategoryErr(error instanceof Error ? error.message : "카테고리를 추가하지 못했습니다.");
    } finally {
      setCategoryPending(false);
    }
  }

  async function toggleCategory(target: PointCategory) {
    if (categoryPending) return;
    setCategoryPending(true);
    setCategoryErr("");
    setCategoryMsg("");
    try {
      const response = await fetch(`/api/admin/point-categories/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !target.active }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "카테고리 상태를 변경하지 못했습니다.");
      setCategoryMsg(`"${target.name}" 카테고리를 ${target.active ? "비활성화" : "활성화"}했습니다.`);
      await loadCategories();
    } catch (error) {
      setCategoryErr(error instanceof Error ? error.message : "카테고리 상태를 변경하지 못했습니다.");
    } finally {
      setCategoryPending(false);
    }
  }

  async function deleteCategory() {
    const target = deletingCategory;
    if (!target || categoryPending) return;
    setCategoryPending(true);
    setCategoryErr("");
    setCategoryMsg("");
    try {
      const response = await fetch(`/api/admin/point-categories/${target.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "카테고리를 삭제하지 못했습니다.");
      setDeletingCategory(null);
      setCategoryMsg(`"${target.name}" 카테고리를 삭제했습니다.`);
      await loadCategories();
    } catch (error) {
      setCategoryErr(error instanceof Error ? error.message : "카테고리를 삭제하지 못했습니다.");
    } finally {
      setCategoryPending(false);
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

      {role === "admin" && (
        <div className="warning-toolbar">
          <label>{meta.categoryLabel} 관리
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={`새 ${meta.categoryLabel} 이름`}
              maxLength={MAX_CATEGORY_NAME_LENGTH}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCategory(); } }}
            />
          </label>
          <label>참고 점수 (선택)
            <input
              value={newCategoryHint}
              onChange={(e) => setNewCategoryHint(e.target.value)}
              placeholder="예: 1점, 10~30점"
              maxLength={MAX_CATEGORY_HINT_LENGTH}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCategory(); } }}
            />
          </label>
          <button type="button" className="secondary" onClick={addCategory} disabled={!newCategoryName.trim() || categoryPending}>추가</button>
          {categoriesLoaded && !!categories.length && (
            <div className="account-meta">
              {categories.map((c) => (
                <span className="pill class-period-pill" key={c.id}>
                  {categoryOptionLabel(c)}{!c.active ? " (비활성)" : ""}
                  <button type="button" className="secondary" onClick={() => toggleCategory(c)} disabled={categoryPending}>
                    {c.active ? "비활성화" : "활성화"}
                  </button>
                  <button type="button" className="secondary" onClick={() => setDeletingCategory(c)} disabled={categoryPending}>삭제</button>
                </span>
              ))}
            </div>
          )}
          <p className="muted">추가한 카테고리는 {POINT_KIND_SHORT_LABELS[kind]} 점수 부여 화면의 카테고리 목록에 바로 나타납니다. 참고 점수는 안내용 표시일 뿐 입력 점수를 제한하지 않습니다.</p>
        </div>
      )}

      <div className="student-picker">
        <div className="student-picker-toolbar">
          <label>학년 필터<select value={pickerGrade} onChange={(e) => setPickerGrade(e.target.value)}><option value="">전체 학년</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
          <label>학생 검색<input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="이름 검색" /></label>
          <span className="pill">{studentIds.length}명 선택됨</span>
          <button type="button" className="secondary" onClick={selectAllFiltered} disabled={!filteredStudents.length}>필터된 학생 전체 선택</button>
          <button type="button" className="secondary" onClick={() => setStudentIds([])} disabled={!studentIds.length}>선택 해제</button>
        </div>
        <div className="student-picker-list">
          {filteredStudents.map((s) => {
            const checked = studentIds.includes(s.id);
            return (
              <label className="student-picker-item" key={s.id}>
                <input type="checkbox" checked={checked} onChange={() => toggleStudent(s.id)} />
                <span>{s.grade} · {s.name}</span>
              </label>
            );
          })}
          {!filteredStudents.length && <p className="muted">조건에 맞는 학생이 없습니다.</p>}
        </div>
      </div>

      <div className="form-panel">
        <div className="two-columns">
          <label>{meta.categoryLabel}
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">카테고리 선택</option>
              {selectableCategories.map((c) => <option key={c.id} value={c.name}>{categoryOptionLabel(c)}</option>)}
              <option value={CUSTOM_CATEGORY}>{CUSTOM_CATEGORY}</option>
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
            <input type="number" min={1} max={kind === "discipline" ? MAX_DISCIPLINE_POINT_VALUE : undefined} step={1} value={points} onChange={(e) => setPoints(e.target.value)} />
          </label>
        </div>

        <label>세부사항 (선택)
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="필요한 경우 구체적인 상황을 적어주세요." />
        </label>
      </div>

      {!pointsValid && points !== "" && <p className="form-error">{kind === "discipline" ? `점수는 1~${MAX_DISCIPLINE_POINT_VALUE} 사이의 정수로 입력해 주세요.` : "점수는 1 이상의 정수로 입력해 주세요."}</p>}
      {isCustomCategory && !customCategoryValid && <p className="form-error">직접 입력한 사유를 작성해 주세요.</p>}
      {categoryErr && <p className="form-error">{categoryErr}</p>}
      {categoryMsg && <p className="success-message">{categoryMsg}</p>}
      {err && <p className="form-error">{err}</p>}
      {msg && <p className="success-message">{msg}</p>}

      <div className="warning-actions">
        <button className="primary" onClick={handleSubmitClick} disabled={!canSubmit || pending}>
          {pending ? "전송 중..." : studentIds.length > 1 ? `${studentIds.length}명에게 전송` : "전송"}
        </button>
      </div>

      {!classPeriods.length && <p className="muted">등록된 수업이 없습니다. {role === "admin" ? "위에서 수업을 추가해 주세요." : "관리자에게 수업 등록을 요청해 주세요."}</p>}

      <ConfirmDialog
        open={confirmingBulk}
        title={`학생 ${studentIds.length}명에게 일괄 부여`}
        eyebrow="BULK GRANT"
        confirmLabel="전체에게 전송"
        pending={pending}
        onClose={() => setConfirmingBulk(false)}
        onConfirm={() => void submit()}
      >
        <p>선택한 학생 {studentIds.length}명 전원에게 &ldquo;{isCustomCategory ? customCategoryLabel : category}&rdquo; 사유로 {POINT_KIND_LABELS[kind]} {pointsValue}점이 한번에 부여되고, 각 학생의 학부모에게 개별 알림이 전송됩니다. 계속할까요?</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deletingCategory}
        title={`${meta.categoryLabel} 삭제`}
        eyebrow="DELETE CATEGORY"
        confirmLabel="삭제"
        variant="danger"
        pending={categoryPending}
        onClose={() => setDeletingCategory(null)}
        onConfirm={() => void deleteCategory()}
      >
        <p>&ldquo;{deletingCategory?.name}&rdquo; 카테고리를 목록에서 삭제할까요? 이미 점수 기록에 사용된 카테고리는 삭제할 수 없으니, 그런 경우에는 비활성화해 주세요.</p>
      </ConfirmDialog>
    </section>
  );
}
