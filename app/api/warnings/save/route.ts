import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendNoticePushes } from "@/lib/push/send";
import { buildWarningNotice, changeType } from "@/lib/warnings/format";
import type { WarningCellChange } from "@/lib/warnings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_SAVE_ERROR = "경고 내역을 저장하지 못했습니다. 다시 시도해 주세요.";
const SAVE_ERROR_CODE = "WARNING_SAVE_FAILED";
const CONFLICT_ERROR = "다른 사용자가 이 경고 내역을 먼저 변경했습니다. 최신 내용을 확인한 후 다시 저장해 주세요.";

type StaffAuth = { supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string }; role: string };

type WarningSaveDiagnostic = {
  requestId: string;
  operation: string;
  table?: string;
  functionName?: string;
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

function logWarningSaveDiagnostic(diagnostic: WarningSaveDiagnostic) {
  console.error("warning-save-diagnostic", diagnostic);
}

function failure(diagnostic: WarningSaveDiagnostic, status = 500) {
  logWarningSaveDiagnostic(diagnostic);
  return NextResponse.json({ error: SAFE_SAVE_ERROR, code: SAVE_ERROR_CODE, errorId: diagnostic.requestId }, { status });
}

async function staff(requestId: string): Promise<StaffAuth | { e: NextResponse }> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) {
    return { e: NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 }) };
  }
  const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profileError || !profile) {
    logWarningSaveDiagnostic({ requestId, operation: "select", table: "profiles", userId: user.id, saveMethod: "authenticated-rls-insert", errorCode: profileError?.code, errorMessage: profileError?.message });
    return { e: NextResponse.json({ error: "권한을 확인할 수 없습니다." }, { status: 403 }) };
  }
  if (!["admin", "teacher"].includes(profile.role)) {
    return { e: NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 }) };
  }
  return { supabase, user: { id: user.id }, role: profile.role };
}

function monthTotal(entries: any[], studentId: string, month: number) {
  return entries.filter((e) => e.student_id === studentId && e.month === month).reduce((sum, entry) => sum + Number(entry.delta || 0), 0);
}

function isDateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
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

  const changes = (Array.isArray(body.changes) ? body.changes : []) as WarningCellChange[];
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
    if (!change.studentId || !["daily", "grace_adjustment"].includes(change.entryType) || !Number.isFinite(Number(change.previousValue)) || !Number.isFinite(Number(change.newValue))) {
      return NextResponse.json({ error: "저장할 변경사항을 확인해주세요." }, { status: 400 });
    }
    if (change.entryType === "daily" && !isDateOnly(change.date)) {
      return NextResponse.json({ error: "경고 날짜 형식을 확인해주세요." }, { status: 400 });
    }
  }

  const existing = await a.supabase.from("warning_change_batches").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing.error) return failure({ ...baseDiagnostic, operation: "select", table: "warning_change_batches", errorCode: existing.error.code, errorMessage: existing.error.message });
  if (existing.data) return NextResponse.json({ success: true, warning_saved: true, idempotent: true, message: "이미 처리된 변경사항입니다.", batch_id: existing.data.id, batchId: existing.data.id, affected_students: affectedStudentIds.length, inserted_entries: 0, notices_created: 0 });

  const currentRes = await a.supabase.from("warning_entries").select("student_id,warning_date,entry_type,delta,month").in("student_id", affectedStudentIds).eq("academic_year", academicYear).eq("semester", semester);
  if (currentRes.error) return failure({ ...baseDiagnostic, operation: "select", table: "warning_entries", errorCode: currentRes.error.code, errorMessage: currentRes.error.message });
  const current = currentRes.data || [];
  for (const change of changes) {
    const currentValue = current.filter((entry: any) => entry.student_id === change.studentId && entry.entry_type === change.entryType && (change.entryType === "grace_adjustment" ? entry.month === month : entry.warning_date === change.date)).reduce((sum: number, entry: any) => sum + Number(entry.delta || 0), 0);
    if (currentValue !== Number(change.previousValue)) {
      logWarningSaveDiagnostic({ ...baseDiagnostic, operation: "concurrency-check", table: "warning_entries", errorCode: "WARNING_SAVE_CONFLICT", errorMessage: `expected ${change.previousValue}, found ${currentValue}` });
      return NextResponse.json({ error: CONFLICT_ERROR, code: "WARNING_SAVE_CONFLICT", errorId: requestId }, { status: 409 });
    }
  }

  const batchRes = await a.supabase.from("warning_change_batches").insert({ idempotency_key: idempotencyKey, academic_year: academicYear, semester, month, author_id: a.user.id }).select("id").single();
  if (batchRes.error || !batchRes.data) return failure({ ...baseDiagnostic, operation: "insert", table: "warning_change_batches", errorCode: batchRes.error?.code, errorMessage: batchRes.error?.message });
  const batchId = batchRes.data.id;

  const rows = changes.map((change) => {
    const delta = Number(change.newValue) - Number(change.previousValue);
    return { batch_id: batchId, student_id: change.studentId, warning_date: change.entryType === "daily" ? change.date : null, academic_year: academicYear, semester, month, entry_type: change.entryType, change_type: changeType(delta, change.entryType), previous_value: Number(change.previousValue), new_value: Number(change.newValue), delta, parent_visible_reason: change.parentVisibleReason || null, teacher_note: change.teacherNote || null, author_id: a.user.id };
  }).filter((row) => row.delta !== 0);
  if (!rows.length) return failure({ ...baseDiagnostic, batchId, operation: "insert", table: "warning_entries", errorCode: "ZERO_DELTA_ROWS", errorMessage: "No non-zero warning entry rows were generated.", insertedRowCount: 0 });

  const entryRes = await a.supabase.from("warning_entries").insert(rows).select("id,student_id,warning_date,entry_type,delta");
  if (entryRes.error || !entryRes.data) return failure({ ...baseDiagnostic, batchId, operation: "insert", table: "warning_entries", errorCode: entryRes.error?.code, errorMessage: entryRes.error?.message, insertedRowCount: undefined });
  if (entryRes.data.length !== rows.length) return failure({ ...baseDiagnostic, batchId, operation: "insert", table: "warning_entries", errorCode: "INSERTED_ROW_COUNT_MISMATCH", errorMessage: `Expected ${rows.length}, inserted ${entryRes.data.length}.`, insertedRowCount: entryRes.data.length });

  const [studentsRes, allEntriesRes, linksRes] = await Promise.all([
    a.supabase.from("students").select("id,name").in("id", affectedStudentIds),
    a.supabase.from("warning_entries").select("student_id,delta,month").in("student_id", affectedStudentIds).eq("academic_year", academicYear).eq("semester", semester),
    a.supabase.from("parent_students").select("student_id,parent_id").in("student_id", affectedStudentIds),
  ]);
  if (studentsRes.error) return failure({ ...baseDiagnostic, batchId, operation: "select", table: "students", errorCode: studentsRes.error.code, errorMessage: studentsRes.error.message, insertedRowCount: entryRes.data.length });
  if (allEntriesRes.error) return failure({ ...baseDiagnostic, batchId, operation: "select", table: "warning_entries", errorCode: allEntriesRes.error.code, errorMessage: allEntriesRes.error.message, insertedRowCount: entryRes.data.length });
  if (linksRes.error) return failure({ ...baseDiagnostic, batchId, operation: "select", table: "parent_students", errorCode: linksRes.error.code, errorMessage: linksRes.error.message, insertedRowCount: entryRes.data.length });

  let notices = 0, pushSent = 0, pushFailed = 0, recipients = 0;
  const missing: string[] = [];
  for (const studentId of affectedStudentIds) {
    const student = (studentsRes.data || []).find((s: any) => s.id === studentId);
    const perStudentChanges = changes.filter((change) => change.studentId === studentId);
    const total = monthTotal(allEntriesRes.data || [], studentId, month);
    const content = buildWarningNotice(student?.name || "학생", perStudentChanges, total);
    const noticeRes = await a.supabase.from("notices").insert({ type: "warning", title: content.title, body: content.body, target_scope: "student", requires_confirmation: true, created_by: a.user.id, published_at: new Date().toISOString(), source_type: "warning_update", source_id: batchId }).select("id,target_scope,target_grade").single();
    if (noticeRes.error || !noticeRes.data) {
      logWarningSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "insert", table: "notices", errorCode: noticeRes.error?.code, errorMessage: noticeRes.error?.message, insertedRowCount: entryRes.data.length });
      continue;
    }
    const noticeStudentRes = await a.supabase.from("notice_students").insert({ notice_id: noticeRes.data.id, student_id: studentId }).select("notice_id").single();
    if (noticeStudentRes.error || !noticeStudentRes.data) {
      logWarningSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "insert", table: "notice_students", errorCode: noticeStudentRes.error?.code, errorMessage: noticeStudentRes.error?.message, insertedRowCount: entryRes.data.length });
      continue;
    }
    const recipientCount = (linksRes.data || []).filter((link: any) => link.student_id === studentId).length;
    if (!recipientCount) missing.push(studentId);
    const push = await sendNoticePushes(noticeRes.data);
    const generatedRes = await a.supabase.from("warning_generated_notices").upsert({ batch_id: batchId, student_id: studentId, notice_id: noticeRes.data.id, recipient_count: recipientCount, push_sent_count: push.sent, push_failed_count: push.failed }).select("batch_id").single();
    if (generatedRes.error || !generatedRes.data) logWarningSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "upsert", table: "warning_generated_notices", errorCode: generatedRes.error?.code, errorMessage: generatedRes.error?.message, insertedRowCount: entryRes.data.length });
    notices++;
    recipients += recipientCount;
    pushSent += push.sent;
    pushFailed += push.failed;
  }

  if (missing.length) {
    const missingRes = await a.supabase.from("warning_change_batches").update({ missing_parent_student_ids: missing }).eq("id", batchId).select("id").single();
    if (missingRes.error || !missingRes.data) logWarningSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "update", table: "warning_change_batches", errorCode: missingRes.error?.code, errorMessage: missingRes.error?.message, insertedRowCount: entryRes.data.length });
  }

  logWarningSaveDiagnostic({ ...baseDiagnostic, batchId, operation: "save-complete", table: "warning_entries", insertedRowCount: entryRes.data.length, refetchResult: "client-grid-refetch-required" });
  return NextResponse.json({ success: true, warning_saved: true, notice_created: notices > 0, push_sent: pushSent, push_failed: pushFailed, message: `${affectedStudentIds.length}명의 학생 경고 내역을 저장했습니다. 학부모 알림 ${notices}건이 생성되었고, 푸시 알림 ${pushSent}건이 전송되었습니다.`, batch_id: batchId, batchId, affected_students: affectedStudentIds.length, inserted_entries: entryRes.data.length, notices_created: notices, notices, recipients, push: { sent: pushSent, failed: pushFailed }, missingParentStudentIds: missing });
}
