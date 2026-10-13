-- 기기별 앱 설치·알림 상태.
-- Run after supabase/20261013_push_subscription_last_seen.sql in the Supabase SQL Editor.
--
-- 대시보드를 열 때마다 그 기기가 한 행을 갱신한다: 플랫폼, 홈 화면 앱으로 열렸는지,
-- 알림 권한, 알림 구독이 저장됐는지. iPhone의 옛 아이콘(주소창이 보이는 바로가기)이나
-- Safari 탭은 알림 구독 자체를 만들 수 없어서 push_subscriptions에는 흔적이 없다. 그래서
-- 따로 남긴다. 관리자 화면의 "앱 설치·알림 상태" 목록이 이 표를 읽는다(service role).
--
-- device_key는 브라우저 저장소에 둔 임의 값이다. iPhone은 홈 화면 앱과 Safari가 저장소를
-- 따로 쓰므로 둘이 다른 행이 된다.
--
-- 다시 실행해도 안전하다.

create table if not exists public.client_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_key text not null check (char_length(device_key) between 8 and 64),
  platform text not null check (platform in ('ios', 'android', 'other')),
  standalone boolean not null,
  permission text not null check (permission in ('granted', 'default', 'denied', 'unsupported')),
  subscribed boolean not null,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_key)
);

alter table public.client_devices enable row level security;
drop policy if exists "client_devices_own_select" on public.client_devices;
create policy "client_devices_own_select" on public.client_devices for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "client_devices_own_insert" on public.client_devices;
create policy "client_devices_own_insert" on public.client_devices for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "client_devices_own_update" on public.client_devices;
create policy "client_devices_own_update" on public.client_devices for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update on public.client_devices to authenticated;

notify pgrst, 'reload schema';
