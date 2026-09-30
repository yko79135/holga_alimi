-- 인정결석(excused_absent): 사유가 인정되는 결석을 무단 결석(absent)과 따로 세기 위한 출결 상태,
-- 그리고 학부모 신청을 출석부에 기록할 때 교사가 고른 상태를 남기는 칸.
-- Run after supabase/20260929_attendance_excused_late_backfill.sql in the Supabase SQL Editor.
--
-- 이제 교사는 학부모의 지각 신청을 인정지각/지각(무단) 중에서, 결석 신청을 인정결석/결석(무단)
-- 중에서 골라 기록한다. 고른 상태는 early_dismissal_requests.attendance_recorded_status에 남아,
-- 신청 목록이 "무단지각으로 기록됨"처럼 보여 주고 기록 취소가 무엇을 되돌릴지 안다.
--
-- 다시 실행해도 안전하다.

alter type public.attendance_status add value if not exists 'excused_absent' after 'absent';

alter table public.early_dismissal_requests
  add column if not exists attendance_recorded_status public.attendance_status;

comment on column public.early_dismissal_requests.attendance_recorded_status is
  '교사가 출석부에 기록한 상태. 조퇴는 early_leave, 지각은 excused_late 또는 late, 결석은 excused_absent 또는 absent. 기록 전이거나 기록을 취소하면 null.';

-- 이미 기록된 신청은 그때 쓰던 고정 규칙대로 채운다 (조퇴 early_leave, 지각 excused_late, 결석 absent).
-- 여기서는 방금 더한 excused_absent를 쓰지 않으므로 같은 트랜잭션에서 실행해도 된다.
update public.early_dismissal_requests
set attendance_recorded_status = case request_type
    when 'tardy' then 'excused_late'::public.attendance_status
    when 'absence' then 'absent'::public.attendance_status
    else 'early_leave'::public.attendance_status
  end
where attendance_recorded_at is not null
  and attendance_recorded_status is null;

comment on column public.early_dismissal_requests.request_type is
  '신청 종류. early_dismissal(조퇴)은 출석부에 early_leave로 기록된다. tardy(지각)와 absence(결석)는 교사가 인정/무단 중에서 골라 기록한다 (attendance_recorded_status).';

notify pgrst, 'reload schema';
