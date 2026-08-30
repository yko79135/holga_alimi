import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles } from "@/lib/roles-server";
import { notifyStaffOfEarlyDismissal } from "@/lib/push/send";
import { buildSubmissionNotice } from "@/lib/early-dismissal/format";
import { MAX_CONTACT_LENGTH, MAX_NAME_LENGTH, MAX_REASON_LENGTH, isRequestType, requestTypeLabel, usesDismissalTime, type EarlyDismissalRequest, type EarlyDismissalRequestType } from "@/lib/early-dismissal/types";
import { serializeRequestRow, REQUEST_SELECT } from "@/lib/early-dismissal/serialize";
import { isMissingRequestTypeError, warnRequestTypeMissing, withoutRequestType } from "@/lib/early-dismissal/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Staff see every request; parents see only their own. Both read through the caller's own
 * Supabase client so RLS -- not this handler -- is the boundary. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  const isStaff = roles.includes("admin") || roles.includes("teacher");
  if (!isStaff && !roles.includes("parent")) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const listQuery = (select: string) => {
    const query = supabase.from("early_dismissal_requests").select(select).order("dismissal_date", { ascending: false }).order("created_at", { ascending: false });
    return isStaff ? query : query.eq("parent_id", user.id);
  };
  let { data, error } = await listQuery(REQUEST_SELECT);
  // A database still waiting on the 결석 migration has no request_type; read it the old way
  // rather than showing every parent an error. Those rows are all 조퇴.
  if (isMissingRequestTypeError(error)) {
    warnRequestTypeMissing("list");
    ({ data, error } = await listQuery(withoutRequestType(REQUEST_SELECT)));
  }
  if (error) {
    console.error("early-dismissal-list-failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "조퇴·결석 신청 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const rows = (data || []) as any[];
  const gradeOf = (row: any) => (Array.isArray(row.students) ? row.students[0] : row.students)?.grade;
  const grades = Array.from(new Set(rows.map(gradeOf).filter(Boolean)));
  const admin = createAdminClient();
  const profileIds = Array.from(new Set(rows.flatMap((row) => [row.parent_id, row.attendance_recorded_by]).filter(Boolean)));

  const [homeroomRes, acksRes, namesRes] = await Promise.all([
    grades.length ? supabase.from("homeroom_assignments").select("grade,teacher_name").in("grade", grades) : Promise.resolve({ data: [] as any[] }),
    isStaff && rows.length
      ? supabase.from("early_dismissal_acknowledgements").select("request_id,staff_id,acknowledged_at").in("request_id", rows.map((row) => row.id))
      : Promise.resolve({ data: [] as any[] }),
    // Names only: a parent's RLS view of profiles hides staff, but they still need to see who
    // handled their own child's request.
    profileIds.length ? admin.from("profiles").select("id,full_name").in("id", profileIds) : Promise.resolve({ data: [] as any[] }),
  ] as any);

  const homerooms = new Map((((homeroomRes as any).data || []) as any[]).map((row) => [row.grade, row.teacher_name as string]));
  const names = new Map<string, string>();
  for (const profile of (((namesRes as any).data || []) as any[])) names.set(profile.id, profile.full_name || "");

  const ackRows = ((acksRes as any).data || []) as any[];
  const ackStaffIds = Array.from(new Set(ackRows.map((ack) => ack.staff_id)));
  if (ackStaffIds.length) {
    const { data: ackNames } = await admin.from("profiles").select("id,full_name").in("id", ackStaffIds);
    for (const profile of (ackNames || []) as any[]) names.set(profile.id, profile.full_name || "");
  }

  const acks = new Map<string, EarlyDismissalRequest["acknowledgedBy"]>();
  for (const ack of ackRows) {
    acks.set(ack.request_id, [...(acks.get(ack.request_id) || []), { id: ack.staff_id, name: names.get(ack.staff_id) || "선생님", at: ack.acknowledged_at }]);
  }

  const requests = rows.map((row) => serializeRequestRow(row, {
    homeroomTeacherName: homerooms.get(gradeOf(row)) || "",
    names,
    acknowledgedBy: acks.get(row.id) || [],
  }));

  return NextResponse.json({ requests, viewerId: user.id, isStaff });
}

/** A parent submits a 조퇴 or 결석 request for one of their own children. Every teacher and admin
 * is pushed a notification -- that notification is the whole workflow; nothing waits on an
 * approval. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("parent")) return NextResponse.json({ error: "학부모 권한이 필요합니다." }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "입력값을 확인해 주세요." }, { status: 400 });
  }

  // Requests submitted before 결석 existed carried no type at all, so an absent field means 조퇴.
  if (body.type !== undefined && !isRequestType(body.type)) return NextResponse.json({ error: "신청 종류를 확인해 주세요." }, { status: 400 });
  const requestType: EarlyDismissalRequestType = isRequestType(body.type) ? body.type : "early_dismissal";
  const studentId = String(body.studentId || "").trim();
  const typeLabel = requestTypeLabel(requestType);
  const dismissalDate = String(body.dismissalDate || "").trim();
  // A leaving time and a same-day return describe a 조퇴 only; on a 결석 the child is away all day.
  const dismissalTime = usesDismissalTime(requestType) ? String(body.dismissalTime || "").trim() : "";
  const reason = String(body.reason || "").trim();
  const guardianName = String(body.guardianName || "").trim().slice(0, MAX_NAME_LENGTH);
  const guardianContact = String(body.guardianContact || "").trim().slice(0, MAX_CONTACT_LENGTH);
  const returnsSameDay = usesDismissalTime(requestType) && body.returnsSameDay === true;

  if (!studentId || !dismissalDate || !reason) return NextResponse.json({ error: `학생, ${typeLabel} 날짜, 사유를 입력해 주세요.` }, { status: 400 });
  if (!DATE_PATTERN.test(dismissalDate)) return NextResponse.json({ error: `${typeLabel} 날짜를 확인해 주세요.` }, { status: 400 });
  if (dismissalTime && !TIME_PATTERN.test(dismissalTime)) return NextResponse.json({ error: "조퇴 시각을 확인해 주세요." }, { status: 400 });
  if (reason.length > MAX_REASON_LENGTH) return NextResponse.json({ error: `사유는 ${MAX_REASON_LENGTH}자 이내로 입력해 주세요.` }, { status: 400 });

  // parent_students is also enforced by the insert policy; checking here turns a policy violation
  // into a message the parent can act on.
  const linkRes = await supabase.from("parent_students").select("student_id,students(id,name,grade)").eq("parent_id", user.id).eq("student_id", studentId).maybeSingle();
  const student = Array.isArray((linkRes.data as any)?.students) ? (linkRes.data as any).students[0] : (linkRes.data as any)?.students;
  if (linkRes.error || !student) return NextResponse.json({ error: `연결된 자녀만 ${typeLabel} 신청을 할 수 있습니다.` }, { status: 403 });

  // One open request per child per day, whichever kind: 조퇴와 결석은 같은 날 함께 성립하지 않는다.
  const duplicateQuery = (select: string) =>
    supabase.from("early_dismissal_requests").select(select).eq("student_id", studentId).eq("dismissal_date", dismissalDate).is("cancelled_at", null).limit(1).maybeSingle();
  let duplicate: any = await duplicateQuery("id,request_type");
  if (isMissingRequestTypeError(duplicate.error)) duplicate = await duplicateQuery("id");
  if (duplicate.data) {
    const existingLabel = requestTypeLabel(isRequestType((duplicate.data as any).request_type) ? (duplicate.data as any).request_type : "early_dismissal");
    return NextResponse.json({ error: `같은 날짜에 이미 제출한 ${existingLabel} 신청이 있습니다.` }, { status: 409 });
  }

  const row = {
    student_id: studentId,
    parent_id: user.id,
    request_type: requestType,
    dismissal_date: dismissalDate,
    dismissal_time: dismissalTime || null,
    reason,
    guardian_name: guardianName || null,
    guardian_contact: guardianContact || null,
    returns_same_day: returnsSameDay,
  };
  const insert = (values: Record<string, unknown>) => supabase.from("early_dismissal_requests").insert(values).select("id").single();
  let insertRes = await insert(row);
  // 조퇴 was accepted long before request_type existed, so a database that is one migration
  // behind must still take it -- writing the column is the only thing 결석 added to this insert.
  if (isMissingRequestTypeError(insertRes.error)) {
    warnRequestTypeMissing("insert");
    if (requestType === "absence") {
      return NextResponse.json({ error: "결석 신청은 아직 받을 수 없습니다. 조퇴로 신청하시거나 학교로 연락해 주세요." }, { status: 503 });
    }
    const { request_type: _unmigrated, ...legacyRow } = row;
    insertRes = await insert(legacyRow);
  }
  if (insertRes.error || !insertRes.data) {
    console.error("early-dismissal-insert-failed", { code: insertRes.error?.code, message: insertRes.error?.message });
    return NextResponse.json({ error: `${typeLabel} 신청을 저장하지 못했습니다. 다시 시도해 주세요.` }, { status: 500 });
  }

  const requestId = insertRes.data.id;
  const [{ data: profile }, homeroomRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("homeroom_assignments").select("teacher_name").eq("grade", student.grade).maybeSingle(),
  ]);
  const parentName = (profile as any)?.full_name || "학부모";
  const homeroomTeacherName = (homeroomRes.data as any)?.teacher_name || "";
  const content = buildSubmissionNotice({ type: requestType, studentName: student.name, studentGrade: student.grade, dismissalDate, dismissalTime: dismissalTime || null, reason, guardianName, returnsSameDay }, parentName, homeroomTeacherName);

  after(async () => {
    try {
      await notifyStaffOfEarlyDismissal(requestId, content, [user.id]);
      const admin = createAdminClient();
      const { data: links } = await admin.from("parent_students").select("parent_id").eq("student_id", studentId);
      const parentIds = Array.from(new Set((links || []).map((row: any) => row.parent_id).filter(Boolean)));
      if (parentIds.length) await admin.from("parent_dashboard_events").insert(parentIds.map((parentId) => ({ parent_id: parentId, event_type: "early_dismissal_submitted", entity_id: requestId })));
    } catch (error) {
      console.error("early-dismissal-submit-notify-failed", { requestId, message: error instanceof Error ? error.message : "unknown" });
    }
  });

  return NextResponse.json({ success: true, requestId, message: `${typeLabel} 신청을 접수했습니다. 모든 선생님께 알림이 전송됩니다.` });
}
