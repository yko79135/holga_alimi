"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type StudentCandidate = { id: string; name: string; grade: string; homeroom: string | null };
type Step = "checking" | "invalid" | "form" | "confirm" | "submitting";

export default function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [step, setStep] = useState<Step>("checking");
  const [invalidReason, setInvalidReason] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentGrade, setStudentGrade] = useState("");

  const [matching, setMatching] = useState(false);
  const [matches, setMatches] = useState<StudentCandidate[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) {
        setInvalidReason("초대 링크가 올바르지 않습니다. 링크 전체를 다시 확인해주세요.");
        setStep("invalid");
        return;
      }
      try {
        const response = await fetch(`/api/signup/invite?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const result = await response.json();
        if (!active) return;
        if (!result.valid) {
          setInvalidReason(result.error || "초대 링크가 유효하지 않습니다.");
          setStep("invalid");
        } else {
          setStep("form");
        }
      } catch {
        if (active) {
          setInvalidReason("초대 링크를 확인하는 중 오류가 발생했습니다.");
          setStep("invalid");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("비밀번호는 8자 이상이어야 합니다.");
    if (password !== confirm) return setError("비밀번호가 서로 일치하지 않습니다.");
    if (!studentName.trim() || !studentGrade.trim()) return setError("학생 이름과 학년을 입력해주세요.");

    setMatching(true);
    try {
      const response = await fetch("/api/signup/invite/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, studentName: studentName.trim(), studentGrade: studentGrade.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "학생 정보를 확인하지 못했습니다.");
      setMatches(result.matches || []);
      setSelectedStudentId(result.matches?.length === 1 ? result.matches[0].id : null);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "학생 정보를 확인하지 못했습니다.");
    } finally {
      setMatching(false);
    }
  }

  async function finalize(useNewStudent: boolean) {
    setError("");
    if (!useNewStudent && !selectedStudentId) return setError("연결할 학생을 선택해주세요.");
    setStep("submitting");
    try {
      const response = await fetch("/api/signup/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          email,
          password,
          fullName,
          phone,
          studentName: studentName.trim(),
          studentGrade: studentGrade.trim(),
          selectedStudentId: useNewStudent ? null : selectedStudentId,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "STUDENT_MATCH_FOUND" || result.code === "STUDENT_MATCH_STALE") {
          // Someone else registered a matching student between our check and this submit --
          // re-run the match instead of silently creating a duplicate or linking blind.
          setError(result.error || "학생 정보가 변경되었습니다. 다시 확인해주세요.");
          setStep("form");
          return;
        }
        throw new Error(result.error || "계정 생성에 실패했습니다.");
      }

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        router.replace("/login");
        return;
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "계정 생성에 실패했습니다.");
      setStep("confirm");
    }
  }

  const logo = (
    <div className="login-logo-panel">
      <Image className="login-logo" src="/branding/holy-guide-logo.png" alt="Holy Guide Christian School logo" width={450} height={428} priority />
    </div>
  );

  if (step === "checking") {
    return (
      <div className="login-card">
        {logo}
        <p className="muted">초대 링크를 확인하는 중입니다...</p>
      </div>
    );
  }

  if (step === "invalid") {
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

  if (step === "confirm" || step === "submitting") {
    return (
      <div className="login-card">
        {logo}
        <p className="eyebrow">PARENT SIGNUP</p>
        <h1>학생 확인</h1>
        {matches.length === 0 && (
          <>
            <p className="muted">일치하는 학생을 찾지 못했습니다. 아래 정보로 새 학생을 등록합니다.</p>
            <dl className="reset-target-details">
              <div><dt>이름</dt><dd>{studentName}</dd></div>
              <div><dt>학년</dt><dd>{studentGrade}</dd></div>
            </dl>
          </>
        )}
        {matches.length > 0 && (
          <>
            <p className="muted">{matches.length === 1 ? "다음 학생과 연결됩니다. 맞습니까?" : "이름과 학년이 일치하는 학생이 여러 명입니다. 자녀를 선택해주세요."}</p>
            <div className="check-grid">
              {matches.map((student) => (
                <label className="check-card" key={student.id}>
                  <input type="radio" name="student-match" checked={selectedStudentId === student.id} onChange={() => setSelectedStudentId(student.id)} />
                  <span><b>{student.name}</b><small>{student.grade}{student.homeroom ? ` · ${student.homeroom}` : ""}</small></span>
                </label>
              ))}
            </div>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="topbar-actions">
          <button type="button" className="secondary" onClick={() => { setStep("form"); setError(""); }} disabled={step === "submitting"}>다시 입력</button>
          {matches.length > 0 && (
            <button type="button" className="secondary" onClick={() => finalize(true)} disabled={step === "submitting"}>{studentName} 학생이 아니에요, 신입생으로 등록</button>
          )}
          <button type="button" className="primary" onClick={() => finalize(matches.length === 0)} disabled={step === "submitting" || (matches.length > 0 && !selectedStudentId)}>
            {step === "submitting" ? "처리 중..." : "확인하고 계정 만들기"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="login-card" onSubmit={submitForm}>
      {logo}
      <p className="eyebrow">PARENT SIGNUP</p>
      <h1>학부모 계정 만들기</h1>

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

      <label>자녀 이름</label>
      <input value={studentName} onChange={(event) => setStudentName(event.target.value)} required />

      <label>자녀 학년</label>
      <input value={studentGrade} onChange={(event) => setStudentGrade(event.target.value)} placeholder="G7E" required />

      {error && <p className="form-error">{error}</p>}
      <button className="primary wide" disabled={matching}>{matching ? "확인 중..." : "다음"}</button>
      <p className="login-help">이미 계정이 있으신가요? <a href="/login">로그인</a></p>
    </form>
  );
}
