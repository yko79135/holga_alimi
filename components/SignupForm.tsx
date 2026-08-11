"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const MAX_CHILDREN = 5;
const CUSTOM_GRADE = "__custom__";

type StudentCandidate = { id: string; name: string; grade: string; homeroom: string | null };
type ChildDraft = { name: string; grade: string; gradeMode: "select" | "custom" };
type ChildMatchResult = { name: string; grade: string; matches: StudentCandidate[] };
type Step = "checking" | "invalid" | "form" | "confirm" | "submitting";

function emptyChild(): ChildDraft {
  return { name: "", grade: "", gradeMode: "select" };
}

export default function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [step, setStep] = useState<Step>("checking");
  const [invalidReason, setInvalidReason] = useState("");
  const [grades, setGrades] = useState<string[]>([]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [childCount, setChildCount] = useState(1);
  const [children, setChildren] = useState<ChildDraft[]>([emptyChild()]);

  const [matching, setMatching] = useState(false);
  const [results, setResults] = useState<ChildMatchResult[]>([]);
  const [selections, setSelections] = useState<Record<number, string | "new" | null>>({});
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
          setGrades(result.grades || []);
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

  function changeChildCount(next: number) {
    setChildCount(next);
    setChildren((current) => {
      const copy = current.slice(0, next);
      while (copy.length < next) copy.push(emptyChild());
      return copy;
    });
  }

  function updateChild(index: number, patch: Partial<ChildDraft>) {
    setChildren((current) => current.map((child, i) => (i === index ? { ...child, ...patch } : child)));
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("비밀번호는 8자 이상이어야 합니다.");
    if (password !== confirm) return setError("비밀번호가 서로 일치하지 않습니다.");
    for (const child of children) {
      if (!child.name.trim() || !child.grade.trim()) return setError("모든 자녀의 이름과 학년을 입력해주세요.");
    }

    setMatching(true);
    try {
      const response = await fetch("/api/signup/invite/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, children: children.map((child) => ({ name: child.name.trim(), grade: child.grade.trim() })) }),
      });
      const result = await response.json();
      if (!response.ok) {
        const suffix = result.errorId ? ` (참조번호: ${result.errorId})` : "";
        throw new Error((result.error || "학생 정보를 확인하지 못했습니다.") + suffix);
      }
      const childResults: ChildMatchResult[] = result.results || [];
      setResults(childResults);
      const initial: Record<number, string | "new" | null> = {};
      childResults.forEach((childResult, index) => {
        if (childResult.matches.length === 1) initial[index] = childResult.matches[0].id;
        else if (childResult.matches.length === 0) initial[index] = "new";
        else initial[index] = null;
      });
      setSelections(initial);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "학생 정보를 확인하지 못했습니다.");
    } finally {
      setMatching(false);
    }
  }

  const canFinalize = results.every((_, index) => selections[index] !== null && selections[index] !== undefined);

  async function finalize() {
    setError("");
    if (!canFinalize) return setError("모든 자녀의 연결 여부를 선택해주세요.");
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
          children: results.map((childResult, index) => ({
            name: childResult.name,
            grade: childResult.grade,
            selectedStudentId: selections[index] === "new" ? null : selections[index],
          })),
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
        // errorId correlates this failure with the server-side diagnostic log (signup-invite-
        // redeem-diagnostic) -- surfaced so it can be relayed back when reporting a failure.
        const suffix = result.errorId ? ` (참조번호: ${result.errorId})` : "";
        throw new Error((result.error || "계정 생성에 실패했습니다.") + suffix);
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
        <h1>자녀 확인</h1>
        <p className="muted">자녀별로 연결할 학생을 확인해주세요.</p>
        <div className="warning-reason-list">
          {results.map((childResult, index) => (
            <div className="warning-reason-card" key={index}>
              <strong>자녀 {index + 1}: {childResult.name} · {childResult.grade}</strong>
              {childResult.matches.length === 0 && <p className="muted">일치하는 학생이 없어 신입생으로 등록됩니다.</p>}
              {childResult.matches.length > 0 && (
                <div className="check-grid">
                  {childResult.matches.map((student) => (
                    <label className="check-card" key={student.id}>
                      <input
                        type="radio"
                        name={`child-${index}-match`}
                        checked={selections[index] === student.id}
                        onChange={() => setSelections((current) => ({ ...current, [index]: student.id }))}
                      />
                      <span><b>{student.name}</b><small>{student.grade}{student.homeroom ? ` · ${student.homeroom}` : ""}</small></span>
                    </label>
                  ))}
                  <label className="check-card">
                    <input
                      type="radio"
                      name={`child-${index}-match`}
                      checked={selections[index] === "new"}
                      onChange={() => setSelections((current) => ({ ...current, [index]: "new" }))}
                    />
                    <span><b>목록에 없음</b><small>신입생으로 등록</small></span>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="topbar-actions">
          <button type="button" className="secondary" onClick={() => { setStep("form"); setError(""); }} disabled={step === "submitting"}>다시 입력</button>
          <button type="button" className="primary" onClick={finalize} disabled={step === "submitting" || !canFinalize}>
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

      <label>자녀 수</label>
      <select value={childCount} onChange={(event) => changeChildCount(Number(event.target.value))}>
        {Array.from({ length: MAX_CHILDREN }, (_, i) => i + 1).map((count) => (
          <option key={count} value={count}>{count}명</option>
        ))}
      </select>

      {children.map((child, index) => (
        <div className="two-columns" key={index}>
          <div>
            <label>자녀 {index + 1} 이름</label>
            <input value={child.name} onChange={(event) => updateChild(index, { name: event.target.value })} required />
          </div>
          <div>
            <label>자녀 {index + 1} 학년</label>
            {child.gradeMode === "select" ? (
              <select
                value={grades.includes(child.grade) ? child.grade : ""}
                onChange={(event) => {
                  if (event.target.value === CUSTOM_GRADE) updateChild(index, { gradeMode: "custom", grade: "" });
                  else updateChild(index, { grade: event.target.value });
                }}
                required
              >
                <option value="">학년 선택</option>
                {grades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                <option value={CUSTOM_GRADE}>직접 입력 (새 학년)</option>
              </select>
            ) : (
              <div className="attachment-item">
                <input value={child.grade} onChange={(event) => updateChild(index, { grade: event.target.value })} placeholder="G7E" required />
                <button type="button" className="secondary" onClick={() => updateChild(index, { gradeMode: "select", grade: "" })}>목록에서 선택</button>
              </div>
            )}
          </div>
        </div>
      ))}

      {error && <p className="form-error">{error}</p>}
      <button className="primary wide" disabled={matching}>{matching ? "확인 중..." : "다음"}</button>
      <p className="login-help">이미 계정이 있으신가요? <a href="/login">로그인</a></p>
    </form>
  );
}
