"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AdminPanel from "@/components/AdminPanel";
import { formatBytes, MAX_NOTICE_ATTACHMENTS } from "@/lib/notice-security";

type Student = { id: string; name: string; grade: string; homeroom: string | null; active: boolean };
type Profile = { id: string; full_name: string; email: string; role: string };
type Notice = {
  id: string; type: string; title: string; body: string; target_scope: string; target_grade: string | null;
  requires_confirmation: boolean; published_at: string;
  notice_students?: Array<{ students: { name: string; grade: string } | Array<{ name: string; grade: string }> | null }>;
  acknowledgements?: Array<{ read_at: string | null; confirmed_at: string | null; parent_reply: string | null; profiles?: { full_name: string } | null }>;
  notice_attachments?: Attachment[];
};

type Attachment = { id: string; original_filename: string; size_bytes: number };

const typeLabels: Record<string, string> = { newsletter:"가정통신문", warning:"학생 경고", guidance:"생활지도", consultation:"상담 안내", urgent:"긴급 공지" };

export default function StaffDashboard({ userId, role }: { userId: string; role: string }) {
  const [tab, setTab] = useState("compose");
  const [students, setStudents] = useState<Student[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [studentGrade, setStudentGrade] = useState("");
  const [homeroom, setHomeroom] = useState("");

  const [form, setForm] = useState({
    type:"newsletter", title:"", body:"", targetScope:"school", targetGrade:"", studentId:"", requiresConfirmation:false,
  });

  const load = useCallback(async () => {
    const supabase = createClient();
    const [studentResult, noticeResult, profileResult] = await Promise.all([
      supabase.from("students").select("id,name,grade,homeroom,active").order("grade").order("name"),
      supabase.from("notices").select(`id,type,title,body,target_scope,target_grade,requires_confirmation,published_at,notice_attachments(id,original_filename,size_bytes),notice_students(students(name,grade)),acknowledgements(read_at,confirmed_at,parent_reply,profiles(full_name))`).order("published_at", { ascending:false }),
      supabase.from("profiles").select("id,full_name,email,role").order("created_at", { ascending:false }),
    ]);
    setStudents(studentResult.data || []);
    setNotices((noticeResult.data || []) as unknown as Notice[]);
    setProfiles(profileResult.data || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grades = useMemo(() => Array.from(new Set(students.map((student) => student.grade))).sort(), [students]);
  const confirmedTotal = notices.reduce((sum, notice) => sum + (notice.acknowledgements || []).filter((ack) => ack.confirmed_at).length, 0);
  const replyTotal = notices.reduce((sum, notice) => sum + (notice.acknowledgements || []).filter((ack) => ack.parent_reply).length, 0);

  async function sendNotice(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");
    if (form.targetScope === "grade" && !form.targetGrade) return setErrorMessage("대상 학년을 선택해주세요.");
    if (form.targetScope === "student" && !form.studentId) return setErrorMessage("대상 학생을 선택해주세요.");
    if (files.length > MAX_NOTICE_ATTACHMENTS) return setErrorMessage("PDF는 최대 5개까지 첨부할 수 있습니다.");
    setLoading(true);
    try {
      const attachments = [];
      for (const file of files) {
        if (file.type !== "application/pdf" || !/\.pdf$/i.test(file.name) || file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: PDF(20MB 이하)만 첨부할 수 있습니다.`);
        const prep = await fetch("/api/attachments/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }) });
        const signed = await prep.json();
        if (!prep.ok) throw new Error(signed.error || "첨부 업로드 준비에 실패했습니다.");
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage.from("notice-attachments").uploadToSignedUrl(signed.path, signed.token, file, { contentType: "application/pdf", upsert: false });
        if (uploadError) throw new Error(`${file.name}: 업로드에 실패했습니다.`);
        attachments.push({ storagePath: signed.path, originalFilename: signed.originalFilename, mimeType: file.type, sizeBytes: file.size });
      }
      const res = await fetch("/api/notices/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, attachments }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "게시 중 오류가 발생했습니다.");
      setForm({ type:"newsletter", title:"", body:"", targetScope:"school", targetGrade:"", studentId:"", requiresConfirmation:false });
      setFiles([]);
      setMessage(`${result.message} 앱 알림 ${result.push?.sent || 0}건 전송 · 알림 미등록 사용자 ${result.push?.unsubscribed || 0}명 · 실패 ${result.push?.failed || 0}건`);
      await load();
      setTab("notices");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "알림 발송에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function addStudent(event: FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.from("students").insert({ name:studentName.trim(), grade:studentGrade.trim(), homeroom:homeroom.trim() || null });
    setMessage(error ? error.message : "학생을 추가했습니다.");
    if (!error) { setStudentName(""); setStudentGrade(""); setHomeroom(""); await load(); }
  }

  function targetText(notice: Notice) {
    if (notice.target_scope === "school") return "학교 전체";
    if (notice.target_scope === "grade") return notice.target_grade || "학년";
    const names = (notice.notice_students || []).flatMap((link) => Array.isArray(link.students) ? link.students.map((s) => s.name) : link.students ? [link.students.name] : []);
    return names.join(", ") || "개별 학생";
  }

  return (
    <div className="staff-wrap">
      <nav className="staff-tabs">
        <button className={tab === "compose" ? "active" : ""} onClick={() => setTab("compose")}>알림 작성</button>
        <button className={tab === "notices" ? "active" : ""} onClick={() => setTab("notices")}>발송 기록</button>
        <button className={tab === "students" ? "active" : ""} onClick={() => setTab("students")}>학생 관리</button>
        {role === "admin" && <button className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>계정 관리</button>}
      </nav>

      <div className="stats-row">
        <div className="stat-card"><span>등록 학생</span><strong>{students.length}</strong></div>
        <div className="stat-card"><span>발송 알림</span><strong>{notices.length}</strong></div>
        <div className="stat-card"><span>학부모 계정</span><strong>{profiles.filter((p) => p.role === "parent").length}</strong></div>
        <div className="stat-card"><span>학부모 답변</span><strong>{replyTotal}</strong></div>
      </div>

      {tab === "compose" && (
        <form className="form-panel large" onSubmit={sendNotice}>
          <div className="section-heading"><div><p className="eyebrow">NEW MESSAGE</p><h2>학부모 알림 작성</h2></div></div>
          <div className="three-columns">
            <div><label>알림 종류</label><select value={form.type} onChange={(e) => setForm({...form,type:e.target.value})}>{Object.entries(typeLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div><label>발송 범위</label><select value={form.targetScope} onChange={(e) => setForm({...form,targetScope:e.target.value})}><option value="school">학교 전체</option><option value="grade">특정 학년</option><option value="student">특정 학생</option></select></div>
            <div>
              <label>세부 대상</label>
              {form.targetScope === "school" && <input value="모든 학부모" disabled />}
              {form.targetScope === "grade" && <select value={form.targetGrade} onChange={(e) => setForm({...form,targetGrade:e.target.value})}><option value="">학년 선택</option>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select>}
              {form.targetScope === "student" && <select value={form.studentId} onChange={(e) => setForm({...form,studentId:e.target.value})}><option value="">학생 선택</option>{students.map((student) => <option key={student.id} value={student.id}>{student.grade} · {student.name}</option>)}</select>}
            </div>
          </div>
          <label>제목</label><input value={form.title} onChange={(e) => setForm({...form,title:e.target.value})} required placeholder="예: 수업 태도 관련 생활지도 안내" />
          <label>내용</label><textarea className="tall" value={form.body} onChange={(e) => setForm({...form,body:e.target.value})} required placeholder="학부모에게 전달할 내용을 작성하세요." />

          <label>PDF 첨부 (최대 5개, 각 20MB 이하)</label><input type="file" accept="application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, MAX_NOTICE_ATTACHMENTS))} />
          {files.length > 0 && <div className="attachment-list">{files.map((file, index) => <div className="attachment-item" key={`${file.name}-${index}`}><span>📎 {file.name} · {formatBytes(file.size)}</span><button type="button" className="secondary" onClick={() => setFiles(files.filter((_, i) => i !== index))}>삭제</button></div>)}</div>}
          <label className="switch-line"><input type="checkbox" checked={form.requiresConfirmation} onChange={(e) => setForm({...form,requiresConfirmation:e.target.checked})} /><span>학부모의 ‘확인 완료’ 응답을 요청합니다.</span></label>
          <button className="primary" disabled={loading}>{loading ? "발송 중..." : "알림 발송"}</button>
          {message && <p role="status" className="success-message">{message}</p>}
          {errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}
        </form>
      )}

      {tab === "notices" && (
        <section className="content-card">
          <div className="section-heading"><div><p className="eyebrow">SENT MESSAGES</p><h2>발송 및 응답 기록</h2></div><span className="pill">확인 완료 {confirmedTotal}건</span></div>
          <div className="sent-list">
            {notices.map((notice) => {
              const replies = (notice.acknowledgements || []).filter((ack) => ack.parent_reply);
              return <article className="sent-card" key={notice.id}>
                <div className="sent-top"><div><span className={`tag ${notice.type}`}>{typeLabels[notice.type]}</span><h3>{notice.title}</h3><p>{targetText(notice)} · {new Date(notice.published_at).toLocaleString("ko-KR")}</p></div><div className="ack-summary"><b>{(notice.acknowledgements || []).filter((a) => a.confirmed_at).length}</b><span>확인 완료</span></div></div>
                <p className="sent-preview">{notice.body}</p>
                {!!notice.notice_attachments?.length && <div className="attachment-list">{notice.notice_attachments.map((att) => <div className="attachment-item" key={att.id}><span>📎 {att.original_filename} · {formatBytes(att.size_bytes)}</span><a className="secondary" href={`/api/attachments/${att.id}`} target="_blank">미리보기</a><a className="secondary" href={`/api/attachments/${att.id}?download=1`}>다운로드</a></div>)}</div>}
                {replies.length > 0 && <div className="reply-log"><strong>학부모 답변</strong>{replies.map((ack,index) => <p key={index}>“{ack.parent_reply}”</p>)}</div>}
              </article>;
            })}
            {!notices.length && <div className="empty-state">아직 발송한 알림이 없습니다.</div>}
          </div>
        </section>
      )}

      {tab === "students" && (
        <section className="panel-grid">
          <form className="form-panel" onSubmit={addStudent}>
            <p className="eyebrow">STUDENT DIRECTORY</p><h2>학생 추가</h2>
            <label>학생 이름</label><input value={studentName} onChange={(e) => setStudentName(e.target.value)} required />
            <div className="two-columns"><div><label>학년</label><input value={studentGrade} onChange={(e) => setStudentGrade(e.target.value)} placeholder="G7E" required /></div><div><label>반</label><input value={homeroom} onChange={(e) => setHomeroom(e.target.value)} /></div></div>
            <button className="primary">학생 저장</button>{message && <p className="success-message">{message}</p>}
          </form>
          <div className="content-card"><h2>학생 목록</h2><div className="directory-list">{students.map((student) => <div key={student.id}><span className="avatar">{student.name[0]}</span><p><b>{student.name}</b><small>{student.grade}{student.homeroom ? ` · ${student.homeroom}` : ""}</small></p></div>)}</div></div>
        </section>
      )}

      {tab === "accounts" && role === "admin" && <AdminPanel userId={userId} onChanged={load} />}
    </div>
  );
}
