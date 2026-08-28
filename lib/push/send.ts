import "server-only";

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildEarlyDismissalPayload, buildReplyPushPayload, buildSafeNoticePayload, buildStaffNoticePayload, type SafePushPayload } from "./payload";

type Notice = { id: string; title: string; body: string; target_scope: string; target_grade: string | null; created_by?: string | null };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id: string };
type PushResult = { sent: number; unsubscribed: number; failed: number; recipients: number };

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function resolveNoticeRecipientIds(notice: Pick<Notice, "id" | "target_scope" | "target_grade">) {
  const admin = createAdminClient();
  let ids: string[] = [];

  if (notice.target_scope === "school") {
    const { data } = await admin.from("profile_roles").select("profile_id").eq("role", "parent");
    ids = (data || []).map((r: any) => r.profile_id);
  } else if (notice.target_scope === "grade") {
    const { data } = await admin.from("parent_students").select("parent_id,students!inner(grade)").eq("students.grade", notice.target_grade);
    ids = (data || []).map((r: any) => r.parent_id);
  } else {
    const { data: ns } = await admin.from("notice_students").select("student_id").eq("notice_id", notice.id);
    const studentIds = (ns || []).map((r: any) => r.student_id);
    if (studentIds.length) {
      const { data } = await admin.from("parent_students").select("parent_id").in("student_id", studentIds);
      ids = (data || []).map((r: any) => r.parent_id);
    }
  }

  return Array.from(new Set(ids));
}

async function resolveStaffRecipientIds() {
  const admin = createAdminClient();
  const { data } = await admin.from("profile_roles").select("profile_id").in("role", ["admin", "teacher"]);
  return Array.from(new Set((data || []).map((r: any) => r.profile_id)));
}

async function pushToUserIds(userIds: string[], payload: SafePushPayload): Promise<PushResult> {
  if (!userIds.length) return { sent: 0, unsubscribed: 0, failed: 0, recipients: 0 };
  if (!configureWebPush()) return { sent: 0, unsubscribed: 0, failed: userIds.length, recipients: userIds.length };

  const admin = createAdminClient();
  const { data } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id").in("user_id", userIds);
  const subs = (data || []) as Sub[];
  const payloadJson = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const invalid: string[] = [];

  for (let i = 0; i < subs.length; i += 5) {
    await Promise.all(
      subs.slice(i, i + 5).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payloadJson,
            { TTL: 86400 },
          );
          sent++;
        } catch (error) {
          const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 0;
          if (statusCode === 404 || statusCode === 410) invalid.push(sub.id);
          else failed++;
        }
      }),
    );
  }

  if (invalid.length) await admin.from("push_subscriptions").delete().in("id", invalid);

  return {
    sent,
    unsubscribed: Math.max(0, userIds.length - new Set(subs.map((s) => s.user_id)).size),
    failed,
    recipients: userIds.length,
  };
}

/** Sends the notice to its parent recipients, and -- for school-wide notices only -- to every
 * teacher/admin as well (minus the author, who already knows they sent it). Individual-student
 * notices (discipline/praise/attendance/single-student) are not broadcast to staff who aren't
 * involved, to keep those records scoped the way the rest of the app scopes them. */
export async function sendNoticePushes(notice: Notice): Promise<PushResult> {
  const parentIds = await resolveNoticeRecipientIds(notice);
  const parentResult = await pushToUserIds(parentIds, buildSafeNoticePayload(notice));

  if (notice.target_scope === "school") {
    const staffIds = await resolveStaffRecipientIds();
    const recipients = notice.created_by ? staffIds.filter((id) => id !== notice.created_by) : staffIds;
    await pushToUserIds(recipients, buildStaffNoticePayload(notice));
  }

  return parentResult;
}

/** Pushes a discipline-point notice to every teacher/admin except whoever granted the point, so
 * the rest of staff hears about every discipline point as it happens, not just the parent. Also
 * excludes anyone in `excludeIds` (the notice's own parent-recipients) -- a dual-role account
 * (teacher who is also that student's parent) would otherwise get both the parent-facing push
 * and this staff broadcast for the same notice id, and since both share that id as their
 * notification `tag`, the second one silently overwrites the first's title/body/deep-link on the
 * device instead of showing as a separate notification. */
export async function notifyStaffOfDisciplinePoint(notice: Pick<Notice, "id" | "title" | "body">, authorId: string | null, excludeIds: string[] = []): Promise<PushResult> {
  const staffIds = await resolveStaffRecipientIds();
  const exclude = new Set(excludeIds);
  if (authorId) exclude.add(authorId);
  const recipients = staffIds.filter((id) => !exclude.has(id));
  return pushToUserIds(recipients, buildStaffNoticePayload(notice));
}

/** Notifies the notice's author when a parent replies. No-op if the notice has no known author
 * (e.g. it predates the created_by column). */
export async function sendReplyPushToTeacher(notice: { id: string; title: string; created_by: string | null }, parentName: string, replyText: string): Promise<PushResult> {
  if (!notice.created_by) return { sent: 0, unsubscribed: 0, failed: 0, recipients: 0 };
  return pushToUserIds([notice.created_by], buildReplyPushPayload(notice, parentName, replyText));
}

/** Notifies every teacher/admin that a parent submitted (or withdrew) an early dismissal
 * request, minus the submitting parent themselves -- a dual-role teacher-parent already knows
 * they just submitted it. Staff notification is the whole point of the feature: there is no
 * approval step, so this push is what puts the request in front of the teachers. */
export async function notifyStaffOfEarlyDismissal(requestId: string, content: { title: string; body: string }, excludeIds: string[] = []): Promise<PushResult> {
  const staffIds = await resolveStaffRecipientIds();
  const exclude = new Set(excludeIds);
  return pushToUserIds(staffIds.filter((id) => !exclude.has(id)), buildEarlyDismissalPayload(requestId, content, "staff"));
}
