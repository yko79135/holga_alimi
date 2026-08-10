import { Suspense } from "react";
import SignupForm from "@/components/SignupForm";

export default function SignupPage() {
  return (
    <main className="login-shell">
      <div className="login-copy">
        <span className="pill inverted">학부모 계정 만들기</span>
        <h2>
          홀리가이드
          <br />
          기독학교 포털
        </h2>
        <p>학교에서 받은 초대 링크로 학부모 계정을 만드세요.</p>
      </div>
      <Suspense fallback={<div className="login-card"><p className="muted">불러오는 중...</p></div>}>
        <SignupForm />
      </Suspense>
    </main>
  );
}
