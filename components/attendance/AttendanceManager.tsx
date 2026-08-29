"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { buildAttendanceReasonTemplate, hasMeaningfulReasonAfterTemplate, attendanceReasonErrorMessage } from "@/lib/attendance/reasons";
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS, type AttendanceCellChange, type AttendanceGridStudent, type AttendanceStatus } from "@/lib/attendance/types";
import { sortGrades } from "@/lib/grade-sort";
import { SEMESTER_LABELS, SEMESTERS } from "@/lib/semester";

const now = new Date();
const cellKey = (studentId: string, date: string) => `${studentId}:${date}`;

type ChangedCell = {
  key: string;
  row: AttendanceGridStudent;
  date: string;
  previousStatus: AttendanceStatus;
  newStatus: AttendanceStatus;
  template: string;
};

export default function AttendanceManager({ role }: { role: string }) {
  const [year, setYear] = useState(now.getFullYear());
  const [semester, setSemester] = useState(now.getMonth() < 7 ? 1 : 2);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [grade, setGrade] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AttendanceGridStudent[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [autoTemplates, setAutoTemplates] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const firstReasonRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setErr("");
    const response = await fetch(`/api/attendance/grid?year=${year}&semester=${semester}&month=${month}&grade=${encodeURIComponent(grade)}&student=${encodeURIComponent(q)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      setErr(result.error || "출결 내역을 불러오는 중입니다.");
      return false;
    }
    setRows(result.students || []);
    setDates(result.dates || []);
    setDraft({});
    return true;
  }, [year, semester, month, grade, q]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({ channelName: `attendance-manager-${role}`, tables: [{ table: "attendance_entries" }, { table: "students" }, { table: "parent_students" }], onRefresh: () => { void load(); } });

  const grades = useMemo(() => sortGrades(Array.from(new Set(rows.map((r) => r.grade)))), [rows]);
  const baseStatus = useCallback((row: AttendanceGridStudent, date: string) => row.daily[date] || "present", []);
  const cellValue = useCallback((row: AttendanceGridStudent, date: string) => draft[cellKey(row.id, date)] ?? baseStatus(row, date), [draft, baseStatus]);

  const dirtyKeys = useMemo(() => Object.keys(draft).filter((key) => {
    const [studentId, date] = key.split(":");
    const row = rows.find((r) => r.id === studentId);
    return row && draft[key] !== baseStatus(row, date);
  }), [draft, rows, baseStatus]);

  const changedRows: ChangedCell[] = useMemo(() => dirtyKeys.map((key) => {
    const [studentId, date] = key.split(":");
    const row = rows.find((r) => r.id === studentId);
    if (!row) return null;
    const previousStatus = baseStatus(row, date);
    const newStatus = draft[key];
    const template = buildAttendanceReasonTemplate({ studentName: row.name, date, previousStatus, newStatus });
    return { key, row, date, previousStatus, newStatus, template };
  }).filter(Boolean) as ChangedCell[], [dirtyKeys, rows, draft, baseStatus]);

  const affectedStudents = new Set(changedRows.map((item) => item.row.id));
  const exceptionCount = changedRows.filter((item) => item.newStatus !== "present").length;
  const correctionCount = changedRows.length - exceptionCount;
  const missingParents = Array.from(affectedStudents).filter((id) => !rows.find((r) => r.id === id)?.parentCount).length;

  const reasonErrors = changedRows.reduce<Record<string, string>>((acc, item) => {
    if (!hasMeaningfulReasonAfterTemplate(reasons[item.key] || "", item.template)) acc[item.key] = attendanceReasonErrorMessage(item.newStatus);
    return acc;
  }, {});
  const hasInvalidReasons = changedRows.length > 0 && Object.keys(reasonErrors).length > 0;

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyKeys.length) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyKeys.length]);

  useEffect(() => {
    if (!confirmOpen) return;
    setReasons((prev) => {
      const next = { ...prev };
      const nextTemplates = { ...autoTemplates };
      for (const item of changedRows) {
        const current = next[item.key] || "";
        const oldTemplate = nextTemplates[item.key];
        if (!current || (oldTemplate && current === oldTemplate)) {
          next[item.key] = item.template;
          nextTemplates[item.key] = item.template;
        }
      }
      setAutoTemplates(nextTemplates);
      return next;
    });
    requestAnimationFrame(() => {
      const el = firstReasonRef.current;
      if (el) { el.focus(); el.selectionStart = el.value.length; el.selectionEnd = el.value.length; }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, changedRows.map((item) => `${item.key}:${item.template}`).join("|")]);

  const openReasonModal = useCallback(() => { setErr(""); setMsg(""); setConfirmOpen(true); }, []);
  const closeReasonModal = useCallback(() => { if (!pending) setConfirmOpen(false); }, [pending]);

  async function save() {
    if (!dirtyKeys.length || pending) return;
    if (hasInvalidReasons) { setErr(Object.values(reasonErrors)[0] || "사유를 입력해 주세요."); return; }
    setPending(true);
    setErr("");
    setMsg("");
    try {
      const changes: AttendanceCellChange[] = dirtyKeys.map((key) => {
        const [studentId, date] = key.split(":");
        const row = rows.find((r) => r.id === studentId)!;
        return {
          studentId,
          date,
          previousStatus: baseStatus(row, date),
          newStatus: draft[key],
          parentVisibleReason: reasons[key],
          teacherNote: notes[key] || undefined,
        };
      });
      const response = await fetch("/api/attendance/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academicYear: year, semester, month, idempotencyKey: crypto.randomUUID(), changes }),
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.attendance_saved || !Number.isFinite(Number(result.inserted_entries)) || Number(result.inserted_entries) <= 0) {
        if (process.env.NODE_ENV !== "production") console.error("attendance-save-failed", result);
        throw new Error(result.error || "출결 내역을 저장하지 못했습니다. 다시 시도해 주세요.");
      }
      const hadMissing = Boolean(result.missingParentStudentIds?.length);
      setDraft({});
      setReasons({});
      setNotes({});
      setAutoTemplates({});
      setConfirmOpen(false);
      setMsg(hadMissing ? "출결 내역은 저장되었지만 일부 학생은 연결된 학부모 계정이 없어 알림을 전송하지 못했습니다." : (result.message || "출결 변경사항이 저장되었으며 학부모 알림이 생성되었습니다."));
      void load().then((ok) => { if (!ok) setErr("출결 내역은 저장되었습니다. 최신 표를 보려면 새로고침해 주세요."); }).catch(() => setErr("출결 내역은 저장되었습니다. 최신 표를 보려면 새로고침해 주세요."));
    } catch (error) {
      setErr(error instanceof Error ? error.message : "출결 내역을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="content-card warning-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ATTENDANCE SHEET</p>
          <h2>출석 관리</h2>
          <p className="muted">셀 상태를 변경한 뒤 변경사항 저장을 눌러야 학부모 개별 알림과 푸시가 생성됩니다. 표시가 없는 날짜는 출석으로 간주됩니다.</p>
        </div>
        <span className="pill">미저장 {dirtyKeys.length}건</span>
      </div>

      <div className="warning-toolbar">
        <label>학년도<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
        <label>학기<select value={semester} onChange={(e) => setSemester(Number(e.target.value))}>{SEMESTERS.map((value) => <option key={value} value={value}>{SEMESTER_LABELS[value]}</option>)}</select></label>
        <label>월<select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}월</option>)}</select></label>
        <label>학년<select value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">전체</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label>학생 검색<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 이름" /></label>
      </div>

      {err && <p className="form-error">{err}</p>}
      {msg && <p className="success-message">{msg}</p>}

      <div className="warning-actions">
        <button className="primary" onClick={openReasonModal} disabled={!dirtyKeys.length || pending}>{pending ? "저장 중..." : "변경사항 저장"}</button>
        <button className="secondary" onClick={() => { setDraft({}); setReasons({}); setNotes({}); setAutoTemplates({}); }} disabled={!dirtyKeys.length || pending}>변경 취소</button>
      </div>

      <div className="warning-grid-wrap">
        <table className="warning-grid attendance-grid">
          <thead>
            <tr>
              <th className="sticky grade">학년</th>
              <th className="sticky name">학생</th>
              {dates.map((date) => (
                <th key={date} className={date === now.toISOString().slice(0, 10) ? "today" : ""}>
                  {Number(date.slice(8))}
                  <small>{[0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? "주말" : ""}</small>
                </th>
              ))}
              <th>이번달 예외</th>
              <th>학기 예외</th>
              <th>학부모</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const monthExceptions = Object.values(row.monthlyCounts).reduce((sum, count) => sum + count, 0);
              const semesterExceptions = Object.values(row.semesterCounts).reduce((sum, count) => sum + count, 0);
              return (
                <tr key={row.id}>
                  <td className="sticky grade"><b>{row.grade}</b></td>
                  <td className="sticky name">{row.name}</td>
                  {dates.map((date) => {
                    const key = cellKey(row.id, date);
                    const isDirty = dirtyKeys.includes(key);
                    const value = cellValue(row, date);
                    return (
                      <td key={date}>
                        <select aria-label={`${row.name} ${date} 출결`} className={isDirty ? "unsaved" : value !== "present" ? "attendance-exception" : ""} value={value} onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value as AttendanceStatus }))}>
                          {ATTENDANCE_STATUSES.map((status) => <option key={status} value={status}>{ATTENDANCE_STATUS_LABELS[status]}</option>)}
                        </select>
                      </td>
                    );
                  })}
                  <td><b>{monthExceptions}</b></td>
                  <td>{semesterExceptions}</td>
                  <td>{row.parentCount ? `${row.parentCount}명` : "연결 없음"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">교사용 메모와 학부모 표시 내용은 저장 확인 시 각 변경 셀의 사유 입력값으로 기록됩니다. 내부 메모는 학부모 화면에 노출되지 않습니다.</p>

      <ConfirmDialog open={confirmOpen} title="출결 변경 사유 입력" eyebrow="ATTENDANCE SAVE" confirmLabel="저장 및 알림 전송" pending={pending} confirmDisabled={hasInvalidReasons} onClose={closeReasonModal} onConfirm={save}>
        <p>변경된 출결 상태마다 학부모에게 표시될 사유를 입력해 주세요.</p>
        <dl className="reset-target-details">
          <div><dt>영향 학생</dt><dd>{affectedStudents.size}명</dd></div>
          <div><dt>변경 셀</dt><dd>{changedRows.length}건</dd></div>
          <div><dt>출결 예외 등록</dt><dd>{exceptionCount}건</dd></div>
          <div><dt>출석 정정</dt><dd>{correctionCount}건</dd></div>
          <div><dt>학부모 미연결</dt><dd>{missingParents}명</dd></div>
        </dl>
        <div className="warning-reason-list">
          {changedRows.map((item, index) => (
            <div className="warning-reason-card" key={item.key}>
              <strong>{item.row.name} · {item.date}</strong>
              <p className="muted">{ATTENDANCE_STATUS_LABELS[item.previousStatus]} → {ATTENDANCE_STATUS_LABELS[item.newStatus]}</p>
              <label>학부모 표시 사유
                <textarea ref={index === 0 ? firstReasonRef : undefined} value={reasons[item.key] || ""} onChange={(e) => setReasons((current) => ({ ...current, [item.key]: e.target.value }))} />
              </label>
              {reasonErrors[item.key] && <p className="form-error">{reasonErrors[item.key]}</p>}
              <label>내부 교사용 메모 (선택)
                <textarea value={notes[item.key] || ""} onChange={(e) => setNotes((current) => ({ ...current, [item.key]: e.target.value }))} />
              </label>
            </div>
          ))}
        </div>
        {err && <p role="alert" className="form-error">{err}</p>}
      </ConfirmDialog>
    </section>
  );
}
