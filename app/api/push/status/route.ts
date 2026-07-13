import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function statusError(error: { code?: string; message?: string } | null) {
  if (error?.code === "42P01" || error?.message?.includes("push_subscriptions")) {
    return "Supabase에 push_subscriptions 테이블이 없습니다.";
  }
  return "상태 확인 실패";
}

export async function GET(req: Request) {
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const endpoint = new URL(req.url).searchParams.get("endpoint");
  let q = s.from("push_subscriptions").select("id,endpoint").eq("user_id", user.id);
  if (endpoint) q = q.eq("endpoint", endpoint);
  const { data, error } = await q;

  return NextResponse.json(error ? { error: statusError(error) } : { subscribed: Boolean(data?.length) }, { status: error ? 500 : 200 });
}
