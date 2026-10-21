-- 20260826_point_categories.sql 다음에 실행합니다. 2026-10-21에 운영 DB에 직접 실행한 1회성
-- 데이터 보정의 기록입니다. 다시 실행해도 '과제·활동 성실 수행' 기록이 남아 있지 않으므로 아무것도
-- 바꾸지 않습니다.
--
-- 칭찬 카테고리 '과제·활동 성실 수행'을 '과제 성실히 수행'과 '활동 성실히 수행'으로 나눕니다.
-- - 홍성혜 선생님이 준 기록은 모두 과제.
-- - 다른 선생님 기록은 사유 문구(숙제·기탄수학 등)와, 9/28 '과제 성실히 수행'이 생긴 뒤 같은
--   선생님이 같은 수업에서 실제로 고른 카테고리를 보고 나눴습니다.
-- 학부모 화면 사유(parent_visible_reason) 앞머리의 카테고리 이름도 함께 바꿉니다. SQL로 직접
-- 고치므로 학부모 알림(푸시·대시보드 이벤트·알림장 수정)은 나가지 않습니다.
-- 바꾸기 전 값은 backup.praise_category_split_20261021 에 남겨 두었습니다.
insert into public.point_categories (kind, name, sort_order)
values ('praise', '활동 성실히 수행', 230)
on conflict (kind, name) do update set active = true;

with split_map as (
  select we.id,
    case
      when we.author_id = '886e814e-6ba0-485d-a897-3a53905267ce' then '과제 성실히 수행' -- 홍성혜
      when we.parent_visible_reason ~ '(숙제|homework|기탄|계산법|풀어|풀고)' then '과제 성실히 수행'
      when we.author_id = '30dc1873-a9fb-4170-955c-01481b95e050' then '과제 성실히 수행' -- 이은총
      when we.author_id = '007697e8-d7c0-4298-b224-fbfb9a456e70' then '과제 성실히 수행' -- 임예을
      when we.author_id = '328a47b8-b9f4-4dc8-98cf-61c6ce333fd5' and cp.name in ('W&G', 'Reading', '성경정리') then '과제 성실히 수행' -- 오민진
      else '활동 성실히 수행'
    end as new_category
  from public.warning_entries we
  left join public.class_periods cp on cp.id = we.class_period_id
  where we.category = '과제·활동 성실 수행'
)
update public.warning_entries we
set category = m.new_category,
    parent_visible_reason = regexp_replace(we.parent_visible_reason, '^과제·활동 성실 수행', m.new_category)
from split_map m
where m.id = we.id;
