import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findMatchingStudents, invalidInviteReason, MAX_CHILDREN_PER_SIGNUP } from "@/lib/invites";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "");
  const children = Array.isArray(body.children) ? body.children : [];

  if (!children.length || children.length > MAX_CHILDREN_PER_SIGNUP) return NextResponse.json({ error: "자녀 정보를 확인해주세요." }, { status: 400 });
  for (const child of children) {
    if (!String(child?.name || "").trim() || !String(child?.grade || "").trim()) return NextResponse.json({ error: "자녀 이름과 학년을 모두 입력해주세요." }, { status: 400 });
  }

  // Gate this behind a valid, unexpired, unrevoked token -- without this check, anyone could
  // probe arbitrary name+grade combinations to enumerate the student roster.
  const admin = createAdminClient();
  const { data: invite } = await admin.from("signup_invites").select("revoked_at,expires_at").eq("token", token).maybeSingle();
  if (!invite) return NextResponse.json({ error: "초대 링크가 유효하지 않습니다." }, { status: 400 });
  const reason = invalidInviteReason(invite);
  if (reason) return NextResponse.json({ error: reason }, { status: 400 });

  try {
    const results = await Promise.all(children.map(async (child: { name: string; grade: string }) => {
      const name = String(child.name).trim();
      const grade = String(child.grade).trim();
      const matches = await findMatchingStudents(name, grade);
      return { name, grade, matches: matches.map((student) => ({ id: student.id, name: student.name, grade: student.grade, homeroom: student.homeroom })) };
    }));
    return NextResponse.json({ results });
  } catch (error) {
    console.error("signup-invite-match-diagnostic", { requestId, childCount: children.length, errorMessage: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "학생 정보를 확인하지 못했습니다. 다시 시도해주세요.", errorId: requestId }, { status: 500 });
  }
}
