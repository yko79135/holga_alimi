import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNoticePushes } from "@/lib/push/send";
import { buildGraceConversionNotice } from "@/lib/warnings/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRACE_UNIT_PRAISE_COST = 20;

async function staff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { e: NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 }) };
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("admin") && !roles.includes("teacher")) return { e: NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 }) };
  return { user };
}

/** 희월 정산: applies `units` grace units to one student per call (칭찬 -20*units, 훈계
 * -1*units), used from the up/down stepper + 적용 button in 점수 통계. Both totals are re-derived
 * from the existing ledger (which already nets out any prior grace_conversion entries), so this
 * is naturally safe to retry -- a stale click just gets rejected by the same floor check on the
 * next attempt. Neither total is allowed to go below 0: if either is short, nothing is applied. */
export async function POST(req: Request) {
  const a = await staff();
  if ("e" in a) return a.e;

  const body = await req.json().catch(() => ({}));
  const studentId = String(body.studentId || "").trim();
  const academicYear = Number(body.academicYear);
  const semester = Number(body.semester);
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  const units = Number.isInteger(body.units) ? Number(body.units) : 1;
  if (!studentId || !academicYear || ![1, 2].includes(semester) || !idempotencyKey || units < 1) {
    return NextResponse.json({ error: "학생, 학년도, 학기, 적용할 희월 점수를 확인해 주세요." }, { status: 400 });
  }

  const admin = createAdminClient();

  const existing = await admin.from("warning_change_batches").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing.error) return NextResponse.json({ error: "정산 요청을 확인하지 못했습니다." }, { status: 500 });
  if (existing.data) return NextResponse.json({ success: true, idempotent: true, message: "이미 처리된 요청입니다.", batchId: existing.data.id });

  const [studentRes, entriesRes] = await Promise.all([
    admin.from("students").select("id,name").eq("id", studentId).single(),
    admin.from("warning_entries").select("kind,delta").eq("student_id", studentId).eq("academic_year", academicYear).eq("semester", semester),
  ]);
  if (studentRes.error || !studentRes.data) return NextResponse.json({ error: "학생 정보를 확인할 수 없습니다." }, { status: 400 });
  if (entriesRes.error) return NextResponse.json({ error: "점수 내역을 불러오지 못했습니다." }, { status: 500 });

  const praiseTotal = (entriesRes.data || []).filter((entry) => entry.kind === "praise").reduce((sum, entry) => sum + Number(entry.delta || 0), 0);
  const disciplineTotal = (entriesRes.data || []).filter((entry) => entry.kind !== "praise").reduce((sum, entry) => sum + Number(entry.delta || 0), 0);

  const praiseCost = GRACE_UNIT_PRAISE_COST * units;
  if (praiseTotal < praiseCost || disciplineTotal < units) {
    return NextResponse.json({ error: "칭찬 점수 또는 훈계 점수가 부족하여 희월을 적용할 수 없습니다." }, { status: 400 });
  }

  const month = new Date().getMonth() + 1;
  const batchRes = await admin.from("warning_change_batches").insert({ idempotency_key: idempotencyKey, academic_year: academicYear, semester, month, author_id: a.user.id }).select("id").single();
  if (batchRes.error || !batchRes.data) return NextResponse.json({ error: "정산 기록을 저장하지 못했습니다." }, { status: 500 });
  const batchId = batchRes.data.id;

  const rows = [
    {
      batch_id: batchId, student_id: studentId, warning_date: null, academic_year: academicYear, semester, month,
      entry_type: "grace_conversion", change_type: "grace_adjustment", previous_value: 0, new_value: 0,
      delta: -praiseCost, kind: "praise",
      parent_visible_reason: `희월 정산 - 칭찬 점수 ${praiseCost}점을 희월 ${units}점으로 전환`,
      author_id: a.user.id,
    },
    {
      batch_id: batchId, student_id: studentId, warning_date: null, academic_year: academicYear, semester, month,
      entry_type: "grace_conversion", change_type: "grace_adjustment", previous_value: 0, new_value: 0,
      delta: -units, kind: "discipline",
      parent_visible_reason: `희월 정산 - 희월 ${units}점 적용으로 훈계 점수 ${units}점 차감`,
      author_id: a.user.id,
    },
  ];
  const entryRes = await admin.from("warning_entries").insert(rows);
  if (entryRes.error) return NextResponse.json({ error: "희월 정산 내역을 저장하지 못했습니다." }, { status: 500 });

  const { data: linkRows } = await admin.from("parent_students").select("parent_id").eq("student_id", studentId);
  const recipientCount = new Set((linkRows || []).map((link) => link.parent_id)).size;

  const remainingPraise = praiseTotal - praiseCost;
  const remainingDiscipline = disciplineTotal - units;
  const content = buildGraceConversionNotice({ studentName: studentRes.data.name, appliedUnits: units, praiseTotal: remainingPraise, disciplineTotal: remainingDiscipline });

  let notices = 0;
  const noticeRes = await admin.from("notices").insert({ type: "warning", title: content.title, body: content.body, target_scope: "student", requires_confirmation: true, created_by: a.user.id, published_at: new Date().toISOString(), source_type: "grace_conversion", source_id: batchId }).select("id,target_scope,target_grade").single();
  if (!noticeRes.error && noticeRes.data) {
    const noticeStudentRes = await admin.from("notice_students").insert({ notice_id: noticeRes.data.id, student_id: studentId }).select("notice_id").single();
    if (!noticeStudentRes.error && noticeStudentRes.data) {
      await admin.from("warning_generated_notices").upsert({ batch_id: batchId, student_id: studentId, notice_id: noticeRes.data.id, recipient_count: recipientCount, push_sent_count: 0, push_failed_count: 0 });
      notices = 1;
      const noticeForPush = { ...noticeRes.data, title: content.title, body: content.body, created_by: a.user.id };
      after(async () => {
        try {
          const push = await sendNoticePushes(noticeForPush);
          await admin.from("warning_generated_notices").update({ push_sent_count: push.sent, push_failed_count: push.failed }).eq("batch_id", batchId).eq("student_id", studentId);
        } catch (error) {
          console.error("grace-settlement-push-failed", { batchId, message: error instanceof Error ? error.message : "unknown" });
        }
      });
    }
  }

  if (!recipientCount) {
    await admin.from("warning_change_batches").update({ missing_parent_student_ids: [studentId] }).eq("id", batchId);
  }

  return NextResponse.json({
    success: true,
    batchId,
    notices,
    recipients: recipientCount,
    praiseTotal: remainingPraise,
    disciplineTotal: remainingDiscipline,
    message: recipientCount
      ? `${studentRes.data.name} 학생에게 희월 ${units}점을 적용하고 학부모 알림을 전송했습니다.`
      : `${studentRes.data.name} 학생에게 희월 ${units}점을 적용했지만 연결된 학부모 계정이 없어 알림을 전송하지 못했습니다.`,
  });
}
