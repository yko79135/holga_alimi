import { NextResponse } from "next/server";
import { requireStaff, staffJsonError } from "@/lib/admin/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeType } from "@/lib/warnings/format";
import { MAX_DISCIPLINE_POINT_VALUE } from "@/lib/warnings/categories";
import { isValidDateOnly, termForDate } from "@/lib/warnings/term";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EntryRow = {
  id: string;
  batch_id: string;
  student_id: string;
  warning_date: string | null;
  entry_type: "daily" | "grace_adjustment" | "grace_conversion";
  kind: "discipline" | "praise" | null;
  previous_value: number;
  delta: number;
};

const ENTRY_COLUMNS = "id,batch_id,student_id,warning_date,entry_type,kind,previous_value,delta";

/** warning_entries is a staff-only ledger with no update/delete RLS policy (it was built
 * append-only), so both handlers go through the service-role client behind requireStaff() --
 * the same shape app/api/admin/reset-records uses to delete point records. */
async function loadEntry(admin: ReturnType<typeof createAdminClient>, entryId: string) {
  const { data, error } = await admin.from("warning_entries").select(ENTRY_COLUMNS).eq("id", entryId).maybeSingle<EntryRow>();
  if (error) return { error: staffJsonError("점수 내역을 불러오지 못했습니다.", 500) };
  if (!data) return { error: staffJsonError("점수 내역을 찾을 수 없습니다.", 404) };
  return { entry: data };
}

/** Nudges the affected parents' dashboards to refetch (the table is a transient realtime
 * queue, see supabase/20260714_parent_dashboard_realtime.sql). Best-effort: a failure here
 * must not fail an edit that already landed. */
