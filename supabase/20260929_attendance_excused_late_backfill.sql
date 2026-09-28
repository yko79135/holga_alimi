-- 학부모 지각 신청으로 출석부에 기록된 날을 지각(late)에서 인정지각(excused_late)으로 옮긴다.
-- Run after supabase/20260928_attendance_excused_late.sql (따로 실행해야 한다 -- 그 파일에서 더한
-- enum 값은 같은 트랜잭션 안에서 쓸 수 없다).
--
-- 이제 학부모 지각 신청은 인정지각으로 기록된다(lib/early-dismissal/types.ts). 이미 지각으로
-- 기록된 신청을 그대로 두면 통계에서 사유 없는 지각으로 잡히고, 교사가 기록을 취소할 때도
-- "지금 상태가 신청이 쓴 상태인가"를 확인하는 부분이 어긋난다. 그래서 신청이 쓴 기록 행
-- (idempotency_key 'early-dismissal-recorded:<신청 id>:<n>')과 그 취소 행
-- ('early-dismissal-reverted:...')을 새 상태로 맞춘다. 교사가 출석 관리에서 직접 입력한 지각은
-- 건드리지 않는다 -- 사유 인정 여부는 교사가 판단해 출석 관리에서 바꾼다.
--
-- 다시 실행해도 안전하다: 이미 옮긴 행은 조건(new_status = 'late' 등)에 걸리지 않는다.

update public.attendance_entries ae
set new_status = 'excused_late'
from public.attendance_change_batches b, public.early_dismissal_requests r
where ae.batch_id = b.id
  and b.idempotency_key like 'early-dismissal-recorded:%'
  and split_part(b.idempotency_key, ':', 2) = r.id::text
  and r.request_type = 'tardy'
  and ae.new_status = 'late';

update public.attendance_entries ae
set previous_status = 'excused_late'
from public.attendance_change_batches b, public.early_dismissal_requests r
where ae.batch_id = b.id
  and b.idempotency_key like 'early-dismissal-reverted:%'
  and split_part(b.idempotency_key, ':', 2) = r.id::text
  and r.request_type = 'tardy'
  and ae.previous_status = 'late';

-- 옮긴 날 뒤에 교사가 그날을 다시 고친 행이 있다면, 그 행의 previous_status도 바로 앞 행의
-- 새 상태와 맞춘다(출석부의 변경 이력이 끊기지 않도록).
update public.attendance_entries ae
set previous_status = 'excused_late'
where ae.previous_status = 'late'
  and (
    select prev.new_status
    from public.attendance_entries prev
    where prev.student_id = ae.student_id
      and prev.attendance_date = ae.attendance_date
      and prev.created_at < ae.created_at
    order by prev.created_at desc
    limit 1
  ) = 'excused_late';
