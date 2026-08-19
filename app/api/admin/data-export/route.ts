import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Every table that holds actual institutional records, in dependency order (parents before
 * children) so a restore script can insert them straight through. Deliberately excludes
 * operational/ephemeral tables that aren't worth backing up: push_subscriptions (device tokens
 * that go stale on their own), parent_dashboard_events (a transient realtime queue), and
 * signup_invites/signup_invite_redemptions (onboarding tokens, not institutional records).
 * Note: this exports table rows only -- PDF files in the notice-attachments Storage bucket are
 * not included, only their metadata (notice_attachments rows). */
const EXPORT_TABLES = [
  "profiles",
  "profile_roles",
  "students",
  "parent_students",
  "class_periods",
  "notices",
  "notice_students",
  "notice_attachments",
  "acknowledgements",
  "warning_change_batches",
  "warning_entries",
  "warning_generated_notices",
  "attendance_change_batches",
  "attendance_entries",
  "attendance_generated_notices",
] as const;

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const results = await Promise.all(EXPORT_TABLES.map((table) => admin.from(table).select("*").then((res) => ({ table, ...res }))));

  const failed = results.find((result) => result.error);
  if (failed) return NextResponse.json({ error: `${failed.table} 내보내기에 실패했습니다: ${failed.error!.message}` }, { status: 500 });

  const tables: Record<string, unknown[]> = {};
  for (const result of results) tables[result.table] = result.data || [];

  const payload = { exportedAt: new Date().toISOString(), tables };
  const filename = `holga-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
