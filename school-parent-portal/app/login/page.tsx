import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <div className="login-copy">
        <span className="pill inverted">안전한 개별 소통</span>
        <h2>학교 소식은 한눈에,<br />자녀 지도 내용은 개인별로.</h2>
        <p>각 학부모는 연결된 자녀의 정보만 확인할 수 있습니다.</p>
      </div>
      <LoginForm />
    </main>
  );
}
