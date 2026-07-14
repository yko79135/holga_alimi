import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AppRole, isAppRole, normalizeRoles } from "@/lib/roles";

export async function getUserRoles(supabase: SupabaseClient, userId: string): Promise<AppRole[]> {
  const { data } = await supabase.from("profile_roles").select("role").eq("profile_id", userId);
  const roles = normalizeRoles((data || []).map((row: any) => row.role));
  if (roles.length) return roles;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return isAppRole((profile as any)?.role) ? [(profile as any).role] : [];
}

export async function userHasRole(supabase: SupabaseClient, userId: string, role: AppRole) { return (await getUserRoles(supabase, userId)).includes(role); }
export async function userIsAdmin(supabase: SupabaseClient, userId: string) { return userHasRole(supabase, userId, "admin"); }
export async function userIsStaff(supabase: SupabaseClient, userId: string) { const roles = await getUserRoles(supabase, userId); return roles.includes("admin") || roles.includes("teacher"); }
