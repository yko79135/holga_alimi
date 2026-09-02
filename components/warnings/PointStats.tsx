"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { MAX_DISCIPLINE_POINT_VALUE } from "@/lib/warnings/categories";
import type { MonthlyWarningBreakdown, WarningStudentSummary } from "@/lib/warnings/stats";
import { isValidDateOnly } from "@/lib/warnings/term";
import { sortGrades } from "@/lib/grade-sort";
import { SELECTABLE_SEMESTERS, SEMESTER_LABELS, defaultSemester } from "@/lib/semester";

type AuditEntry = {
  id: string;
  warning_date: string | null;
  entry_type: "daily" | "grace_adjustment" | "grace_conversion";
  kind: "discipline" | "praise" | null;
  category: string | null;
  delta: number;
  class_period_id: string | null;
  parent_visible_reason: string | null;
  teacher_note: string | null;
  created_at: string;
  profiles?: { full_name: string } | null;
  class_periods?: { name: string } | null;
};

type StatsStudent = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
  parentCount: number;
  discipline: WarningStudentSummary;
  praise: WarningStudentSummary;
  graceTotal: number;
};

type ClassPeriod = { id: string; name: string; active: boolean };

type EntryDraft = { points: string; date: string; classPeriodId: string; reason: string };

const GRACE_UNIT_PRAISE_COST = 20;
const now = new Date();

function mergeMonthly(discipline: MonthlyWarningBreakdown[], praise: MonthlyWarningBreakdown[]) {
  const months = Array.from(new Set([...discipline.map((m) => m.month), ...praise.map((m) => m.month)])).sort((a, b) => a - b);
  return months.map((month) => ({
    month,
    discipline: discipline.find((m) => m.month === month)?.total ?? 0,
    praise: praise.find((m) => m.month === month)?.total ?? 0,
  }));
}

/** entries arrive newest-first; compute each row's running semester total by walking oldest-first,
 * then hand back newest-first again so the display order and the "합계" column both make sense. */
function withRunningTotal(entries: AuditEntry[]) {
  const chronological = [...entries].reverse();
  let sum = 0;
  const withTotals = chronological.map((entry) => {
    sum += Number(entry.delta || 0);
    return { entry, total: sum };
  });
  return withTotals.reverse();
}

function entryDateLabel(entry: AuditEntry) {
  if (entry.warning_date) return new Date(entry.warning_date).toLocaleDateString("ko-KR");
  if (entry.entry_type === "grace_conversion") return "희월 정산";
  if (entry.entry_type === "grace_adjustment") return "희월·조정";
  return "-";
}

function draftFromEntry(entry: AuditEntry): EntryDraft {
  return {
    points: String(entry.delta ?? ""),
    date: entry.warning_date || "",
    classPeriodId: entry.class_period_id || "",
    reason: entry.parent_visible_reason || entry.category || "",
  };
}

/** Mirrors the checks in app/api/warnings/entries/[id] so a bad edit is caught before the request. */
function draftError(entry: AuditEntry, draft: EntryDraft): string | null {
  const points = Number(draft.points);
  if (!draft.points.trim() || !Number.isInteger(points) || points === 0) return "적용 점수는 0이 아닌 정수로 입력해 주세요.";
  if (entry.kind !== "praise" && Math.abs(points) > MAX_DISCIPLINE_POINT_VALUE) {
    return `훈계 점수는 -${MAX_DISCIPLINE_POINT_VALUE}~${MAX_DISCIPLINE_POINT_VALUE} 사이의 정수로 입력해 주세요.`;
  }
  if (entry.entry_type === "daily" && !isValidDateOnly(draft.date)) return "날짜를 확인해 주세요.";
  return null;
}

