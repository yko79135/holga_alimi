import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import ParentDashboard from "@/components/ParentDashboard";
import StaffDashboard from "@/components/StaffDashboard";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return <main className="center-message">계정 프로필을 찾을 수 없습니다. 관리자에게 문의해주세요.</main>;
  }

  return (
    <main className="app-shell">
      <Header name={profile.full_name || user.email || "사용자"} role={profile.role} />
      {profile.role === "parent" ? (
        <ParentDashboard userId={user.id} />
      ) : (
        <StaffDashboard userId={user.id} role={profile.role} />
      )}
    </main>
  );
}
