"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import ParentDashboard from "@/components/ParentDashboard";
import StaffDashboard from "@/components/StaffDashboard";
import { type AppRole, type DashboardView, canUseParentView, canUseStaffView, effectiveStaffRole, resolveDashboardView } from "@/lib/roles";

export default function DashboardShell({ userId, name, roles, legacyRole, initialView }: { userId: string; name: string; roles: AppRole[]; legacyRole?: string | null; initialView?: string | null }) {
  const [view, setView] = useState<DashboardView>(() => resolveDashboardView(roles, initialView, legacyRole));
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

  const safeView = resolveDashboardView(roles, view, legacyRole);
  return (
    <main className="app-shell">
      <Header name={name} roles={roles} activeView={safeView} onViewChange={changeView} currentPage="dashboard" />
      {safeView === "parent" && canParent ? <ParentDashboard userId={userId} /> : null}
      {safeView === "staff" && canStaff && staffRole ? <StaffDashboard userId={userId} role={staffRole} /> : null}
    </main>
  );
}
