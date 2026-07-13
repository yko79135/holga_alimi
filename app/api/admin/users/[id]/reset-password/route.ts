import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: jsonError("로그인이 필요합니다.", 401) } as const;

  const { data: requester, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || requester?.role !== "admin") {
    return { error: jsonError("관리자 권한이 필요합니다.", 403) } as const;
  }

  return { user } as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const targetUserId = String(id || "").trim();

  try {
    const body = await request.json();
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (!targetUserId) return jsonError("대상 계정을 확인해주세요.", 400);
    if (!newPassword || !confirmPassword || newPassword.length < 8 || confirmPassword.length < 8) {
      return jsonError("새 비밀번호는 8자 이상이어야 합니다.", 400);
    }
    if (newPassword !== confirmPassword) {
      return jsonError("새 비밀번호가 서로 일치하지 않습니다.", 400);
    }
    if (targetUserId === auth.user.id) {
      return jsonError("본인 비밀번호는 내 계정에서 변경해주세요.", 400);
    }

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
    if (targetError || !target.user) return jsonError("대상 Auth 사용자를 찾을 수 없습니다.", 404);

    const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, { password: newPassword });
    if (updateError) {
      console.error("Admin password reset failed", { targetUserId, code: updateError.code, status: updateError.status });
      return jsonError("비밀번호 재설정에 실패했습니다.", 500);
    }

    return NextResponse.json({ message: "비밀번호를 재설정했습니다." });
  } catch (error) {
    console.error("Admin password reset failed", { targetUserId, message: error instanceof Error ? error.message : "unknown" });
    return jsonError("비밀번호 재설정에 실패했습니다.", 500);
  }
}
