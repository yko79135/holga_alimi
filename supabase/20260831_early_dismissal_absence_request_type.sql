-- Lets a parent submit 결석 (absence) through the same form that already submits 조퇴 (early
-- dismissal). Run after supabase/20260830_principal_designation.sql in the Supabase SQL Editor.
--
-- The two share everything except the label and the attendance status a teacher records, so this
-- adds one discriminator column rather than a second table. Rows written before this migration
-- were all 조퇴, which is exactly what the default gives them.

alter table public.early_dismissal_requests
  add column if not exists request_type text not null default 'early_dismissal';

do $$ begin
  alter table public.early_dismissal_requests
    add constraint early_dismissal_requests_type_check
    check (request_type in ('early_dismissal', 'absence'));
exception when duplicate_object then null; end $$;

-- A leaving time and a same-day return only describe a 조퇴; on a 결석 the child is away all day,
-- and /api/early-dismissal drops both fields for that kind. This keeps the table honest about it.
do $$ begin
  alter table public.early_dismissal_requests
    add constraint early_dismissal_requests_absence_has_no_time
    check (request_type <> 'absence' or (dismissal_time is null and returns_same_day = false));
exception when duplicate_object then null; end $$;

comment on column public.early_dismissal_requests.request_type is
  '신청 종류. early_dismissal(조퇴)은 출석부에 early_leave로, absence(결석)는 absent로 기록된다.';
comment on column public.early_dismissal_requests.dismissal_date is
  '조퇴 또는 결석 날짜.';
comment on table public.early_dismissal_requests is
  '학부모가 제출한 조퇴·결석 신청. 결재 없이 접수되며 모든 교사에게 알림이 전송된다. cancelled_at은 학부모 취소, attendance_recorded_at은 교사가 출석부에 기록한 시점.';

notify pgrst, 'reload schema';
