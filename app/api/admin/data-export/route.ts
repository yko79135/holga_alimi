import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTestRowVisible } from "@/lib/test-data";

export const runtime = "nodejs";

/** Every table that holds actual institutional records, in dependency order (parents before
 * children) so a restore script can insert them straight through. Deliberately excludes
 * operational/ephemeral tables that aren't worth backing up: push_subscriptions (device tokens
 * that go stale on their own), parent_dashboard_events (a transient realtime queue), and
 * signup_invites/signup_invite_redemptions (onboarding tokens, not institutional records).
 * Note: this exports table rows only -- PDF files in the notice-attachments Storage bucket are
 * not included, only their metadata (notice_attachments rows). */
/** 남의 테스트 계정·학생은 백업에도 담기지 않습니다. 두 테이블에서 빠진 행을 참조하는
 * 나머지 테이블 행도 아래에서 함께 걸러냅니다. */
const TEST_OWNED_TABLES = ["profiles", "students"] as const;

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

  for (const table of TEST_OWNED_TABLES) {
    tables[table] = (tables[table] as Array<{ id: string; test_owner_id?: string | null }>).filter((row) => isTestRowVisible(row, auth.user.id));
  }
  const visibleProfileIds = new Set((tables.profiles as Array<{ id: string }>).map((row) => row.id));
  const visibleStudentIds = new Set((tables.students as Array<{ id: string }>).map((row) => row.id));
  const keepByProfile = (rows: unknown[], key: string) => rows.filter((row) => visibleProfileIds.has((row as Record<string, string>)[key]));
  const keepByStudent = (rows: unknown[], key: string) => rows.filter((row) => visibleStudentIds.has((row as Record<string, string>)[key]));
  tables.profile_roles = keepByProfile(tables.profile_roles, "profile_id");
  tables.acknowledgements = keepByProfile(tables.acknowledgements, "parent_id");
  tables.parent_students = keepByStudent(keepByProfile(tables.parent_students, "parent_id"), "student_id");
  for (const table of ["notice_students", "warning_entries", "attendance_entries"]) {
    tables[table] = keepByStudent(tables[table], "student_id");
  }

  const payload = { exportedAt: new Date().toISOString(), tables };
  const filename = `holga-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
