"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { formatBytes } from "@/lib/notice-security";
import { useSearchParams } from "next/navigation";

type Student = { id: string; name: string; grade: string; homeroom: string | null };
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
  target_scope: string;
  target_grade: string | null;
  requires_confirmation: boolean;
  published_at: string;
  notice_students?: Array<{ student_id: string; students: Student | Student[] | null }>;
  acknowledgements?: Ack[];
  notice_attachments?: Attachment[];
};

const typeLabels: Record<string, string> = {
  newsletter: "가정통신문",
  warning: "학생 경고",
  guidance: "생활지도",
  consultation: "상담 안내",
  urgent: "긴급 공지",
};

export default function ParentDashboard({ userId }: { userId: string }) {
  const searchParams = useSearchParams();
  const [students, setStudents] = useState<Student[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [selected, setSelected] = useState<Notice | null>(null);
  const [reply, setReply] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [warningRows, setWarningRows] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const [{ data: links }, { data: noticeRows, error }] = await Promise.all([
      supabase.from("parent_students").select("students(id,name,grade,homeroom)").eq("parent_id", userId),
      supabase
        .from("notices")
        .select(`
          id,type,title,body,target_scope,target_grade,requires_confirmation,published_at,
          notice_students(student_id,students(id,name,grade,homeroom)),
          notice_attachments(id,original_filename,size_bytes),
          acknowledgements(read_at,confirmed_at,parent_reply,replied_at)
        `)
        .order("published_at", { ascending: false }),
    ]);

    const studentRows = (links || []).flatMap((row: any) => {
      if (Array.isArray(row.students)) return row.students;
      return row.students ? [row.students] : [];
    });
    setStudents(studentRows as Student[]);
    const warningResult = await supabase.from("warning_entries").select("student_id,warning_date,entry_type,delta,parent_visible_reason,created_at,students(name,grade)").order("created_at", { ascending: false }).limit(50);
    if (!warningResult.error) setWarningRows(warningResult.data || []);
    if (!error) {
      const nextNotices = (noticeRows || []) as unknown as Notice[];
      setNotices(nextNotices);
      setSelected((current) => current ? nextNotices.find((notice) => notice.id === current.id) || null : null);
    } else {
      setMessage("변경사항을 불러오지 못했습니다. 다시 시도해 주세요.");
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh({
    channelName: `parent-dashboard-${userId}`,
    tables: [
      { table: "notices" },
      { table: "notice_students" },
      { table: "notice_attachments" },
      { table: "acknowledgements", filter: `parent_id=eq.${userId}` },
      { table: "parent_students", filter: `parent_id=eq.${userId}` },
      { table: "students" },
      { table: "warning_entries" },
    ],
    onRefresh: load,
  });
  useEffect(() => { const id = searchParams.get("notice"); if (id && notices.length && !selected) { const n = notices.find((notice) => notice.id === id); if (n) void openNotice(n); } }, [searchParams, notices, selected]);

  const unreadCount = useMemo(
    () => notices.filter((notice) => !notice.acknowledgements?.[0]?.read_at).length,
    [notices],
  );

  const filtered = notices.filter((notice) => {
    if (filter === "unread") return !notice.acknowledgements?.[0]?.read_at;
    if (filter === "individual") return notice.target_scope === "student";
    return true;
  });

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

  async function openNotice(notice: Notice) {
    setMessage("");
    setSelected(notice);
    setReply(notice.acknowledgements?.[0]?.parent_reply || "");
    if (!notice.acknowledgements?.[0]?.read_at) {
      const supabase = createClient();
      await supabase.from("acknowledgements").upsert(
        { notice_id: notice.id, parent_id: userId, read_at: new Date().toISOString() },
        { onConflict: "notice_id,parent_id" },
      );
      await load();
    }
  }

  async function confirmNotice() {
    if (!selected) return;
    const supabase = createClient();
    const now = new Date().toISOString();
    const { error } = await supabase.from("acknowledgements").upsert(
      { notice_id: selected.id, parent_id: userId, read_at: now, confirmed_at: now },
      { onConflict: "notice_id,parent_id" },
    );
    setMessage(error ? "확인 처리에 실패했습니다." : "확인 완료로 기록되었습니다.");
    if (!error) {
      const previous = selected.acknowledgements?.[0];
      setSelected({ ...selected, acknowledgements: [{ read_at: now, confirmed_at: now, parent_reply: previous?.parent_reply || null, replied_at: previous?.replied_at || null }] });
    }
    await load();
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
    setMessage(error ? "답변 저장에 실패했습니다." : "학교에 답변을 전달했습니다.");
    if (!error) {
      const previous = selected.acknowledgements?.[0];
      setSelected({ ...selected, acknowledgements: [{ read_at: now, confirmed_at: previous?.confirmed_at || null, parent_reply: reply.trim(), replied_at: now }] });
    }
    await load();
  }

  return (
    <div className="dashboard-layout">
      <aside className="sidebar-card">
        <p className="eyebrow">MY CHILDREN</p>
        <h2>연결된 학생</h2>
        <div className="student-stack">
          {students.map((student) => (
            <div className="student-chip" key={student.id}>
              <span className="avatar">{student.name.slice(0, 1)}</span>
              <div><strong>{student.name}</strong><small>{student.grade}{student.homeroom ? ` · ${student.homeroom}` : ""}</small></div>
            </div>
          ))}
          {!students.length && <p className="muted">연결된 학생이 없습니다.</p>}
        </div>
        <div className="summary-box"><strong>{unreadCount}</strong><span>읽지 않은 알림</span></div>
      </aside>

      <section className="content-card parent-warning-card"><div className="section-heading"><div><p className="eyebrow">WARNING STATUS</p><h2>경고 현황</h2></div></div><div className="sent-list">{warningRows.length ? warningRows.map((w:any)=><article className="sent-card" key={w.id || `${w.student_id}-${w.created_at}`}><span className="tag warning">경고</span><h3>{w.entry_type === "grace_adjustment" ? "은혜의 희월" : w.warning_date}</h3><p>{new Date(w.created_at).toLocaleString("ko-KR")}</p>{w.parent_visible_reason && <p className="sent-preview">{w.parent_visible_reason}</p>}</article>) : <p className="muted">표시할 경고 내역이 없습니다.</p>}</div></section>

      <section className="content-card">
        <div className="section-heading">
          <div><p className="eyebrow">NOTIFICATIONS</p><h2>학교 알림</h2></div>
          <div className="filter-row">
            {[["all","전체"],["unread","읽지 않음"],["individual","개별 알림"]].map(([value,label]) => (
              <button key={value} className={filter === value ? "filter active" : "filter"} onClick={() => setFilter(value)}>{label}</button>
            ))}
          </div>
        </div>

        {loading ? <p className="muted">알림을 불러오는 중입니다...</p> : (
          <div className="notice-list">
            {filtered.map((notice) => {
              const ack = notice.acknowledgements?.[0];
              return (
                <button className={`notice-row ${!ack?.read_at ? "unread" : ""}`} key={notice.id} onClick={() => openNotice(notice)}>
                  <span className={`notice-icon ${notice.type}`}>{notice.type === "warning" ? "!" : notice.type === "urgent" ? "⚑" : "✉"}</span>
                  <span className="notice-main">
                    <span className="notice-meta"><b>{typeLabels[notice.type] || notice.type}</b> · {recipientText(notice)}</span>
                    <strong>{notice.title}</strong>
                    <small>{new Date(notice.published_at).toLocaleString("ko-KR")}</small>
                  </span>
                  <span className="notice-state">{ack?.confirmed_at ? "확인 완료" : ack?.read_at ? "읽음" : "새 알림"}</span>
                </button>
              );
            })}
            {!filtered.length && <div className="empty-state">해당하는 알림이 없습니다.</div>}
          </div>
        )}
      </section>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <article className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>×</button>
            <span className={`tag ${selected.type}`}>{typeLabels[selected.type] || selected.type}</span>
            <h2>{selected.title}</h2>
            <p className="modal-meta">대상: {recipientText(selected)} · {new Date(selected.published_at).toLocaleString("ko-KR")}</p>
            <div className="notice-body">{selected.body}</div>
            {!!selected.notice_attachments?.length && <div className="attachment-list">{selected.notice_attachments.map((att) => <div className="attachment-item" key={att.id}><span>📎 {att.original_filename} · {formatBytes(att.size_bytes)}</span><a className="secondary" href={`/api/attachments/${att.id}`} target="_blank">미리보기</a><a className="secondary" href={`/api/attachments/${att.id}?download=1`}>다운로드</a></div>)}</div>}

            {selected.requires_confirmation && (
              <button className="primary" onClick={confirmNotice} disabled={Boolean(selected.acknowledgements?.[0]?.confirmed_at)}>
                {selected.acknowledgements?.[0]?.confirmed_at ? "확인 완료됨" : "내용을 확인했습니다"}
              </button>
            )}

            <div className="reply-box">
              <label>학교에 답변하기</label>
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="문의사항이나 전달할 내용을 입력하세요." />
              <button className="secondary" onClick={saveReply}>답변 저장</button>
            </div>
            {message && <p className="success-message">{message}</p>}
          </article>
        </div>
      )}
    </div>
  );
}
