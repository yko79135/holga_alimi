"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resolveAuthNotice } from "@/lib/auth/notices";

/** Only follow "next" when it's a same-origin relative path, to avoid an open redirect via a
 * crafted ?next= value, and never loop back into /login itself. */
function safeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return null;
  return next;
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const redirectedFromNotice = !!safeNextPath(searchParams.get("next"));
  // /auth/callback sends the outcome of an auth email link here when the browser has no session.
  const authNotice = resolveAuthNotice(searchParams.get("notice") || searchParams.get("error"));

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

      router.replace(safeNextPath(searchParams.get("next")) || "/dashboard");
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
      <h1>로그인</h1>
      {redirectedFromNotice && (
        <p className="login-notice">로그인 세션이 만료되어 다시 로그인이 필요합니다. 로그인하면 보시려던 알림으로 자동 이동합니다.</p>
      )}
      {authNotice && (
        <p
          role={authNotice.tone === "error" ? "alert" : "status"}
          className={authNotice.tone === "error" ? "form-error" : authNotice.tone === "success" ? "success-message" : "login-notice"}
        >
          {authNotice.message}
        </p>
      )}

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
    </form>
  );
}