async function notifyParents(admin: ReturnType<typeof createAdminClient>, studentId: string, kind: EntryRow["kind"], batchId: string) {
  const { data, error } = await admin.from("parent_students").select("parent_id").eq("student_id", studentId);
  if (error || !data?.length) return;
  const parentIds = Array.from(new Set(data.map((link: { parent_id: string }) => link.parent_id).filter(Boolean)));
  if (!parentIds.length) return;
  const eventType = kind === "praise" ? "praise_updated" : "warning_updated";
  const { error: insertError } = await admin.from("parent_dashboard_events").insert(parentIds.map((parentId) => ({ parent_id: parentId, event_type: eventType, entity_id: batchId })));
  if (insertError) console.error("warning-entry-parent-event-failed", { batchId, studentId, code: insertError.code, message: insertError.message });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const entryId = String(id || "").trim();
  if (!UUID_PATTERN.test(entryId)) return staffJsonError("점수 내역 ID를 확인해 주세요.", 400);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return staffJsonError("입력값을 확인해 주세요.", 400);

  const admin = createAdminClient();
  const loaded = await loadEntry(admin, entryId);
  if ("error" in loaded) return loaded.error;
  const entry = loaded.entry;

  // 희월 정산 writes a matched pair (칭찬 -20*units / 훈계 -units) whose amounts have to stay in
  // step, so editing one side alone is refused -- delete the settlement and re-apply it instead.
  if (entry.entry_type === "grace_conversion") {
    return staffJsonError("희월 정산 내역은 수정할 수 없습니다. 삭제한 뒤 희월을 다시 적용해 주세요.", 400);
  }

  const points = Number(body.points);
  if (!Number.isInteger(points) || points === 0) return staffJsonError("적용 점수는 0이 아닌 정수로 입력해 주세요.", 400);
  if (entry.kind !== "praise" && Math.abs(points) > MAX_DISCIPLINE_POINT_VALUE) {
    return staffJsonError(`훈계 점수는 -${MAX_DISCIPLINE_POINT_VALUE}~${MAX_DISCIPLINE_POINT_VALUE} 사이의 정수로 입력해 주세요.`, 400);
  }

  const update: Record<string, unknown> = {
    delta: points,
    // previous_value stays put; new_value is what the entry left the running total at, and the
    // grid/grant writers both keep new_value = previous_value + delta.
    new_value: Number(entry.previous_value || 0) + points,
    change_type: changeType(points, entry.entry_type === "daily" ? "daily" : "grace_adjustment"),
  };

  if (body.reason !== undefined) {
    const reason = String(body.reason || "").trim();
    update.parent_visible_reason = reason || null;
  }

  if (body.classPeriodId !== undefined) {
    const classPeriodId = String(body.classPeriodId || "").trim();
    if (classPeriodId) {
      if (!UUID_PATTERN.test(classPeriodId)) return staffJsonError("수업 정보를 확인할 수 없습니다.", 400);
      const classRes = await admin.from("class_periods").select("id").eq("id", classPeriodId).maybeSingle();
      if (classRes.error || !classRes.data) return staffJsonError("수업 정보를 확인할 수 없습니다.", 400);
      update.class_period_id = classPeriodId;
    } else {
      update.class_period_id = null;
    }
  }

  // Only 'daily' entries carry a date (a DB check constraint keeps the 희월 rows' date null).
  let movedTerm = false;
  if (entry.entry_type === "daily") {
    const date = body.date === undefined ? entry.warning_date || "" : String(body.date || "").trim();
    if (!isValidDateOnly(date)) return staffJsonError("날짜를 확인해 주세요.", 400);
    const term = termForDate(date);
    movedTerm = date !== entry.warning_date;
    update.warning_date = date;
    update.academic_year = term.academicYear;
    update.semester = term.semester;
    update.month = term.month;
  }

  const { data: updated, error: updateError } = await admin.from("warning_entries").update(update).eq("id", entryId).select(ENTRY_COLUMNS).single<EntryRow>();
  if (updateError || !updated) {
    console.error("warning-entry-update-failed", { entryId, code: updateError?.code, message: updateError?.message });
    return staffJsonError("점수 내역을 수정하지 못했습니다.", 500);
  }

  await notifyParents(admin, entry.student_id, entry.kind, entry.batch_id);

  return NextResponse.json({
    success: true,
    entry: updated,
    // The generated 학부모 안내문 is left as sent -- it records what actually went out. Only the
    // ledger (and therefore every 점수 합계) follows the edit.
    message: movedTerm
      ? "점수 내역을 수정했습니다. 날짜가 바뀌어 다른 월·학기 통계로 이동할 수 있습니다."
      : "점수 내역을 수정했습니다.",
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const entryId = String(id || "").trim();
  if (!UUID_PATTERN.test(entryId)) return staffJsonError("점수 내역 ID를 확인해 주세요.", 400);

  const admin = createAdminClient();
  const loaded = await loadEntry(admin, entryId);
  if ("error" in loaded) return loaded.error;
  const entry = loaded.entry;

  // A 희월 정산 is one settlement recorded as two rows in the same batch; deleting only the half
  // the teacher clicked would leave the other half deducting points forever.
  let deleteQuery = admin.from("warning_entries").delete();
  deleteQuery = entry.entry_type === "grace_conversion"
    ? deleteQuery.eq("batch_id", entry.batch_id).eq("student_id", entry.student_id).eq("entry_type", "grace_conversion")
    : deleteQuery.eq("id", entryId);
  const { data: deleted, error: deleteError } = await deleteQuery.select("id");
  if (deleteError) {
    console.error("warning-entry-delete-failed", { entryId, code: deleteError.code, message: deleteError.message });
    return staffJsonError("점수 내역을 삭제하지 못했습니다.", 500);
  }

  // Once nothing is left of this student's share of the batch, the 학부모 안내문 it generated is
  // about a record that no longer exists, so it goes too (notice_students/acknowledgements
  // cascade from notices).
  let deletedNotice = false;
  const remaining = await admin.from("warning_entries").select("id").eq("batch_id", entry.batch_id).eq("student_id", entry.student_id).limit(1);
  if (!remaining.error && !remaining.data?.length) {
    const generated = await admin.from("warning_generated_notices").select("notice_id").eq("batch_id", entry.batch_id).eq("student_id", entry.student_id).maybeSingle<{ notice_id: string | null }>();
    if (!generated.error && generated.data) {
      await admin.from("warning_generated_notices").delete().eq("batch_id", entry.batch_id).eq("student_id", entry.student_id);
      if (generated.data.notice_id) {
        const noticeRes = await admin.from("notices").delete().eq("id", generated.data.notice_id).select("id");
        deletedNotice = !noticeRes.error && !!noticeRes.data?.length;
      }
    }
  }

  await notifyParents(admin, entry.student_id, entry.kind, entry.batch_id);

  const deletedCount = deleted?.length || 0;
  return NextResponse.json({
    success: true,
    deletedCount,
    deletedNotice,
    message: entry.entry_type === "grace_conversion"
      ? `희월 정산 내역 ${deletedCount}건을 삭제했습니다.`
      : deletedNotice
        ? "점수 내역과 학부모에게 발송된 안내문을 삭제했습니다."
        : "점수 내역을 삭제했습니다.",
  });
}
