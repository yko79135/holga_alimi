import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles } from "@/lib/roles-server";
import { notifyStaffOfEarlyDismissal } from "@/lib/push/send";
import { buildCancellationNotice, withMeansParticle } from "@/lib/early-dismissal/format";
import { recordEarlyDismissalAttendance, revertEarlyDismissalAttendance } from "@/lib/early-dismissal/attendance";
import { isRequestType, requestTypeLabel, usesDismissalTime, type EarlyDismissalRequestType } from "@/lib/early-dismissal/types";
import { isMissingRequestTypeError, warnRequestTypeMissing, withoutRequestType } from "@/lib/early-dismissal/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestRow = {
  id: string;
  student_id: string;
  parent_id: string;
  request_type: string | null;
  dismissal_date: string;
  dismissal_time: string | null;
  reason: string;
  guardian_name: string | null;
  returns_same_day: boolean;
  cancelled_at: string | null;
  attendance_recorded_at: string | null;
  students: { name: string; grade: string } | Array<{ name: string; grade: string }> | null;
};

const ROW_SELECT = "id,student_id,parent_id,request_type,dismissal_date,dismissal_time,reason,guardian_name,returns_same_day,cancelled_at,attendance_recorded_at,students(name,grade)";

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
  const rowQuery = (select: string) => supabase.from("early_dismissal_requests").select(select).eq("id", id).maybeSingle<RequestRow>();
  let rowRes = await rowQuery(ROW_SELECT);
  // Every row is 조퇴 on a database that has not been given request_type yet, and cancelling or
  // recording one must keep working there.
  if (isMissingRequestTypeError(rowRes.error)) {
    warnRequestTypeMissing("row");
    rowRes = await rowQuery(withoutRequestType(ROW_SELECT));
  }
  if (rowRes.error || !rowRes.data) return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
  const row = rowRes.data;
  // Rows written before the other kinds existed carry no request_type; they were all 조퇴.
  const requestType: EarlyDismissalRequestType = isRequestType(row.request_type) ? row.request_type : "early_dismissal";
  const typeLabel = requestTypeLabel(requestType);
  const studentValue = Array.isArray(row.students) ? row.students[0] : row.students;
  const student = { name: studentValue?.name || "학생", grade: studentValue?.grade || "" };
  const summary = { type: requestType, studentName: student.name, studentGrade: student.grade, dismissalDate: row.dismissal_date, dismissalTime: row.dismissal_time, reason: row.reason, guardianName: row.guardian_name, returnsSameDay: row.returns_same_day };
  const admin = createAdminClient();
  const now = new Date().toISOString();

  if (action === "cancel") {
    if (row.parent_id !== user.id) return NextResponse.json({ error: "본인이 신청한 건만 취소할 수 있습니다." }, { status: 403 });
    if (row.cancelled_at) return NextResponse.json({ error: "이미 취소된 신청입니다." }, { status: 409 });
    if (row.attendance_recorded_at) return NextResponse.json({ error: "이미 출석부에 기록되어 취소할 수 없습니다. 담임 선생님께 문의해 주세요." }, { status: 409 });

    const { error } = await admin.from("early_dismissal_requests").update({ cancelled_at: now, updated_at: now }).eq("id", id).is("cancelled_at", null);
    if (error) {
      console.error("early-dismissal-cancel-failed", { id, code: error.code, message: error.message });
      return NextResponse.json({ error: `${typeLabel} 신청을 취소하지 못했습니다.` }, { status: 500 });
    }
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    after(async () => {
      try {
        await notifyStaffOfEarlyDismissal(id, buildCancellationNotice(summary, (profile as any)?.full_name || "학부모"), [user.id]);
      } catch (error) {
        console.error("early-dismissal-cancel-notify-failed", { id, message: error instanceof Error ? error.message : "unknown" });
      }
    });
    return NextResponse.json({ success: true, message: `${typeLabel} 신청을 취소했습니다.` });
  }

  if (!isStaff) return NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 });

  if (action === "acknowledge") {
    const { error } = await admin.from("early_dismissal_acknowledgements").upsert({ request_id: id, staff_id: user.id, acknowledged_at: now }, { onConflict: "request_id,staff_id" });
    if (error) {
      console.error("early-dismissal-acknowledge-failed", { id, code: error.code, message: error.message });
      return NextResponse.json({ error: "확인 처리에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ success: true, message: "확인 처리했습니다." });
  }

  // Any teacher can put the request on the attendance sheet -- there is no approver any more, so
  // whoever handles the student that day records it. The request's own kind decides whether the
  // day is written as 조퇴, 지각, or 결석. The attendance write itself goes through the
  // teacher's own client, so attendance_entries' RLS still applies and the entry has a real author.
  if (action === "record") {
    if (row.cancelled_at) return NextResponse.json({ error: "취소된 신청입니다." }, { status: 409 });
    if (row.attendance_recorded_at) return NextResponse.json({ error: "이미 출석부에 기록된 신청입니다." }, { status: 409 });

    const sync = await recordEarlyDismissalAttendance(supabase, {
      requestId: id,
      studentId: row.student_id,
      studentName: student.name,
      type: requestType,
      dismissalDate: row.dismissal_date,
      dismissalTime: usesDismissalTime(requestType) ? row.dismissal_time : null,
      reason: row.reason,
      authorId: user.id,
    });
    if (!sync.recorded && sync.reason === "failed") {
      return NextResponse.json({ error: "출석부 기록에 실패했습니다. 출석 관리에서 직접 입력해 주세요." }, { status: 500 });
    }

    const { error } = await admin.from("early_dismissal_requests").update({ attendance_recorded_at: now, attendance_recorded_by: user.id, updated_at: now }).eq("id", id);
    if (error) {
      console.error("early-dismissal-record-flag-failed", { id, code: error.code, message: error.message });
      return NextResponse.json({ error: "출석부에는 기록했지만 신청 상태를 갱신하지 못했습니다. 목록을 새로고침해 주세요." }, { status: 500 });
    }

    after(async () => {
      try {
        const { data: links } = await admin.from("parent_students").select("parent_id").eq("student_id", row.student_id);
        const parentIds = Array.from(new Set((links || []).map((link: any) => link.parent_id).filter(Boolean)));
        if (parentIds.length) await admin.from("parent_dashboard_events").insert(parentIds.map((parentId) => ({ parent_id: parentId, event_type: "early_dismissal_recorded", entity_id: id })));
      } catch (error) {
        console.error("early-dismissal-record-event-failed", { id, message: error instanceof Error ? error.message : "unknown" });
      }
    });

    return NextResponse.json({
      success: true,
      message: sync.recorded
        ? `출석부에 ${withMeansParticle(typeLabel)} 기록했습니다.`
        : `해당 날짜는 이미 ${withMeansParticle(typeLabel)} 기록되어 있어 출석부는 그대로 두었습니다.`,
    });
  }

  // Undo a mistaken record: the attendance log is append-only, so this writes a correction back
  // to whatever the day held before, and only while it still reads what this request wrote.
  if (action === "unrecord") {
    if (!row.attendance_recorded_at) return NextResponse.json({ error: "아직 출석부에 기록되지 않은 신청입니다." }, { status: 409 });

    const sync = await revertEarlyDismissalAttendance(supabase, {
      requestId: id,
      studentId: row.student_id,
      studentName: student.name,
      type: requestType,
      dismissalDate: row.dismissal_date,
      authorId: user.id,
    });
    if (!sync.recorded && sync.reason === "failed") {
      return NextResponse.json({ error: "출석부 기록을 되돌리지 못했습니다. 출석 관리에서 직접 수정해 주세요." }, { status: 500 });
    }

    const { error } = await admin.from("early_dismissal_requests").update({ attendance_recorded_at: null, attendance_recorded_by: null, updated_at: now }).eq("id", id);
    if (error) {
      console.error("early-dismissal-unrecord-flag-failed", { id, code: error.code, message: error.message });
      return NextResponse.json({ error: "신청 상태를 갱신하지 못했습니다. 목록을 새로고침해 주세요." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: sync.recorded
        ? `출석부의 ${typeLabel} 기록을 되돌렸습니다.`
        : "출석부는 이후 따로 수정되어 그대로 두고, 신청의 기록 표시만 해제했습니다.",
    });
  }

  return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
}
