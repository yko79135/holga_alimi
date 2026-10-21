-- 20260826_point_categories.sql 다음에 실행합니다.
-- 부여 폼 드롭다운을 많이 쓴 카테고리부터 보여 주기 위해, 카테고리별 사용 횟수를 돌려주는 함수를
-- 추가합니다. 점수 기록 전체를 API로 내려받아 세면 PostgREST 1000행 제한에 걸리므로 DB에서
-- 셉니다. 정정(correction)·은혜 전환 행은 카테고리 선택이 아니라서 세지 않습니다.
create or replace function public.point_category_usage()
returns table (kind text, name text, uses bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(we.kind, 'discipline'), we.category, count(*)
  from public.warning_entries we
  where we.category is not null
    and we.category <> '직접 입력'
    and we.change_type = 'addition'
  group by 1, 2;
$$;

-- 서버(service_role)에서만 부릅니다. 브라우저 세션에 rpc로 열어 둘 이유가 없습니다.
revoke execute on function public.point_category_usage() from public, anon, authenticated;

notify pgrst, 'reload schema';
