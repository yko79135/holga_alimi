import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type AppRole = "admin" | "teacher" | "parent";
type AccountStatus = "active" | "missing_profile" | "missing_role" | "unconfirmed_email" | "inconsistent";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  created_at: string | null;
};

const VALID_ROLES: AppRole[] = ["admin", "teacher", "parent"];
const DUPLICATE_EMAIL_MESSAGE = "이미 등록된 이메일입니다. 아래 계정 목록에서 계정 상태와 권한을 확인해주세요.";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isRole(value: string): value is AppRole {
  return (VALID_ROLES as string[]).includes(value);
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeLog(message: string, details?: Record<string, unknown>) {
  console.error(message, details);
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: jsonError("로그인이 필요합니다.", 401) } as const;

  const { data: requester, error: profileError } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profileError || requester?.role !== "admin") return { error: jsonError("관리자 권한이 필요합니다.", 403) } as const;

  return { user } as const;
}

function toAccount(profile: ProfileRow, authUser: User, profileVerified = true) {
  return {
    id: authUser.id,
    email: authUser.email || profile.email || "",
    fullName: profile.full_name || "",
    phone: profile.phone,
    role: profile.role as AppRole,
    emailConfirmed: Boolean(authUser.email_confirmed_at),
    profileVerified,
  };
}

function verifyProfile(profile: ProfileRow | null, userId: string, email: string, role: AppRole) {
  return Boolean(profile && profile.id === userId && (profile.email || "").toLowerCase() === email.toLowerCase() && profile.role === role);
}

function buildSummary(authUser: User, profile?: ProfileRow) {
  const validRole = profile?.role && isRole(profile.role) ? profile.role : null;
  let status: AccountStatus = "active";

  if (!profile) status = "missing_profile";
  else if (!validRole) status = "missing_role";
  else if (!authUser.email_confirmed_at) status = "unconfirmed_email";
  else if (profile.id !== authUser.id || !authUser.email || !profile.email || profile.email.toLowerCase() !== authUser.email.toLowerCase() || !profile.full_name) status = "inconsistent";

  return {
    id: authUser.id,
    email: authUser.email || profile?.email || "",
    fullName: profile?.full_name || String(authUser.user_metadata?.full_name || ""),
    phone: profile?.phone || null,
    authExists: true,
    profileExists: Boolean(profile),
    emailConfirmed: Boolean(authUser.email_confirmed_at),
    role: validRole,
    status,
    createdAt: profile?.created_at || authUser.created_at || null,
  };
}

async function listAllAuthUsers(admin: ReturnType<typeof createAdminClient>) {
  const users: User[] = [];
  const perPage = 100;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return users;
}

