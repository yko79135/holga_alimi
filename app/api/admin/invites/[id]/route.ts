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

  // Soft revoke, not delete: signup_invite_redemptions cascades off signup_invites via FK, so a
  // hard delete here would wipe the redemption history for a link that real families already
  // used. This only blocks *future* redemptions -- students/links already created stay intact.
  const admin = createAdminClient();
  const { error, count } = await admin.from("signup_invites").update({ revoked_at: new Date().toISOString() }, { count: "exact" }).eq("id", inviteId).is("revoked_at", null);
  if (error) return adminJsonError("초대 링크 취소에 실패했습니다.", 500);
  if (!count) return adminJsonError("이미 취소되었거나 존재하지 않는 초대 링크입니다.", 404);

  return NextResponse.json({ message: "초대 링크를 취소했습니다." });
}
