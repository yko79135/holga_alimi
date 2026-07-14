"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Role = "admin" | "teacher" | "parent";
type Status = "active" | "missing_profile" | "missing_role" | "unconfirmed_email" | "inconsistent";
type Student = { id: string; name: string; grade: string };
type Feedback = { type: "success" | "error"; text: string };
type AccountSummary = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  authExists: boolean;
  profileExists: boolean;
  emailConfirmed: boolean;
  role: Role | null;
  roles: Role[];
  status: Status;
  createdAt: string | null;
  linkedStudents?: Student[];
};
type CreatedAccount = AccountSummary;

const roleLabels: Record<Role, string> = { admin: "관리자", teacher: "교사", parent: "학부모" };
const statusLabels: Record<Status, string> = { active: "정상", missing_profile: "프로필 없음", missing_role: "권한 확인 필요", unconfirmed_email: "이메일 미확인", inconsistent: "정보 불일치" };
const repairableStatuses: Status[] = ["missing_profile", "missing_role", "inconsistent"];

async function parseApiResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as { error?: string; message?: string; account?: CreatedAccount; accounts?: AccountSummary[] };
  } catch {
    throw new Error("서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해주세요.");
  }
}

export default function AdminPanel({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [roles, setRoles] = useState<Role[]>(["parent"]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [repairRoles, setRepairRoles] = useState<Record<string, Role>>({});
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [rolePending, setRolePending] = useState<Record<string, boolean>>({});
  const [resetTarget, setResetTarget] = useState<AccountSummary | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<Feedback | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountSummary | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState<Feedback | null>(null);

  const loadAccounts = useCallback(async () => {
    setDirectoryLoading(true);
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const result = await parseApiResponse(response);
      if (!response.ok) throw new Error(result.error || "계정 목록을 불러오지 못했습니다.");
      setAccounts(result.accounts || []);
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "계정 목록을 불러오지 못했습니다." });
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    void supabase.from("students").select("id,name,grade").order("grade").order("name").then(({ data }) => setStudents(data || []));
    void loadAccounts();
  }, [loadAccounts]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName, phone, roles, studentIds: roles.includes("parent") ? studentIds : [] }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok || !result.account) throw new Error(result.error || "계정 생성 실패");
      const created = result.account;
      setAccounts((current) => [created, ...current.filter((account) => account.id !== created.id)]);
      setFeedback({ type: "success", text: `${created.email} 계정을 만들고 선택한 권한을 배정했습니다.` });
      setEmail(""); setPassword(""); setFullName(""); setPhone(""); setRoles(["parent"]); setStudentIds([]);
      void loadAccounts();
      void Promise.resolve(onChanged());
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "네트워크 오류로 계정 생성에 실패했습니다." });
    } finally {
      setLoading(false);
    }
  }

  async function repairAccount(account: AccountSummary) {
    const nextRole = repairRoles[account.id] || account.role || "teacher";
    setRepairingId(account.id);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id, fullName: account.fullName || account.email, phone: account.phone || "", role: nextRole }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok || !result.account) throw new Error(result.error || "계정 복구 실패");
      setFeedback({ type: "success", text: `${result.account.email} 계정을 ${roleLabels[result.account.role || nextRole]} 권한으로 복구했습니다. 비밀번호는 변경하지 않았습니다.` });
      await loadAccounts();
      onChanged();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "계정 복구에 실패했습니다." });
    } finally {
      setRepairingId(null);
    }
  }

  async function addRole(account: AccountSummary, nextRole: Role) {
    if (rolePending[account.id]) return;
    setRolePending((current) => ({ ...current, [account.id]: true }));
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(account.id)}/roles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: nextRole }) });
      const result = await parseApiResponse(response) as { error?: string; message?: string; roles?: Role[] };
      if (!response.ok) { setFeedback({ type: "error", text: result.error || "권한 추가에 실패했습니다." }); return; }
      const updatedRoles = result.roles || Array.from(new Set([...(account.roles || []), nextRole]));
      setAccounts((current) => current.map((item) => item.id === account.id ? { ...item, roles: updatedRoles, role: updatedRoles[0] || item.role, status: item.status === "missing_role" ? "active" : item.status } : item));
      setFeedback({ type: "success", text: result.message || "기존 계정에 권한이 추가되었습니다." });
      void loadAccounts();
      void Promise.resolve(onChanged());
    } finally {
      setRolePending((current) => ({ ...current, [account.id]: false }));
    }
  }

  function toggleRole(nextRole: Role) {
    setRoles((current) => current.includes(nextRole) ? current.filter((value) => value !== nextRole) : [...current, nextRole]);
  }

  function toggleStudent(id: string) {
    setStudentIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }


  function closeDeleteModal() {
    if (deleteSubmitting) return;
    setDeleteTarget(null);
    setDeleteConfirm("");
    setDeleteFeedback(null);
  }

  async function deleteAccount() {
    if (!deleteTarget || deleteSubmitting || deleteConfirm !== deleteTarget.email) return;
    setDeleteSubmitting(true);
    setDeleteFeedback(null);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      const result = await parseApiResponse(response);
      if (!response.ok) throw new Error(result.error || "계정 삭제에 실패했습니다.");
      setFeedback({ type: "success", text: result.message || "계정을 영구 삭제했습니다." });
      closeDeleteModal();
      await loadAccounts();
      onChanged();
    } catch (error) {
      setDeleteFeedback({ type: "error", text: error instanceof Error ? error.message : "계정 삭제에 실패했습니다." });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  function closeResetModal() {
    setResetTarget(null);
    setNewPassword("");
    setConfirmPassword("");
    setResetFeedback(null);
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!resetTarget || resetSubmitting) return;
    setFeedback(null);
    setResetFeedback(null);
    if (newPassword.length < 8 || confirmPassword.length < 8) {
      setResetFeedback({ type: "error", text: "새 비밀번호는 8자 이상이어야 합니다." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetFeedback({ type: "error", text: "새 비밀번호가 서로 일치하지 않습니다." });
      return;
    }

    setResetSubmitting(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(resetTarget.id)}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, confirmPassword }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok) throw new Error(result.error || "비밀번호 재설정에 실패했습니다.");
      setFeedback({ type: "success", text: result.message || "비밀번호를 재설정했습니다." });
      closeResetModal();
    } catch (error) {
      setResetFeedback({ type: "error", text: error instanceof Error ? error.message : "비밀번호 재설정에 실패했습니다." });
    } finally {
      setResetSubmitting(false);
    }
  }

  return (
    <section className="panel-grid">
      <form className="form-panel" onSubmit={submit}>
        <p className="eyebrow">ACCOUNT MANAGEMENT</p>
        <h2>사용자 계정 발급</h2>
        <p className="muted">하나의 로그인 이메일에 학부모, 교사, 관리자 권한을 함께 배정할 수 있습니다. 이메일은 Auth 사용자별로 고유해야 합니다.</p>
        <div className="two-columns">
          <div><label>이름</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div>
          <div><label>초기 권한</label><div className="check-grid">{(["parent","teacher","admin"] as Role[]).map((value) => <label className="check-card" key={value}><input type="checkbox" checked={roles.includes(value)} onChange={() => toggleRole(value)} /><span><b>{roleLabels[value]}</b></span></label>)}</div></div>
        </div>
        <div className="two-columns">
          <div><label>이메일</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><label>전화번호</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <label>임시 비밀번호</label>
        <input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />

        {roles.includes("parent") && (
          <>
            <label>연결할 학생</label>
            <div className="check-grid">
              {students.map((student) => (
                <label className="check-card" key={student.id}>
                  <input type="checkbox" checked={studentIds.includes(student.id)} onChange={() => toggleStudent(student.id)} />
                  <span><b>{student.name}</b><small>{student.grade}</small></span>
                </label>
              ))}
            </div>
          </>
        )}
        <button className="primary" disabled={loading}>{loading ? "생성 중..." : "계정 생성"}</button>
        {feedback && <p role={feedback.type === "success" ? "status" : "alert"} className={feedback.type === "success" ? "success-message" : "form-error"}>{feedback.text}</p>}
      </form>

      <section className="content-card">
        <div className="section-heading"><div><p className="eyebrow">ACCOUNT DIRECTORY</p><h2>계정 목록</h2></div><button type="button" className="secondary" onClick={loadAccounts} disabled={directoryLoading}>{directoryLoading ? "확인 중..." : "새로고침"}</button></div>
        <div className="account-list">
          {accounts.map((account) => {
            const selectedRole = repairRoles[account.id] || account.role || "teacher";
            return (
              <article className="account-card" key={account.id}>
                <div>
                  <strong>{account.fullName || "이름 없음"}</strong>
                  <small>{account.email}</small>
                  <span>{(account.roles?.length ? account.roles : account.role ? [account.role] : []).map((r) => <span className={`role-badge role-${r}`} key={r}>{roleLabels[r]}</span>)}</span>
                  <small>{statusLabels[account.status]}</small>
                  {(account.roles?.includes("parent") || account.role === "parent") && <small>연결 학생: {account.linkedStudents?.length ? account.linkedStudents.map((student) => `${student.grade} ${student.name}`).join(", ") : "없음"}</small>}
                </div>
                <div className="account-meta">
                  <span className="pill">이메일 {account.emailConfirmed ? "확인됨" : "미확인"}</span>
                  <span className="pill">프로필 {account.profileExists ? "확인됨" : "없음"}</span>
                  <span className="pill">{statusLabels[account.status]}</span>
                  {account.createdAt && <small>{new Date(account.createdAt).toLocaleString("ko-KR")}</small>}
                </div>
                {repairableStatuses.includes(account.status) && (
                  <div className="repair-row">
                    <select value={selectedRole} onChange={(e) => setRepairRoles((current) => ({ ...current, [account.id]: e.target.value as Role }))}>
                      <option value="teacher">교사</option><option value="parent">학부모</option><option value="admin">관리자</option>
                    </select>
                    <button type="button" className="secondary" onClick={() => repairAccount(account)} disabled={repairingId === account.id}>{repairingId === account.id ? "저장 중..." : "프로필 복구"}</button>
                  </div>
                )}
                {account.id !== userId && account.authExists && (
                  <div className="account-actions">
                    {!account.roles?.includes("parent") && <button type="button" className="secondary" onClick={() => addRole(account, "parent")} disabled={Boolean(rolePending[account.id])}>학부모 권한 및 학생 연결</button>}
                    {!account.roles?.includes("teacher") && <button type="button" className="secondary" onClick={() => addRole(account, "teacher")} disabled={Boolean(rolePending[account.id])}>교사 권한 추가</button>}
                    <button type="button" className="secondary" onClick={() => { setFeedback(null); setResetFeedback(null); setResetTarget(account); }}>비밀번호 재설정</button><button type="button" className="danger-button" onClick={() => { setFeedback(null); setDeleteFeedback(null); setDeleteConfirm(""); setDeleteTarget(account); }}>계정 영구 삭제</button>
                  </div>
                )}
              </article>
            );
          })}
          {!accounts.length && <div className="empty-state">표시할 계정이 없습니다.</div>}
        </div>
      </section>



      {deleteTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteSubmitting) closeDeleteModal(); }}>
          <div className="modal-card destructive-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title">
            <button type="button" className="modal-close" aria-label="닫기" onClick={closeDeleteModal} disabled={deleteSubmitting}>×</button>
            <p className="eyebrow">PERMANENT DELETE</p>
            <h2 id="delete-account-title">계정 영구 삭제</h2>
            <dl className="reset-target-details">
              <div><dt>이름</dt><dd>{deleteTarget.fullName || "이름 없음"}</dd></div><div><dt>이메일</dt><dd>{deleteTarget.email}</dd></div><div><dt>권한</dt><dd>{deleteTarget.role ? roleLabels[deleteTarget.role] : "권한 없음"}</dd></div><div><dt>상태</dt><dd>{statusLabels[deleteTarget.status]}</dd></div>
            </dl>
            <p className="destructive-warning">이 작업은 되돌릴 수 없습니다. 학부모 계정의 학생 연결, 확인 기록, 푸시 구독이 함께 삭제됩니다. 교사/관리자가 만든 과거 공지와 PDF는 보존됩니다.</p>
            <label htmlFor="delete-account-confirm">대상 이메일을 정확히 입력하세요.</label>
            <input id="delete-account-confirm" type="email" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} autoFocus />
            {deleteFeedback && <p role="alert" className={deleteFeedback.type === "success" ? "success-message" : "form-error"}>{deleteFeedback.text}</p>}
            <div className="modal-actions"><button type="button" className="secondary" onClick={closeDeleteModal} disabled={deleteSubmitting}>취소</button><button type="button" className="danger-button" onClick={deleteAccount} disabled={deleteSubmitting || deleteConfirm !== deleteTarget.email}>{deleteSubmitting ? "삭제 중..." : "이 계정을 영구 삭제"}</button></div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !resetSubmitting) closeResetModal(); }}>
          <form className="modal-card reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-password-title" onSubmit={resetPassword}>
            <button type="button" className="modal-close" aria-label="닫기" onClick={closeResetModal} disabled={resetSubmitting}>×</button>
            <p className="eyebrow">PASSWORD RESET</p>
            <h2 id="reset-password-title">비밀번호 재설정</h2>
            <dl className="reset-target-details">
              <div><dt>대상 이름</dt><dd>{resetTarget.fullName || "이름 없음"}</dd></div>
              <div><dt>대상 이메일</dt><dd>{resetTarget.email}</dd></div>
              <div><dt>대상 권한</dt><dd>{resetTarget.role ? roleLabels[resetTarget.role] : "권한 없음"}</dd></div>
            </dl>
            <label htmlFor="new-password">새 임시 비밀번호</label>
            <input id="new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoFocus />
            <label htmlFor="confirm-password">새 임시 비밀번호 확인</label>
            <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            {resetFeedback && <p role="alert" className={resetFeedback.type === "success" ? "success-message" : "form-error"}>{resetFeedback.text}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={closeResetModal} disabled={resetSubmitting}>취소</button>
              <button type="submit" className="primary" disabled={resetSubmitting}>{resetSubmitting ? "재설정 중..." : "비밀번호 재설정"}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
