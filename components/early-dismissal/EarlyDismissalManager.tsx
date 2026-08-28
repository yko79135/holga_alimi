"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { formatDismissalMoment } from "@/lib/early-dismissal/format";
import { compareGrades } from "@/lib/grade-sort";
import { APPROVER_ROLE_LABELS, DECISION_LABELS, MAX_COMMENT_LENGTH, STATUS_LABELS, type EarlyDismissalRequest, type EarlyDismissalStatus } from "@/lib/early-dismissal/types";

type Filter = "pending" | "mine" | "all";

export default function EarlyDismissalManager({ userId }: { userId: string }) {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("request");
  const [requests, setRequests] = useState<EarlyDismissalRequest[]>([]);
  const [approvableIds, setApprovableIds] = useState<string[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/early-dismissal", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "조퇴 신청 목록을 불러오지 못했습니다.");
      setRequests(result.requests || []);
      setApprovableIds(result.approvableIds || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "조퇴 신청 목록을 불러오지 못했습니다.");
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

  const approvable = useMemo(() => new Set(approvableIds), [approvableIds]);
  const visible = useMemo(() => {
    const rows = requests.filter((request) => {
      if (filter === "pending") return request.status === "pending";
      if (filter === "mine") return approvable.has(request.id) && request.status === "pending";
      return true;
    });
    return [...rows].sort((a, b) => b.dismissalDate.localeCompare(a.dismissalDate) || compareGrades(a.studentGrade, b.studentGrade) || a.studentName.localeCompare(b.studentName));
  }, [requests, filter, approvable]);

  const pendingForMe = useMemo(() => requests.filter((request) => request.status === "pending" && approvable.has(request.id)).length, [requests, approvable]);

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
      setComments((current) => ({ ...current, [request.id]: "" }));
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

  function statusTag(status: EarlyDismissalStatus) {
    return <span className={`tag early-dismissal-${status}`}>{STATUS_LABELS[status]}</span>;
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">EARLY DISMISSAL</p>
          <h2>조퇴 신청 결재</h2>
          <p className="muted">학부모가 제출한 조퇴 신청입니다. 홈룸 선생님과 교감 선생님이 모두 승인해야 확정되며, 다른 선생님은 내용을 확인할 수 있습니다.</p>
        </div>
        <span className="pill">내 결재 대기 {pendingForMe}건</span>
      </div>

      <div className="filter-row">
        {([["pending", "승인 대기"], ["mine", "내 결재"], ["all", "전체"]] as Array<[Filter, string]>).map(([value, label]) => (
          <button key={value} type="button" className={filter === value ? "filter active" : "filter"} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>

      {message && <p className="success-message">{message}</p>}
      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">불러오는 중입니다...</p>}

      <div className="notice-list">
        {visible.map((request) => {
          const canDecide = approvable.has(request.id);
          const busy = busyId === request.id;
          return (
            <article className={`early-dismissal-row ${highlightId === request.id ? "highlight" : ""}`} key={request.id}>
              <header>
                {statusTag(request.status)}
                <strong>{request.studentGrade} {request.studentName} · {formatDismissalMoment(request.dismissalDate, request.dismissalTime)}</strong>
              </header>
              <p className="muted">신청: {request.parentName} · {new Date(request.createdAt).toLocaleString("ko-KR")}</p>
              <p className="notice-body">{request.reason}</p>
              <p className="muted">
                {request.guardianName ? `인솔자 ${request.guardianName}` : "인솔자 미기재"}
                {request.guardianContact ? ` · ${request.guardianContact}` : ""}
                {request.returnsSameDay ? " · 당일 복귀 예정" : ""}
              </p>

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

              {!!request.acknowledgedBy.length && (
                <p className="muted">확인: {request.acknowledgedBy.map((entry) => entry.name).join(", ")}</p>
              )}

              <div className="early-dismissal-actions">
                <button type="button" className="secondary" disabled={busy || acknowledgedByMe(request)} onClick={() => act(request, { action: "acknowledge" })}>
                  {acknowledgedByMe(request) ? "확인함" : "확인"}
                </button>
                {canDecide && request.status !== "cancelled" && (
                  <>
                    <input
                      value={comments[request.id] || ""}
                      maxLength={MAX_COMMENT_LENGTH}
                      placeholder="결재 의견 (선택)"
                      onChange={(event) => setComments((current) => ({ ...current, [request.id]: event.target.value }))}
                    />
                    <button type="button" className="primary" disabled={busy} onClick={() => act(request, { action: "decide", decision: "approved", comment: comments[request.id] || "" })}>승인</button>
                    <button type="button" className="danger-outline-button" disabled={busy} onClick={() => act(request, { action: "decide", decision: "rejected", comment: comments[request.id] || "" })}>반려</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
        {!loading && !visible.length && <div className="empty-state">해당하는 조퇴 신청이 없습니다.</div>}
      </div>
    </section>
  );
}
