import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";

type StaffProfile = { id: string; role: string; email: string | null; full_name: string | null; roles: string[] };

export function staffJsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireStaff(): Promise<{ user: User; profile: StaffProfile } | { error: NextResponse }> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: staffJsonError("로그인이 필요합니다.", 401) };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,email,full_name")
    .eq("id", user.id)
    .single<StaffProfile>();

  const roles = await getUserRoles(supabase, user.id);
  if (profileError || !profile || !(roles.includes("admin") || roles.includes("teacher"))) {
    return { error: staffJsonError("교사 또는 관리자 권한이 필요합니다.", 403) };
  }

  return { user, profile: { ...profile, roles } };
}
