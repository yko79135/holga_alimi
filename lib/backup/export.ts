import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isTestRowVisible } from "@/lib/test-data";

/** Every table that holds actual institutional records, in dependency order (parents before
 * children) so a restore script can insert them straight through. Deliberately excludes
 * operational/ephemeral tables that aren't worth backing up: push_subscriptions (device tokens
 * that go stale on their own), parent_dashboard_events (a transient realtime queue), and
 * signup_invites/signup_invite_redemptions (onboarding tokens, not institutional records).
 * Note: this exports table rows only -- PDF files in the notice-attachments Storage bucket are
 * not included, only their metadata (notice_attachments rows). */
export const EXPORT_TABLES = [
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

/** 남의 테스트 계정·학생은 사람이 내려받는 백업에 담기지 않습니다. 두 테이블에서 빠진 행을
 * 참조하는 나머지 테이블 행도 아래에서 함께 걸러냅니다. */
const TEST_OWNED_TABLES = ["profiles", "students"] as const;

export type BackupTables = Record<string, unknown[]>;
export type BackupPayload = { exportedAt: string; tables: BackupTables };

export class BackupExportError extends Error {}

/** `viewerId`를 주면 그 관리자 화면에서 보이는 범위만(= 남의 더미 데이터 제외) 담고,
 * 주지 않으면(자동 백업) 복원에 필요한 모든 행을 그대로 담습니다. */
export async function collectBackup(admin: SupabaseClient, viewerId?: string): Promise<BackupPayload> {
  const results = await Promise.all(
    EXPORT_TABLES.map((table) => admin.from(table).select("*").then((res) => ({ table, ...res })))
  );

  const failed = results.find((result) => result.error);
  if (failed) throw new BackupExportError(`${failed.table} 내보내기에 실패했습니다: ${failed.error!.message}`);

  const tables: BackupTables = {};
  for (const result of results) tables[result.table] = result.data || [];

  if (viewerId) filterOtherPeoplesTestRows(tables, viewerId);

  return { exportedAt: new Date().toISOString(), tables };
}

function filterOtherPeoplesTestRows(tables: BackupTables, viewerId: string) {
  for (const table of TEST_OWNED_TABLES) {
    tables[table] = (tables[table] as Array<{ id: string; test_owner_id?: string | null }>).filter((row) => isTestRowVisible(row, viewerId));
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
}

export function serializeBackup(payload: BackupPayload) {
  return JSON.stringify(payload, null, 2);
}

export function countRows(tables: BackupTables) {
  return Object.values(tables).reduce((total, rows) => total + rows.length, 0);
}
