import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, adminJsonError } from "@/lib/admin/require-admin";
import { selectAll } from "@/lib/supabase/select-all";
import { isTestRowVisible } from "@/lib/test-data";

type DeviceRow = { user_id: string; device_key: string; platform: string; standalone: boolean; permission: string; subscribed: boolean; last_seen_at: string };
type ProfileRow = { id: string; full_name: string | null; test_owner_id: string | null; profile_roles: { role: string }[] | null };

export type DeviceStatus = "ok" | "ios_bookmark" | "notifications_off" | "blocked" | "unsupported" | "unknown";

/** Worst-first is not what matters here: one working device means the person gets notified, so
 * "ok" wins. Otherwise the most actionable problem is shown, iPhone bookmark first because it is
 * the one people can't spot themselves (the app looks like it works, just never notifies). */
function statusOf(devices: DeviceRow[]): DeviceStatus {
  if (!devices.length) return "unknown";
  if (devices.some((d) => d.permission === "granted" && d.subscribed)) return "ok";
  if (devices.some((d) => d.platform === "ios" && !d.standalone)) return "ios_bookmark";
  if (devices.some((d) => d.permission === "default" || d.permission === "granted")) return "notifications_off";
  if (devices.some((d) => d.permission === "denied")) return "blocked";
  return "unsupported";
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const admin = createAdminClient();

  const [profiles, devices] = await Promise.all([
    selectAll<ProfileRow>((from, to) => admin.from("profiles").select("id,full_name,test_owner_id,profile_roles:profile_roles!profile_roles_profile_id_fkey(role)").order("id").range(from, to)),
    selectAll<DeviceRow>((from, to) => admin.from("client_devices").select("user_id,device_key,platform,standalone,permission,subscribed,last_seen_at").order("user_id").order("device_key").range(from, to)),
  ]);
  if (profiles.error || devices.error) return adminJsonError("기기 상태를 불러오지 못했습니다.", 500);

  const byUser = new Map<string, DeviceRow[]>();
  for (const d of devices.data) byUser.set(d.user_id, [...(byUser.get(d.user_id) || []), d]);

  const people = profiles.data
    .filter((p) => isTestRowVisible(p, auth.user.id))
    .map((p) => {
      const mine = (byUser.get(p.id) || []).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
      return {
        id: p.id,
        name: p.full_name || "이름 없음",
        roles: (p.profile_roles || []).map((r) => r.role),
        status: statusOf(mine),
        lastSeenAt: mine[0]?.last_seen_at ?? null,
        devices: mine.map((d) => ({ platform: d.platform, standalone: d.standalone, permission: d.permission, subscribed: d.subscribed, lastSeenAt: d.last_seen_at })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return NextResponse.json({ people });
}
