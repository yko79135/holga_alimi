import { NextResponse } from "next/server";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteNoticePermanently } from "@/lib/admin/delete-notice";

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
async function preview(studentId: string) {
  const admin = createAdminClient();
  const { data: student, error } = await admin.from("students").select("id,name,grade").eq("id", studentId).single();
  if (error || !student) throw new Error("STUDENT_NOT_FOUND");
  const [{ count: parentLinkCount, error: parentError }, { data: noticeLinks, error: noticeError }] = await Promise.all([
    admin.from("parent_students").select("student_id", { count: "exact", head: true }).eq("student_id", studentId),
    admin.from("notice_students").select("notice_id,notices!inner(target_scope)").eq("student_id", studentId).eq("notices.target_scope", "student"),
  ]);
  if (parentError || noticeError) throw new Error("PREVIEW_FAILED");
  return { student, parentLinkCount: parentLinkCount || 0, individualNoticeCount: (noticeLinks || []).length };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(); if ("error" in auth) return auth.error;
  const { id } = await params; const studentId = String(id || "").trim();
  if (!validUuid(studentId)) return adminJsonError("학생 ID를 확인해주세요.", 400);
  try { const p = await preview(studentId); return NextResponse.json({ name: p.student.name, grade: p.student.grade, parentLinkCount: p.parentLinkCount, individualNoticeCount: p.individualNoticeCount }); }
  catch (error) { if (error instanceof Error && error.message === "STUDENT_NOT_FOUND") return adminJsonError("학생을 찾을 수 없습니다.", 404); return adminJsonError("삭제 영향을 확인하지 못했습니다.", 500); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(); if ("error" in auth) return auth.error;
  const { id } = await params; const studentId = String(id || "").trim();
  if (!validUuid(studentId)) return adminJsonError("학생 ID를 확인해주세요.", 400);
  try {
    const admin = createAdminClient();
    const { data: student, error: studentError } = await admin.from("students").select("id,name").eq("id", studentId).single();
    if (studentError || !student) return adminJsonError("학생을 찾을 수 없습니다.", 404);
    const { data: links, error: linksError } = await admin.from("notice_students").select("notice_id,notices!inner(target_scope)").eq("student_id", studentId).eq("notices.target_scope", "student");
    if (linksError) throw new Error("NOTICE_LINK_LOOKUP_FAILED");
    let orphanedNoticesDeleted = 0;
    for (const link of links || []) {
      const { count, error: countError } = await admin.from("notice_students").select("student_id", { count: "exact", head: true }).eq("notice_id", link.notice_id);
      if (countError) throw new Error("NOTICE_TARGET_COUNT_FAILED");
      if ((count || 0) <= 1) { await deleteNoticePermanently(link.notice_id); orphanedNoticesDeleted += 1; }
    }
    const { error: deleteError } = await admin.from("students").delete().eq("id", studentId);
    if (deleteError) throw new Error("STUDENT_DELETE_FAILED");
    return NextResponse.json({ message: "학생을 영구 삭제했습니다.", orphanedNoticesDeleted });
  } catch (error) {
    console.error("Admin student deletion failed", { studentId, message: error instanceof Error ? error.message : "unknown" });
    return adminJsonError("학생 삭제에 실패했습니다.", 500);
  }
}
