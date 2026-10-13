-- 구독한 기기가 마지막으로 앱을 연 시각.
-- Run after supabase/20261013_push_delivery_status.sql in the Supabase SQL Editor.
--
-- 앱을 열 때마다 그 기기가 자기 구독을 서버에 다시 저장하면서 이 시각을 남긴다. 알림 서버는
-- 휴대폰에서 이미 지워진 설치본의 구독도 "성공"으로 받아 주기 때문에, 전송 결과만으로는 끊긴
-- 구독을 가려낼 수 없다. 오래도록 갱신되지 않는 구독이 끊긴 구독이다.
--
-- 다시 실행해도 안전하다.

alter table public.push_subscriptions
  add column if not exists last_seen_at timestamptz;

notify pgrst, 'reload schema';
