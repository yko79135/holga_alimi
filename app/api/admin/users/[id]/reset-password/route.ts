import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const targetUserId = String(id || "").trim();

  try {
    const body = await request.json();
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (!targetUserId) return adminJsonError("대상 계정을 확인해주세요.", 400);
    if (!newPassword || !confirmPassword || newPassword.length < 8 || confirmPassword.length < 8) {
      return adminJsonError("새 비밀번호는 8자 이상이어야 합니다.", 400);
    }
    if (newPassword !== confirmPassword) {
      return adminJsonError("새 비밀번호가 서로 일치하지 않습니다.", 400);
    }
    if (targetUserId === auth.user.id) {
      return adminJsonError("본인 비밀번호는 내 계정에서 변경해주세요.", 400);
    }

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
    if (targetError || !target.user) return adminJsonError("대상 Auth 사용자를 찾을 수 없습니다.", 404);

    const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, { password: newPassword });
    if (updateError) {
      console.error("Admin password reset failed", { targetUserId, code: updateError.code, status: updateError.status });
      return adminJsonError("비밀번호 재설정에 실패했습니다.", 500);
    }

    return NextResponse.json({ message: "비밀번호를 재설정했습니다." });
  } catch (error) {
    console.error("Admin password reset failed", { targetUserId, message: error instanceof Error ? error.message : "unknown" });
    return adminJsonError("비밀번호 재설정에 실패했습니다.", 500);
  }
}
