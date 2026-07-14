import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";

type Params = { params: Promise<{ id: string }> };

type LinkRow = {
  parent_id: string;
  student_id: string;
  profiles: { id: string; full_name: string | null; email: string | null } | null;
};

type ParentStudentRow = {
  parent_id: string;
  students: { id: string; name: string; grade: string } | null;
};

async function getStudentId(context: Params) {
  const { id } = await context.params;
  return String(id || "").trim();
}

export async function GET(_request: Request, context: Params) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const studentId = await getStudentId(context);
  if (!studentId) return adminJsonError("학생 정보를 확인해주세요.", 400);

  const admin = createAdminClient();
  const { data: student } = await admin.from("students").select("id").eq("id", studentId).maybeSingle();
  if (!student) return adminJsonError("학생을 찾을 수 없습니다.", 404);

  const { data: links, error } = await admin
    .from("parent_students")
    .select("parent_id,student_id,profiles(id,full_name,email)")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });
  if (error) return adminJsonError("학부모 연결 정보를 불러오지 못했습니다.", 500);

  const parentIds = (links || []).map((link) => link.parent_id);
  const { data: siblingLinks, error: siblingError } = parentIds.length
    ? await admin.from("parent_students").select("parent_id,students(id,name,grade)").in("parent_id", parentIds)
    : { data: [], error: null };
  if (siblingError) return adminJsonError("연결된 학생 정보를 불러오지 못했습니다.", 500);

  const studentsByParent = new Map<string, Array<{ id: string; name: string; grade: string }>>();
  for (const row of (siblingLinks || []) as unknown as ParentStudentRow[]) {
    if (!row.students) continue;
    studentsByParent.set(row.parent_id, [...(studentsByParent.get(row.parent_id) || []), row.students]);
  }

  return NextResponse.json({
    linkedParents: ((links || []) as unknown as LinkRow[]).map((link) => ({
      parentId: link.parent_id,
      fullName: link.profiles?.full_name || "",
      email: link.profiles?.email || "",
      linkedStudents: studentsByParent.get(link.parent_id) || [],
    })),
  });
}

export async function POST(request: Request, context: Params) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const studentId = await getStudentId(context);
  const { parentId } = await request.json().catch(() => ({ parentId: "" }));
  const normalizedParentId = String(parentId || "").trim();
  if (!studentId || !normalizedParentId) return adminJsonError("학생과 학부모 계정을 선택해주세요.", 400);

  const admin = createAdminClient();
  const [{ data: student }, { data: parent }] = await Promise.all([
    admin.from("students").select("id").eq("id", studentId).maybeSingle(),
    admin.from("profiles").select("id,role").eq("id", normalizedParentId).eq("role", "parent").maybeSingle(),
  ]);
  if (!student) return adminJsonError("학생을 찾을 수 없습니다.", 404);
  if (!parent) return adminJsonError("학부모 계정을 찾을 수 없습니다.", 404);

  const { error } = await admin.from("parent_students").insert({ parent_id: normalizedParentId, student_id: studentId });
  if (error) {
    if (error.code === "23505") return adminJsonError("이미 연결된 학부모 계정입니다.", 409);
    return adminJsonError("학부모 계정 연결에 실패했습니다.", 500);
  }
  return NextResponse.json({ message: "학부모 계정이 학생과 연결되었습니다." });
}

export async function DELETE(request: Request, context: Params) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const studentId = await getStudentId(context);
  const parentId = new URL(request.url).searchParams.get("parentId") || "";
  if (!studentId || !parentId) return adminJsonError("학생과 학부모 계정을 선택해주세요.", 400);

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("parent_students")
    .delete({ count: "exact" })
    .eq("student_id", studentId)
    .eq("parent_id", parentId);
  if (error) return adminJsonError("학부모 계정 연결 해제에 실패했습니다.", 500);
  if (!count) return adminJsonError("이미 삭제되었거나 연결을 찾을 수 없습니다.", 404);
  return NextResponse.json({ message: "학부모 계정 연결이 해제되었습니다." });
}
