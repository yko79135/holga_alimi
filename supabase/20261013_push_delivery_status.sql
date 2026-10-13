-- 푸시 구독마다 마지막 전송 결과를 남긴다.
-- Run after supabase/20260930_attendance_excused_absent.sql in the Supabase SQL Editor.
--
-- 지금까지는 푸시 서비스(Apple·Google)가 404/410 말고 다른 오류를 돌려주면 아무 기록 없이
-- 넘어가서, "알림이 안 온다"는 연락을 받아도 어느 단계에서 막혔는지 알 수 없었다. 이 칸들은
-- 서버(service role)만 쓴다. 학부모·교사는 기존 정책대로 자기 행만 읽는다.
--
-- 다시 실행해도 안전하다.

alter table public.push_subscriptions
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_error text;

notify pgrst, 'reload schema';
