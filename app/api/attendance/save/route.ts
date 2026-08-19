import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendNoticePushes } from "@/lib/push/send";
import { getUserRoles } from "@/lib/roles-server";
import { effectiveStaffRole } from "@/lib/roles";
import { attendanceChangeType, buildAttendanceNotice } from "@/lib/attendance/format";
import { attendanceReasonErrorMessage, buildAttendanceReasonTemplate, hasMeaningfulReasonAfterTemplate } from "@/lib/attendance/reasons";
import { currentStatus, latestStatusByStudentDate } from "@/lib/attendance/aggregate";
import { ATTENDANCE_STATUSES, emptyExceptionCounts, type AttendanceCellChange, type AttendanceExceptionStatus, type AttendanceStatus } from "@/lib/attendance/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_SAVE_ERROR = "출결 내역을 저장하지 못했습니다. 다시 시도해 주세요.";
const SAVE_ERROR_CODE = "ATTENDANCE_SAVE_FAILED";
const CONFLICT_ERROR = "다른 사용자가 이 출결 내역을 먼저 변경했습니다. 최신 내용을 확인한 후 다시 저장해 주세요.";

type StaffAuth = { supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string }; role: string };

type AttendanceSaveDiagnostic = {
  requestId: string;
  operation: string;
  table?: string;
  userId?: string;
  batchId?: string | null;
  role?: string;
  submittedChangeCount?: number;
  affectedStudentIds?: string[];
  academicYear?: number;
  semester?: number;
  month?: number;
  saveMethod: "authenticated-rls-insert";
  errorCode?: string;
  errorMessage?: string;
  insertedRowCount?: number;
  refetchResult?: string;
};

function logAttendanceSaveDiagnostic(diagnostic: AttendanceSaveDiagnostic) {
  console.error("attendance-save-diagnostic", diagnostic);
}

function failure(diagnostic: AttendanceSaveDiagnostic, status = 500) {
  logAttendanceSaveDiagnostic(diagnostic);
  return NextResponse.json({ error: SAFE_SAVE_ERROR, code: SAVE_ERROR_CODE, errorId: diagnostic.requestId }, { status });
}

async function staff(requestId: string): Promise<StaffAuth | { e: NextResponse }> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) {
    return { e: NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 }) };
  }
  const roles = await getUserRoles(supabase, user.id);
  const isStaff = roles.includes("admin") || roles.includes("teacher");
  if (!isStaff) {
    return { e: NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 }) };
  }
  return { supabase, user: { id: user.id }, role: effectiveStaffRole(roles) || "teacher" };
}

function isDateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidStatus(value: unknown): value is AttendanceStatus {
  return typeof value === "string" && (ATTENDANCE_STATUSES as string[]).includes(value);
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const a = await staff(requestId);
  if ("e" in a) return a.e;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "저장할 변경사항을 확인해주세요." }, { status: 400 });
  }

  const changes = (Array.isArray(body.changes) ? body.changes : []) as AttendanceCellChange[];
  const academicYear = Number(body.academicYear);
  const semester = Number(body.semester);
  const month = Number(body.month);
  const idempotencyKey = String(body.idempotencyKey || "");
  const affectedStudentIds = Array.from(new Set(changes.map((change) => change.studentId).filter(Boolean)));
  const baseDiagnostic = { requestId, userId: a.user.id, role: a.role, submittedChangeCount: changes.length, affectedStudentIds, academicYear, semester, month, saveMethod: "authenticated-rls-insert" as const };

  if (!idempotencyKey || !academicYear || ![1, 2].includes(semester) || month < 1 || month > 12 || !changes.length || !affectedStudentIds.length) {
    return NextResponse.json({ error: "저장할 변경사항을 확인해주세요." }, { status: 400 });
  }

  for (const change of changes) {
    if (!change.studentId || !isDateOnly(change.date) || !isValidStatus(change.previousStatus) || !isValidStatus(change.newStatus)) {
      return NextResponse.json({ error: "저장할 변경사항을 확인해주세요." }, { status: 400 });
    }
    if (change.previousStatus === change.newStatus) {
      return NextResponse.json({ error: "변경된 내용이 없습니다." }, { status: 400 });
    }
  }

  const submittedStudentsRes = await a.supabase.from("students").select("id,name").in("id", affectedStudentIds);
  if (submittedStudentsRes.error) return failure({ ...baseDiagnostic, operation: "select", table: "students", errorCode: submittedStudentsRes.error.code, errorMessage: submittedStudentsRes.error.message });
  for (const change of changes) {
    const student = (submittedStudentsRes.data || []).find((s: any) => s.id === change.studentId);
    if (!student?.name) return NextResponse.json({ error: "학생 정보를 확인할 수 없습니다." }, { status: 400 });
    const template = buildAttendanceReasonTemplate({ studentName: student.name, date: change.date, previousStatus: change.previousStatus, newStatus: change.newStatus });
    const parentVisibleReason = String(change.parentVisibleReason || "").trim();
    if (!hasMeaningfulReasonAfterTemplate(parentVisibleReason, template)) {
      return NextResponse.json({ error: attendanceReasonErrorMessage(change.newStatus) }, { status: 400 });
    }
  }

  const existing = await a.supabase.from("attendance_change_batches").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing.error) return failure({ ...baseDiagnostic, operation: "select", table: "attendance_change_batches", errorCode: existing.error.code, errorMessage: existing.error.message });
  if (existing.data) {
    return NextResponse.json({ success: true, attendance_saved: true, idempotent: true, message: "이미 처리된 변경사항입니다.", batch_id: existing.data.id, batchId: existing.data.id, affected_students: affectedStudentIds.length, inserted_entries: 0, notices_created: 0 });
  }

  const currentRes = await a.supabase.from("attendance_entries").select("student_id,attendance_date,new_status,created_at").in("student_id", affectedStudentIds).eq("academic_year", academicYear).eq("semester", semester);
  if (currentRes.error) return failure({ ...baseDiagnostic, operation: "select", table: "attendance_entries", errorCode: currentRes.error.code, errorMessage: currentRes.error.message });
  const currentMap = latestStatusByStudentDate(currentRes.data || []);
  for (const change of changes) {
    const currentValue = currentStatus(currentMap, change.studentId, change.date);
    if (currentValue !== change.previousStatus) {
      logAttendanceSaveDiagnostic({ ...baseDiagnostic, operation: "concurrency-check", table: "attendance_entries", errorCode: "ATTENDANCE_SAVE_CONFLICT", errorMessage: `expected ${change.previousStatus}, found ${currentValue}` });
      return NextResponse.json({ error: CONFLICT_ERROR, code: "ATTENDANCE_SAVE_CONFLICT", errorId: requestId }, { status: 409 });
    }
  }

  const batchRes = await a.supabase.from("attendance_change_batches").insert({ idempotency_key: idempotencyKey, academic_year: academicYear, semester, month, author_id: a.user.id }).select("id").single();
  if (batchRes.error || !batchRes.data) return failure({ ...baseDiagnostic, operation: "insert", table: "attendance_change_batches", errorCode: batchRes.error?.code, errorMessage: batchRes.error?.message });
  const batchId = batchRes.data.id;

  const rows = changes.map((change) => ({
    batch_id: batchId,
    student_id: change.studentId,
    attendance_date: change.date,
    academic_year: academicYear,
    semester,
    month,
    previous_status: change.previousStatus,
    new_status: change.newStatus,
    change_type: attendanceChangeType(change.newStatus),
    parent_visible_reason: String(change.parentVisibleReason || "").trim() || null,
    teacher_note: change.teacherNote || null,
    author_id: a.user.id,
  }));

  const entryRes = await a.supabase.from("attendance_entries").insert(rows).select("id,student_id,attendance_date,new_status");
  if (entryRes.error || !entryRes.data) return failure({ ...baseDiagnostic, batchId, operation: "insert", table: "attendance_entries", errorCode: entryRes.error?.code, errorMessage: entryRes.error?.message });
  if (entryRes.data.length !== rows.length) return failure({ ...baseDiagnostic, batchId, operation: "insert", table: "attendance_entries", errorCode: "INSERTED_ROW_COUNT_MISMATCH", errorMessage: `Expected ${rows.length}, inserted ${entryRes.data.length}.`, insertedRowCount: entryRes.data.length });

  const [allEntriesRes, linksRes] = await Promise.all([
    a.supabase.from("attendance_entries").select("student_id,attendance_date,new_status,created_at").in("student_id", affectedStudentIds).eq("academic_year", academicYear).eq("semester", semester),
    a.supabase.from("parent_students").select("student_id,parent_id").in("student_id", affectedStudentIds),
  ]);
  if (allEntriesRes.error) return failure({ ...baseDiagnostic, batchId, operation: "select", table: "attendance_entries", errorCode: allEntriesRes.error.code, errorMessage: allEntriesRes.error.message, insertedRowCount: entryRes.data.length });
  if (linksRes.error) return failure({ ...baseDiagnostic, batchId, operation: "select", table: "parent_students", errorCode: linksRes.error.code, errorMessage: linksRes.error.message, insertedRowCount: entryRes.data.length });

  const latestMap = latestStatusByStudentDate(allEntriesRes.data || []);
  const monthPrefix = `${academicYear}-${String(month).padStart(2, "0")}`;

  let notices = 0;
  let recipients = 0;
  const missing: string[] = [];
  const createdNotices: Array<{ notice: { id: string; target_scope: string; target_grade: string | null; title: string; body: string; created_by: string }; studentId: string }> = [];
  for (const studentId of affectedStudentIds) {
    const student = (submittedStudentsRes.data || []).find((s: any) => s.id === studentId);
    const perStudentChanges = changes.filter((change) => change.studentId === studentId);
    const monthCounts = emptyExceptionCounts();
    for (const [key, entry] of latestMap) {
      const [sid, date] = key.split(":");
      if (sid !== studentId || !date.startsWith(monthPrefix) || entry.status === "present") continue;
      monthCounts[entry.status as AttendanceExceptionStatus]++;
    }
    const content = buildAttendanceNotice(student?.name || "학생", perStudentChanges, monthCounts);
    const noticeRes = await a.supabase.from("notices").insert({ type: "attendance", title: content.title, body: content.body, target_scope: "student", requires_confirmation: true, created_by: a.user.id, published_at: new Date().toISOString(), source_type: "attendance_update", source_id: batchId }).select("id,target_scope,target_grade").single();
    if (noticeRes.error || !noticeRes.data) {
      logAttendanceSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "insert", table: "notices", errorCode: noticeRes.error?.code, errorMessage: noticeRes.error?.message, insertedRowCount: entryRes.data.length });
      continue;
    }
    const noticeStudentRes = await a.supabase.from("notice_students").insert({ notice_id: noticeRes.data.id, student_id: studentId }).select("notice_id").single();
    if (noticeStudentRes.error || !noticeStudentRes.data) {
      logAttendanceSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "insert", table: "notice_students", errorCode: noticeStudentRes.error?.code, errorMessage: noticeStudentRes.error?.message, insertedRowCount: entryRes.data.length });
      continue;
    }
    const uniqueParents = new Set((linksRes.data || []).filter((link: any) => link.student_id === studentId).map((link: any) => link.parent_id));
    const recipientCount = uniqueParents.size;
    if (!recipientCount) missing.push(studentId);
    const generatedRes = await a.supabase.from("attendance_generated_notices").upsert({ batch_id: batchId, student_id: studentId, notice_id: noticeRes.data.id, recipient_count: recipientCount, push_sent_count: 0, push_failed_count: 0 }).select("batch_id").single();
    if (generatedRes.error || !generatedRes.data) logAttendanceSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "upsert", table: "attendance_generated_notices", errorCode: generatedRes.error?.code, errorMessage: generatedRes.error?.message, insertedRowCount: entryRes.data.length });
    notices++;
    recipients += recipientCount;
    createdNotices.push({ notice: { ...noticeRes.data, title: content.title, body: content.body, created_by: a.user.id }, studentId });
  }

  const parentIds = Array.from(new Set((linksRes.data || []).map((link: any) => link.parent_id).filter(Boolean)));
  if (parentIds.length) {
    const eventRes = await a.supabase.from("parent_dashboard_events").insert(parentIds.map((parentId) => ({ parent_id: parentId, event_type: "attendance_updated", entity_id: batchId })));
    if (eventRes.error) return failure({ ...baseDiagnostic, batchId, operation: "insert", table: "parent_dashboard_events", errorCode: eventRes.error.code, errorMessage: eventRes.error.message, insertedRowCount: entryRes.data.length });
  }

  if (createdNotices.length) {
    after(async () => {
      const admin = createAdminClient();
      for (const item of createdNotices) {
        try {
          const push = await sendNoticePushes(item.notice);
          const { error } = await admin.from("attendance_generated_notices").update({ push_sent_count: push.sent, push_failed_count: push.failed }).eq("batch_id", batchId).eq("student_id", item.studentId);
          if (error) console.error("attendance-push-count-update-failed", { batchId, noticeId: item.notice.id, code: error.code, message: error.message });
        } catch (error) {
          console.error("attendance-push-background-failed", { batchId, noticeId: item.notice.id, message: error instanceof Error ? error.message : "unknown" });
        }
      }
    });
  }

  if (missing.length) {
    const missingRes = await a.supabase.from("attendance_change_batches").update({ missing_parent_student_ids: missing }).eq("id", batchId).select("id").single();
    if (missingRes.error || !missingRes.data) logAttendanceSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "update", table: "attendance_change_batches", errorCode: missingRes.error?.code, errorMessage: missingRes.error?.message, insertedRowCount: entryRes.data.length });
  }

  logAttendanceSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "save-complete", table: "attendance_entries", insertedRowCount: entryRes.data.length, refetchResult: "client-grid-refetch-required" });
  return NextResponse.json({
    success: true,
    attendance_saved: true,
    notice_created: notices > 0,
    push_started: createdNotices.length > 0,
    message: "출결 내역과 학부모 알림이 저장되었습니다. 푸시 알림 전송을 시작했습니다.",
    batch_id: batchId,
    batchId,
    affected_students: affectedStudentIds.length,
    inserted_entries: entryRes.data.length,
    notices_created: notices,
    notices,
    recipients,
    missingParentStudentIds: missing,
  });
}
