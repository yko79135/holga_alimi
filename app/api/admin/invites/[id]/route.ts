import { NextResponse } from "next/server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const inviteId = String(id || "").trim();
  if (!inviteId) return adminJsonError("초대 ID를 확인해주세요.", 400);

  const admin = createAdminClient();
  const { error, count } = await admin.from("signup_invites").delete({ count: "exact" }).eq("id", inviteId).is("used_at", null);
  if (error) return adminJsonError("초대 링크 취소에 실패했습니다.", 500);
  if (!count) return adminJsonError("이미 사용되었거나 존재하지 않는 초대 링크입니다.", 404);

  return NextResponse.json({ message: "초대 링크를 취소했습니다." });
}
