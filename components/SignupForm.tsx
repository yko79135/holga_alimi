"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type InviteStudent = { id: string; name: string; grade: string };

export default function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [checking, setChecking] = useState(true);
  const [invalidReason, setInvalidReason] = useState("");
  const [students, setStudents] = useState<InviteStudent[]>([]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) {
        setInvalidReason("초대 링크가 올바르지 않습니다. 링크 전체를 다시 확인해주세요.");
        setChecking(false);
        return;
      }
      try {
        const response = await fetch(`/api/signup/invite?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const result = await response.json();
        if (!active) return;
        if (!result.valid) setInvalidReason(result.error || "초대 링크가 유효하지 않습니다.");
        else setStudents(result.students || []);
      } catch {
        if (active) setInvalidReason("초대 링크를 확인하는 중 오류가 발생했습니다.");
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("비밀번호는 8자 이상이어야 합니다.");
    if (password !== confirm) return setError("비밀번호가 서로 일치하지 않습니다.");
    setLoading(true);
    try {
      const response = await fetch("/api/signup/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password, fullName, phone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "계정 생성에 실패했습니다.");

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        router.replace("/login");
        return;
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "계정 생성에 실패했습니다.");
      setLoading(false);
    }
  }

  const logo = (
    <div className="login-logo-panel">
      <Image className="login-logo" src="/branding/holy-guide-logo.png" alt="Holy Guide Christian School logo" width={450} height={428} priority />
    </div>
  );

  if (checking) {
    return (
      <div className="login-card">
        {logo}
        <p className="muted">초대 링크를 확인하는 중입니다...</p>
      </div>
    );
  }

  if (invalidReason) {
    return (
      <div className="login-card">
        {logo}
        <p className="eyebrow">SIGNUP</p>
        <h1>초대 링크를 사용할 수 없습니다</h1>
        <p className="form-error">{invalidReason}</p>
        <p className="login-help">학교에 새 초대 링크를 요청해주세요. 이미 계정이 있다면 <a href="/login">로그인</a>해주세요.</p>
      </div>
    );
  }

  return (
    <form className="login-card" onSubmit={submit}>
      {logo}
      <p className="eyebrow">PARENT SIGNUP</p>
      <h1>학부모 계정 만들기</h1>
      {students.length > 0 && (
        <p className="muted">아래 학생과 자동으로 연결됩니다: {students.map((student) => `${student.name} (${student.grade})`).join(", ")}</p>
      )}

      <label>이름</label>
      <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />

      <label>이메일</label>
      <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="parent@example.com" required />

      <label>전화번호 (선택)</label>
      <input value={phone} onChange={(event) => setPhone(event.target.value)} />

      <label>비밀번호</label>
      <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />

      <label>비밀번호 확인</label>
      <input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />

      {error && <p className="form-error">{error}</p>}
      <button className="primary wide" disabled={loading}>{loading ? "계정 생성 중..." : "계정 만들기"}</button>
      <p className="login-help">이미 계정이 있으신가요? <a href="/login">로그인</a></p>
    </form>
  );
}
