"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      router.replace("/dashboard");
      return;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "로그인 요청을 준비하는 중 오류가 발생했습니다.",
      );
      setLoading(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo-panel">
        <Image
          className="login-logo"
          src="/branding/holy-guide-logo.png"
          alt="Holy Guide Christian School logo"
          width={450}
          height={428}
          priority
        />
      </div>
      <p className="eyebrow">SCHOOL FAMILY PORTAL</p>
      <h1>{process.env.NEXT_PUBLIC_SCHOOL_NAME || "우리학교 학부모 포털"}</h1>
      <p className="muted">학교에서 발송한 가정통신문과 자녀별 안내를 확인하세요.</p>

      <label>이메일</label>
      <input
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="parent@example.com"
        required
      />

      <label>비밀번호</label>
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="비밀번호"
        required
      />

      {error && <p className="form-error">{error}</p>}
      <button className="primary wide" disabled={loading}>
        {loading ? "로그인 중..." : "로그인"}
      </button>
      <p className="login-help">계정 발급 또는 비밀번호 문의는 학교로 연락해주세요.</p>
    </form>
  );
}
