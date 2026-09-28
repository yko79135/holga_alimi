-- 인정지각(excused_late): 사유가 인정되는 지각을 사유 없는 지각(late)과 따로 세기 위한 출결 상태.
-- Run after supabase/20260911_notice_edits.sql in the Supabase SQL Editor.
--
-- 이 파일은 enum 값만 더한다. Postgres는 같은 트랜잭션 안에서 방금 더한 enum 값을 쓰지 못하게
-- 하므로, 기존 기록을 옮기는 보정은 다음 파일(20260929_attendance_excused_late_backfill.sql)에
-- 따로 두고 이 파일을 먼저 실행한 뒤에 실행한다.

alter type public.attendance_status add value if not exists 'excused_late' after 'late';

-- 학부모 지각 신청은 사유를 적어 내므로 이제 인정지각으로 기록된다.
comment on column public.early_dismissal_requests.request_type is
  '신청 종류. early_dismissal(조퇴)은 출석부에 early_leave로, tardy(지각)는 excused_late(인정지각)로, absence(결석)는 absent로 기록된다.';

notify pgrst, 'reload schema';
