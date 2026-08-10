import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidInviteReason } from "@/lib/invites";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function loadInvite(admin: ReturnType<typeof createAdminClient>, token: string) {
  if (!token) return null;
  const { data } = await admin.from("signup_invites").select("id,student_ids,expires_at,used_at,revoked_at").eq("token", token).maybeSingle();
  return data;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const admin = createAdminClient();
  const invite = await loadInvite(admin, token);
  if (!invite) return NextResponse.json({ valid: false, error: "초대 링크가 유효하지 않습니다." });

  const reason = invalidInviteReason(invite);
  if (reason) return NextResponse.json({ valid: false, error: reason });

  const { data: students } = invite.student_ids.length ? await admin.from("students").select("id,name,grade").in("id", invite.student_ids) : { data: [] };
  return NextResponse.json({ valid: true, students: students || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "");
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const fullName = String(body.fullName || "").trim();
  const phone = String(body.phone || "").trim();

  if (!isValidEmail(email)) return NextResponse.json({ error: "이메일 형식을 확인해주세요." }, { status: 400 });
  if (!fullName) return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });

  const admin = createAdminClient();
  const invite = await loadInvite(admin, token);
  if (!invite) return NextResponse.json({ error: "초대 링크가 유효하지 않습니다." }, { status: 400 });
  const reason = invalidInviteReason(invite);
  if (reason) return NextResponse.json({ error: reason }, { status: 400 });

  // Claim the token before creating anything: this is the single-use guard, and it closes the
  // race where two requests redeem the same link concurrently. If account creation fails below,
  // the catch block un-claims it so the same link can be retried.
  const claimRes = await admin.from("signup_invites").update({ used_at: new Date().toISOString() }).eq("id", invite.id).is("used_at", null).is("revoked_at", null).select("id").single();
  if (claimRes.error || !claimRes.data) return NextResponse.json({ error: "이미 처리된 초대 링크입니다." }, { status: 409 });

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

    if (invite.student_ids.length) {
      const rows = invite.student_ids.map((studentId: string) => ({ parent_id: newUserId, student_id: studentId }));
      const { error: linkError } = await admin.from("parent_students").insert(rows);
      if (linkError && linkError.code !== "23505") throw new Error("PARENT_LINK_FAILED");
    }

    const { error: usedByError } = await admin.from("signup_invites").update({ used_by: newUserId }).eq("id", invite.id);
    if (usedByError) throw new Error("INVITE_FINALIZE_FAILED");

    return NextResponse.json({ message: "계정이 생성되었습니다.", email });
  } catch (error) {
    await admin.from("signup_invites").update({ used_at: null }).eq("id", invite.id);
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
