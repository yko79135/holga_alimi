import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attendanceChangeType } from "@/lib/attendance/format";
import { currentStatus, latestStatusByStudentDate } from "@/lib/attendance/aggregate";
import { buildAttendanceReasonTemplate } from "@/lib/attendance/reasons";
import { termForDate } from "@/lib/warnings/term";
import type { AttendanceStatus } from "@/lib/attendance/types";
import { formatDismissalTime } from "./format";

export type AttendanceSyncResult =
  | { recorded: true }
  | { recorded: false; reason: "already-early-leave" | "not-early-leave" | "nothing-to-revert" | "failed" };

type Params = {
  requestId: string;
  studentId: string;
  studentName: string;
  dismissalDate: string;
  dismissalTime: string | null;
  reason: string;
  authorId: string;
};

const KEY_PREFIX = "early-dismissal";

/** attendance_entries is an append-only history: the "current" status for a day is the newest
 * entry for that (student, date), read the same way the attendance grid reads it. That status --
 * not a stored flag -- is what decides whether there is anything to write, so an approval that is
 * repeated, or withdrawn and granted again, always lands on the right answer. */
async function dayEntries(supabase: SupabaseClient, studentId: string, date: string, academicYear: number, semester: number) {
  const { data, error } = await supabase
    .from("attendance_entries")
    .select("student_id,attendance_date,previous_status,new_status,created_at")
    .eq("student_id", studentId)
    .eq("attendance_date", date)
    .eq("academic_year", academicYear)
    .eq("semester", semester)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as Array<{ student_id: string; attendance_date: string; previous_status: AttendanceStatus | null; new_status: AttendanceStatus; created_at: string }>;
}

/** attendance_change_batches.idempotency_key is unique, so the key doubles as the lock against a
 * double-clicked button. It carries a cycle number because one request can legitimately be
 * recorded, undone, and recorded again, each needing its own batch. */
async function nextKey(supabase: SupabaseClient, requestId: string, action: "recorded" | "reverted") {
  const { count } = await supabase
    .from("attendance_change_batches")
    .select("id", { count: "exact", head: true })
    .like("idempotency_key", `${KEY_PREFIX}-%:${requestId}:%`);
  return `${KEY_PREFIX}-${action}:${requestId}:${count ?? 0}`;
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string })?.code === "23505";
}

async function writeEntry(
  supabase: SupabaseClient,
  key: string,
  term: { academicYear: number; semester: number; month: number },
  entry: { studentId: string; date: string; previousStatus: AttendanceStatus; newStatus: AttendanceStatus; reason: string; authorId: string },
) {
  const batchRes = await supabase
    .from("attendance_change_batches")
    .insert({ idempotency_key: key, academic_year: term.academicYear, semester: term.semester, month: term.month, author_id: entry.authorId })
    .select("id")
    .single();
  if (batchRes.error || !batchRes.data) throw batchRes.error || new Error("batch insert returned no row");

  const entryRes = await supabase.from("attendance_entries").insert({
    batch_id: batchRes.data.id,
    student_id: entry.studentId,
    attendance_date: entry.date,
    academic_year: term.academicYear,
    semester: term.semester,
    month: term.month,
    previous_status: entry.previousStatus,
    new_status: entry.newStatus,
    change_type: attendanceChangeType(entry.newStatus),
    parent_visible_reason: entry.reason,
    author_id: entry.authorId,
  }).select("id").single();
  if (entryRes.error || !entryRes.data) throw entryRes.error || new Error("entry insert returned no row");
}

/** Writes 조퇴 into the attendance record when a teacher records the request. Never throws: a
 * failure is reported back for the caller to surface so the teacher can still enter the day by
 * hand in 출석 관리. */
export async function recordEarlyDismissalAttendance(supabase: SupabaseClient, params: Params): Promise<AttendanceSyncResult> {
  const term = termForDate(params.dismissalDate);
  try {
    const entries = await dayEntries(supabase, params.studentId, params.dismissalDate, term.academicYear, term.semester);
    const previousStatus = currentStatus(latestStatusByStudentDate(entries), params.studentId, params.dismissalDate);
    // attendance_entries requires previous_status to differ from new_status, and a day already
    // marked 조퇴 -- by a teacher directly, or by this same request -- needs no second row.
    if (previousStatus === "early_leave") return { recorded: false, reason: "already-early-leave" };

    const clock = formatDismissalTime(params.dismissalTime);
    const template = buildAttendanceReasonTemplate({ studentName: params.studentName, date: params.dismissalDate, previousStatus, newStatus: "early_leave" });
    const detail = [clock ? `${clock} 조퇴` : null, `학부모 조퇴 신청 (사유: ${params.reason})`].filter(Boolean).join(" · ");

    await writeEntry(supabase, await nextKey(supabase, params.requestId, "recorded"), term, {
      studentId: params.studentId,
      date: params.dismissalDate,
      previousStatus,
      newStatus: "early_leave",
      reason: `${template}${detail}`,
      authorId: params.authorId,
    });
    return { recorded: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { recorded: false, reason: "already-early-leave" };
    console.error("early-dismissal-attendance-record-failed", { requestId: params.requestId, message: error instanceof Error ? error.message : "unknown" });
    return { recorded: false, reason: "failed" };
  }
}

/** Undoes a record a teacher entered by mistake. The attendance log is append-only, so this
 * writes a correction entry back to whatever the day held before -- and only while the day still
 * reads 조퇴, so a later edit by someone else is never overwritten. */
export async function revertEarlyDismissalAttendance(supabase: SupabaseClient, params: Omit<Params, "reason" | "dismissalTime">): Promise<AttendanceSyncResult> {
  const term = termForDate(params.dismissalDate);
  try {
    const entries = await dayEntries(supabase, params.studentId, params.dismissalDate, term.academicYear, term.semester);
    if (!entries.length) return { recorded: false, reason: "nothing-to-revert" };
    const current = currentStatus(latestStatusByStudentDate(entries), params.studentId, params.dismissalDate);
    // Someone corrected the day after the approval -- leave their edit alone.
    if (current !== "early_leave") return { recorded: false, reason: "not-early-leave" };

    // Restore what the day held before 조퇴 was written, rather than a blanket 출석.
    const restored = (entries.find((entry) => entry.new_status === "early_leave")?.previous_status || "present") as AttendanceStatus;
    if (restored === "early_leave") return { recorded: false, reason: "nothing-to-revert" };

    const template = buildAttendanceReasonTemplate({ studentName: params.studentName, date: params.dismissalDate, previousStatus: "early_leave", newStatus: restored });
    await writeEntry(supabase, await nextKey(supabase, params.requestId, "reverted"), term, {
      studentId: params.studentId,
      date: params.dismissalDate,
      previousStatus: "early_leave",
      newStatus: restored,
      reason: `${template}조퇴 기록이 취소되었습니다.`,
      authorId: params.authorId,
    });
    return { recorded: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { recorded: false, reason: "nothing-to-revert" };
    console.error("early-dismissal-attendance-revert-failed", { requestId: params.requestId, message: error instanceof Error ? error.message : "unknown" });
    return { recorded: false, reason: "failed" };
  }
}
