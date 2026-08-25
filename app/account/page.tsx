import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import AccountSettings from "@/components/AccountSettings";
import { getUserRoles } from "@/lib/roles-server";
import { resolveDashboardView } from "@/lib/roles";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }){
  const s=await createClient(); const {data:{user}}=await s.auth.getUser(); if(!user) redirect("/login");
  const {data:p}=await s.from("profiles").select("full_name,role").eq("id",user.id).single();
  const roles = await getUserRoles(s, user.id);
  const activeView = resolveDashboardView(roles, null, p?.role);
  const { notice } = await searchParams;
  return <main className="app-shell"><Header name={p?.full_name||user.email||"사용자"} roles={roles} activeView={activeView} currentPage="account"/><AccountSettings email={user.email||""} roles={roles} notice={notice}/></main>;
}
