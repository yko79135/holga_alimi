import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { type AppRole, isAppRole, normalizeRoles, roleLabel } from "@/lib/roles";

async function updatedRoles(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data } = await admin.from("profile_roles").select("role").eq("profile_id", userId).order("role");
  return normalizeRoles((data || []).map((r: any) => r.role));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const role = body.role;
  if (!isAppRole(role)) return adminJsonError("추가할 권한 값이 올바르지 않습니다.", 400);
  const admin = createAdminClient();
  const [{ data: authUser }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(id),
    admin.from("profiles").select("id").eq("id", id).maybeSingle(),
  ]);
  if (!authUser.user || !profile) return adminJsonError("대상 계정을 찾을 수 없습니다.", 404);
  const { error } = await admin.from("profile_roles").upsert({ profile_id: id, role, assigned_by: auth.user.id }, { onConflict: "profile_id,role" });
  if (error) return adminJsonError("권한 추가에 실패했습니다.", 500);
  return NextResponse.json({ roles: await updatedRoles(admin, id), message: `기존 계정에 ${roleLabel(role as AppRole)} 권한이 추가되었습니다. 같은 이메일과 비밀번호로 로그인하여 화면을 전환할 수 있습니다.` });
}
