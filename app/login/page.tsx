import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

// The login page is the only page anyone can see without an account, so for now it shows
// nothing that names the school: no logo, no school name, a plain tab title.
export const metadata: Metadata = {
  title: "로그인",
  description: null,
};

export default function LoginPage() {
  return (
    <main className="login-plain">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
