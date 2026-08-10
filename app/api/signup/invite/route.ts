import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findMatchingStudents, invalidInviteReason } from "@/lib/invites";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function loadInvite(admin: ReturnType<typeof createAdminClient>, token: string) {
  if (!token) return null;
  const { data } = await admin.from("signup_invites").select("id,revoked_at,expires_at").eq("token", token).maybeSingle();
  return data;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const admin = createAdminClient();
  const invite = await loadInvite(admin, token);
  if (!invite) return NextResponse.json({ valid: false, error: "초대 링크가 유효하지 않습니다." });

  const reason = invalidInviteReason(invite);
  if (reason) return NextResponse.json({ valid: false, error: reason });

  return NextResponse.json({ valid: true });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "");
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const fullName = String(body.fullName || "").trim();
  const phone = String(body.phone || "").trim();
  const studentName = String(body.studentName || "").trim();
  const studentGrade = String(body.studentGrade || "").trim();
  const selectedStudentId = body.selectedStudentId ? String(body.selectedStudentId).trim() : null;

  if (!isValidEmail(email)) return NextResponse.json({ error: "이메일 형식을 확인해주세요." }, { status: 400 });
  if (!fullName) return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  if (!studentName || !studentGrade) return NextResponse.json({ error: "학생 이름과 학년을 입력해주세요." }, { status: 400 });

  const admin = createAdminClient();
  const invite = await loadInvite(admin, token);
  if (!invite) return NextResponse.json({ error: "초대 링크가 유효하지 않습니다." }, { status: 400 });
  const reason = invalidInviteReason(invite);
  if (reason) return NextResponse.json({ error: reason }, { status: 400 });

  // Re-resolve the match server-side rather than trusting the client's selection outright: this
  // catches both tampering (an id that doesn't actually correspond to the submitted name/grade)
  // and races (a matching student got created by someone else between the match-check call and
  // this submit). Either way we never silently create a duplicate student.
  const matches = await findMatchingStudents(studentName, studentGrade);
  let studentId: string;
  if (selectedStudentId) {
    const confirmed = matches.find((student) => student.id === selectedStudentId);
    if (!confirmed) return NextResponse.json({ error: "선택한 학생 정보가 변경되었습니다. 다시 확인해주세요.", code: "STUDENT_MATCH_STALE" }, { status: 409 });
    studentId = confirmed.id;
  } else if (matches.length > 0) {
    return NextResponse.json({ error: "이미 등록된 같은 이름의 학생이 있습니다. 다시 확인해주세요.", code: "STUDENT_MATCH_FOUND" }, { status: 409 });
  } else {
    const { data: newStudent, error: studentError } = await admin.from("students").insert({ name: studentName, grade: studentGrade }).select("id").single();
    if (studentError || !newStudent) return NextResponse.json({ error: "학생 등록에 실패했습니다. 다시 시도해주세요." }, { status: 500 });
    studentId = newStudent.id;
  }

  let newUserId: string | null = null;
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, role: "parent" } });
    if (createError || !created.user) {
      const message = createError?.message?.toLowerCase() || "";
      if (message.includes("already") || message.includes("registered") || message.includes("exists") || message.includes("duplicate") || createError?.code === "email_exists") {
        throw new Error("DUPLICATE_EMAIL");
      }
      throw new Error("AUTH_CREATE_FAILED");
    }
    newUserId = created.user.id;

    if (phone) {
      const { error: profileError } = await admin.from("profiles").update({ phone }).eq("id", newUserId);
      if (profileError) throw new Error("PROFILE_UPDATE_FAILED");
    }

    const { error: linkError } = await admin.from("parent_students").insert({ parent_id: newUserId, student_id: studentId });
    if (linkError && linkError.code !== "23505") throw new Error("PARENT_LINK_FAILED");

    const { error: redemptionError } = await admin.from("signup_invite_redemptions").insert({ invite_id: invite.id, parent_id: newUserId, student_id: studentId });
    if (redemptionError) throw new Error("INVITE_FINALIZE_FAILED");

    return NextResponse.json({ message: "계정이 생성되었습니다.", email });
  } catch (error) {
    if (newUserId) {
      try {
        await admin.auth.admin.deleteUser(newUserId);
      } catch (cleanupError) {
        console.error("signup-invite-cleanup-failed", { inviteId: invite.id, newUserId, message: cleanupError instanceof Error ? cleanupError.message : "unknown" });
      }
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "DUPLICATE_EMAIL") return NextResponse.json({ error: "이미 사용 중인 이메일입니다. 다른 이메일을 입력해주세요." }, { status: 409 });
    console.error("signup-invite-redeem-failed", { inviteId: invite.id, message });
    return NextResponse.json({ error: "계정 생성 중 오류가 발생했습니다. 다시 시도해주세요." }, { status: 500 });
  }
}
