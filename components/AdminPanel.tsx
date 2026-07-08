"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Student = { id: string; name: string; grade: string };

export default function AdminPanel({ onChanged }: { onChanged: () => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("parent");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.from("students").select("id,name,grade").order("grade").order("name").then(({ data }) => setStudents(data || []));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullName, phone, role, studentIds: role === "parent" ? studentIds : [] }),
    });
    const result = await response.json();
    setMessage(response.ok ? "계정을 만들었습니다. 임시 비밀번호를 안전하게 전달해주세요." : result.error || "계정 생성 실패");
    if (response.ok) {
      setEmail(""); setPassword(""); setFullName(""); setPhone(""); setStudentIds([]);
      onChanged();
    }
    setLoading(false);
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
          <div><label>권한</label><select value={role} onChange={(e) => setRole(e.target.value)}><option value="parent">학부모</option><option value="teacher">교사</option><option value="admin">관리자</option></select></div>
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
        {message && <p className="success-message">{message}</p>}
      </form>
      <div className="info-panel">
        <h3>계정 운영 방식</h3>
        <ol>
          <li>관리자가 학부모 계정을 발급합니다.</li>
          <li>학부모 계정에 한 명 이상의 학생을 연결합니다.</li>
          <li>학부모는 연결된 학생 대상 알림만 볼 수 있습니다.</li>
          <li>관리자용 서비스 키는 브라우저에 노출되지 않습니다.</li>
        </ol>
      </div>
    </section>
  );
}
