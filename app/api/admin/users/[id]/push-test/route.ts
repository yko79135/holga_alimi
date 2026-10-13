import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { canSeeProfile } from "@/lib/admin/test-fixtures";
import { configureWebPush, deliverToSubscriptions, type Sub } from "@/lib/push/send";

type SubRow = Sub & { user_agent: string | null; last_success_at: string | null; last_seen_at: string | null };

/** For "○○님은 알림이 안 와요": sends a fixed test notification to that account's devices and
 * returns what each push service answered, plus when the device last received anything. The
 * message is fixed so this can't be used to push arbitrary content to someone. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const admin = createAdminClient();
  if (!(await canSeeProfile(admin, id, auth.user.id))) return adminJsonError("대상 계정을 찾을 수 없습니다.", 404);
  if (!configureWebPush()) return adminJsonError("서버에 VAPID 키가 설정되지 않았습니다.", 500);

  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,user_id,user_agent,last_success_at,last_seen_at")
    .eq("user_id", id);
  if (error) return adminJsonError("알림 구독을 불러오지 못했습니다.", 500);
  const subs = (data || []) as SubRow[];

  const results = await deliverToSubscriptions(subs, JSON.stringify({
    title: "테스트 알림",
    body: "학교 알림 전송을 점검하고 있습니다. 이 알림이 보이면 정상입니다.",
    noticeId: `test-${Date.now()}`,
    url: "/dashboard",
    category: "general",
  }));

  return NextResponse.json({
    devices: subs.map((sub) => {
      const r = results.find((x) => x.subscriptionId === sub.id);
      return {
        service: new URL(sub.endpoint).host.includes("apple") ? "Apple" : new URL(sub.endpoint).host.includes("google") ? "Google" : new URL(sub.endpoint).host,
        device: /iPhone|iPad/.test(sub.user_agent ?? "") ? "iPhone/iPad" : /Android/.test(sub.user_agent ?? "") ? "Android" : "기타",
        previousSuccessAt: sub.last_success_at,
        lastSeenAt: sub.last_seen_at,
        ok: r?.ok ?? false,
        gone: r?.gone ?? false,
        error: r?.error ?? null,
      };
    }),
  });
}
