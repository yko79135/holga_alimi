import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findMatchingStudents, invalidInviteReason } from "@/lib/invites";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "");
  const studentName = String(body.studentName || "").trim();
  const studentGrade = String(body.studentGrade || "").trim();

  if (!studentName || !studentGrade) return NextResponse.json({ error: "학생 이름과 학년을 입력해주세요." }, { status: 400 });

  // Gate this behind a valid, unused, unexpired token -- without this check, anyone could probe
  // arbitrary name+grade combinations to enumerate the student roster.
  const admin = createAdminClient();
  const { data: invite } = await admin.from("signup_invites").select("used_at,revoked_at,expires_at").eq("token", token).maybeSingle();
  if (!invite) return NextResponse.json({ error: "초대 링크가 유효하지 않습니다." }, { status: 400 });
  const reason = invalidInviteReason(invite);
  if (reason) return NextResponse.json({ error: reason }, { status: 400 });

  const matches = await findMatchingStudents(studentName, studentGrade);
  return NextResponse.json({ matches: matches.map((student) => ({ id: student.id, name: student.name, grade: student.grade, homeroom: student.homeroom })) });
}
