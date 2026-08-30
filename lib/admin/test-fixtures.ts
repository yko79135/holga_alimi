import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { isTestRowVisible } from "@/lib/test-data";

type AdminClient = ReturnType<typeof createAdminClient>;

/** service_role 로 특정 계정·학생을 다루기 전 확인. 남의 테스트 행이면 그 관리자에게는
 * 존재하지 않는 것과 같아야 하므로, 권한 오류가 아니라 "없음"으로 답합니다. */
export async function canSeeProfile(admin: AdminClient, profileId: string, viewerId: string) {
  if (profileId === viewerId) return true;
  const { data } = await admin.from("profiles").select("test_owner_id").eq("id", profileId).maybeSingle();
  return isTestRowVisible(data, viewerId);
}

export async function canSeeStudent(admin: AdminClient, studentId: string, viewerId: string) {
  const { data } = await admin.from("students").select("test_owner_id").eq("id", studentId).maybeSingle();
  return isTestRowVisible(data, viewerId);
}
