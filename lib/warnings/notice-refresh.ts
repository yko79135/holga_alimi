import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { buildPointCorrectionFooter, buildPointCorrectionNotice } from "@/lib/warnings/format";
import type { PointKind } from "@/lib/warnings/categories";

type Admin = ReturnType<typeof createAdminClient>;

type NoticeEntry = {
  id: string;
  warning_date: string | null;
  entry_type: "daily" | "grace_adjustment" | "grace_conversion";
  kind: "discipline" | "praise" | null;
  category: string | null;
  parent_visible_reason: string | null;
  delta: number;
  academic_year: number;
  semester: number;
  month: number;
  created_at: string;
  class_periods?: { name: string } | null;
};

const ENTRY_COLUMNS = "id,warning_date,entry_type,kind,category,parent_visible_reason,delta,academic_year,semester,month,created_at,class_periods(name)";

/** "2026. 8. 26." -- the same shape toLocaleDateString("ko-KR") renders in the portal. Built from
 * the date parts directly so the string does not depend on the server's locale data. */
function koreanDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}

function entryDateLabel(entry: NoticeEntry) {
  if (entry.warning_date) return koreanDate(entry.warning_date);
  return entry.entry_type === "grace_conversion" ? "희월 정산" : "희월·조정";
}

function entryReason(entry: NoticeEntry) {
  return entry.parent_visible_reason || entry.category || "사유 없음";
}

/** Rewrites the 학부모 안내문 generated for one student's share of a point batch so it matches the
 * entries as they stand now. Called after an entry is edited or deleted in 점수 통계 -- without it
 * the notice keeps quoting the 점수 and 사유 that were first sent. Best-effort: the ledger edit has
 * already been committed, so a failure here is logged and reported, never thrown.
 *
 * No push is sent. The original announcement already reached the parent's phone, and a silent
 * correction is what the teacher asked for; re-notifying is a separate decision. */
export async function refreshGeneratedPointNotice(admin: Admin, params: { batchId: string; studentId: string; today: string }): Promise<"updated" | "skipped" | "failed"> {
  const { batchId, studentId, today } = params;

  const generated = await admin.from("warning_generated_notices").select("notice_id").eq("batch_id", batchId).eq("student_id", studentId).maybeSingle<{ notice_id: string | null }>();
  if (generated.error) {
    console.error("point-notice-refresh-lookup-failed", { batchId, studentId, code: generated.error.code, message: generated.error.message });
    return "failed";
  }
  const noticeId = generated.data?.notice_id;
  if (!noticeId) return "skipped";

  const entriesRes = await admin.from("warning_entries").select(ENTRY_COLUMNS).eq("batch_id", batchId).eq("student_id", studentId).order("warning_date", { ascending: true }).order("created_at", { ascending: true });
  if (entriesRes.error) {
    console.error("point-notice-refresh-entries-failed", { batchId, studentId, code: entriesRes.error.code, message: entriesRes.error.message });
    return "failed";
  }
  const entries = (entriesRes.data || []) as unknown as NoticeEntry[];
  // Nothing left for this student in the batch: the caller deletes the notice outright.
  if (!entries.length) return "skipped";
  // 희월 정산 notices describe a settlement, not a list of entries, and their rows cannot be
  // edited -- leave that text alone.
  if (entries.some((entry) => entry.entry_type === "grace_conversion")) return "skipped";

  const primary = entries[entries.length - 1];
  const kind: PointKind = primary.kind === "praise" ? "praise" : "discipline";
  const kindLabel = kind === "praise" ? "칭찬" : "훈계";

  const monthlyRes = await admin.from("warning_entries").select("delta,kind").eq("student_id", studentId).eq("academic_year", primary.academic_year).eq("semester", primary.semester).eq("month", primary.month);
  if (monthlyRes.error) {
    console.error("point-notice-refresh-total-failed", { batchId, studentId, code: monthlyRes.error.code, message: monthlyRes.error.message });
    return "failed";
  }
  const monthlyTotal = (monthlyRes.data || [])
    .filter((row: { kind: string | null }) => (kind === "praise" ? row.kind === "praise" : row.kind !== "praise"))
    .reduce((sum: number, row: { delta: number }) => sum + Number(row.delta || 0), 0);

  const noticeRes = await admin.from("notices").select("id,title,body").eq("id", noticeId).maybeSingle<{ id: string; title: string; body: string }>();
  if (noticeRes.error || !noticeRes.data) {
    if (noticeRes.error) console.error("point-notice-refresh-notice-failed", { batchId, studentId, noticeId, code: noticeRes.error.code, message: noticeRes.error.message });
    return noticeRes.error ? "failed" : "skipped";
  }

  let update: { title?: string; body: string };
  if (entries.length === 1) {
    const studentRes = await admin.from("students").select("name").eq("id", studentId).maybeSingle<{ name: string }>();
    const rebuilt = buildPointCorrectionNotice({
      kind,
      studentName: studentRes.data?.name || "학생",
      reason: entryReason(primary),
      className: primary.class_periods?.name || null,
      points: Number(primary.delta || 0),
      monthlyTotal,
      correctedOn: koreanDate(today),
    });
    update = { title: rebuilt.title, body: rebuilt.body };
  } else {
    update = {
      body: buildPointCorrectionFooter({
        body: noticeRes.data.body,
        entries: entries.map((entry) => ({ dateLabel: entryDateLabel(entry), reason: entryReason(entry), points: Number(entry.delta || 0) })),
        kindLabel,
        monthlyTotal,
        correctedOn: koreanDate(today),
      }),
    };
  }

  const updateRes = await admin.from("notices").update(update).eq("id", noticeId).select("id").single();
  if (updateRes.error) {
    console.error("point-notice-refresh-update-failed", { batchId, studentId, noticeId, code: updateRes.error.code, message: updateRes.error.message });
    return "failed";
  }
  return "updated";
}
