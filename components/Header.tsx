"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { type AppRole, type DashboardView, canUseParentView, canUseStaffView, effectiveStaffRole, roleLabel } from "@/lib/roles";

export default function Header({ name, roles, activeView = "staff", currentPage = "dashboard", onViewChange, onLogoClick }: { name: string; roles?: AppRole[]; role?: string; activeView?: DashboardView; currentPage?: "dashboard" | "account"; onViewChange?: (view: DashboardView) => void; onLogoClick?: () => void }) {
  const router = useRouter();
  const safeRoles = roles?.length ? roles : ["parent"] as AppRole[];
  const canStaff = canUseStaffView(safeRoles);
  const canParent = canUseParentView(safeRoles);
  const staffRole = effectiveStaffRole(safeRoles);
  const activeLabel = activeView === "staff" ? (staffRole === "admin" ? "관리자 화면" : "교사 화면") : "학부모 화면";
  const showSwitcher = currentPage === "dashboard" && canStaff && canParent && Boolean(onViewChange);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function goDashboard() {
    router.replace(`/dashboard?view=${encodeURIComponent(activeView)}`);
  }

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <button type="button" className="topbar-logo-link" aria-label="메인 화면으로 이동" onClick={() => (onLogoClick ? onLogoClick() : router.push("/dashboard"))}>
          <Image className="topbar-logo" src="/branding/holy-guide-logo.png" alt="" width={44} height={42} priority />
        </button>
        <div><p className="eyebrow">{process.env.NEXT_PUBLIC_SCHOOL_NAME || "우리학교 학부모 포털"}</p><h1>{name}님, 안녕하세요.</h1><p className="muted">현재 {activeLabel}</p></div>
      </div>
      <div className="topbar-actions">
        {!showSwitcher && <div className="role-badges" aria-label="보유 권한">{safeRoles.map((r) => <span className={`role-badge role-${r}`} key={r}>{roleLabel(r)}</span>)}</div>}
        {showSwitcher && <div className="view-switcher" role="tablist" aria-label="화면 전환"><button type="button" role="tab" aria-selected={activeView === "staff"} className={activeView === "staff" ? "filter active" : "filter"} onClick={() => onViewChange!("staff")}>{staffRole === "admin" ? "관리자 화면" : "교사 화면"}</button><button type="button" role="tab" aria-selected={activeView === "parent"} className={activeView === "parent" ? "filter active" : "filter"} onClick={() => onViewChange!("parent")}>학부모 화면</button></div>}
        {currentPage === "account" ? <button className="secondary" onClick={goDashboard}>메인 화면으로</button> : <button className="secondary" onClick={() => router.push("/account")}>내 계정</button>}
        <button className="secondary" onClick={logout}>로그아웃</button>
      </div>
    </header>
  );
}
