import { NextResponse } from "next/server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInviteToken, INVITE_DEFAULT_EXPIRY_DAYS, INVITE_MAX_EXPIRY_DAYS, inviteStatus } from "@/lib/invites";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin.from("signup_invites").select("id,token,student_ids,expires_at,used_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) return adminJsonError("초대 목록을 불러오지 못했습니다.", 500);

  // student_ids is populated after redemption now (which student this link ended up connecting
  // to), not chosen in advance -- so this is an audit trail, not a target list.
  const studentIds = Array.from(new Set((data || []).flatMap((row: any) => row.student_ids || [])));
  const { data: students } = studentIds.length ? await admin.from("students").select("id,name,grade").in("id", studentIds) : { data: [] };
  const studentMap = new Map((students || []).map((student: any) => [student.id, student]));

  const invites = (data || []).map((row: any) => ({
    id: row.id,
    token: row.token,
    linkedStudents: (row.student_ids || []).map((id: string) => studentMap.get(id)).filter(Boolean),
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    status: inviteStatus(row),
  }));

  return NextResponse.json({ invites });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const expiresInDays = Number(body.expiresInDays) || INVITE_DEFAULT_EXPIRY_DAYS;
  if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > INVITE_MAX_EXPIRY_DAYS) return adminJsonError("유효기간을 확인해주세요.", 400);

  const admin = createAdminClient();
  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: invite, error } = await admin
    .from("signup_invites")
    .insert({ token, expires_at: expiresAt, created_by: auth.user.id })
    .select("id,token,expires_at,created_at")
    .single();
  if (error || !invite) return adminJsonError("초대 링크 생성에 실패했습니다.", 500);

  return NextResponse.json({ invite });
}
