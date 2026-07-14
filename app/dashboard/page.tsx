import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/DashboardShell";
import { getUserRoles } from "@/lib/roles-server";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("id, full_name, role").eq("id", user.id).single();
  if (!profile) return <main className="center-message">계정 프로필을 찾을 수 없습니다. 관리자에게 문의해주세요.</main>;
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.length) return <main className="center-message">계정 권한을 찾을 수 없습니다. 관리자에게 문의해주세요.</main>;
  const params = await searchParams;

  return <DashboardShell userId={user.id} name={profile.full_name || user.email || "사용자"} roles={roles} legacyRole={profile.role} initialView={params.view || null} />;
}
