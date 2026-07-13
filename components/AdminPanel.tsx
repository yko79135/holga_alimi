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
  status: Status;
  createdAt: string | null;
};
type CreatedAccount = { id: string; email: string; fullName: string; phone: string | null; role: Role; emailConfirmed: boolean; profileVerified: boolean };

const roleLabels: Record<Role, string> = { admin: "관리자", teacher: "교사", parent: "학부모" };
const statusLabels: Record<Status, string> = { active: "정상", missing_profile: "프로필 없음", missing_role: "권한 확인 필요", unconfirmed_email: "이메일 미확인", inconsistent: "정보 불일치" };
const repairableStatuses: Status[] = ["missing_profile", "missing_role", "inconsistent"];

async function parseApiResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as { error?: string; account?: CreatedAccount; accounts?: AccountSummary[] };
  } catch {
    throw new Error("서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해주세요.");
  }
}

export default function AdminPanel({ onChanged }: { onChanged: () => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("parent");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [repairRoles, setRepairRoles] = useState<Record<string, Role>>({});
  const [repairingId, setRepairingId] = useState<string | null>(null);

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
        body: JSON.stringify({ email, password, fullName, phone, role, studentIds: role === "parent" ? studentIds : [] }),
      });
      const result = await parseApiResponse(response);
      if (!response.ok || !result.account) throw new Error(result.error || "계정 생성 실패");
      const created = result.account;
      setFeedback({ type: "success", text: `${created.email} (${roleLabels[created.role]}) 계정을 만들고 프로필을 확인했습니다.` });
      setEmail(""); setPassword(""); setFullName(""); setPhone(""); setRole("parent"); setStudentIds([]);
      await loadAccounts();
      onChanged();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "네트워크 오류로 계정 생성에 실패했습니다." });
    } finally {
      setLoading(false);
    }
  }

  async function repairAccount(account: AccountSummary) {
    const nextRole = repairRoles[account.id] || account.role || "teacher";
    if (account.role === "admin" && nextRole !== "admin" && !window.confirm("다른 관리자 계정의 권한을 변경하시겠습니까?")) return;
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
      setFeedback({ type: "success", text: `${result.account.email} 계정을 ${roleLabels[result.account.role]} 권한으로 복구했습니다. 비밀번호는 변경하지 않았습니다.` });
      await loadAccounts();
      onChanged();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "계정 복구에 실패했습니다." });
    } finally {
      setRepairingId(null);
    }
  }

  function toggleStudent(id: string) {
    setStudentIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  return (
    <section className="panel-grid">
      <form className="form-panel" onSubmit={submit}>
        <p className="eyebrow">ACCOUNT MANAGEMENT</p>
        <h2>사용자 계정 발급</h2>
        <div className="two-columns">
          <div><label>이름</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div>
          <div><label>권한</label><select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="parent">학부모</option><option value="teacher">교사</option><option value="admin">관리자</option></select></div>
        </div>
        <div className="two-columns">
          <div><label>이메일</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div><label>전화번호</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <label>임시 비밀번호</label>
        <input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />

        {role === "parent" && (
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
                  <small>{account.role ? roleLabels[account.role] : "권한 없음"} · {statusLabels[account.status]}</small>
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
              </article>
            );
          })}
          {!accounts.length && <div className="empty-state">표시할 계정이 없습니다.</div>}
        </div>
      </section>
    </section>
  );
}
