import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <div className="login-copy">
        <span className="pill inverted">안전한 개별 소통</span>
        <h2>
          홀리가이드
          <br />
          기독학교 포털
        </h2>
        <p>가정통신문, 학교 공지, 개별 경고 공지, 등</p>
      </div>
      <LoginForm />
    </main>
  );
}
