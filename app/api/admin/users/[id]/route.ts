import { NextResponse } from "next/server";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(); if ("error" in auth) return auth.error;
  const { id } = await params; const targetUserId = String(id || "").trim();
  if (!validUuid(targetUserId)) return adminJsonError("계정 ID를 확인해주세요.", 400);
  if (targetUserId === auth.user.id) return adminJsonError("현재 로그인한 관리자 계정은 삭제할 수 없습니다.", 400);
  try {
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
    const { data: profile } = await admin.from("profiles").select("id,email,full_name,role").eq("id", targetUserId).maybeSingle();
    if (targetError || !target.user) {
      if (profile) return adminJsonError("Auth 사용자가 없는 고아 프로필입니다. Supabase에서 상태를 확인한 뒤 정리해주세요.", 409);
      return adminJsonError("대상 Auth 사용자를 찾을 수 없습니다.", 404);
    }
    const { data: targetRoles } = await admin.from("profile_roles").select("role").eq("profile_id", targetUserId);
    if ((targetRoles || []).some((r: any) => r.role === "admin")) {
      const { count, error: countError } = await admin.from("profile_roles").select("profile_id", { count: "exact", head: true }).eq("role", "admin");
      if (countError) throw new Error("ADMIN_COUNT_FAILED");
      if ((count || 0) <= 1) return adminJsonError("마지막 관리자 계정은 삭제할 수 없습니다.", 400);
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
    if (deleteError) throw deleteError;
    return NextResponse.json({ message: "계정을 영구 삭제했습니다." });
  } catch (error) {
    console.error("Admin account deletion failed", { targetUserId, message: error instanceof Error ? error.message : "unknown" });
    return adminJsonError("계정 삭제에 실패했습니다.", 500);
  }
}
