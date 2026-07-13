"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Header({ name, role }: { name: string; role: string }) {
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const roleLabel = role === "admin" ? "관리자" : role === "teacher" ? "교사" : "학부모";

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{process.env.NEXT_PUBLIC_SCHOOL_NAME || "우리학교 학부모 포털"}</p>
        <h1>{name}님, 안녕하세요.</h1>
      </div>
      <div className="topbar-actions">
        <span className="pill">{roleLabel}</span>
        <button className="secondary" onClick={() => router.push("/account")}>내 계정</button>
        <button className="secondary" onClick={logout}>로그아웃</button>
      </div>
    </header>
  );
}
