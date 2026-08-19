import { after, NextResponse } from "next/server";
import { adminJsonError, requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNoticePushes } from "@/lib/push/send";
import { buildGraceConversionNotice } from "@/lib/warnings/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRACE_UNIT_PRAISE_COST = 20;

type CreatedNotice = { notice: { id: string; target_scope: string; target_grade: string | null; title: string; body: string; created_by: string }; studentId: string };

/** 희월 정산: for every student, converts as many complete 20-point chunks of their *current*
 * praise-point total into 1 discipline-point reduction each, capped by how much discipline they
 * actually have (never goes negative). Both totals already net out any prior settlement (earlier
 * grace_conversion entries reduced them), so re-running this with nothing new to convert is a
 * safe no-op -- no separate "carryover balance" needs to be tracked. */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const academicYear = Number(body.academicYear);
  const semester = Number(body.semester);
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!academicYear || ![1, 2].includes(semester) || !idempotencyKey) {
    return adminJsonError("학년도, 학기를 확인해 주세요.", 400);
  }

  const admin = createAdminClient();

  const existing = await admin.from("warning_change_batches").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing.error) return adminJsonError("정산 요청을 확인하지 못했습니다.", 500);
  if (existing.data) return NextResponse.json({ success: true, idempotent: true, message: "이미 처리된 요청입니다.", batchId: existing.data.id, appliedCount: 0 });

  const { data: students, error: studentsError } = await admin.from("students").select("id,name").eq("active", true);
  if (studentsError) return adminJsonError("학생 목록을 불러오지 못했습니다.", 500);
  const studentIds = (students || []).map((s) => s.id);

  const { data: entries, error: entriesError } = studentIds.length
    ? await admin.from("warning_entries").select("student_id,kind,delta").in("student_id", studentIds).eq("academic_year", academicYear).eq("semester", semester)
    : { data: [] as { student_id: string; kind: string | null; delta: number }[], error: null };
  if (entriesError) return adminJsonError("점수 내역을 불러오지 못했습니다.", 500);

  const praiseTotals = new Map<string, number>();
  const disciplineTotals = new Map<string, number>();
  for (const entry of entries || []) {
    const map = entry.kind === "praise" ? praiseTotals : disciplineTotals;
    map.set(entry.student_id, (map.get(entry.student_id) || 0) + Number(entry.delta || 0));
  }

  const now = new Date();
  const month = now.getMonth() + 1;

  const targets = (students || []).flatMap((student) => {
    const praiseTotal = praiseTotals.get(student.id) || 0;
    const disciplineTotal = disciplineTotals.get(student.id) || 0;
    const unitsFromPraise = Math.floor(praiseTotal / GRACE_UNIT_PRAISE_COST);
    const appliedUnits = Math.max(0, Math.min(unitsFromPraise, disciplineTotal));
    return appliedUnits > 0 ? [{ studentId: student.id, name: student.name, appliedUnits, praiseTotal, disciplineTotal }] : [];
  });

  if (!targets.length) {
    return NextResponse.json({ success: true, appliedCount: 0, notices: 0, recipients: 0, message: "정산할 대상이 없습니다. 칭찬 점수가 20점 미만이거나 상쇄할 훈계 점수가 없는 학생들입니다." });
  }

  const batchRes = await admin.from("warning_change_batches").insert({ idempotency_key: idempotencyKey, academic_year: academicYear, semester, month, author_id: auth.user.id }).select("id").single();
  if (batchRes.error || !batchRes.data) return adminJsonError("정산 기록을 저장하지 못했습니다.", 500);
  const batchId = batchRes.data.id;

  const rows = targets.flatMap((target) => [
    {
      batch_id: batchId, student_id: target.studentId, warning_date: null, academic_year: academicYear, semester, month,
      entry_type: "grace_conversion", change_type: "grace_adjustment", previous_value: 0, new_value: 0,
      delta: -(target.appliedUnits * GRACE_UNIT_PRAISE_COST), kind: "praise",
      parent_visible_reason: `희월 정산 - 칭찬 점수 ${target.appliedUnits * GRACE_UNIT_PRAISE_COST}점을 희월 ${target.appliedUnits}점으로 전환`,
      author_id: auth.user.id,
    },
    {
      batch_id: batchId, student_id: target.studentId, warning_date: null, academic_year: academicYear, semester, month,
      entry_type: "grace_conversion", change_type: "grace_adjustment", previous_value: 0, new_value: 0,
      delta: -target.appliedUnits, kind: "discipline",
      parent_visible_reason: `희월 정산 - 희월 ${target.appliedUnits}점 적용으로 훈계 점수 차감`,
      author_id: auth.user.id,
    },
  ]);

  const entryRes = await admin.from("warning_entries").insert(rows);
  if (entryRes.error) return adminJsonError("희월 정산 내역을 저장하지 못했습니다.", 500);

  const { data: linkRows } = await admin.from("parent_students").select("student_id,parent_id").in("student_id", targets.map((t) => t.studentId));

  const createdNotices: CreatedNotice[] = [];
  let notices = 0;
  let recipients = 0;
  const missing: string[] = [];

  for (const target of targets) {
    const content = buildGraceConversionNotice({
      studentName: target.name,
      appliedUnits: target.appliedUnits,
      praiseTotal: target.praiseTotal - target.appliedUnits * GRACE_UNIT_PRAISE_COST,
      disciplineTotal: target.disciplineTotal - target.appliedUnits,
    });
    const noticeRes = await admin.from("notices").insert({ type: "warning", title: content.title, body: content.body, target_scope: "student", requires_confirmation: true, created_by: auth.user.id, published_at: new Date().toISOString(), source_type: "grace_conversion", source_id: batchId }).select("id,target_scope,target_grade").single();
    if (noticeRes.error || !noticeRes.data) continue;
    const noticeStudentRes = await admin.from("notice_students").insert({ notice_id: noticeRes.data.id, student_id: target.studentId }).select("notice_id").single();
    if (noticeStudentRes.error || !noticeStudentRes.data) continue;
    const uniqueParents = new Set((linkRows || []).filter((link) => link.student_id === target.studentId).map((link) => link.parent_id));
    const recipientCount = uniqueParents.size;
    if (!recipientCount) missing.push(target.studentId);
    await admin.from("warning_generated_notices").upsert({ batch_id: batchId, student_id: target.studentId, notice_id: noticeRes.data.id, recipient_count: recipientCount, push_sent_count: 0, push_failed_count: 0 });
    notices++;
    recipients += recipientCount;
    createdNotices.push({ notice: { ...noticeRes.data, title: content.title, body: content.body, created_by: auth.user.id }, studentId: target.studentId });
  }

  if (missing.length) {
    await admin.from("warning_change_batches").update({ missing_parent_student_ids: missing }).eq("id", batchId);
  }

  if (createdNotices.length) {
    after(async () => {
      for (const item of createdNotices) {
        try {
          const push = await sendNoticePushes(item.notice);
          await admin.from("warning_generated_notices").update({ push_sent_count: push.sent, push_failed_count: push.failed }).eq("batch_id", batchId).eq("student_id", item.studentId);
        } catch (error) {
          console.error("grace-settlement-push-failed", { batchId, noticeId: item.notice.id, message: error instanceof Error ? error.message : "unknown" });
        }
      }
    });
  }

  return NextResponse.json({
    success: true,
    batchId,
    appliedCount: targets.length,
    notices,
    recipients,
    message: `${targets.length}명의 학생에게 희월 정산을 적용했습니다.`,
  });
}
