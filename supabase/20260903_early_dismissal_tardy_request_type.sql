-- Lets a parent submit 지각 (a tardy arrival with a stated reason) through the same form that
-- already submits 조퇴 and 결석. Run after supabase/20260902_private_test_fixtures.sql in the
-- Supabase SQL Editor.
--
-- 지각 needs no new column: it is a third value of request_type, recorded on the attendance sheet
-- as `late`. Its clock reuses dismissal_time, where it means the expected arrival rather than a
-- leaving time. What changes is the pair of check constraints, because the old ones were written
-- when 조퇴 was the only kind that could carry either field.

alter table public.early_dismissal_requests
  drop constraint if exists early_dismissal_requests_type_check;

alter table public.early_dismissal_requests
  add constraint early_dismissal_requests_type_check
  check (request_type in ('early_dismissal', 'absence', 'tardy'));

-- A 결석 covers the whole day and so carries no clock at all, and only a 조퇴 sends a child home
-- mid-day, so only a 조퇴 can say they come back the same day. A 지각 carries a clock (등교 예정
-- 시각) but never a same-day return. This replaces the 결석-only rule the previous migration added.
alter table public.early_dismissal_requests
  drop constraint if exists early_dismissal_requests_absence_has_no_time;

alter table public.early_dismissal_requests
  drop constraint if exists early_dismissal_requests_time_fields_check;

alter table public.early_dismissal_requests
  add constraint early_dismissal_requests_time_fields_check
  check (
    (request_type <> 'absence' or dismissal_time is null)
    and (request_type = 'early_dismissal' or returns_same_day = false)
  );

comment on column public.early_dismissal_requests.request_type is
  '신청 종류. early_dismissal(조퇴)은 출석부에 early_leave로, tardy(지각)는 late로, absence(결석)는 absent로 기록된다.';
comment on column public.early_dismissal_requests.dismissal_time is
  '조퇴는 조퇴 시각, 지각은 등교 예정 시각. 결석은 언제나 비어 있다.';
comment on column public.early_dismissal_requests.dismissal_date is
  '조퇴 · 지각 · 결석 날짜.';
comment on column public.early_dismissal_requests.returns_same_day is
  '조퇴 후 당일 복귀 예정 여부. 조퇴가 아닌 신청에서는 언제나 false.';
comment on table public.early_dismissal_requests is
  '학부모가 제출한 조퇴 · 지각 · 결석 신청. 결재 없이 접수되며 모든 교사에게 알림이 전송된다. cancelled_at은 학부모 취소, attendance_recorded_at은 교사가 출석부에 기록한 시점.';

notify pgrst, 'reload schema';
