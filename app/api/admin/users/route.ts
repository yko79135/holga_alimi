import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { APP_ROLES, type AppRole, isAppRole, normalizeRoles } from "@/lib/roles";

type AccountStatus = "active" | "missing_profile" | "missing_role" | "unconfirmed_email" | "inconsistent";

type SafeAccountListErrorCode = "PROFILE_ROLES_MIGRATION_REQUIRED" | "ACCOUNT_LIST_RELATION_ERROR" | "ACCOUNT_LIST_FAILED";
type SupabaseErrorLike = { code?: string; message?: string; details?: string; hint?: string };

const PROFILE_ROLES_RELATION = "profile_roles:profile_roles!profile_roles_profile_id_fkey(role)";
const ACCOUNT_LIST_SELECT = `
    id,
    email,
    full_name,
    phone,
    role,
    created_at,
    ${PROFILE_ROLES_RELATION},
    parent_students(
      student_id,
      students(id,name,grade)
    )
  `;

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  created_at: string | null;
};

const VALID_ROLES: AppRole[] = APP_ROLES;
const DUPLICATE_EMAIL_MESSAGE = "이미 사용 중인 이메일입니다. 다른 로그인 이메일을 입력해 주세요.";

function isRole(value: string): value is AppRole { return isAppRole(value); }

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeLog(message: string, details?: Record<string, unknown>) {
  console.error(message, details);
}

function logSupabaseError(message: string, error: unknown) {
  const supabaseError = error as SupabaseErrorLike;
  safeLog(message, {
    code: supabaseError?.code,
    message: supabaseError?.message,
    details: supabaseError?.details,
    hint: supabaseError?.hint,
  });
}

function accountListError(message: string, code: SafeAccountListErrorCode, status = 500) {
  return NextResponse.json({ error: message, code }, { status });
}

function isProfileRolesMigrationError(error: unknown) {
  const supabaseError = error as SupabaseErrorLike;
  const code = supabaseError?.code || "";
  const message = `${supabaseError?.message || ""} ${supabaseError?.details || ""} ${supabaseError?.hint || ""}`.toLowerCase();
  return code === "42P01" || code === "PGRST205" || (message.includes("profile_roles") && (message.includes("does not exist") || message.includes("not find") || message.includes("schema cache")));
}

function isRelationError(error: unknown) {
  const supabaseError = error as SupabaseErrorLike;
  const code = supabaseError?.code || "";
  const message = `${supabaseError?.message || ""} ${supabaseError?.details || ""} ${supabaseError?.hint || ""}`.toLowerCase();
  return code === "PGRST200" || code === "PGRST201" || message.includes("relationship") || message.includes("ambiguous");
}

