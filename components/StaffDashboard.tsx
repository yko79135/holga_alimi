"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import AdminPanel from "@/components/AdminPanel";
import WarningManager from "@/components/warnings/WarningManager";
import { formatBytes, MAX_NOTICE_ATTACHMENTS } from "@/lib/notice-security";

type Student = { id: string; name: string; grade: string; homeroom: string | null; active: boolean };
type ParentLink = { parentId: string; fullName: string; email: string; linkedStudents: Array<{ id: string; name: string; grade: string }> };
type Profile = { id: string; full_name: string; email: string; role: string };
type Notice = {
  id: string; type: string; title: string; body: string; target_scope: string; target_grade: string | null;
  requires_confirmation: boolean; published_at: string;
  notice_students?: Array<{ students: { name: string; grade: string } | Array<{ name: string; grade: string }> | null }>;
  acknowledgements?: Array<{ read_at: string | null; confirmed_at: string | null; parent_reply: string | null; profiles?: { full_name: string } | null }>;
  notice_attachments?: Attachment[];
};

type Attachment = { id: string; original_filename: string; size_bytes: number };
type Feedback = { type: "success" | "error"; text: string };
type StudentPreview = { name: string; grade: string; parentLinkCount: number; individualNoticeCount: number };

const typeLabels: Record<string, string> = { newsletter:"가정통신문", warning:"학생 경고", guidance:"생활지도", consultation:"상담 안내", urgent:"긴급 공지" };

