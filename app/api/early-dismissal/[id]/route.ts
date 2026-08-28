import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles } from "@/lib/roles-server";
import { notifyEarlyDismissalApprovers, notifyParentsOfEarlyDismissal, notifyStaffOfEarlyDismissal } from "@/lib/push/send";
import { buildApproverReminder, buildCancellationNotice, buildDecisionNotice } from "@/lib/early-dismissal/format";
import { approverRolesFor, resolveApproverSlots } from "@/lib/early-dismissal/approvers";
import { recordEarlyDismissalAttendance, revertEarlyDismissalAttendance } from "@/lib/early-dismissal/attendance";
import { MAX_COMMENT_LENGTH, overallStatus, type ApproverRole, type EarlyDismissalDecision } from "@/lib/early-dismissal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestRow = {
  id: string;
  student_id: string;
  parent_id: string;
  dismissal_date: string;
  dismissal_time: string | null;
  reason: string;
  guardian_name: string | null;
  returns_same_day: boolean;
  status: string;
  homeroom_decision: EarlyDismissalDecision;
  vice_principal_decision: EarlyDismissalDecision;
  students: { name: string; grade: string } | Array<{ name: string; grade: string }> | null;
};

const ROW_SELECT = "id,student_id,parent_id,dismissal_date,dismissal_time,reason,guardian_name,returns_same_day,status,homeroom_decision,vice_principal_decision,students(name,grade)";

function studentOf(row: RequestRow) {
  const value = Array.isArray(row.students) ? row.students[0] : row.students;
  return { name: value?.name || "학생", grade: value?.grade || "" };
}


/** Tells the approver what happened to the attendance record, so a skipped or failed write is
 * visible on the screen rather than only in the server log. */
