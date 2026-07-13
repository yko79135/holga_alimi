import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function pushTableError(error: { code?: string; message?: string } | null) {
  if (error?.code === "42P01" || error?.message?.includes("push_subscriptions")) {
    return "Supabase에 push_subscriptions 테이블이 없습니다.";
  }
  return "알림 구독 저장에 실패했습니다.";
}

async function user() {
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return { s, e: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  return { s, user };
}

export async function POST(req: Request) {
  const a = await user();
  if ("e" in a) return a.e;

  const b = await req.json().catch(() => null);
  const endpoint = String(b?.endpoint || "");
  const keys = b?.keys || {};
  if (!endpoint || !keys.p256dh || !keys.auth) return NextResponse.json({ error: "구독 정보가 올바르지 않습니다." }, { status: 400 });

  const { error } = await a.s.from("push_subscriptions").upsert({
    user_id: a.user.id,
    endpoint,
    p256dh: String(keys.p256dh),
    auth: String(keys.auth),
    user_agent: req.headers.get("user-agent"),
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });

  return NextResponse.json(error ? { error: pushTableError(error) } : { ok: true }, { status: error ? 500 : 200 });
}

export async function DELETE(req: Request) {
  const a = await user();
  if ("e" in a) return a.e;

  const endpoint = String((await req.json().catch(() => ({}))).endpoint || "");
  let q = a.s.from("push_subscriptions").delete().eq("user_id", a.user.id);
  if (endpoint) q = q.eq("endpoint", endpoint);
  const { error } = await q;
  return NextResponse.json(error ? { error: "알림 구독 해제에 실패했습니다." } : { ok: true }, { status: error ? 500 : 200 });
}
