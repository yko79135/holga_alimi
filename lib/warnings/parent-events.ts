import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

/** Nudges the affected parents' dashboards to refetch (the table is a transient realtime
 * queue, see supabase/20260714_parent_dashboard_realtime.sql). This is not a push notification.
 * Best-effort: a failure here must not fail an edit that already landed. */
export async function notifyParentsOfPointChange(admin: ReturnType<typeof createAdminClient>, studentId: string, kind: "discipline" | "praise" | null, batchId: string) {
  const { data, error } = await admin.from("parent_students").select("parent_id").eq("student_id", studentId);
  if (error || !data?.length) return;
  const parentIds = Array.from(new Set(data.map((link: { parent_id: string }) => link.parent_id).filter(Boolean)));
  if (!parentIds.length) return;
  const eventType = kind === "praise" ? "praise_updated" : "warning_updated";
  const { error: insertError } = await admin.from("parent_dashboard_events").insert(parentIds.map((parentId) => ({ parent_id: parentId, event_type: eventType, entity_id: batchId })));
  if (insertError) console.error("warning-entry-parent-event-failed", { batchId, studentId, code: insertError.code, message: insertError.message });
}
