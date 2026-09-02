"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { formatDismissalMoment, withMeansParticle, withObjectParticle } from "@/lib/early-dismissal/format";
import { MAX_REASON_LENGTH, REQUEST_TYPES, REQUEST_TYPES_SUMMARY, REQUEST_TYPE_LABELS, STATE_LABELS, timeFieldLabel, usesDismissalTime, usesReturnsSameDay, type EarlyDismissalRequest, type EarlyDismissalRequestType } from "@/lib/early-dismissal/types";

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
  const [form, setForm] = useState({ type: "early_dismissal" as EarlyDismissalRequestType, studentId: "", dismissalDate: todayValue(), dismissalTime: "", reason: "", guardianName: "", guardianContact: "", returnsSameDay: false });
  const typeLabel = REQUEST_TYPE_LABELS[form.type];
  // 조퇴 asks when the child leaves, 지각 when they expect to arrive; a 결석 covers the whole day
  // and asks neither. Only a 조퇴 sends the child home mid-day, so only it asks about returning.
  const clockLabel = timeFieldLabel(form.type);
  const asksReturn = usesReturnsSameDay(form.type);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/early-dismissal", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "신청 목록을 불러오지 못했습니다.");
      setRequests(result.requests || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "신청 목록을 불러오지 못했습니다.");
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
    if (!form.reason.trim()) return setError(`${typeLabel} 사유를 입력해 주세요.`);
    setSubmitting(true);
    try {
      const response = await fetch("/api/early-dismissal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `${typeLabel} 신청에 실패했습니다.`);
      setMessage(result.message || `${typeLabel} 신청을 접수했습니다.`);
      setForm((current) => ({ ...current, dismissalTime: "", reason: "", returnsSameDay: false }));
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `${typeLabel} 신청에 실패했습니다.`);
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
      setMessage(result.message || "신청을 취소했습니다.");
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "취소하지 못했습니다.");
    }
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ATTENDANCE REQUESTS</p>
          <h2>{REQUEST_TYPES_SUMMARY} 신청</h2>
          <p className="muted">신청하면 모든 선생님께 알림이 전달됩니다. 별도의 승인 절차는 없으며, 선생님이 확인 후 출석부에 신청한 종류대로 기록합니다.</p>
        </div>
      </div>

      <form className="form-panel" onSubmit={submit}>
        <label id="early-dismissal-type-label">신청 종류</label>
        <div className="filter-row" role="radiogroup" aria-labelledby="early-dismissal-type-label">
          {REQUEST_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.type === value}
              className={form.type === value ? "filter active" : "filter"}
              // Each kind means something different by its clock, and only a 조퇴 returns the
              // same day, so switching kinds clears both rather than carrying them over.
              onClick={() => setForm({ ...form, type: value, dismissalTime: "", returnsSameDay: false })}
            >
              {REQUEST_TYPE_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="three-columns">
          <div>
            <label htmlFor="early-dismissal-student">자녀</label>
            <select id="early-dismissal-student" value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })}>
              {students.map((student) => <option key={student.id} value={student.id}>{student.grade} {student.name}</option>)}
              {!students.length && <option value="">연결된 자녀가 없습니다</option>}
            </select>
          </div>
          <div>
            <label htmlFor="early-dismissal-date">{typeLabel} 날짜</label>
            <input id="early-dismissal-date" type="date" value={form.dismissalDate} onChange={(event) => setForm({ ...form, dismissalDate: event.target.value })} required />
          </div>
          {clockLabel && (
            <div>
              <label htmlFor="early-dismissal-time">{clockLabel} (선택)</label>
              <input id="early-dismissal-time" type="time" value={form.dismissalTime} onChange={(event) => setForm({ ...form, dismissalTime: event.target.value })} />
            </div>
          )}
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
          {asksReturn && (
            <div>
              <label>당일 복귀</label>
              <label className="switch-line" htmlFor="early-dismissal-return">
                <input id="early-dismissal-return" type="checkbox" checked={form.returnsSameDay} onChange={(event) => setForm({ ...form, returnsSameDay: event.target.checked })} />
                <span>조퇴 후 같은 날 학교로 돌아옵니다</span>
              </label>
            </div>
          )}
        </div>
        <label htmlFor="early-dismissal-reason">{typeLabel} 사유</label>
        <textarea id="early-dismissal-reason" value={form.reason} maxLength={MAX_REASON_LENGTH} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder={`병원 진료, 가정 사정 등 ${withObjectParticle(typeLabel)} 신청하는 사유를 적어주세요.`} required />
        <button className="primary" type="submit" disabled={submitting || !students.length}>{submitting ? "신청 중..." : `${typeLabel} 신청하기`}</button>
        {message && <p className="success-message">{message}</p>}
        {error && <p className="form-error">{error}</p>}
      </form>

      <div className="section-heading"><div><h3>신청 내역</h3></div></div>
      {loading ? <p className="muted">불러오는 중입니다...</p> : null}
      <div className="notice-list">
        {requests.map((request) => (
          <article className={`early-dismissal-row ${highlightId === request.id ? "highlight" : ""}`} key={request.id}>
            <header>
              <span className={`tag request-type-${request.type}`}>{REQUEST_TYPE_LABELS[request.type]}</span>
              <span className={`tag early-dismissal-${request.state}`}>{STATE_LABELS[request.state]}</span>
              <strong>{request.studentName} · {formatDismissalMoment(request.dismissalDate, usesDismissalTime(request.type) ? request.dismissalTime : null)}</strong>
            </header>
            <p className="notice-body">{request.reason}</p>
            <p className="muted">
              홈룸 선생님: {request.homeroomTeacherName}
              {request.attendanceRecordedAt
                ? ` · ${new Date(request.attendanceRecordedAt).toLocaleString("ko-KR")} 출석부에 ${withMeansParticle(REQUEST_TYPE_LABELS[request.type])} 기록됨${request.attendanceRecordedByName ? ` (${request.attendanceRecordedByName})` : ""}`
                : request.state === "submitted"
                  ? " · 선생님들께 알림이 전달되었습니다."
                  : ""}
            </p>
            {request.state === "submitted" && (
              <button type="button" className="secondary" onClick={() => cancel(request)}>신청 취소</button>
            )}
          </article>
        ))}
        {!loading && !requests.length && <div className="empty-state">아직 {REQUEST_TYPES_SUMMARY} 신청 내역이 없습니다.</div>}
      </div>
    </section>
  );
}
