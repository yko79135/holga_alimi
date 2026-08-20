import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidInviteReason, MAX_CHILDREN_PER_SIGNUP } from "@/lib/invites";
import { sortGrades } from "@/lib/grade-sort";

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

  // students.grade has no fixed enum -- it's free text -- so this is just "whatever grades
  // currently exist," not an authoritative list. The signup form falls back to free-text entry
  // for a grade that isn't in this list yet (e.g. a brand-new incoming class with no students).
  const { data: gradeRows } = await admin.from("students").select("grade").eq("active", true);
  const grades = sortGrades(Array.from(new Set((gradeRows || []).map((row: any) => row.grade))));

  return NextResponse.json({ valid: true, grades });
}

type ChildInput = { name: string; grade: string; selectedStudentId?: string | null };

type SignupDiagnostic = {
  requestId: string;
  operation: string;
  table?: string;
  inviteId?: string;
  newUserId?: string | null;
  childCount?: number;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: string;
  errorHint?: string;
  errorStatus?: number;
};

function logSignupDiagnostic(diagnostic: SignupDiagnostic) {
  console.error("signup-invite-redeem-diagnostic", diagnostic);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || "");
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const fullName = String(body.fullName || "").trim();
  const phone = String(body.phone || "").trim();
  const children: ChildInput[] = Array.isArray(body.children) ? body.children : [];

  if (!isValidEmail(email)) return NextResponse.json({ error: "이메일 형식을 확인해주세요." }, { status: 400 });
  if (!fullName) return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  if (!children.length || children.length > MAX_CHILDREN_PER_SIGNUP) return NextResponse.json({ error: "자녀 정보를 확인해주세요." }, { status: 400 });
  for (const child of children) {
    if (!String(child?.name || "").trim() || !String(child?.grade || "").trim()) return NextResponse.json({ error: "자녀 이름과 학년을 모두 입력해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const invite = await loadInvite(admin, token);
  if (!invite) return NextResponse.json({ error: "초대 링크가 유효하지 않습니다." }, { status: 400 });
  const reason = invalidInviteReason(invite);
  if (reason) return NextResponse.json({ error: reason }, { status: 400 });

  const baseDiagnostic = { requestId, inviteId: invite.id, childCount: children.length };

  let newUserId: string | null = null;
  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, role: "parent" } });
    if (createError || !created.user) {
      const message = createError?.message?.toLowerCase() || "";
      if (message.includes("already") || message.includes("registered") || message.includes("exists") || message.includes("duplicate") || createError?.code === "email_exists") {
        throw new Error("DUPLICATE_EMAIL");
      }
      logSignupDiagnostic({ ...baseDiagnostic, operation: "auth.createUser", errorCode: createError?.code, errorMessage: createError?.message, errorStatus: createError?.status });
      throw new Error("AUTH_CREATE_FAILED");
    }
    newUserId = created.user.id;

    if (phone) {
      const { error: profileError } = await admin.from("profiles").update({ phone }).eq("id", newUserId);
      if (profileError) {
        logSignupDiagnostic({ ...baseDiagnostic, operation: "update", table: "profiles", newUserId, errorCode: profileError.code, errorMessage: profileError.message, errorDetails: profileError.details, errorHint: profileError.hint });
        throw new Error("PROFILE_UPDATE_FAILED");
      }
    }

    // One atomic transaction for every child: resolves each (existing match or new student),
    // links the parent, and logs the redemption. Any single child failing re-validation rolls
    // the whole batch back -- never a partial set of linked children.
    const payload = children.map((child) => ({
      name: String(child.name).trim(),
      grade: String(child.grade).trim(),
      selectedStudentId: child.selectedStudentId ? String(child.selectedStudentId).trim() : null,
    }));
    const { data: rpcResult, error: rpcError } = await admin.rpc("redeem_signup_invite_children", { p_invite_id: invite.id, p_parent_id: newUserId, p_children: payload });
    if (rpcError) {
      logSignupDiagnostic({ ...baseDiagnostic, operation: "rpc", table: "redeem_signup_invite_children", newUserId, errorCode: rpcError.code, errorMessage: rpcError.message, errorDetails: rpcError.details, errorHint: rpcError.hint });
      throw new Error(rpcError.message || "RPC_FAILED");
    }

    return NextResponse.json({ message: "계정이 생성되었습니다.", email, children: rpcResult });
  } catch (error) {
    // Always capture the raw caught value, even if it isn't an Error instance (e.g. a network-
    // level throw from admin.rpc()) -- this is the gap that made every prior failure here show
    // the same unhelpful generic message with nothing in the logs to diagnose from.
    const raw = error instanceof Error ? error.message : String(error);
    logSignupDiagnostic({ ...baseDiagnostic, operation: "redeem-caught", newUserId, errorMessage: raw });

    if (newUserId) {
      try {
        await admin.auth.admin.deleteUser(newUserId);
      } catch (cleanupError) {
        logSignupDiagnostic({ ...baseDiagnostic, operation: "cleanup-deleteUser", newUserId, errorMessage: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) });
      }
    }

    if (raw === "DUPLICATE_EMAIL") return NextResponse.json({ error: "이미 사용 중인 이메일입니다. 다른 이메일을 입력해주세요." }, { status: 409 });
    if (raw.startsWith("STUDENT_MATCH_FOUND")) {
      return NextResponse.json({ error: `이미 등록된 같은 이름의 학생이 있습니다 (${raw.split(":")[1]?.trim() || ""}). 다시 확인해주세요.`, code: "STUDENT_MATCH_FOUND" }, { status: 409 });
    }
    if (raw.startsWith("STUDENT_MATCH_STALE")) {
      return NextResponse.json({ error: `선택한 학생 정보가 변경되었습니다 (${raw.split(":")[1]?.trim() || ""}). 다시 확인해주세요.`, code: "STUDENT_MATCH_STALE" }, { status: 409 });
    }
    return NextResponse.json({ error: "계정 생성 중 오류가 발생했습니다. 다시 시도해주세요.", errorId: requestId }, { status: 500 });
  }
}
