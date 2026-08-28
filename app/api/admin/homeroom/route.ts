import { NextResponse } from "next/server";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { createClient } from "@/lib/supabase/server";
import { compareGrades } from "@/lib/grade-sort";
import { MAX_NAME_LENGTH } from "@/lib/early-dismissal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The homeroom roster, the vice principal, and the staff accounts an admin can link them to. */
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  const supabase = await createClient();

  const [assignmentsRes, officerRes, staffRolesRes, studentGradesRes] = await Promise.all([
    supabase.from("homeroom_assignments").select("grade,teacher_id,teacher_name"),
    supabase.from("school_officers").select("role_key,profile_id,person_name").eq("role_key", "vice_principal").maybeSingle(),
    supabase.from("profile_roles").select("profile_id").in("role", ["admin", "teacher"]),
    supabase.from("students").select("grade").eq("active", true),
  ]);
  if (assignmentsRes.error) return adminJsonError("홈룸 정보를 불러오지 못했습니다.", 500);

  const staffIds = Array.from(new Set((staffRolesRes.data || []).map((row: any) => row.profile_id)));
  const { data: staffProfiles } = staffIds.length
    ? await supabase.from("profiles").select("id,full_name,email").in("id", staffIds)
    : { data: [] as any[] };

  const assignedGrades = new Set((assignmentsRes.data || []).map((row: any) => row.grade));
  // Grades in use by the roster but never assigned still need a row in the UI, otherwise a new
  // grade label silently has no homeroom teacher and no way to pick one.
  const unassignedGrades = Array.from(new Set((studentGradesRes.data || []).map((row: any) => row.grade).filter(Boolean))).filter((grade) => !assignedGrades.has(grade));

  const assignments = [
    ...(assignmentsRes.data || []).map((row: any) => ({ grade: row.grade, teacherId: row.teacher_id, teacherName: row.teacher_name })),
    ...unassignedGrades.map((grade) => ({ grade, teacherId: null, teacherName: "" })),
  ].sort((a, b) => compareGrades(a.grade, b.grade));

  return NextResponse.json({
    assignments,
    vicePrincipal: { profileId: (officerRes.data as any)?.profile_id || null, personName: (officerRes.data as any)?.person_name || "" },
    staff: (staffProfiles || []).map((row: any) => ({ id: row.id, fullName: row.full_name || "", email: row.email || "" })).sort((a: any, b: any) => a.fullName.localeCompare(b.fullName)),
  });
}

/** Upserts one homeroom assignment or the vice principal. */
export async function PUT(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  const supabase = await createClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return adminJsonError("입력값을 확인해 주세요.", 400);
  }

  const teacherId = body.teacherId ? String(body.teacherId).trim() : null;
  const name = String(body.name || "").trim().slice(0, MAX_NAME_LENGTH);

  // A linked account is the source of truth for permissions, so its own display name is what the
  // roster shows -- an admin cannot label a linked slot with someone else's name.
  let resolvedName = name;
  if (teacherId) {
    const { data: profile, error } = await supabase.from("profiles").select("full_name").eq("id", teacherId).maybeSingle();
    if (error || !profile) return adminJsonError("선택한 계정을 찾을 수 없습니다.", 400);
    resolvedName = (profile as any).full_name || name;
  }

  if (body.target === "vice_principal") {
    const { error } = await supabase.from("school_officers").upsert({ role_key: "vice_principal", profile_id: teacherId, person_name: resolvedName, updated_at: new Date().toISOString() }, { onConflict: "role_key" });
    if (error) return adminJsonError("교감 선생님을 저장하지 못했습니다.", 500);
    return NextResponse.json({ success: true, message: "교감 선생님을 저장했습니다." });
  }

  const grade = String(body.grade || "").trim();
  if (!grade) return adminJsonError("학년을 선택해 주세요.", 400);
  const { error } = await supabase.from("homeroom_assignments").upsert({ grade, teacher_id: teacherId, teacher_name: resolvedName, updated_at: new Date().toISOString() }, { onConflict: "grade" });
  if (error) return adminJsonError("홈룸 선생님을 저장하지 못했습니다.", 500);
  return NextResponse.json({ success: true, message: `${grade} 홈룸 선생님을 저장했습니다.` });
}
