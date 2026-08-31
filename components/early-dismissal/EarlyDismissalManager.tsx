"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { formatDismissalMoment } from "@/lib/early-dismissal/format";
import { compareGrades } from "@/lib/grade-sort";
import { REQUEST_TYPES_SUMMARY, REQUEST_TYPE_LABELS, STATE_LABELS, usesDismissalTime, usesReturnsSameDay, type EarlyDismissalRequest } from "@/lib/early-dismissal/types";

type Filter = "open" | "unrecorded" | "all";

export default function EarlyDismissalManager({ userId }: { userId: string }) {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("request");
  const [requests, setRequests] = useState<EarlyDismissalRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
  useLiveRefresh({
    channelName: `staff-early-dismissal-${userId}`,
    tables: [{ table: "early_dismissal_requests" }],
    onRefresh: () => { void load(); },
  });

  const visible = useMemo(() => {
    const rows = requests.filter((request) => {
      if (filter === "open") return request.state !== "cancelled";
      if (filter === "unrecorded") return request.state === "submitted";
      return true;
    });
    return [...rows].sort((a, b) => b.dismissalDate.localeCompare(a.dismissalDate) || compareGrades(a.studentGrade, b.studentGrade) || a.studentName.localeCompare(b.studentName));
  }, [requests, filter]);

  const unrecordedCount = useMemo(() => requests.filter((request) => request.state === "submitted").length, [requests]);

  async function act(request: EarlyDismissalRequest, payload: Record<string, unknown>) {
    setMessage("");
    setError("");
    setBusyId(request.id);
    try {
      const response = await fetch(`/api/early-dismissal/${encodeURIComponent(request.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "처리에 실패했습니다.");
      setMessage(result.message || "처리했습니다.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "처리에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  function acknowledgedByMe(request: EarlyDismissalRequest) {
    return request.acknowledgedBy.some((entry) => entry.id === userId);
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ATTENDANCE REQUESTS</p>
          <h2>{REQUEST_TYPES_SUMMARY} 신청</h2>
          <p className="muted">학부모가 제출한 {REQUEST_TYPES_SUMMARY} 신청입니다. 별도의 승인 절차는 없고, 제출 즉시 모든 선생님께 알림이 갑니다. 내용을 확인한 뒤 신청한 종류대로 출석부에 기록해 주세요.</p>
        </div>
        <span className="pill">출석부 미기록 {unrecordedCount}건</span>
      </div>

      <div className="filter-row">
        {([["open", "진행 중"], ["unrecorded", "출석부 미기록"], ["all", "전체"]] as Array<[Filter, string]>).map(([value, label]) => (
          <button key={value} type="button" className={filter === value ? "filter active" : "filter"} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      {message && <p className="success-message">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">불러오는 중입니다...</p>}

      <div className="notice-list">
        {visible.map((request) => {
          const busy = busyId === request.id;
          return (
            <article className={`early-dismissal-row ${highlightId === request.id ? "highlight" : ""}`} key={request.id}>
              <header>
                <span className={`tag request-type-${request.type}`}>{REQUEST_TYPE_LABELS[request.type]}</span>
                <span className={`tag early-dismissal-${request.state}`}>{STATE_LABELS[request.state]}</span>
                <strong>{request.studentGrade} {request.studentName} · {formatDismissalMoment(request.dismissalDate, usesDismissalTime(request.type) ? request.dismissalTime : null)}</strong>
              </header>
              <p className="muted">신청: {request.parentName} · {new Date(request.createdAt).toLocaleString("ko-KR")} · 홈룸 {request.homeroomTeacherName}</p>
              <p className="notice-body">{request.reason}</p>
              <p className="muted">
                {request.guardianName ? `인솔자 ${request.guardianName}` : "인솔자 미기재"}
                {request.guardianContact ? ` · ${request.guardianContact}` : ""}
                {usesReturnsSameDay(request.type) && request.returnsSameDay ? " · 당일 복귀 예정" : ""}
              </p>

              {request.attendanceRecordedAt && (
                <p className="muted">출석부 기록: {new Date(request.attendanceRecordedAt).toLocaleString("ko-KR")}{request.attendanceRecordedByName ? ` · ${request.attendanceRecordedByName}` : ""}</p>
              )}
              {!!request.acknowledgedBy.length && (
                <p className="muted">확인: {request.acknowledgedBy.map((entry) => entry.name).join(", ")}</p>
              )}

              <div className="early-dismissal-actions">
                <button type="button" className="secondary" disabled={busy || acknowledgedByMe(request)} onClick={() => act(request, { action: "acknowledge" })}>
                  {acknowledgedByMe(request) ? "확인함" : "확인"}
                </button>
                {request.state === "submitted" && (
                  <button type="button" className="primary" disabled={busy} onClick={() => act(request, { action: "record" })}>출석부에 {REQUEST_TYPE_LABELS[request.type]} 기록</button>
                )}
                {request.state === "recorded" && (
                  <button type="button" className="danger-outline-button" disabled={busy} onClick={() => act(request, { action: "unrecord" })}>기록 취소</button>
                )}
              </div>
            </article>
          );
        })}
        {!loading && !visible.length && <div className="empty-state">해당하는 신청이 없습니다.</div>}
      </div>
    </section>
  );
}