export default function StaffDashboard({ userId, role }: { userId: string; role: string }) {
  const [tab, setTab] = useState("compose");
  const [students, setStudents] = useState<Student[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeDeleteTarget, setNoticeDeleteTarget] = useState<Notice | null>(null);
  const [studentDeleteTarget, setStudentDeleteTarget] = useState<Student | null>(null);
  const [studentPreview, setStudentPreview] = useState<StudentPreview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState<Feedback | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [studentGrade, setStudentGrade] = useState("");
  const [studentParentId, setStudentParentId] = useState("");
  const [parentLinks, setParentLinks] = useState<Record<string, ParentLink[]>>({});
  const [parentSearch, setParentSearch] = useState<Record<string, string>>({});
  const [expandedLinkPanel, setExpandedLinkPanel] = useState<Record<string, boolean>>({});
  const [linkingStudentId, setLinkingStudentId] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentGradeFilter, setStudentGradeFilter] = useState("");
  const [parentStatusFilter, setParentStatusFilter] = useState("all");
  const [activeStatusFilter, setActiveStatusFilter] = useState("active");
  const [expandedGrades, setExpandedGrades] = useState<Record<string, boolean>>({});
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [studentFormOpen, setStudentFormOpen] = useState(false);

  const [form, setForm] = useState({
    type:"newsletter", title:"", body:"", targetScope:"school", targetGrade:"", studentId:"", requiresConfirmation:false,
  });

  const sortStudents = (items: Student[]) => [...items].sort((a, b) => a.grade.localeCompare(b.grade) || a.name.localeCompare(b.name));

  const loadStudents = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("students").select("id,name,grade,homeroom,active").order("grade").order("name");
    setStudents((data || []) as Student[]);
  }, []);

  const loadNotices = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("notices").select(`id,type,title,body,target_scope,target_grade,requires_confirmation,published_at,notice_attachments(id,original_filename,size_bytes),notice_students(students(name,grade)),acknowledgements(read_at,confirmed_at,parent_reply,profiles(full_name))`).order("published_at", { ascending:false });
    setNotices((data || []) as unknown as Notice[]);
  }, []);

  const loadProfiles = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("profiles").select("id,full_name,email,role").order("created_at", { ascending:false });
    setProfiles(data || []);
  }, []);

  const loadParentLinks = useCallback(async () => {
    if (role !== "admin") return;
    const supabase = createClient();
    const { data: links } = await supabase.from("parent_students").select("student_id,parent_id,profiles(id,full_name,email),students(id,name,grade)");
    const grouped: Record<string, ParentLink[]> = {};
    ((links || []) as any[]).forEach((link) => {
      const parent = Array.isArray(link.profiles) ? link.profiles[0] : link.profiles;
      const student = Array.isArray(link.students) ? link.students[0] : link.students;
      if (!parent || !link.student_id) return;
      grouped[link.student_id] = [...(grouped[link.student_id] || []), { parentId: link.parent_id, fullName: parent.full_name || "", email: parent.email || "", linkedStudents: student ? [student] : [] }];
    });
    setParentLinks(grouped);
  }, [role]);

  const load = useCallback(async () => {
    await Promise.all([loadStudents(), loadNotices(), loadProfiles(), loadParentLinks()]);
  }, [loadStudents, loadNotices, loadProfiles, loadParentLinks]);

  useEffect(() => { void loadStudents(); }, [loadStudents]);
  useEffect(() => { if (tab === "compose") void loadStudents(); }, [tab, loadStudents]);
  useEffect(() => { if (tab === "notices") void loadNotices(); }, [tab, loadNotices]);
  useEffect(() => { if (tab === "students") { void loadStudents(); void loadProfiles(); void loadParentLinks(); } }, [tab, loadStudents, loadProfiles, loadParentLinks]);
  useLiveRefresh({
    channelName: `staff-dashboard-${userId}-${role}`,
    tables: [
      { table: "notices" },
      { table: "notice_students" },
      { table: "notice_attachments" },
      { table: "acknowledgements" },
      { table: "students" },
      { table: "parent_students" },
      { table: "profiles" },
    ],
    onRefresh: () => { void load(); },
  });

  const loadStudentParents = useCallback(async (studentId: string) => {
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/parents`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학부모 연결 정보를 불러오지 못했습니다.");
      setParentLinks((current) => ({ ...current, [studentId]: result.linkedParents || [] }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "변경사항을 불러오지 못했습니다. 다시 시도해 주세요.");
    }
  }, []);

  const parentProfiles = useMemo(() => profiles.filter((profile) => profile.role === "parent"), [profiles]);

  const filteredStudents = useMemo(() => {
    const term = studentSearch.trim().toLowerCase();
    return students.filter((student) => {
      const linked = parentLinks[student.id] || [];
      const haystack = `${student.name} ${student.grade} ${linked.map((p) => `${p.fullName} ${p.email}`).join(" ")}`.toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (studentGradeFilter && student.grade !== studentGradeFilter) return false;
      if (parentStatusFilter === "linked" && linked.length === 0) return false;
      if (parentStatusFilter === "unlinked" && linked.length > 0) return false;
      if (activeStatusFilter === "active" && !student.active) return false;
      if (activeStatusFilter === "inactive" && student.active) return false;
      return true;
    });
  }, [students, parentLinks, studentSearch, studentGradeFilter, parentStatusFilter, activeStatusFilter]);

  const groupedStudents = useMemo(() => filteredStudents.reduce<Record<string, Student[]>>((groups, student) => { (groups[student.grade] ||= []).push(student); return groups; }, {}), [filteredStudents]);

  useEffect(() => { if (studentGradeFilter) setExpandedGrades((current) => ({ ...current, [studentGradeFilter]: true })); }, [studentGradeFilter]);
  useEffect(() => { if (studentSearch.trim()) setExpandedGrades((current) => Object.fromEntries(Object.keys(groupedStudents).map((g) => [g, true]))); }, [studentSearch, groupedStudents]);

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
    const start = process.env.NODE_ENV !== "production" ? performance.now() : 0;
    const supabase = createClient();
    setMessage("");
    setErrorMessage("");
    const { data, error } = await supabase.from("students").insert({ name:studentName.trim(), grade:studentGrade.trim() }).select("id,name,grade,homeroom,active").single();
    if (error) { setErrorMessage(error.message); return; }
    const newStudent = data as Student;
    setStudents((current) => sortStudents([...current.filter((student) => student.id !== newStudent.id), newStudent]));
    if (role === "admin" && studentParentId && data?.id) {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(data.id)}/parents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: studentParentId }) });
      const result = await response.json();
      if (!response.ok) { setErrorMessage(result.error || "학생은 추가했지만 학부모 연결에 실패했습니다."); }
      else { setMessage("학생을 추가하고 학부모 계정을 연결했습니다."); void loadStudentParents(newStudent.id); }
    } else {
      setMessage("학생을 추가했습니다. 필요하면 학생 목록에서 학부모 계정을 연결하세요.");
    }
    if (process.env.NODE_ENV !== "production") console.debug("student-create", { durationMs: Math.round(performance.now() - start) });
    setStudentName(""); setStudentGrade(""); setStudentParentId(""); void loadStudents();
  }


  function closeDeleteModal() {
    if (deleteSubmitting) return;
    setNoticeDeleteTarget(null);
    setStudentDeleteTarget(null);
    setStudentPreview(null);
    setConfirmText("");
    setDeleteFeedback(null);
  }

  async function openStudentDelete(student: Student) {
    setDeleteFeedback(null);
    setConfirmText("");
    setStudentDeleteTarget(student);
    setStudentPreview(null);
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(student.id)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "삭제 영향을 확인하지 못했습니다.");
      setStudentPreview(result);
    } catch (error) {
      setDeleteFeedback({ type: "error", text: error instanceof Error ? error.message : "삭제 영향을 확인하지 못했습니다." });
    }
  }

  async function deleteNotice() {
    if (!noticeDeleteTarget || deleteSubmitting || confirmText !== "삭제") return;
    setDeleteSubmitting(true); setDeleteFeedback(null);
    try {
      const response = await fetch(`/api/admin/notices/${encodeURIComponent(noticeDeleteTarget.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "공지 삭제에 실패했습니다.");
      setMessage(result.message || "공지를 영구 삭제했습니다.");
      setNoticeDeleteTarget(null); setConfirmText("");
      setNotices((current) => current.filter((notice) => notice.id !== noticeDeleteTarget.id));
      await load();
    } catch (error) {
      setDeleteFeedback({ type: "error", text: error instanceof Error ? error.message : "공지 삭제에 실패했습니다." });
    } finally { setDeleteSubmitting(false); }
  }

  async function deleteStudent() {
    if (!studentDeleteTarget || deleteSubmitting || confirmText !== "삭제") return;
    setDeleteSubmitting(true); setDeleteFeedback(null);
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(studentDeleteTarget.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학생 삭제에 실패했습니다.");
      setMessage(result.message || "학생을 영구 삭제했습니다.");
      setStudentDeleteTarget(null); setStudentPreview(null); setConfirmText("");
      await load();
    } catch (error) {
      setDeleteFeedback({ type: "error", text: error instanceof Error ? error.message : "학생 삭제에 실패했습니다." });
    } finally { setDeleteSubmitting(false); }
  }

  async function linkParent(studentId: string, parentId: string) {
    if (!parentId || linkingStudentId) return;
    setLinkingStudentId(studentId); setErrorMessage(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/parents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학부모 계정 연결에 실패했습니다.");
      setMessage(result.message || "학부모 계정이 학생과 연결되었습니다.");
      setParentSearch((current) => ({ ...current, [studentId]: "" }));
      setExpandedLinkPanel((current) => ({ ...current, [studentId]: false }));
      await loadStudentParents(studentId);
      void loadParentLinks();
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "학부모 계정 연결에 실패했습니다."); }
    finally { setLinkingStudentId(null); }
  }

  async function unlinkParent(studentId: string, parentId: string) {
    if (linkingStudentId) return;
    setLinkingStudentId(studentId); setErrorMessage(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/parents?parentId=${encodeURIComponent(parentId)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학부모 계정 연결 해제에 실패했습니다.");
      setMessage(result.message || "학부모 계정 연결이 해제되었습니다.");
      await loadStudentParents(studentId);
      void loadParentLinks();
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "학부모 계정 연결 해제에 실패했습니다."); }
    finally { setLinkingStudentId(null); }
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
        <button className={tab === "warnings" ? "active" : ""} onClick={() => setTab("warnings")}>경고 관리</button>
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
                {role === "admin" && <div className="danger-zone"><button type="button" className="danger-button" onClick={() => { setDeleteFeedback(null); setConfirmText(""); setNoticeDeleteTarget(notice); }}>공지 영구 삭제</button></div>}
                {replies.length > 0 && <div className="reply-log"><strong>학부모 답변</strong>{replies.map((ack,index) => <p key={index}>“{ack.parent_reply}”</p>)}</div>}
              </article>;
            })}
            {!notices.length && <div className="empty-state">아직 발송한 알림이 없습니다.</div>}
          </div>
        </section>
      )}

      {tab === "warnings" && <WarningManager role={role} />}

      {tab === "students" && (
        <section className="student-management-layout">
          <div className="student-management-toolbar">
            <div><label>학생 검색</label><input value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="학생, 학년, 학부모 이름/이메일" /></div>
            <div><label>학년</label><select value={studentGradeFilter} onChange={(e) => setStudentGradeFilter(e.target.value)}><option value="">전체 학년</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></div>
            <div><label>학부모 연결 상태</label><select value={parentStatusFilter} onChange={(e) => setParentStatusFilter(e.target.value)}><option value="all">전체</option><option value="linked">연결됨</option><option value="unlinked">연결되지 않음</option></select></div>
            <div><label>상태</label><select value={activeStatusFilter} onChange={(e) => setActiveStatusFilter(e.target.value)}><option value="all">전체</option><option value="active">활성</option><option value="inactive">비활성</option></select></div>
            <span className="pill">검색 결과 {filteredStudents.length}명</span>
            <button type="button" className="primary" onClick={() => setStudentFormOpen((v) => !v)}>학생 추가</button>
          </div>
          {studentFormOpen && <form className="form-panel" onSubmit={addStudent}>
            <p className="eyebrow">STUDENT DIRECTORY</p><h2>학생 추가</h2>
            <label>학생 이름</label><input value={studentName} onChange={(e) => setStudentName(e.target.value)} required />
            <label>학년</label><input value={studentGrade} onChange={(e) => setStudentGrade(e.target.value)} placeholder="G7E" required />
            {role === "admin" && <><label>학부모 계정 연결 (선택)</label><select value={studentParentId} onChange={(e) => setStudentParentId(e.target.value)}><option value="">나중에 연결</option>{parentProfiles.map((parent) => <option key={parent.id} value={parent.id}>{parent.full_name || parent.email} · {parent.email}</option>)}</select></>}
            <button className="primary">학생 저장</button>{message && <p className="success-message">{message}</p>}{errorMessage && <p role="alert" className="form-error">{errorMessage}</p>}
          </form>}
          <div className="content-card student-directory-panel">
            <div className="section-heading"><div><p className="eyebrow">STUDENT ACCOUNTS</p><h2>학생 목록</h2></div><div className="student-toolbar-actions"><button type="button" className="secondary" onClick={() => setExpandedGrades(Object.fromEntries(Object.keys(groupedStudents).map((g) => [g, true])))}>모두 펼치기</button><button type="button" className="secondary" onClick={() => setExpandedGrades({})}>모두 접기</button></div></div>
            <div className="student-grade-list">{Object.entries(groupedStudents).map(([gradeName, gradeStudents]) => {
              const isOpen = expandedGrades[gradeName] ?? Object.keys(groupedStudents).length <= 3;
              const missing = gradeStudents.filter((student) => !(parentLinks[student.id] || []).length).length;
              return <section className="student-grade-section" key={gradeName}><button type="button" className="student-grade-header" aria-expanded={isOpen} onClick={() => setExpandedGrades((current) => ({ ...current, [gradeName]: !isOpen }))}><strong>{gradeName}</strong><span>{gradeStudents.length}명 · 학부모 미연결 {missing}명</span><em>{isOpen ? "접기" : "펼치기"}</em></button>{isOpen && <div className="compact-student-list">{gradeStudents.map((student) => {
                const linked = parentLinks[student.id] || []; const busy = linkingStudentId === student.id; const query = (parentSearch[student.id] || "").trim().toLowerCase(); const linkedIds = new Set(linked.map((parent) => parent.parentId)); const candidates = query ? parentProfiles.filter((parent) => !linkedIds.has(parent.id) && `${parent.full_name} ${parent.email}`.toLowerCase().includes(query)).slice(0, 8) : []; const editing = editingStudentId === student.id;
                return <article className="compact-student-card" key={student.id}><div className="compact-student-main"><span className="student-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span><div><h3>{student.name}</h3><p>{student.grade}{student.homeroom ? ` · ${student.homeroom}` : ""}</p><small>{linked.length ? linked.map((p) => p.fullName || p.email).join(", ") : "연결된 학부모 없음"}</small></div></div><div className="compact-student-status"><span className="pill">{linked.length ? `학부모 ${linked.length}명` : "학부모 미연결"}</span><button type="button" className="secondary" onClick={() => { setEditingStudentId(editing ? null : student.id); if (!editing) void loadStudentParents(student.id); }}>{editing ? "닫기" : "수정"}</button>{role === "admin" && <button type="button" className="danger-outline-button" onClick={() => openStudentDelete(student)}>삭제</button>}</div>{editing && role === "admin" && <div className="focused-student-editor"><section><div className="section-label-row"><span>연결된 학부모</span><strong>{linked.length}명</strong></div>{linked.length ? linked.map((parent) => <div className="linked-parent-row" key={parent.parentId}><div className="linked-parent-details"><strong>{parent.fullName || parent.email}</strong><span>{parent.email}</span></div><button type="button" className="unlink-button" onClick={() => unlinkParent(student.id, parent.parentId)} disabled={busy}>{busy ? "처리 중" : "연결 해제"}</button></div>) : <div className="linked-parent-empty"><strong>학부모 미연결</strong><span>아래 검색으로 기존 학부모 계정을 연결하세요.</span></div>}</section><section className="parent-link-panel"><div className="parent-link-panel__top"><label htmlFor={`parent-search-${student.id}`}>학부모 계정 검색</label></div><input id={`parent-search-${student.id}`} className="parent-search-input" placeholder="이름 또는 이메일로 검색" value={parentSearch[student.id] || ""} onChange={(e) => setParentSearch((current) => ({ ...current, [student.id]: e.target.value }))} />{query && <div className="parent-search-results">{candidates.map((parent) => <button type="button" className="parent-result" key={parent.id} onClick={() => linkParent(student.id, parent.id)} disabled={busy}><span><strong>{parent.full_name || parent.email}</strong><small>{parent.email}</small></span><em>선택한 계정 연결</em></button>)}{!candidates.length && <p className="link-status">일치하는 학부모 계정이 없거나 이미 연결된 계정입니다.</p>}</div>}</section></div>}</article>;
              })}</div>}</section>;
            })}</div>
            {!filteredStudents.length && <div className="empty-state">검색 조건에 맞는 학생이 없습니다.</div>}
          </div>
        </section>
      )}

      {tab === "accounts" && role === "admin" && <AdminPanel userId={userId} onChanged={load} />}

      {(noticeDeleteTarget || studentDeleteTarget) && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteSubmitting) closeDeleteModal(); }}>
          <div className="modal-card destructive-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-modal-title">
            <button type="button" className="modal-close" aria-label="닫기" onClick={closeDeleteModal} disabled={deleteSubmitting}>×</button>
            <p className="eyebrow">PERMANENT DELETE</p>
            <h2 id="delete-modal-title">영구 삭제 확인</h2>
            {noticeDeleteTarget && <dl className="reset-target-details">
              <div><dt>공지 종류</dt><dd>{typeLabels[noticeDeleteTarget.type]}</dd></div><div><dt>제목</dt><dd>{noticeDeleteTarget.title}</dd></div><div><dt>대상</dt><dd>{targetText(noticeDeleteTarget)}</dd></div><div><dt>발송일</dt><dd>{new Date(noticeDeleteTarget.published_at).toLocaleString("ko-KR")}</dd></div><div><dt>PDF</dt><dd>{noticeDeleteTarget.notice_attachments?.length || 0}개</dd></div>
            </dl>}
            {studentDeleteTarget && <dl className="reset-target-details">
              <div><dt>학생</dt><dd>{studentPreview?.name || studentDeleteTarget.name}</dd></div><div><dt>학년</dt><dd>{studentPreview?.grade || studentDeleteTarget.grade}</dd></div><div><dt>학부모 연결</dt><dd>{studentPreview ? `${studentPreview.parentLinkCount}개` : "확인 중..."}</dd></div><div><dt>개별 공지</dt><dd>{studentPreview ? `${studentPreview.individualNoticeCount}개` : "확인 중..."}</dd></div>
            </dl>}
            <p className="destructive-warning">{noticeDeleteTarget ? "읽음 기록, 확인, 답변, 학생 연결, 첨부파일이 모두 삭제됩니다." : "학부모/학생 연결이 삭제되며, 남은 대상 학생이 없는 개별 공지도 함께 삭제됩니다."}</p>
            <label htmlFor="delete-confirm">확인을 위해 ‘삭제’를 입력하세요.</label>
            <input id="delete-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
            {deleteFeedback && <p role="alert" className={deleteFeedback.type === "success" ? "success-message" : "form-error"}>{deleteFeedback.text}</p>}
            <div className="modal-actions"><button type="button" className="secondary" onClick={closeDeleteModal} disabled={deleteSubmitting}>취소</button><button type="button" className="danger-button" onClick={noticeDeleteTarget ? deleteNotice : deleteStudent} disabled={deleteSubmitting || confirmText !== "삭제"}>{deleteSubmitting ? "삭제 중..." : noticeDeleteTarget ? "이 공지를 영구 삭제" : "이 학생을 영구 삭제"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
