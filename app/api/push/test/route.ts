import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { configureWebPush, deliverToSubscriptions, type Sub } from "@/lib/push/send";

/** Sends a test notification to the caller's own devices and reports what each push service
 * answered, so "알림이 안 와요" can be told apart: no subscription saved, push service refused
 * (shown with its error), or accepted by the push service but not shown by the device. */
export async function POST(req: Request) {
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!configureWebPush()) return NextResponse.json({ error: "서버에 VAPID 키가 설정되지 않았습니다." }, { status: 500 });

  const endpoint = String((await req.json().catch(() => ({})))?.endpoint || "");
  const { data, error } = await createAdminClient().from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id").eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "알림 구독을 불러오지 못했습니다." }, { status: 500 });

  const subs = (data || []) as Sub[];
  const results = await deliverToSubscriptions(subs, JSON.stringify({
    title: "테스트 알림",
    body: "이 알림이 보이면 이 기기에서 앱 알림이 정상입니다.",
    noticeId: `test-${Date.now()}`,
    url: "/account",
    category: "general",
  }));

  const thisDevice = results.find((r) => subs.find((sub) => sub.id === r.subscriptionId)?.endpoint === endpoint) ?? null;
  return NextResponse.json({
    devices: subs.length,
    sent: results.filter((r) => r.ok).length,
    thisDeviceSaved: Boolean(endpoint) && subs.some((sub) => sub.endpoint === endpoint),
    thisDevice: thisDevice && { ok: thisDevice.ok, gone: thisDevice.gone, error: thisDevice.error },
  });
}
