import { NextResponse } from "next/server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInviteToken, INVITE_DEFAULT_EXPIRY_DAYS, INVITE_MAX_EXPIRY_DAYS, inviteStatus } from "@/lib/invites";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const { data, error } = await admin.from("signup_invites").select("id,token,expires_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) return adminJsonError("초대 목록을 불러오지 못했습니다.", 500);

  const inviteIds = (data || []).map((row: any) => row.id);
  const { data: redemptions } = inviteIds.length
    ? await admin.from("signup_invite_redemptions").select("invite_id,student_id,created_at").in("invite_id", inviteIds).order("created_at", { ascending: false })
    : { data: [] };
  const studentIds = Array.from(new Set((redemptions || []).map((row: any) => row.student_id)));
  const { data: students } = studentIds.length ? await admin.from("students").select("id,name,grade").in("id", studentIds) : { data: [] };
  const studentMap = new Map((students || []).map((student: any) => [student.id, student]));

  const redemptionsByInvite = new Map<string, Array<{ name: string; grade: string; createdAt: string }>>();
  for (const row of (redemptions || []) as any[]) {
    const student = studentMap.get(row.student_id);
    if (!student) continue;
    const list = redemptionsByInvite.get(row.invite_id) || [];
    list.push({ name: student.name, grade: student.grade, createdAt: row.created_at });
    redemptionsByInvite.set(row.invite_id, list);
  }

  const invites = (data || []).map((row: any) => ({
    id: row.id,
    token: row.token,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    status: inviteStatus(row),
    redemptions: redemptionsByInvite.get(row.id) || [],
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
