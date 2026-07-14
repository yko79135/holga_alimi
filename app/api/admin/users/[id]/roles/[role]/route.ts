import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { isAppRole, normalizeRoles } from "@/lib/roles";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; role: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id, role } = await params;
  if (!isAppRole(role)) return adminJsonError("삭제할 권한 값이 올바르지 않습니다.", 400);
  const admin = createAdminClient();
  const { data: rows } = await admin.from("profile_roles").select("role").eq("profile_id", id);
  const roles = normalizeRoles((rows || []).map((r: any) => r.role));
  if (!roles.includes(role)) return NextResponse.json({ roles, message: "이미 제거된 권한입니다." });
  if (roles.length <= 1) return adminJsonError("계정의 마지막 권한은 제거할 수 없습니다.", 400);
  if (role === "admin") {
    const { count } = await admin.from("profile_roles").select("profile_id", { count: "exact", head: true }).eq("role", "admin");
    if ((count || 0) <= 1) return adminJsonError("마지막 관리자 권한은 제거할 수 없습니다.", 400);
  }
  const { error } = await admin.from("profile_roles").delete().eq("profile_id", id).eq("role", role);
  if (error) return adminJsonError("권한 제거에 실패했습니다.", 500);
  const { data: nextRows } = await admin.from("profile_roles").select("role").eq("profile_id", id);
  return NextResponse.json({ roles: normalizeRoles((nextRows || []).map((r: any) => r.role)), message: "권한을 제거했습니다." });
}
