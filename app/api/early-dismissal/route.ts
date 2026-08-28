import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserRoles } from "@/lib/roles-server";
import { notifyStaffOfEarlyDismissal } from "@/lib/push/send";
import { buildSubmissionNotice } from "@/lib/early-dismissal/format";
import { resolveApproverSlots } from "@/lib/early-dismissal/approvers";
import { MAX_CONTACT_LENGTH, MAX_NAME_LENGTH, MAX_REASON_LENGTH, type EarlyDismissalRequest } from "@/lib/early-dismissal/types";
import { serializeRequestRow, REQUEST_SELECT } from "@/lib/early-dismissal/serialize";

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

  let query = supabase.from("early_dismissal_requests").select(REQUEST_SELECT).order("dismissal_date", { ascending: false }).order("created_at", { ascending: false });
  if (!isStaff) query = query.eq("parent_id", user.id);
  const { data, error } = await query;
  if (error) {
    console.error("early-dismissal-list-failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "조퇴 신청 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const rows = (data || []) as any[];
  const grades = Array.from(new Set(rows.map((row) => (Array.isArray(row.students) ? row.students[0] : row.students)?.grade).filter(Boolean)));
  const admin = createAdminClient();
  const profileIds = Array.from(new Set(rows.flatMap((row) => [row.parent_id, row.homeroom_decided_by, row.vice_principal_decided_by]).filter(Boolean)));

  const [homeroomRes, officerRes, acksRes, namesRes] = await Promise.all([
    grades.length ? supabase.from("homeroom_assignments").select("grade,teacher_id,teacher_name").in("grade", grades) : Promise.resolve({ data: [] as any[] }),
    supabase.from("school_officers").select("profile_id,person_name").eq("role_key", "vice_principal").maybeSingle(),
    isStaff && rows.length
      ? supabase.from("early_dismissal_acknowledgements").select("request_id,staff_id,acknowledged_at").in("request_id", rows.map((row) => row.id))
      : Promise.resolve({ data: [] as any[] }),
    // Names only: a parent's RLS view of profiles hides staff, but they still need to see who
    // signed off on their own child's request.
    profileIds.length ? admin.from("profiles").select("id,full_name").in("id", profileIds) : Promise.resolve({ data: [] as any[] }),
  ] as any);

  const homerooms = new Map((((homeroomRes as any).data || []) as any[]).map((row) => [row.grade, row]));
  const officer = (officerRes as any).data;
  const names = new Map<string, string>();
  for (const profile of (((namesRes as any).data || []) as any[])) names.set(profile.id, profile.full_name || "");

  const ackStaffIds = Array.from(new Set((((acksRes as any).data || []) as any[]).map((ack) => ack.staff_id)));
  if (ackStaffIds.length) {
    const { data: ackNames } = await admin.from("profiles").select("id,full_name").in("id", ackStaffIds);
    for (const profile of (ackNames || []) as any[]) names.set(profile.id, profile.full_name || "");
  }

  const acks = new Map<string, EarlyDismissalRequest["acknowledgedBy"]>();
  for (const ack of (((acksRes as any).data || []) as any[])) {
    acks.set(ack.request_id, [...(acks.get(ack.request_id) || []), { id: ack.staff_id, name: names.get(ack.staff_id) || "선생님", at: ack.acknowledged_at }]);
  }

  const vicePrincipal = { teacherId: officer?.profile_id || null, name: officer?.person_name || "" };
  const requests = rows.map((row) => {
    const student = Array.isArray(row.students) ? row.students[0] : row.students;
    const homeroom = homerooms.get(student?.grade);
    return serializeRequestRow(row, {
      homeroom: { teacherId: homeroom?.teacher_id || null, name: homeroom?.teacher_name || "" },
      vicePrincipal,
      names,
      acknowledgedBy: acks.get(row.id) || [],
    });
  });

  const approvableIds = rows
    .filter((row) => {
      const student = Array.isArray(row.students) ? row.students[0] : row.students;
      const homeroomTeacherId = homerooms.get(student?.grade)?.teacher_id || null;
      if (homeroomTeacherId === user.id || vicePrincipal.teacherId === user.id) return true;
      return roles.includes("admin") && (!homeroomTeacherId || !vicePrincipal.teacherId);
    })
    .map((row) => row.id);

  return NextResponse.json({ requests, viewerId: user.id, isStaff, isAdmin: roles.includes("admin"), approvableIds });
}

/** A parent submits a request for one of their own children. Every teacher and admin is pushed a
 * notification; the homeroom teacher and vice principal are the ones who can then approve it. */
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

  const studentId = String(body.studentId || "").trim();
  const dismissalDate = String(body.dismissalDate || "").trim();
  const dismissalTime = String(body.dismissalTime || "").trim();
  const reason = String(body.reason || "").trim();
  const guardianName = String(body.guardianName || "").trim().slice(0, MAX_NAME_LENGTH);
  const guardianContact = String(body.guardianContact || "").trim().slice(0, MAX_CONTACT_LENGTH);
  const returnsSameDay = body.returnsSameDay === true;

  if (!studentId || !dismissalDate || !reason) return NextResponse.json({ error: "학생, 조퇴 날짜, 사유를 입력해 주세요." }, { status: 400 });
  if (!DATE_PATTERN.test(dismissalDate)) return NextResponse.json({ error: "조퇴 날짜를 확인해 주세요." }, { status: 400 });
  if (dismissalTime && !TIME_PATTERN.test(dismissalTime)) return NextResponse.json({ error: "조퇴 시각을 확인해 주세요." }, { status: 400 });
  if (reason.length > MAX_REASON_LENGTH) return NextResponse.json({ error: `사유는 ${MAX_REASON_LENGTH}자 이내로 입력해 주세요.` }, { status: 400 });

  // parent_students is also enforced by the insert policy; checking here turns a policy violation
  // into a message the parent can act on.
  const linkRes = await supabase.from("parent_students").select("student_id,students(id,name,grade)").eq("parent_id", user.id).eq("student_id", studentId).maybeSingle();
  const student = Array.isArray((linkRes.data as any)?.students) ? (linkRes.data as any).students[0] : (linkRes.data as any)?.students;
  if (linkRes.error || !student) return NextResponse.json({ error: "연결된 자녀만 조퇴를 신청할 수 있습니다." }, { status: 403 });

  const duplicate = await supabase.from("early_dismissal_requests").select("id").eq("student_id", studentId).eq("dismissal_date", dismissalDate).eq("status", "pending").limit(1).maybeSingle();
  if (duplicate.data) return NextResponse.json({ error: "같은 날짜에 아직 처리되지 않은 조퇴 신청이 있습니다." }, { status: 409 });

  const insertRes = await supabase
    .from("early_dismissal_requests")
    .insert({
      student_id: studentId,
      parent_id: user.id,
      dismissal_date: dismissalDate,
      dismissal_time: dismissalTime || null,
      reason,
      guardian_name: guardianName || null,
      guardian_contact: guardianContact || null,
      returns_same_day: returnsSameDay,
    })
    .select("id")
    .single();
  if (insertRes.error || !insertRes.data) {
    console.error("early-dismissal-insert-failed", { code: insertRes.error?.code, message: insertRes.error?.message });
    return NextResponse.json({ error: "조퇴 신청을 저장하지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
  }

  const requestId = insertRes.data.id;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const parentName = (profile as any)?.full_name || "학부모";
  const slots = await resolveApproverSlots(supabase, student.grade);
  const content = buildSubmissionNotice({ studentName: student.name, studentGrade: student.grade, dismissalDate, dismissalTime: dismissalTime || null, reason, guardianName, returnsSameDay }, parentName);

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

  return NextResponse.json({
    success: true,
    requestId,
    message: `조퇴 신청을 접수했습니다. 모든 선생님께 알림이 전송되며, 홈룸 선생님(${slots.homeroom.name || "미지정"})과 교감 선생님(${slots.vicePrincipal.name || "미지정"})의 승인이 필요합니다.`,
  });
}
