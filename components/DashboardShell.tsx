"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Header from "@/components/Header";
import { type AppRole, type DashboardView, canUseParentView, canUseStaffView, effectiveStaffRole, resolveDashboardView } from "@/lib/roles";

// Code-split by view so a notification deep link only downloads the dashboard it's actually
// landing on (parent or staff), not both -- this is the biggest lever on first-paint time for a
// cold PWA launch from a push notification tap.
const ParentDashboard = dynamic(() => import("@/components/ParentDashboard"));
const StaffDashboard = dynamic(() => import("@/components/StaffDashboard"));

export default function DashboardShell({ userId, name, roles, legacyRole, initialView }: { userId: string; name: string; roles: AppRole[]; legacyRole?: string | null; initialView?: string | null }) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<DashboardView>(() => resolveDashboardView(roles, initialView, legacyRole));
  // Staff push notifications (see lib/push/payload.ts) deep-link with ?tab=notices so the
  // notification lands directly on the sent-notices list instead of the compose tab.
  const [staffTab, setStaffTab] = useState(() => searchParams.get("tab") || "compose");
  const storageKey = `holy-guide-dashboard-view:${userId}`;
  const staffRole = effectiveStaffRole(roles);
  const canStaff = canUseStaffView(roles);
  const canParent = canUseParentView(roles);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
    if (saved) setView(resolveDashboardView(roles, saved, legacyRole));
  }, [storageKey, roles, legacyRole]);

  function changeView(next: DashboardView) {
    const resolved = resolveDashboardView(roles, next, legacyRole);
    setView(resolved);
    window.localStorage.setItem(storageKey, resolved);
    const url = new URL(window.location.href);
    url.searchParams.set("view", resolved);
    window.history.replaceState(null, "", url.toString());
  }

  // Logo click: land on the staff "알림 작성" tab specifically when the user has a staff role,
  // even if a client-side navigation to the same /dashboard URL wouldn't otherwise reset state
  // (search-param props only re-derive state on first mount, not on later prop changes). A
  // parent-only session has no staff tabs to reset, so it just stays on their one view.
  function goHome() {
    if (canStaff) {
      setStaffTab("compose");
      changeView("staff");
    } else if (canParent) {
      changeView("parent");
    }
  }

  const safeView = resolveDashboardView(roles, view, legacyRole);
  return (
    <main className="app-shell">
      <Header name={name} roles={roles} activeView={safeView} onViewChange={changeView} onLogoClick={goHome} currentPage="dashboard" />
      {safeView === "parent" && canParent ? <ParentDashboard userId={userId} /> : null}
      {safeView === "staff" && canStaff && staffRole ? <StaffDashboard userId={userId} role={staffRole} tab={staffTab} onTabChange={setStaffTab} /> : null}
    </main>
  );
}
