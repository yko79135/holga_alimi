"use client";

import { useCallback, useEffect, useState } from "react";

type Assignment = { grade: string; teacherId: string | null; teacherName: string };
type Officer = { roleKey: string; label: string; profileId: string | null; personName: string };
type StaffOption = { id: string; fullName: string; email: string };

export default function HomeroomSettings() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/homeroom", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "홈룸 정보를 불러오지 못했습니다.");
      setAssignments(result.assignments || []);
      setOfficers(result.officers || []);
      setStaff(result.staff || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "홈룸 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(key: string, payload: Record<string, unknown>) {
    setMessage("");
    setError("");
    setSavingKey(key);
    try {
      const response = await fetch("/api/admin/homeroom", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "저장하지 못했습니다.");
      setMessage(result.message || "저장했습니다.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "저장하지 못했습니다.");
    } finally {
      setSavingKey(null);
    }
  }

  // The teacher's name is stored alongside the link so the roster still reads correctly before a
  // teacher has a portal account; linking an account overwrites it with that account's own name.
  // The link no longer carries any permission -- it only keeps the displayed name in sync.
  function staffOptions(selectedId: string | null) {
    return (
      <>
        <option value="">계정 미연결</option>
        {staff.map((option) => <option key={option.id} value={option.id}>{option.fullName || option.email}</option>)}
        {selectedId && !staff.some((option) => option.id === selectedId) && <option value={selectedId}>연결된 계정</option>}
      </>
    );
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">HOMEROOM</p>
          <h2>홈룸 · 교장 · 교감 선생님 지정</h2>
          <p className="muted">학년별 홈룸 담당 명단입니다. 조퇴 신청 목록에 학생의 홈룸 선생님이 함께 표시됩니다. 계정을 연결하면 표시 이름이 그 계정의 이름을 따릅니다.</p>
        </div>
        <button type="button" className="secondary" onClick={() => { void load(); }} disabled={loading}>새로고침</button>
      </div>

      {message && <p className="success-message">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">불러오는 중입니다...</p>}

      {officers.map((officer) => (
        <div className="homeroom-row" key={officer.roleKey}>
          <strong>{officer.label}</strong>
          <input
            value={officer.personName}
            placeholder="이름"
            disabled={Boolean(officer.profileId)}
            onChange={(event) => setOfficers((current) => current.map((row) => row.roleKey === officer.roleKey ? { ...row, personName: event.target.value } : row))}
          />
          <select
            value={officer.profileId || ""}
            onChange={(event) => setOfficers((current) => current.map((row) => row.roleKey === officer.roleKey ? { ...row, profileId: event.target.value || null } : row))}
          >
            {staffOptions(officer.profileId)}
          </select>
          <button type="button" className="secondary" disabled={savingKey === officer.roleKey} onClick={() => save(officer.roleKey, { target: officer.roleKey, teacherId: officer.profileId, name: officer.personName })}>저장</button>
        </div>
      ))}

      {assignments.map((assignment) => (
        <div className="homeroom-row" key={assignment.grade}>
          <strong>{assignment.grade}</strong>
          <input
            value={assignment.teacherName}
            placeholder="이름"
            disabled={Boolean(assignment.teacherId)}
            onChange={(event) => setAssignments((current) => current.map((row) => row.grade === assignment.grade ? { ...row, teacherName: event.target.value } : row))}
          />
          <select
            value={assignment.teacherId || ""}
            onChange={(event) => setAssignments((current) => current.map((row) => row.grade === assignment.grade ? { ...row, teacherId: event.target.value || null } : row))}
          >
            {staffOptions(assignment.teacherId)}
          </select>
          <button type="button" className="secondary" disabled={savingKey === assignment.grade} onClick={() => save(assignment.grade, { grade: assignment.grade, teacherId: assignment.teacherId, name: assignment.teacherName })}>저장</button>
        </div>
      ))}
      {!loading && !assignments.length && <div className="empty-state">등록된 학년이 없습니다. 먼저 학생을 등록해 주세요.</div>}
    </section>
  );
}
