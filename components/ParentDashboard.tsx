"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { formatBytes } from "@/lib/notice-security";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { noticeTypeLabel } from "@/lib/notices";
import ParentAttendanceStats from "@/components/parent/AttendanceStats";
import ParentPointStats from "@/components/parent/PointStats";

const NOTICES_PER_PAGE = 10;

type Student = {
  id: string;
  name: string;
  grade: string;
  homeroom: string | null;
};
type Ack = {
  read_at: string | null;
  confirmed_at: string | null;
  parent_reply: string | null;
  replied_at: string | null;
};
type Attachment = { id: string; original_filename: string; size_bytes: number };
type Notice = {
  id: string;
  type: string;
  title: string;
  body: string;
  custom_type_label: string | null;
  target_scope: string;
  target_grade: string | null;
  requires_confirmation: boolean;
  published_at: string;
  notice_students?: Array<{
    student_id: string;
    students: Student | Student[] | null;
  }>;
  acknowledgements?: Ack[];
  notice_attachments?: Attachment[];
};

export default function ParentDashboard({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const closingNoticeIdRef = useRef<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [selected, setSelected] = useState<Notice | null>(null);
  const [reply, setReply] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [noticePage, setNoticePage] = useState(1);
  const [tab, setTab] = useState<"notices" | "attendance-stats" | "point-stats">("notices");
  const [message, setMessage] = useState("");

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async ({ initial }: { initial: boolean }) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (initial) setLoading(true);
    try {
      const response = await fetch("/api/parent/dashboard", { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "변경사항을 불러오지 못했습니다.");
      if (requestId !== requestIdRef.current) return;
      const nextNotices = (result.notices || []) as Notice[];
      setStudents((result.students || []) as Student[]);
      setNotices(nextNotices);
      setSelected((current) => current ? nextNotices.find((notice) => notice.id === current.id) || null : null);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setMessage("변경사항을 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadDashboard({ initial: true });
    return () => abortRef.current?.abort();
  }, [loadDashboard]);
  useLiveRefresh({
    channelName: `parent-dashboard-events-${userId}`,
    tables: [{ table: "parent_dashboard_events", filter: `parent_id=eq.${userId}` }],
    onRefresh: () => loadDashboard({ initial: false }),
    debounceMs: 150,
    refreshOnSubscribed: true,
    onError: (status) => { if (process.env.NODE_ENV !== "production") console.warn("parent-dashboard-realtime", status); },
  });

  useLiveRefresh({
    channelName: `parent-dashboard-fallback-${userId}`,
    tables: [
      { table: "acknowledgements", filter: `parent_id=eq.${userId}` },
      { table: "parent_students", filter: `parent_id=eq.${userId}` },
    ],
    onRefresh: () => loadDashboard({ initial: false }),
  });

  const unreadCount = useMemo(
    () =>
      notices.filter((notice) => !notice.acknowledgements?.[0]?.read_at).length,
    [notices],
  );

  const filtered = notices.filter((notice) => {
    if (filter === "unread") return !notice.acknowledgements?.[0]?.read_at;
    if (filter === "individual") return notice.target_scope === "student";
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / NOTICES_PER_PAGE));
  const currentPage = Math.min(noticePage, pageCount);
  const pagedNotices = filtered.slice((currentPage - 1) * NOTICES_PER_PAGE, currentPage * NOTICES_PER_PAGE);

  useEffect(() => { setNoticePage(1); }, [filter]);

  function recipientText(notice: Notice) {
    if (notice.target_scope === "school") return "학교 전체";
    if (notice.target_scope === "grade") return `${notice.target_grade} 학년`;
    const names = (notice.notice_students || []).flatMap((link) => {
      const value = link.students;
      if (Array.isArray(value)) return value.map((student) => student.name);
      return value ? [value.name] : [];
    });
    return names.join(", ") || "개별 학생";
  }

  const closeNotice = useCallback(() => {
    const noticeId = selected?.id || searchParams.get("notice");
    if (noticeId) closingNoticeIdRef.current = noticeId;
    setSelected(null);

    if (!searchParams.has("notice")) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("notice");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams, selected?.id]);

  useEffect(() => {
    const id = searchParams.get("notice");
    if (!id || id !== closingNoticeIdRef.current)
      closingNoticeIdRef.current = null;
    if (
      !id ||
      closingNoticeIdRef.current === id ||
      !notices.length ||
      selected?.id === id
    )
      return;
    const notice = notices.find((item) => item.id === id);
    if (notice) {
      setTab("notices");
      void openNotice(notice);
    }
  }, [searchParams, notices, selected?.id]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNotice();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeNotice, selected]);

  async function openNotice(notice: Notice) {
    closingNoticeIdRef.current = null;
    setMessage("");
    setSelected(notice);
    setReply(notice.acknowledgements?.[0]?.parent_reply || "");
    if (!notice.acknowledgements?.[0]?.read_at) {
      const supabase = createClient();
      await supabase
        .from("acknowledgements")
        .upsert(
          {
            notice_id: notice.id,
            parent_id: userId,
            read_at: new Date().toISOString(),
          },
          { onConflict: "notice_id,parent_id" },
        );
      await loadDashboard({ initial: false });
    }
  }

  async function confirmNotice() {
    if (!selected) return;
    const supabase = createClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("acknowledgements")
      .upsert(
        {
          notice_id: selected.id,
          parent_id: userId,
          read_at: now,
          confirmed_at: now,
        },
        { onConflict: "notice_id,parent_id" },
      );
    if (error) {
      setMessage("확인 처리에 실패했습니다.");
      await loadDashboard({ initial: false });
      return;
    }
    closeNotice();
    await loadDashboard({ initial: false });
  }

  async function saveReply() {
    if (!selected || !reply.trim()) return;
    const supabase = createClient();
    const now = new Date().toISOString();
    const { error } = await supabase.from("acknowledgements").upsert(
      {
        notice_id: selected.id,
        parent_id: userId,
        read_at: now,
        parent_reply: reply.trim(),
        replied_at: now,
      },
      { onConflict: "notice_id,parent_id" },
    );
    setMessage(
      error ? "답변 저장에 실패했습니다." : "학교에 답변을 전달했습니다.",
    );
    if (!error) {
      const previous = selected.acknowledgements?.[0];
      setSelected({
        ...selected,
        acknowledgements: [
          {
            read_at: now,
            confirmed_at: previous?.confirmed_at || null,
            parent_reply: reply.trim(),
            replied_at: now,
          },
        ],
      });
    }
    await loadDashboard({ initial: false });
  }

  return (
    <>
      <div className="dashboard-layout parent-dashboard parent-dashboard-layout">
        <aside className="sidebar-card parent-sidebar">
          <p className="eyebrow">MY CHILDREN</p>
          <h2>연결된 학생</h2>
          <div className="student-stack">
            {students.map((student) => (
              <div className="student-chip" key={student.id}>
                <span className="avatar">{student.name.slice(0, 1)}</span>
                <div>
                  <strong>{student.name}</strong>
                  <small>
                    {student.grade}
                    {student.homeroom ? ` · ${student.homeroom}` : ""}
                  </small>
                </div>
              </div>
            ))}
            {!students.length && (
              <p className="muted">연결된 학생이 없습니다.</p>
            )}
          </div>
          <div className="summary-box">
            <strong>{unreadCount}</strong>
            <span>읽지 않은 알림</span>
          </div>
        </aside>

        <main className="parent-main-column">
          <nav className="staff-tabs">
            <button className={tab === "notices" ? "active" : ""} onClick={() => setTab("notices")}>학교 알림</button>
            <button className={tab === "attendance-stats" ? "active" : ""} onClick={() => setTab("attendance-stats")}>출석 통계</button>
            <button className={tab === "point-stats" ? "active" : ""} onClick={() => setTab("point-stats")}>점수 통계</button>
          </nav>

          {tab === "attendance-stats" && <ParentAttendanceStats />}
          {tab === "point-stats" && <ParentPointStats />}

          {tab === "notices" && (
            <section className="content-card parent-notice-card">
              <div className="section-heading parent-notice-heading">
                <div>
                  <p className="eyebrow">NOTIFICATIONS</p>
                  <h2>학교 알림</h2>
                </div>
                <div className="filter-row">
                  {[
                    ["all", "전체"],
                    ["unread", "읽지 않음"],
                    ["individual", "개별 알림"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={filter === value ? "filter active" : "filter"}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <p className="muted">알림을 불러오는 중입니다...</p>
              ) : (
                <>
                  <div className="notice-list">
                    {pagedNotices.map((notice) => {
                      const ack = notice.acknowledgements?.[0];
                      return (
                        <button
                          className={`notice-row ${!ack?.read_at ? "unread" : ""}`}
                          key={notice.id}
                          onClick={() => openNotice(notice)}
                        >
                          <span className={`notice-icon ${notice.type}`}>
                            {notice.type === "warning"
                              ? "!"
                              : notice.type === "urgent"
                                ? "⚑"
                                : notice.type === "praise"
                                  ? "🎉"
                                  : notice.type === "attendance"
                                    ? "🚶"
                                    : "✉"}
                          </span>
                          <span className="notice-main">
                            <span className="notice-meta">
                              <b>{noticeTypeLabel(notice)}</b> ·{" "}
                              {recipientText(notice)}
                            </span>
                            <strong>{notice.title}</strong>
                            <small>
                              {new Date(notice.published_at).toLocaleString(
                                "ko-KR",
                              )}
                            </small>
                          </span>
                          <span className="notice-state">
                            {ack?.confirmed_at
                              ? "확인 완료"
                              : ack?.read_at
                                ? "읽음"
                                : "새 알림"}
                          </span>
                        </button>
                      );
                    })}
                    {!filtered.length && (
                      <div className="empty-state">해당하는 알림이 없습니다.</div>
                    )}
                  </div>
                  {pageCount > 1 && (
                    <div className="filter-row" aria-label="알림 페이지 이동">
                      <button className="secondary" onClick={() => setNoticePage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>이전</button>
                      <span className="pill">{currentPage} / {pageCount}</span>
                      <button className="secondary" onClick={() => setNoticePage((p) => Math.min(pageCount, p + 1))} disabled={currentPage >= pageCount}>다음</button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </main>
      </div>

      {selected && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeNotice();
          }}
        >
          <article
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="parent-notice-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              aria-label="닫기"
              onClick={closeNotice}
            >
              ×
            </button>
            <span className={`tag ${selected.type}`}>
              {noticeTypeLabel(selected)}
            </span>
            <h2 id="parent-notice-title">{selected.title}</h2>
            <p className="modal-meta">
              대상: {recipientText(selected)} ·{" "}
              {new Date(selected.published_at).toLocaleString("ko-KR")}
            </p>
            <div className="notice-body">{selected.body}</div>
            {!!selected.notice_attachments?.length && (
              <div className="attachment-list">
                {selected.notice_attachments.map((att) => (
                  <div className="attachment-item" key={att.id}>
                    <span>
                      📎 {att.original_filename} · {formatBytes(att.size_bytes)}
                    </span>
                    <a
                      className="secondary"
                      href={`/api/attachments/${att.id}`}
                      target="_blank"
                    >
                      미리보기
                    </a>
                    <a
                      className="secondary"
                      href={`/api/attachments/${att.id}?download=1`}
                    >
                      다운로드
                    </a>
                  </div>
                ))}
              </div>
            )}

            {selected.requires_confirmation && (
              <button
                className="primary"
                onClick={confirmNotice}
                disabled={Boolean(selected.acknowledgements?.[0]?.confirmed_at)}
              >
                {selected.acknowledgements?.[0]?.confirmed_at
                  ? "확인 완료됨"
                  : "내용을 확인했습니다"}
              </button>
            )}

            <div className="reply-box">
              <label>학교에 답변하기</label>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="문의사항이나 전달할 내용을 입력하세요."
              />
              <button className="secondary" onClick={saveReply}>
                답변 저장
              </button>
            </div>
            {message && <p className="success-message">{message}</p>}
          </article>
        </div>
      )}
    </>
  );
}
