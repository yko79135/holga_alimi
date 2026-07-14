import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";

type AdminProfile = { id: string; role: string; email: string | null; full_name: string | null; roles: string[] };

export function adminJsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireAdmin(): Promise<{ user: User; profile: AdminProfile } | { error: NextResponse }> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: adminJsonError("로그인이 필요합니다.", 401) };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,email,full_name")
    .eq("id", user.id)
    .single<AdminProfile>();

  const roles = await getUserRoles(supabase, user.id);
  if (profileError || !profile || !roles.includes("admin")) {
    return { error: adminJsonError("관리자 권한이 필요합니다.", 403) };
  }

  return { user, profile: { ...profile, roles } };
}
