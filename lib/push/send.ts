import "server-only";

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSafeNoticePayload } from "./payload";

type Notice = { id: string; target_scope: string; target_grade: string | null };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id: string };

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function resolveNoticeRecipientIds(notice: Notice) {
  const admin = createAdminClient();
  let ids: string[] = [];

  if (notice.target_scope === "school") {
    const { data } = await admin.from("profiles").select("id").eq("role", "parent");
    ids = (data || []).map((r: any) => r.id);
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

export async function sendNoticePushes(notice: Notice) {
  const admin = createAdminClient();
  const recipients = await resolveNoticeRecipientIds(notice);
  if (!recipients.length) return { sent: 0, unsubscribed: 0, failed: 0, recipients: 0 };

  if (!configureWebPush()) return { sent: 0, unsubscribed: 0, failed: recipients.length, recipients: recipients.length };

  const { data } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id").in("user_id", recipients);
  const subs = (data || []) as Sub[];
  const payload = JSON.stringify(buildSafeNoticePayload(notice));
  let sent = 0;
  let failed = 0;
  const invalid: string[] = [];

  for (let i = 0; i < subs.length; i += 5) {
    await Promise.all(
      subs.slice(i, i + 5).map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
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
    unsubscribed: Math.max(0, recipients.length - new Set(subs.map((s) => s.user_id)).size),
    failed,
    recipients: recipients.length,
  };
}