function attendanceNote(status: string, sync: { recorded: boolean; reason?: string } | null) {
  if (!sync) return "";
  if (sync.recorded) return status === "approved" ? "출석부에 조퇴로 기록했습니다." : "출석부의 조퇴 기록을 되돌렸습니다.";
  switch (sync.reason) {
    case "already-early-leave":
      return "해당 날짜는 이미 조퇴로 기록되어 있습니다.";
    case "not-early-leave":
      return "출석부는 이후 따로 수정되어 그대로 두었습니다. 필요하면 출석 관리에서 확인해 주세요.";
    case "nothing-to-revert":
      return "";
    default:
      return "다만 출석부 자동 기록에 실패했습니다. 출석 관리에서 직접 입력해 주세요.";
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  const isStaff = roles.includes("admin") || roles.includes("teacher");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "입력값을 확인해 주세요." }, { status: 400 });
  }
  const action = String(body.action || "").trim();

  // The caller's own client reads the row, so RLS decides whether they may see it at all.
  const rowRes = await supabase.from("early_dismissal_requests").select(ROW_SELECT).eq("id", id).maybeSingle<RequestRow>();
  if (rowRes.error || !rowRes.data) return NextResponse.json({ error: "조퇴 신청을 찾을 수 없습니다." }, { status: 404 });
  const row = rowRes.data;
  const student = studentOf(row);
  const summary = { studentName: student.name, studentGrade: student.grade, dismissalDate: row.dismissal_date, dismissalTime: row.dismissal_time, reason: row.reason, guardianName: row.guardian_name, returnsSameDay: row.returns_same_day };
  const admin = createAdminClient();

  if (action === "cancel") {
    if (row.parent_id !== user.id) return NextResponse.json({ error: "본인이 신청한 건만 취소할 수 있습니다." }, { status: 403 });
    if (row.status !== "pending") return NextResponse.json({ error: "이미 처리된 신청은 취소할 수 없습니다." }, { status: 409 });
    const { error } = await admin.from("early_dismissal_requests").update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    if (error) {
      console.error("early-dismissal-cancel-failed", { id, code: error.code, message: error.message });
      return NextResponse.json({ error: "조퇴 신청을 취소하지 못했습니다." }, { status: 500 });
    }
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    after(async () => {
      try {
        await notifyStaffOfEarlyDismissal(id, buildCancellationNotice(summary, (profile as any)?.full_name || "학부모"), [user.id]);
      } catch (error) {
        console.error("early-dismissal-cancel-notify-failed", { id, message: error instanceof Error ? error.message : "unknown" });
      }
    });
    return NextResponse.json({ success: true, message: "조퇴 신청을 취소했습니다." });
  }

  if (!isStaff) return NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 });

  if (action === "acknowledge") {
    const { error } = await admin.from("early_dismissal_acknowledgements").upsert({ request_id: id, staff_id: user.id, acknowledged_at: new Date().toISOString() }, { onConflict: "request_id,staff_id" });
    if (error) {
      console.error("early-dismissal-acknowledge-failed", { id, code: error.code, message: error.message });
      return NextResponse.json({ error: "확인 처리에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ success: true, message: "확인 처리했습니다." });
  }

  if (action !== "decide") return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });

  const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : null;
  if (!decision) return NextResponse.json({ error: "승인 또는 반려를 선택해 주세요." }, { status: 400 });
  const comment = String(body.comment || "").trim().slice(0, MAX_COMMENT_LENGTH);

  if (row.status === "cancelled") return NextResponse.json({ error: "취소된 신청입니다." }, { status: 409 });
  if (row.status === "rejected") return NextResponse.json({ error: "이미 반려된 신청입니다." }, { status: 409 });

  const slots = await resolveApproverSlots(supabase, student.grade);
  const allowedRoles = approverRolesFor(slots, user.id, roles.includes("admin"));
  if (!allowedRoles.length) return NextResponse.json({ error: "홈룸 선생님과 교감 선생님만 승인할 수 있습니다." }, { status: 403 });

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };
  for (const role of allowedRoles) {
    if (role === "homeroom") {
      update.homeroom_decision = decision;
      update.homeroom_decided_by = user.id;
      update.homeroom_decided_at = now;
      update.homeroom_comment = comment || null;
    } else {
      update.vice_principal_decision = decision;
      update.vice_principal_decided_by = user.id;
      update.vice_principal_decided_at = now;
      update.vice_principal_comment = comment || null;
    }
  }

  const { error } = await admin.from("early_dismissal_requests").update(update).eq("id", id);
  if (error) {
    console.error("early-dismissal-decide-failed", { id, code: error.code, message: error.message });
    return NextResponse.json({ error: "결재 처리에 실패했습니다. 다시 시도해 주세요." }, { status: 500 });
  }

  const nextHomeroom = allowedRoles.includes("homeroom") ? decision : row.homeroom_decision;
  const nextVicePrincipal = allowedRoles.includes("vice_principal") ? decision : row.vice_principal_decision;
  const status = overallStatus(nextHomeroom, nextVicePrincipal);

  // Once both approvals land the day is settled, so it belongs in the attendance record as 조퇴
  // without anyone re-typing it. Written through the approver's own client so the entry carries a
  // real author and RLS still applies; a failure is reported, never fatal -- the approval itself
  // is already committed and must not be rolled back over a bookkeeping write.
  const attendanceParams = { requestId: id, studentId: row.student_id, studentName: student.name, dismissalDate: row.dismissal_date, authorId: user.id };
  let attendanceSync = null as Awaited<ReturnType<typeof recordEarlyDismissalAttendance>> | null;
  if (status === "approved") {
    attendanceSync = await recordEarlyDismissalAttendance(supabase, { ...attendanceParams, dismissalTime: row.dismissal_time, reason: row.reason });
  } else if (status === "rejected" && row.status === "approved") {
    // An approval that is later withdrawn must not leave a 조퇴 standing on the record.
    attendanceSync = await revertEarlyDismissalAttendance(supabase, attendanceParams);
  }
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const deciderName = (profile as any)?.full_name || "선생님";
  // When one account holds both slots (the vice principal is also the G8-G12 homeroom teacher)
  // the single decision covers both, so name the role the parent cares about most.
  const reportedRole: ApproverRole = allowedRoles.includes("homeroom") ? "homeroom" : "vice_principal";

  after(async () => {
    try {
      await notifyParentsOfEarlyDismissal(id, row.student_id, buildDecisionNotice(summary, reportedRole, decision, deciderName, comment || null, status));
      const { data: links } = await admin.from("parent_students").select("parent_id").eq("student_id", row.student_id);
      const parentIds = Array.from(new Set((links || []).map((link: any) => link.parent_id).filter(Boolean)));
      if (parentIds.length) await admin.from("parent_dashboard_events").insert(parentIds.map((parentId) => ({ parent_id: parentId, event_type: "early_dismissal_decided", entity_id: id })));

      if (status === "pending") {
        const waiting = [
          nextHomeroom === "pending" ? slots.homeroom.teacherId : null,
          nextVicePrincipal === "pending" ? slots.vicePrincipal.teacherId : null,
        ].filter((value): value is string => Boolean(value) && value !== user.id);
        if (waiting.length) await notifyEarlyDismissalApprovers(id, waiting, buildApproverReminder(summary, reportedRole, decision, deciderName));
      }
    } catch (pushError) {
      console.error("early-dismissal-decide-notify-failed", { id, message: pushError instanceof Error ? pushError.message : "unknown" });
    }
  });

  const baseMessage = status === "approved"
    ? "홈룸 선생님과 교감 선생님의 승인이 모두 완료되어 조퇴가 확정되었습니다."
    : status === "rejected"
      ? "조퇴 신청을 반려했습니다. 학부모님께 안내가 전송됩니다."
      : `${decision === "approved" ? "승인" : "반려"} 처리했습니다. 남은 결재가 완료되면 확정됩니다.`;

  return NextResponse.json({
    success: true,
    status,
    attendanceRecorded: attendanceSync?.recorded === true,
    message: [baseMessage, attendanceNote(status, attendanceSync)].filter(Boolean).join(" "),
  });
}
