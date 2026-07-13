import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Header from "@/components/Header";
import AccountSettings from "@/components/AccountSettings";
export default async function AccountPage(){const s=await createClient(); const {data:{user}}=await s.auth.getUser(); if(!user) redirect("/login"); const {data:p}=await s.from("profiles").select("full_name,role").eq("id",user.id).single(); return <main className="app-shell"><Header name={p?.full_name||user.email||"사용자"} role={p?.role||"parent"}/><AccountSettings email={user.email||""}/></main>;}