function PointHistoryTable({
  heading,
  rows,
  emptyLabel,
  classPeriods,
  editingId,
  draft,
  savingId,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRequestDelete,
}: {
  heading: string;
  rows: Array<{ entry: AuditEntry; total: number }>;
  emptyLabel: string;
  classPeriods: ClassPeriod[];
  editingId: string | null;
  draft: EntryDraft | null;
  savingId: string | null;
  onDraftChange: (patch: Partial<EntryDraft>) => void;
  onStartEdit: (entry: AuditEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: (entry: AuditEntry) => void;
  onRequestDelete: (entry: AuditEntry) => void;
}) {
  return (
    <div>
      <h4>{heading}</h4>
      {rows.length ? (
        <div className="point-history-scroll">
          <table className="attendance-stats-detail point-history-table">
            <thead><tr><th>적용 점수</th><th>날짜</th><th>수업</th><th>사유</th><th>총 점수</th><th>관리</th></tr></thead>
            <tbody>
              {rows.map(({ entry, total }) => {
                const isEditing = editingId === entry.id && !!draft;
                const isSaving = savingId === entry.id;
                // 희월 정산 is stored as a matched 칭찬/훈계 pair, so it can only be removed whole --
                // editing one side alone would leave the two halves disagreeing.
                const editable = entry.entry_type !== "grace_conversion";
                if (isEditing && draft) {
                  return (
                    <tr key={entry.id} className="point-history-editing">
                      <td data-label="적용 점수"><input type="number" step={1} value={draft.points} onChange={(e) => onDraftChange({ points: e.target.value })} aria-label="적용 점수" /></td>
                      <td data-label="날짜">
                        {entry.entry_type === "daily"
                          ? <input type="date" value={draft.date} onChange={(e) => onDraftChange({ date: e.target.value })} aria-label="날짜" />
                          : entryDateLabel(entry)}
                      </td>
                      <td data-label="수업">
                        <select value={draft.classPeriodId} onChange={(e) => onDraftChange({ classPeriodId: e.target.value })} aria-label="수업">
                          <option value="">수업 없음</option>
                          {classPeriods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
                          {draft.classPeriodId && !classPeriods.some((period) => period.id === draft.classPeriodId) && (
                            <option value={draft.classPeriodId}>{entry.class_periods?.name || "삭제된 수업"}</option>
                          )}
                        </select>
                      </td>
                      <td data-label="사유"><input type="text" value={draft.reason} onChange={(e) => onDraftChange({ reason: e.target.value })} placeholder="사유" aria-label="사유" /></td>
                      <td data-label="총 점수"><b>{total}점</b></td>
                      <td className="point-history-manage">
                        <div className="point-history-actions">
                          <button type="button" className="primary" onClick={() => onSaveEdit(entry)} disabled={isSaving}>{isSaving ? "저장 중..." : "저장"}</button>
                          <button type="button" className="secondary" onClick={onCancelEdit} disabled={isSaving}>취소</button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={entry.id}>
                    <td data-label="적용 점수">{entry.delta > 0 ? `+${entry.delta}` : entry.delta}점</td>
                    <td data-label="날짜">{entryDateLabel(entry)}</td>
                    <td data-label="수업">{entry.class_periods?.name || "-"}</td>
                    <td data-label="사유">{entry.parent_visible_reason || entry.category || "사유 없음"}</td>
                    <td data-label="총 점수"><b>{total}점</b></td>
                    <td className="point-history-manage">
                      <div className="point-history-actions">
                        {editable
                          ? <button type="button" className="secondary" onClick={() => onStartEdit(entry)} disabled={!!editingId}>수정</button>
                          : <span className="muted point-history-locked" title="희월 정산 내역은 수정할 수 없습니다. 삭제 후 다시 적용해 주세요.">정산</span>}
                        <button type="button" className="danger-button" onClick={() => onRequestDelete(entry)} disabled={!!editingId}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{emptyLabel}</p>
      )}
    </div>
  );
}

export default function PointStats({ role }: { role: string }) {
  const [year, setYear] = useState(now.getFullYear());
  const [semester, setSemester] = useState<number>(defaultSemester());
  const [grade, setGrade] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<StatsStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entriesByStudent, setEntriesByStudent] = useState<Record<string, AuditEntry[]>>({});
  const [entriesLoadingId, setEntriesLoadingId] = useState<string | null>(null);
  const [entriesError, setEntriesError] = useState("");
  const [graceDraft, setGraceDraft] = useState<Record<string, number>>({});
  const [applyingGraceId, setApplyingGraceId] = useState<string | null>(null);
  const [graceMessage, setGraceMessage] = useState<{ studentId: string; type: "success" | "error"; text: string } | null>(null);
  const [classPeriods, setClassPeriods] = useState<ClassPeriod[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ entry: AuditEntry; studentId: string } | null>(null);
  const [deletingEntry, setDeletingEntry] = useState(false);
  const [entryMessage, setEntryMessage] = useState<{ studentId: string; type: "success" | "error"; text: string } | null>(null);

  const loadEntries = useCallback(async (studentId: string) => {
    setEntriesLoadingId(studentId);
    setEntriesError("");
    try {
      const response = await fetch(`/api/warnings/audit?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "이력을 불러오지 못했습니다.");
      setEntriesByStudent((current) => ({ ...current, [studentId]: result.entries || [] }));
    } catch (error) {
      setEntriesError(error instanceof Error ? error.message : "이력을 불러오지 못했습니다.");
    } finally {
      setEntriesLoadingId(null);
    }
  }, []);

  const loadClassPeriods = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/class-periods", { cache: "no-store" });
      const result = await response.json();
      if (response.ok) setClassPeriods(result.classPeriods || []);
    } catch {
      // The 수업 dropdown is optional context for an edit; the rest of 점수 통계 still works without it.
    }
  }, []);

  function cancelEntryEdit() {
    setEditingEntryId(null);
    setEntryDraft(null);
  }

  function toggleStudentRow(studentId: string) {
    const next = expandedId === studentId ? null : studentId;
    cancelEntryEdit();
    setEntryMessage(null);
    setExpandedId(next);
    if (next && !entriesByStudent[next]) void loadEntries(next);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const response = await fetch(`/api/warnings/points-stats?year=${year}&semester=${semester}&grade=${encodeURIComponent(grade)}&student=${encodeURIComponent(q)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "통계를 불러오지 못했습니다.");
      setRows(result.students || []);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "통계를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [year, semester, grade, q]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadClassPeriods(); }, [loadClassPeriods]);
  useLiveRefresh({ channelName: `point-stats-${role}`, tables: [{ table: "warning_entries" }, { table: "students" }], onRefresh: () => { void load(); } });

  function bumpGrace(studentId: string, delta: number) {
    setGraceDraft((current) => ({ ...current, [studentId]: Math.max(0, (current[studentId] || 0) + delta) }));
  }

  async function applyGrace(row: StatsStudent) {
    const units = graceDraft[row.id] || 0;
    if (units <= 0) return;
    setApplyingGraceId(row.id);
    setGraceMessage(null);
    try {
      const response = await fetch("/api/warnings/grace-settlement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: row.id, units, academicYear: year, semester, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "희월 적용에 실패했습니다.");
      setGraceMessage({ studentId: row.id, type: "success", text: result.message || "희월을 적용했습니다." });
      setGraceDraft((current) => ({ ...current, [row.id]: 0 }));
      void load();
      if (entriesByStudent[row.id]) void loadEntries(row.id);
    } catch (error) {
      setGraceMessage({ studentId: row.id, type: "error", text: error instanceof Error ? error.message : "희월 적용에 실패했습니다." });
    } finally {
      setApplyingGraceId(null);
    }
  }

  function startEntryEdit(entry: AuditEntry) {
    setEntryMessage(null);
    setEditingEntryId(entry.id);
    setEntryDraft(draftFromEntry(entry));
  }

  function patchEntryDraft(patch: Partial<EntryDraft>) {
    setEntryDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveEntryEdit(entry: AuditEntry, studentId: string) {
    if (!entryDraft || savingEntryId) return;
    const validationError = draftError(entry, entryDraft);
    if (validationError) {
      setEntryMessage({ studentId, type: "error", text: validationError });
      return;
    }
    setSavingEntryId(entry.id);
    setEntryMessage(null);
    try {
      const response = await fetch(`/api/warnings/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: Number(entryDraft.points),
          date: entry.entry_type === "daily" ? entryDraft.date : undefined,
          classPeriodId: entryDraft.classPeriodId,
          reason: entryDraft.reason.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "점수 내역을 수정하지 못했습니다.");
      cancelEntryEdit();
      setEntryMessage({ studentId, type: "success", text: result.message || "점수 내역을 수정했습니다." });
      await Promise.all([load(), loadEntries(studentId)]);
    } catch (error) {
      setEntryMessage({ studentId, type: "error", text: error instanceof Error ? error.message : "점수 내역을 수정하지 못했습니다." });
    } finally {
      setSavingEntryId(null);
    }
  }

  async function confirmDeleteEntry() {
    if (!deleteTarget || deletingEntry) return;
    const { entry, studentId } = deleteTarget;
    setDeletingEntry(true);
    setEntryMessage(null);
    try {
      const response = await fetch(`/api/warnings/entries/${entry.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "점수 내역을 삭제하지 못했습니다.");
      setDeleteTarget(null);
      setEntryMessage({ studentId, type: "success", text: result.message || "점수 내역을 삭제했습니다." });
      await Promise.all([load(), loadEntries(studentId)]);
    } catch (error) {
      setEntryMessage({ studentId, type: "error", text: error instanceof Error ? error.message : "점수 내역을 삭제하지 못했습니다." });
    } finally {
      setDeletingEntry(false);
    }
  }

  const grades = useMemo(() => sortGrades(Array.from(new Set(rows.map((row) => row.grade)))), [rows]);
  const disciplineTotal = rows.reduce((sum, row) => sum + (row.discipline?.semesterTotal || 0), 0);
  const praiseTotal = rows.reduce((sum, row) => sum + (row.praise?.semesterTotal || 0), 0);
  const columnCount = 7;
  const selectableClasses = useMemo(() => (role === "admin" ? classPeriods : classPeriods.filter((period) => period.active)), [classPeriods, role]);

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">POINT STATS</p>
          <h2>점수 통계</h2>
          <p className="muted">학생을 선택하면 월별 훈계 점수·칭찬 점수 내역을 함께 확인할 수 있습니다.</p>
        </div>
        <span className="pill">훈계 {disciplineTotal}점 · 칭찬 {praiseTotal}점</span>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value))}>{SELECTABLE_SEMESTERS.map((value) => <option key={value} value={value}>{SEMESTER_LABELS[value]}</option>)}</select></label>
        <label>학년<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">전체</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label>학생 검색<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 이름" /></label>
      </div>

      {err && <p className="form-error">{err}</p>}
      {loading && <p className="muted">불러오는 중...</p>}

      <div className="warning-grid-wrap stat-cards-wrap">
        <table className="warning-grid stat-cards-grid">
          <thead>
            <tr>
              <th className="sticky grade">학년</th>
              <th className="sticky name">학생</th>
              <th>훈계 점수</th>
              <th>칭찬 점수</th>
              <th>희월</th>
              <th>학부모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expandedId === row.id;
              const monthly = mergeMonthly(row.discipline?.monthly || [], row.praise?.monthly || []);
              const disciplineNow = row.discipline?.semesterTotal ?? 0;
              const praiseNow = row.praise?.semesterTotal ?? 0;
              const draftUnits = graceDraft[row.id] || 0;
              const canIncrease = praiseNow - GRACE_UNIT_PRAISE_COST * (draftUnits + 1) >= 0 && disciplineNow - (draftUnits + 1) >= 0;
              const message = graceMessage?.studentId === row.id ? graceMessage : null;
              const entryStatus = entryMessage?.studentId === row.id ? entryMessage : null;
              const disciplineEntries = withRunningTotal((entriesByStudent[row.id] || []).filter((entry) => entry.kind !== "praise"));
              const praiseEntries = withRunningTotal((entriesByStudent[row.id] || []).filter((entry) => entry.kind === "praise"));
              return (
                <Fragment key={row.id}>
                  <tr className="attendance-stats-row" aria-expanded={isOpen} onClick={() => toggleStudentRow(row.id)}>
                    <td className="sticky grade"><b>{row.grade}</b></td>
                    <td className="sticky name">{row.name}</td>
                    <td data-label="훈계 점수"><b>{disciplineNow}점</b></td>
                    <td data-label="칭찬 점수"><b>{praiseNow}점</b></td>
                    <td className="grace-cell" data-label="희월" onClick={(e) => e.stopPropagation()}>
                      <div className="grace-stepper">
                        <div className="grace-stepper-value">
                          <b>{row.graceTotal || 0}점</b>
                          {draftUnits > 0 && <span className="muted"> · +{draftUnits} 대기 (칭찬 -{draftUnits * GRACE_UNIT_PRAISE_COST}, 훈계 -{draftUnits})</span>}
                        </div>
                        <div className="grace-stepper-controls">
                          <button type="button" className="secondary" onClick={() => applyGrace(row)} disabled={draftUnits <= 0 || applyingGraceId === row.id}>{applyingGraceId === row.id ? "적용 중..." : "적용"}</button>
                          <button type="button" className="grace-arrow" onClick={() => bumpGrace(row.id, 1)} disabled={!canIncrease} aria-label="희월 올리기">▲</button>
                          <button type="button" className="grace-arrow" onClick={() => bumpGrace(row.id, -1)} disabled={draftUnits <= 0} aria-label="희월 내리기">▼</button>
                        </div>
                        {message && <p className={message.type === "success" ? "success-message" : "form-error"}>{message.text}</p>}
                      </div>
                    </td>
                    <td data-label="학부모">{row.parentCount ? `${row.parentCount}명` : "연결 없음"}</td>
                    <td className="stat-cards-toggle">{isOpen ? "닫기" : "월별 보기"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="attendance-stats-detail-row">
                      <td colSpan={columnCount} className="stat-cards-detail-cell">
                        {monthly.length ? (
                          <table className="attendance-stats-detail">
                            <thead><tr><th>월</th><th>훈계 점수</th><th>칭찬 점수</th></tr></thead>
                            <tbody>
                              {monthly.map((entry) => (
                                <tr key={entry.month}><td>{entry.month}월</td><td><b>{entry.discipline}점</b></td><td><b>{entry.praise}점</b></td></tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="muted">이번 학기 기록이 없습니다.</p>
                        )}

                        <div className="point-history">
                          <p className="eyebrow">POINT HISTORY</p>
                          <h3>칭찬·훈계 상세 내역</h3>
                          <p className="muted point-history-note">잘못 기재된 내역은 수정하거나 삭제할 수 있습니다. 변경 내용은 학부모 화면의 합계와 이미 발송된 안내문에도 반영되며, 알림(푸시)은 다시 가지 않습니다.</p>
                          {entryStatus && <p className={entryStatus.type === "success" ? "success-message" : "form-error"}>{entryStatus.text}</p>}
                          {entriesLoadingId === row.id && <p className="muted">불러오는 중...</p>}
                          {entriesError && entriesLoadingId !== row.id && <p className="form-error">{entriesError}</p>}
                          {entriesLoadingId !== row.id && !entriesError && (
                            <div className="point-history-tables">
                              <PointHistoryTable
                                heading="훈계 점수"
                                rows={disciplineEntries}
                                emptyLabel="훈계 점수 이력이 없습니다."
                                classPeriods={selectableClasses}
                                editingId={editingEntryId}
                                draft={entryDraft}
                                savingId={savingEntryId}
                                onDraftChange={patchEntryDraft}
                                onStartEdit={startEntryEdit}
                                onCancelEdit={cancelEntryEdit}
                                onSaveEdit={(entry) => void saveEntryEdit(entry, row.id)}
                                onRequestDelete={(entry) => setDeleteTarget({ entry, studentId: row.id })}
                              />
                              <PointHistoryTable
                                heading="칭찬 점수"
                                rows={praiseEntries}
                                emptyLabel="칭찬 점수 이력이 없습니다."
                                classPeriods={selectableClasses}
                                editingId={editingEntryId}
                                draft={entryDraft}
                                savingId={savingEntryId}
                                onDraftChange={patchEntryDraft}
                                onStartEdit={startEntryEdit}
                                onCancelEdit={cancelEntryEdit}
                                onSaveEdit={(entry) => void saveEntryEdit(entry, row.id)}
                                onRequestDelete={(entry) => setDeleteTarget({ entry, studentId: row.id })}
                              />
                            </div>
                          )}
                        </div>
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

      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        eyebrow="DELETE POINT"
        title="점수 내역을 삭제할까요?"
        confirmLabel="삭제"
        pending={deletingEntry}
        onConfirm={() => void confirmDeleteEntry()}
        onClose={() => { if (!deletingEntry) setDeleteTarget(null); }}
      >
        {deleteTarget && (
          <>
            <dl className="reset-target-details">
              <dt>적용 점수</dt><dd>{deleteTarget.entry.delta > 0 ? `+${deleteTarget.entry.delta}` : deleteTarget.entry.delta}점 ({deleteTarget.entry.kind === "praise" ? "칭찬" : "훈계"})</dd>
              <dt>날짜</dt><dd>{entryDateLabel(deleteTarget.entry)}</dd>
              <dt>사유</dt><dd>{deleteTarget.entry.parent_visible_reason || deleteTarget.entry.category || "사유 없음"}</dd>
            </dl>
            <p className="destructive-warning">
              {deleteTarget.entry.entry_type === "grace_conversion"
                ? "희월 정산은 칭찬·훈계 두 줄이 한 쌍이라 함께 삭제됩니다. 삭제 후 필요하면 희월을 다시 적용해 주세요."
                : "삭제하면 되돌릴 수 없습니다. 이 내역으로 학부모에게 발송된 안내문도 함께 삭제됩니다. (같은 안내문에 묶인 다른 내역이 남아 있으면 안내문은 유지됩니다.)"}
            </p>
          </>
        )}
      </ConfirmDialog>
    </section>
  );
}
