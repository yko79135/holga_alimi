"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { formatDismissalMoment } from "@/lib/early-dismissal/format";
import { APPROVER_ROLE_LABELS, DECISION_LABELS, MAX_REASON_LENGTH, STATUS_LABELS, type EarlyDismissalRequest } from "@/lib/early-dismissal/types";

type Student = { id: string; name: string; grade: string };

function todayValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function ParentEarlyDismissalRequests({ userId, students }: { userId: string; students: Student[] }) {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("request");
  const [requests, setRequests] = useState<EarlyDismissalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ studentId: "", dismissalDate: todayValue(), dismissalTime: "", reason: "", guardianName: "", guardianContact: "", returnsSameDay: false });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/early-dismissal", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "조퇴 신청 목록을 불러오지 못했습니다.");
      setRequests(result.requests || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "조퇴 신청 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!form.studentId && students.length) setForm((current) => ({ ...current, studentId: students[0].id })); }, [students, form.studentId]);
  useLiveRefresh({
    channelName: `parent-early-dismissal-${userId}`,
    tables: [{ table: "early_dismissal_requests", filter: `parent_id=eq.${userId}` }],
    onRefresh: () => { void load(); },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!form.studentId) return setError("자녀를 선택해 주세요.");
    if (!form.reason.trim()) return setError("조퇴 사유를 입력해 주세요.");
    setSubmitting(true);
    try {
      const response = await fetch("/api/early-dismissal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "조퇴 신청에 실패했습니다.");
      setMessage(result.message || "조퇴 신청을 접수했습니다.");
      setForm((current) => ({ ...current, dismissalTime: "", reason: "", returnsSameDay: false }));
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "조퇴 신청에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(request: EarlyDismissalRequest) {
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/early-dismissal/${encodeURIComponent(request.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "취소하지 못했습니다.");
      setMessage(result.message || "조퇴 신청을 취소했습니다.");
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "취소하지 못했습니다.");
    }
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">EARLY DISMISSAL</p>
          <h2>조퇴 신청</h2>
          <p className="muted">신청하면 모든 선생님께 알림이 전달되고, 홈룸 선생님과 교감 선생님이 모두 승인해야 확정됩니다. 승인되면 출석부에 조퇴로 기록됩니다.</p>
        </div>
      </div>

      <form className="form-panel" onSubmit={submit}>
        <div className="three-columns">
          <div>
            <label htmlFor="early-dismissal-student">자녀</label>
            <select id="early-dismissal-student" value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })}>
              {students.map((student) => <option key={student.id} value={student.id}>{student.grade} {student.name}</option>)}
              {!students.length && <option value="">연결된 자녀가 없습니다</option>}
            </select>
          </div>
          <div>
            <label htmlFor="early-dismissal-date">조퇴 날짜</label>
            <input id="early-dismissal-date" type="date" value={form.dismissalDate} onChange={(event) => setForm({ ...form, dismissalDate: event.target.value })} required />
          </div>
          <div>
            <label htmlFor="early-dismissal-time">조퇴 시각 (선택)</label>
            <input id="early-dismissal-time" type="time" value={form.dismissalTime} onChange={(event) => setForm({ ...form, dismissalTime: event.target.value })} />
          </div>
        </div>
        <div className="three-columns">
          <div>
            <label htmlFor="early-dismissal-guardian">인솔자 (선택)</label>
            <input id="early-dismissal-guardian" value={form.guardianName} onChange={(event) => setForm({ ...form, guardianName: event.target.value })} placeholder="예: 어머니 홍길동" />
          </div>
          <div>
            <label htmlFor="early-dismissal-contact">연락처 (선택)</label>
            <input id="early-dismissal-contact" value={form.guardianContact} onChange={(event) => setForm({ ...form, guardianContact: event.target.value })} placeholder="010-0000-0000" />
          </div>
          <div>
            <label>당일 복귀</label>
            <label className="switch-line" htmlFor="early-dismissal-return">
              <input id="early-dismissal-return" type="checkbox" checked={form.returnsSameDay} onChange={(event) => setForm({ ...form, returnsSameDay: event.target.checked })} />
              <span>조퇴 후 같은 날 학교로 돌아옵니다</span>
            </label>
          </div>
        </div>
        <label htmlFor="early-dismissal-reason">조퇴 사유</label>
        <textarea id="early-dismissal-reason" value={form.reason} maxLength={MAX_REASON_LENGTH} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="병원 진료, 가정 사정 등 조퇴가 필요한 사유를 적어주세요." required />
        <button className="primary" type="submit" disabled={submitting || !students.length}>{submitting ? "신청 중..." : "조퇴 신청하기"}</button>
        {message && <p className="success-message">{message}</p>}
        {error && <p className="form-error">{error}</p>}
      </form>

      <div className="section-heading"><div><h3>신청 내역</h3></div></div>
      {loading ? <p className="muted">불러오는 중입니다...</p> : null}
      <div className="notice-list">
        {requests.map((request) => (
          <article className={`early-dismissal-row ${highlightId === request.id ? "highlight" : ""}`} key={request.id}>
            <header>
              <span className={`tag early-dismissal-${request.status}`}>{STATUS_LABELS[request.status]}</span>
              <strong>{request.studentName} · {formatDismissalMoment(request.dismissalDate, request.dismissalTime)}</strong>
            </header>
            <p className="notice-body">{request.reason}</p>
            <dl className="early-dismissal-approvals">
              <div>
                <dt>{APPROVER_ROLE_LABELS.homeroom} ({request.homeroomTeacherName})</dt>
                <dd>{DECISION_LABELS[request.homeroom.decision]}{request.homeroom.decidedByName ? ` · ${request.homeroom.decidedByName}` : ""}{request.homeroom.comment ? ` · ${request.homeroom.comment}` : ""}</dd>
              </div>
              <div>
                <dt>{APPROVER_ROLE_LABELS.vice_principal} ({request.vicePrincipalName})</dt>
                <dd>{DECISION_LABELS[request.vicePrincipal.decision]}{request.vicePrincipal.decidedByName ? ` · ${request.vicePrincipal.decidedByName}` : ""}{request.vicePrincipal.comment ? ` · ${request.vicePrincipal.comment}` : ""}</dd>
              </div>
            </dl>
            {request.status === "pending" && (
              <button type="button" className="secondary" onClick={() => cancel(request)}>신청 취소</button>
            )}
          </article>
        ))}
        {!loading && !requests.length && <div className="empty-state">아직 조퇴 신청 내역이 없습니다.</div>}
      </div>
    </section>
  );
}
