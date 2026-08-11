import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendNoticePushes } from "@/lib/push/send";
import { getUserRoles } from "@/lib/roles-server";
import { effectiveStaffRole } from "@/lib/roles";
import { changeType, buildPointNotice } from "@/lib/warnings/format";
import { POINT_VALUE, isValidCategory, type PointKind } from "@/lib/warnings/categories";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ERROR = "점수를 저장하지 못했습니다. 다시 시도해 주세요.";

type Diagnostic = {
  requestId: string;
  operation: string;
  table?: string;
  userId?: string;
  role?: string;
  kind?: string;
  studentId?: string;
  errorCode?: string;
  errorMessage?: string;
};

function logDiagnostic(diagnostic: Diagnostic) {
  console.error("warning-grant-diagnostic", diagnostic);
}

function failure(diagnostic: Diagnostic, status = 500) {
  logDiagnostic(diagnostic);
  return NextResponse.json({ error: SAFE_ERROR, errorId: diagnostic.requestId }, { status });
}

function currentTerm() {
  const now = new Date();
  return { year: now.getFullYear(), semester: now.getMonth() < 7 ? 1 : 2, month: now.getMonth() + 1, dateOnly: now.toISOString().slice(0, 10) };
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("admin") && !roles.includes("teacher")) return NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 });
  const role = effectiveStaffRole(roles) || "teacher";

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "입력값을 확인해 주세요." }, { status: 400 });
  }

  const kind = body.kind === "praise" ? "praise" : body.kind === "discipline" ? "discipline" : null;
  const studentId = String(body.studentId || "").trim();
  const category = String(body.category || "").trim();
  const classPeriodId = String(body.classPeriodId || "").trim();
  const detail = String(body.detail || "").trim();
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  const baseDiagnostic = { requestId, userId: user.id, role, kind: kind || undefined, studentId };

  if (!kind || !studentId || !classPeriodId || !idempotencyKey || !isValidCategory(kind as PointKind, category)) {
    return NextResponse.json({ error: "학생, 카테고리, 수업을 모두 선택해 주세요." }, { status: 400 });
  }

  const studentRes = await supabase.from("students").select("id,name").eq("id", studentId).single();
  if (studentRes.error || !studentRes.data) return NextResponse.json({ error: "학생 정보를 확인할 수 없습니다." }, { status: 400 });

  const classRes = await supabase.from("class_periods").select("id,name,active").eq("id", classPeriodId).single();
  if (classRes.error || !classRes.data || !classRes.data.active) return NextResponse.json({ error: "수업 정보를 확인할 수 없습니다." }, { status: 400 });

  const existing = await supabase.from("warning_change_batches").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing.error) return failure({ ...baseDiagnostic, operation: "select", table: "warning_change_batches", errorCode: existing.error.code, errorMessage: existing.error.message });
  if (existing.data) return NextResponse.json({ success: true, idempotent: true, message: "이미 처리된 요청입니다.", batchId: existing.data.id });

  const { year, semester, month, dateOnly } = currentTerm();
  const delta = kind === "discipline" ? -POINT_VALUE : POINT_VALUE;

  const batchRes = await supabase.from("warning_change_batches").insert({ idempotency_key: idempotencyKey, academic_year: year, semester, month, author_id: user.id }).select("id").single();
  if (batchRes.error || !batchRes.data) return failure({ ...baseDiagnostic, operation: "insert", table: "warning_change_batches", errorCode: batchRes.error?.code, errorMessage: batchRes.error?.message });
  const batchId = batchRes.data.id;

  const parentVisibleReason = detail ? `${category} - ${detail}` : category;
  const entryRes = await supabase
    .from("warning_entries")
    .insert({
      batch_id: batchId,
      student_id: studentId,
      warning_date: dateOnly,
      academic_year: year,
      semester,
      month,
      entry_type: "daily",
      change_type: changeType(delta, "daily"),
      previous_value: 0,
      new_value: POINT_VALUE,
      delta,
      category,
      kind,
      class_period_id: classPeriodId,
      parent_visible_reason: parentVisibleReason,
      author_id: user.id,
    })
    .select("id")
    .single();
  if (entryRes.error || !entryRes.data) return failure({ ...baseDiagnostic, operation: "insert", table: "warning_entries", errorCode: entryRes.error?.code, errorMessage: entryRes.error?.message });

  const [allEntriesRes, linksRes] = await Promise.all([
    supabase.from("warning_entries").select("delta,kind").eq("student_id", studentId).eq("academic_year", year).eq("semester", semester).eq("month", month),
    supabase.from("parent_students").select("parent_id").eq("student_id", studentId),
  ]);
  if (allEntriesRes.error) return failure({ ...baseDiagnostic, operation: "select", table: "warning_entries", errorCode: allEntriesRes.error.code, errorMessage: allEntriesRes.error.message });
  if (linksRes.error) return failure({ ...baseDiagnostic, operation: "select", table: "parent_students", errorCode: linksRes.error.code, errorMessage: linksRes.error.message });

  const monthlyTotal = (allEntriesRes.data || [])
    .filter((entry: any) => (kind === "praise" ? entry.kind === "praise" : entry.kind !== "praise"))
    .reduce((sum: number, entry: any) => sum + Number(entry.delta || 0), 0);

  const content = buildPointNotice({ kind: kind as PointKind, studentName: studentRes.data.name, category, className: classRes.data.name, detail, monthlyTotal });
  const noticeRes = await supabase
    .from("notices")
    .insert({
      type: kind === "praise" ? "praise" : "warning",
      title: content.title,
      body: content.body,
      target_scope: "student",
      requires_confirmation: true,
      created_by: user.id,
      published_at: new Date().toISOString(),
      source_type: kind === "praise" ? "praise_update" : "warning_update",
      source_id: batchId,
    })
    .select("id,target_scope,target_grade")
    .single();

  let notices = 0, recipients = 0;
  const missing: string[] = [];
  let createdNotice: { id: string } | null = null;
  if (noticeRes.error || !noticeRes.data) {
    logDiagnostic({ ...baseDiagnostic, operation: "insert", table: "notices", errorCode: noticeRes.error?.code, errorMessage: noticeRes.error?.message });
  } else {
    const noticeStudentRes = await supabase.from("notice_students").insert({ notice_id: noticeRes.data.id, student_id: studentId }).select("notice_id").single();
    if (noticeStudentRes.error || !noticeStudentRes.data) {
      logDiagnostic({ ...baseDiagnostic, operation: "insert", table: "notice_students", errorCode: noticeStudentRes.error?.code, errorMessage: noticeStudentRes.error?.message });
    } else {
      const uniqueParents = new Set((linksRes.data || []).map((link: any) => link.parent_id));
      const recipientCount = uniqueParents.size;
      if (!recipientCount) missing.push(studentId);
      const generatedRes = await supabase.from("warning_generated_notices").upsert({ batch_id: batchId, student_id: studentId, notice_id: noticeRes.data.id, recipient_count: recipientCount, push_sent_count: 0, push_failed_count: 0 }).select("batch_id").single();
      if (generatedRes.error || !generatedRes.data) logDiagnostic({ ...baseDiagnostic, operation: "upsert", table: "warning_generated_notices", errorCode: generatedRes.error?.code, errorMessage: generatedRes.error?.message });
      notices = 1;
      recipients = recipientCount;
      createdNotice = { id: noticeRes.data.id };
    }
  }

  const parentIds = Array.from(new Set((linksRes.data || []).map((link: any) => link.parent_id).filter(Boolean)));
  if (parentIds.length) {
    const eventRes = await supabase.from("parent_dashboard_events").insert(parentIds.map((parentId) => ({ parent_id: parentId, event_type: kind === "praise" ? "praise_updated" : "warning_updated", entity_id: batchId })));
    if (eventRes.error) logDiagnostic({ ...baseDiagnostic, operation: "insert", table: "parent_dashboard_events", errorCode: eventRes.error.code, errorMessage: eventRes.error.message });
  }

  if (createdNotice) {
    const noticeId = createdNotice.id;
    after(async () => {
      const admin = createAdminClient();
      try {
        const push = await sendNoticePushes({ id: noticeId, target_scope: "student", target_grade: null });
        const { error } = await admin.from("warning_generated_notices").update({ push_sent_count: push.sent, push_failed_count: push.failed }).eq("batch_id", batchId).eq("student_id", studentId);
        if (error) console.error("warning-grant-push-count-update-failed", { batchId, noticeId, code: error.code, message: error.message });
      } catch (error) {
        console.error("warning-grant-push-background-failed", { batchId, noticeId, message: error instanceof Error ? error.message : "unknown" });
      }
    });
  }

  if (missing.length) {
    const missingRes = await supabase.from("warning_change_batches").update({ missing_parent_student_ids: missing }).eq("id", batchId).select("id").single();
    if (missingRes.error || !missingRes.data) logDiagnostic({ ...baseDiagnostic, operation: "update", table: "warning_change_batches", errorCode: missingRes.error?.code, errorMessage: missingRes.error?.message });
  }

  return NextResponse.json({
    success: true,
    message: missing.length ? `${kind === "praise" ? "칭찬" : "훈계"} 점수는 저장되었지만 연결된 학부모 계정이 없어 알림을 전송하지 못했습니다.` : `${kind === "praise" ? "칭찬" : "훈계"} 점수가 저장되었고 학부모 알림을 전송했습니다.`,
    batchId,
    notices,
    recipients,
    monthlyTotal,
  });
}