function toAccount(profile: ProfileRow, authUser: User, profileVerified = true) {
  return {
    id: authUser.id,
    email: authUser.email || profile.email || "",
    fullName: profile.full_name || "",
    phone: profile.phone,
    role: profile.role as AppRole,
    roles: (profile as any).roles || [profile.role as AppRole],
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
    roles: Array.isArray((profile as any)?.profile_roles) ? normalizeRoles((profile as any).profile_roles.map((r: any) => r.role)) : validRole ? [validRole] : [],
    status,
    createdAt: profile?.created_at || authUser.created_at || null,
    linkedStudents: Array.isArray((profile as any)?.parent_students) ? (profile as any).parent_students.map((link: any) => link.students).filter(Boolean) : [],
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

    const { error: profileRolesError } = await admin.from("profile_roles").select("profile_id,assigned_by").limit(1);
    if (profileRolesError) {
      logSupabaseError("Failed to verify profile_roles migration before listing admin accounts", profileRolesError);
      if (isProfileRolesMigrationError(profileRolesError)) {
        return accountListError("다중 권한 데이터베이스 설정이 아직 적용되지 않았습니다. 관리자에게 문의해 주세요.", "PROFILE_ROLES_MIGRATION_REQUIRED");
      }
      return accountListError("계정 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "ACCOUNT_LIST_FAILED");
    }

    const { data: profiles, error } = ids.length
      ? await admin.from("profiles").select(ACCOUNT_LIST_SELECT).in("id", ids)
      : { data: [], error: null };
    if (error) {
      logSupabaseError("Failed to query admin account profiles", error);
      if (isProfileRolesMigrationError(error)) {
        return accountListError("다중 권한 데이터베이스 설정이 아직 적용되지 않았습니다. 관리자에게 문의해 주세요.", "PROFILE_ROLES_MIGRATION_REQUIRED");
      }
      if (isRelationError(error)) {
        return accountListError("계정 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "ACCOUNT_LIST_RELATION_ERROR");
      }
      return accountListError("계정 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "ACCOUNT_LIST_FAILED");
    }

    const profileMap = new Map((profiles as ProfileRow[]).map((profile) => [profile.id, profile]));
    return NextResponse.json({ accounts: authUsers.map((authUser) => buildSummary(authUser, profileMap.get(authUser.id))) });
  } catch (error) {
    logSupabaseError("Failed to list admin accounts", error);
    return accountListError("계정 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "ACCOUNT_LIST_FAILED");
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
    const requestedRoles = normalizeRoles(body.roles || body.role || "parent");
    const primaryRole = requestedRoles[0] || "parent";
    const studentIds = Array.isArray(body.studentIds) ? Array.from(new Set(body.studentIds.filter((value: unknown) => typeof value === "string" && value.trim()).map((value: string) => value.trim()))) : [];

    if (!isValidEmail(email)) return adminJsonError("이메일 형식을 확인해주세요. 하나의 로그인 이메일에 여러 권한을 배정할 수 있습니다.", 400);
    if (!fullName) return adminJsonError("이름을 입력해주세요.", 400);
    if (password.length < 8) return adminJsonError("비밀번호는 8자 이상이어야 합니다.", 400);
    if (!requestedRoles.length) return adminJsonError("하나 이상의 권한을 선택해주세요.", 400);
    const admin = createAdminClient();
    if (requestedRoles.includes("parent") && studentIds.length > 0) {
      const { data: students, error: studentError } = await admin.from("students").select("id").in("id", studentIds);
      if (studentError || (students || []).length !== studentIds.length) return adminJsonError("연결할 학생 정보를 확인해주세요.", 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, role: primaryRole } });
    if (createError || !created.user) {
      const message = createError?.message?.toLowerCase() || "";
      if (message.includes("already") || message.includes("registered") || message.includes("exists") || message.includes("duplicate") || createError?.code === "email_exists") return adminJsonError(DUPLICATE_EMAIL_MESSAGE, 409);
      safeLog("Failed to create auth user", { email, code: createError?.code, status: createError?.status });
      return adminJsonError("계정 생성에 실패했습니다.", 400);
    }

    newUserId = created.user.id;
    const profile = await upsertAndVerifyProfile(admin, { userId: newUserId, email, fullName, phone, role: primaryRole });
    const roleRows = requestedRoles.map((role) => ({ profile_id: newUserId, role, assigned_by: auth.user.id }));
    const { error: roleError } = await admin.from("profile_roles").upsert(roleRows, { onConflict: "profile_id,role" });
    if (roleError) throw new Error("ROLE_ASSIGN_FAILED");
    (profile as any).roles = requestedRoles;

    if (requestedRoles.includes("parent") && studentIds.length > 0) {
      const rows = studentIds.map((studentId) => ({ parent_id: newUserId, student_id: studentId }));
      const { error: linkError } = await admin.from("parent_students").insert(rows);
      if (linkError && linkError.code !== "23505") throw new Error("PARENT_LINK_FAILED");
    }

    return NextResponse.json({ account: toAccount(profile, created.user) });
  } catch (error) {
    safeLog("Admin account creation failed", { message: error instanceof Error ? error.message : "unknown", newUserId });
    if (newUserId) {
      try { await createAdminClient().auth.admin.deleteUser(newUserId); } catch (cleanupError) { safeLog("Failed to clean up auth user after account creation error", { newUserId, message: cleanupError instanceof Error ? cleanupError.message : "unknown" }); }
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "PROFILE_UPSERT_FAILED") return adminJsonError("프로필 생성에 실패했습니다.", 500);
    if (message === "PROFILE_VERIFICATION_FAILED") return adminJsonError("계정 검증에 실패했습니다.", 500);
    if (message === "ROLE_ASSIGN_FAILED") return adminJsonError("권한 배정에 실패했습니다.", 500);
    if (message === "PARENT_LINK_FAILED") return adminJsonError("학부모-학생 연결에 실패했습니다.", 500);
    return adminJsonError("계정 생성 중 오류가 발생했습니다.", 500);
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

    if (!userId || !fullName) return adminJsonError("계정 ID와 이름을 입력해주세요.", 400);
    if (!isRole(role)) return adminJsonError("권한 값이 올바르지 않습니다.", 400);

    const admin = createAdminClient();
    if (auth.user.id === userId && role !== "admin") {
      const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if (countError || (count || 0) <= 1) return adminJsonError("마지막 관리자 계정의 관리자 권한은 제거할 수 없습니다.", 400);
    }

    const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !target.user?.email) return adminJsonError("대상 Auth 사용자를 찾을 수 없습니다.", 404);

    const profile = await upsertAndVerifyProfile(admin, { userId, email: target.user.email.toLowerCase(), fullName, phone, role });
    return NextResponse.json({ account: toAccount(profile, target.user) });
  } catch (error) {
    safeLog("Admin account repair failed", { message: error instanceof Error ? error.message : "unknown" });
    const message = error instanceof Error ? error.message : "";
    if (message === "PROFILE_UPSERT_FAILED") return adminJsonError("프로필 복구에 실패했습니다.", 500);
    if (message === "PROFILE_VERIFICATION_FAILED") return adminJsonError("복구된 계정 검증에 실패했습니다.", 500);
    return adminJsonError("계정 복구 중 오류가 발생했습니다.", 500);
  }
}
