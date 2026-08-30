/** 개인 전용 테스트 데이터("더미") 규칙.
 *
 * profiles.test_owner_id / students.test_owner_id 가 null 이면 실제 데이터라 누구에게나 보이고,
 * 값이 있으면 그 계정 한 명에게만 존재하는 행입니다. 브라우저·세션 쿼리는 RLS가 걸러 주지만
 * app/api/admin/* 의 service_role 경로는 RLS를 지나가지 않으므로 여기 헬퍼로 같은 규칙을
 * 직접 적용해야 합니다. (supabase/20260902_private_test_fixtures.sql)
 */

export type TestOwned = { test_owner_id?: string | null };

export function testOwnerOf(row: TestOwned | null | undefined): string | null {
  return row?.test_owner_id ?? null;
}

/** 실제 데이터이거나, 보는 사람 본인의 테스트 데이터일 때만 true. */
export function isTestRowVisible(row: TestOwned | null | undefined, viewerId: string) {
  const owner = testOwnerOf(row);
  return owner === null || owner === viewerId;
}

export function isTestRow(row: TestOwned | null | undefined) {
  return testOwnerOf(row) !== null;
}

/** PostgREST `.or()` 인자: 실제 데이터 + 보는 사람 본인의 테스트 데이터. */
export function visibleTestRowsFilter(viewerId: string) {
  return `test_owner_id.is.null,test_owner_id.eq.${viewerId}`;
}
