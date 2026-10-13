import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PLATFORMS = new Set(["ios", "android", "other"]);
const PERMISSIONS = new Set(["granted", "default", "denied", "unsupported"]);

/** Records this device's install and notification state each time the dashboard opens (see
 * components/PushSync.tsx). Feeds the admin "앱 설치·알림 상태" list. Written with the user's own
 * session, so RLS keeps each user to their own rows. */
export async function POST(req: Request) {
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const b = await req.json().catch(() => null);
  const deviceKey = String(b?.deviceKey || "");
  const platform = String(b?.platform || "");
  const permission = String(b?.permission || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(deviceKey) || !PLATFORMS.has(platform) || !PERMISSIONS.has(permission)) {
    return NextResponse.json({ error: "기기 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const { error } = await s.from("client_devices").upsert({
    user_id: user.id,
    device_key: deviceKey,
    platform,
    standalone: b?.standalone === true,
    permission,
    subscribed: b?.subscribed === true,
    user_agent: req.headers.get("user-agent"),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "user_id,device_key" });

  return NextResponse.json(error ? { error: "기기 정보를 저장하지 못했습니다." } : { ok: true }, { status: error ? 500 : 200 });
}
