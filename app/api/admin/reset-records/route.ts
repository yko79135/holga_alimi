import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetRecordsConfirmPhrase, semesterLabel } from "@/lib/semester";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Permanently deletes every 훈계/칭찬/출석 record for one academic_year+semester: the
 * warning_entries/attendance_entries rows themselves, the notices generated from them (and
 * those notices' acknowledgements/attachments/student links), and the change-batch rows that
 * grouped them. General teacher-composed notices (안내문 등, source_type null) are untouched --
 * only records sourced from a warning/praise/attendance change batch are in scope. Requires the
 * caller to retype a confirmation phrase naming the exact year/semester being wiped. */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const academicYear = Number(body.academicYear);
  const semester = Number(body.semester);
  const confirmText = String(body.confirmText || "").trim();

  if (!Number.isInteger(academicYear) || academicYear < 2000 || ![1, 2].includes(semester)) {
    return NextResponse.json({ error: "학년도와 학기를 확인해 주세요." }, { status: 400 });
  }
  const expectedConfirm = resetRecordsConfirmPhrase(academicYear, semester);
  if (confirmText !== expectedConfirm) {
    return NextResponse.json({ error: `확인 문구가 일치하지 않습니다. "${expectedConfirm}"를 정확히 입력해 주세요.` }, { status: 400 });
  }

  const admin = createAdminClient();

  const [warningBatchesRes, attendanceBatchesRes] = await Promise.all([
    admin.from("warning_change_batches").select("id").eq("academic_year", academicYear).eq("semester", semester),
    admin.from("attendance_change_batches").select("id").eq("academic_year", academicYear).eq("semester", semester),
  ]);
  if (warningBatchesRes.error) return NextResponse.json({ error: "훈계·칭찬 기록을 확인하지 못했습니다." }, { status: 500 });
  if (attendanceBatchesRes.error) return NextResponse.json({ error: "출석 기록을 확인하지 못했습니다." }, { status: 500 });
  const warningBatchIds = (warningBatchesRes.data || []).map((b: { id: string }) => b.id);
  const attendanceBatchIds = (attendanceBatchesRes.data || []).map((b: { id: string }) => b.id);

  const noticeIds = new Set<string>();
  if (warningBatchIds.length) {
    const { data } = await admin.from("notices").select("id").in("source_id", warningBatchIds).in("source_type", ["warning_update", "praise_update", "grace_conversion"]);
    for (const notice of data || []) noticeIds.add(notice.id);
  }
  if (attendanceBatchIds.length) {
    const { data } = await admin.from("notices").select("id").in("source_id", attendanceBatchIds).eq("source_type", "attendance_update");
    for (const notice of data || []) noticeIds.add(notice.id);
  }
  const noticeIdList = Array.from(noticeIds);

  if (noticeIdList.length) {
    await admin.from("acknowledgements").delete().in("notice_id", noticeIdList);
    await admin.from("notice_attachments").delete().in("notice_id", noticeIdList);
    await admin.from("notice_students").delete().in("notice_id", noticeIdList);
  }
  if (warningBatchIds.length) await admin.from("warning_generated_notices").delete().in("batch_id", warningBatchIds);
  if (attendanceBatchIds.length) await admin.from("attendance_generated_notices").delete().in("batch_id", attendanceBatchIds);
  if (noticeIdList.length) await admin.from("notices").delete().in("id", noticeIdList);

  const warningEntriesRes = await admin.from("warning_entries").delete().eq("academic_year", academicYear).eq("semester", semester).select("id");
  const attendanceEntriesRes = await admin.from("attendance_entries").delete().eq("academic_year", academicYear).eq("semester", semester).select("id");
  if (warningEntriesRes.error) return NextResponse.json({ error: "훈계·칭찬 기록 삭제에 실패했습니다." }, { status: 500 });
  if (attendanceEntriesRes.error) return NextResponse.json({ error: "출석 기록 삭제에 실패했습니다." }, { status: 500 });

  if (warningBatchIds.length) await admin.from("warning_change_batches").delete().in("id", warningBatchIds);
  if (attendanceBatchIds.length) await admin.from("attendance_change_batches").delete().in("id", attendanceBatchIds);

  const allBatchIds = [...warningBatchIds, ...attendanceBatchIds];
  if (allBatchIds.length) await admin.from("parent_dashboard_events").delete().in("entity_id", allBatchIds);

  return NextResponse.json({
    success: true,
    message: `${academicYear}년 ${semesterLabel(semester)}의 훈계·칭찬·출석 기록을 모두 삭제했습니다. (훈계·칭찬 ${warningEntriesRes.data?.length || 0}건, 출석 ${attendanceEntriesRes.data?.length || 0}건, 관련 알림 ${noticeIdList.length}건)`,
    deletedWarningEntries: warningEntriesRes.data?.length || 0,
    deletedAttendanceEntries: attendanceEntriesRes.data?.length || 0,
    deletedNotices: noticeIdList.length,
  });
}