async function upsertAndVerifyProfile(admin: ReturnType<typeof createAdminClient>, params: { userId: string; email: string; fullName: string; phone: string; role: AppRole }) {
  const { userId, email, fullName, phone, role } = params;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, email, full_name: fullName, phone: phone || null, role }, { onConflict: "id" })
    .select("id,email,full_name,phone,role,created_at")
    .single<ProfileRow>();

  if (profileError) throw new Error("PROFILE_UPSERT_FAILED");
  if (!verifyProfile(profile, userId, email, role)) throw new Error("PROFILE_VERIFICATION_FAILED");
  return profile;
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const admin = createAdminClient();
    const authUsers = await listAllAuthUsers(admin);
    const ids = authUsers.map((user) => user.id);
    const { data: profiles, error } = ids.length
      ? await admin.from("profiles").select("id,email,full_name,phone,role,created_at").in("id", ids)
      : { data: [], error: null };
    if (error) throw error;

    const profileMap = new Map((profiles as ProfileRow[]).map((profile) => [profile.id, profile]));
    return NextResponse.json({ accounts: authUsers.map((authUser) => buildSummary(authUser, profileMap.get(authUser.id))) });
  } catch (error) {
    safeLog("Failed to list admin accounts", { message: error instanceof Error ? error.message : "unknown" });
    return jsonError("계정 목록을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let newUserId: string | null = null;
  try {
    const body = await request.json();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const role = String(body.role || "parent");
    const studentIds = Array.isArray(body.studentIds) ? Array.from(new Set(body.studentIds.filter((value: unknown) => typeof value === "string" && value.trim()).map((value: string) => value.trim()))) : [];

    if (!isValidEmail(email)) return jsonError("이메일 형식을 확인해주세요.", 400);
    if (!fullName) return jsonError("이름을 입력해주세요.", 400);
    if (password.length < 8) return jsonError("비밀번호는 8자 이상이어야 합니다.", 400);
    if (!isRole(role)) return jsonError("권한 값이 올바르지 않습니다.", 400);
    if (role === "parent" && studentIds.length === 0) return jsonError("학부모 계정은 한 명 이상의 학생을 연결해야 합니다.", 400);

    const admin = createAdminClient();
    if (role === "parent") {
      const { data: students, error: studentError } = await admin.from("students").select("id").in("id", studentIds);
      if (studentError || (students || []).length !== studentIds.length) return jsonError("연결할 학생 정보를 확인해주세요.", 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, role } });
    if (createError || !created.user) {
      const message = createError?.message?.toLowerCase() || "";
      if (message.includes("already") || message.includes("registered") || message.includes("exists") || message.includes("duplicate")) return jsonError(DUPLICATE_EMAIL_MESSAGE, 409);
      safeLog("Failed to create auth user", { email, code: createError?.code, status: createError?.status });
      return jsonError("계정 생성에 실패했습니다.", 400);
    }

    newUserId = created.user.id;
    const profile = await upsertAndVerifyProfile(admin, { userId: newUserId, email, fullName, phone, role });

    if (role === "parent") {
      const rows = studentIds.map((studentId) => ({ parent_id: newUserId, student_id: studentId }));
      const { error: linkError } = await admin.from("parent_students").insert(rows);
      if (linkError) throw new Error("PARENT_LINK_FAILED");
    }

    return NextResponse.json({ account: toAccount(profile, created.user) });
  } catch (error) {
    safeLog("Admin account creation failed", { message: error instanceof Error ? error.message : "unknown", newUserId });
    if (newUserId) {
      try { await createAdminClient().auth.admin.deleteUser(newUserId); } catch (cleanupError) { safeLog("Failed to clean up auth user after account creation error", { newUserId, message: cleanupError instanceof Error ? cleanupError.message : "unknown" }); }
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "PROFILE_UPSERT_FAILED") return jsonError("프로필 생성에 실패했습니다.", 500);
    if (message === "PROFILE_VERIFICATION_FAILED") return jsonError("계정 검증에 실패했습니다.", 500);
    if (message === "PARENT_LINK_FAILED") return jsonError("학부모-학생 연결에 실패했습니다.", 500);
    return jsonError("계정 생성 중 오류가 발생했습니다.", 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await request.json();
    const userId = String(body.userId || "").trim();
    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const role = String(body.role || "");

    if (!userId || !fullName) return jsonError("계정 ID와 이름을 입력해주세요.", 400);
    if (!isRole(role)) return jsonError("권한 값이 올바르지 않습니다.", 400);

    const admin = createAdminClient();
    if (auth.user.id === userId && role !== "admin") {
      const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if (countError || (count || 0) <= 1) return jsonError("마지막 관리자 계정의 관리자 권한은 제거할 수 없습니다.", 400);
    }

    const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !target.user?.email) return jsonError("대상 Auth 사용자를 찾을 수 없습니다.", 404);

    const profile = await upsertAndVerifyProfile(admin, { userId, email: target.user.email.toLowerCase(), fullName, phone, role });
    return NextResponse.json({ account: toAccount(profile, target.user) });
  } catch (error) {
    safeLog("Admin account repair failed", { message: error instanceof Error ? error.message : "unknown" });
    const message = error instanceof Error ? error.message : "";
    if (message === "PROFILE_UPSERT_FAILED") return jsonError("프로필 복구에 실패했습니다.", 500);
    if (message === "PROFILE_VERIFICATION_FAILED") return jsonError("복구된 계정 검증에 실패했습니다.", 500);
    return jsonError("계정 복구 중 오류가 발생했습니다.", 500);
  }
}
