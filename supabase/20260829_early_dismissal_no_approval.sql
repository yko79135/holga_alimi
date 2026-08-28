-- Removes the two-signature approval from early dismissal (조퇴) requests.
-- A request is now simply submitted and every teacher is notified; a teacher records it on the
-- attendance sheet with one click instead of it being gated behind homeroom + vice-principal
-- sign-off. Run after supabase/20260828_homeroom_and_early_dismissal.sql.
--
-- The homeroom roster (homeroom_assignments / school_officers) is deliberately kept: it is still
-- shown on each request so staff can see whose class the student is in.

-- Status is no longer a workflow: a request is either open or withdrawn, which cancelled_at
-- already records, and whether it reached the attendance sheet is its own timestamp.
alter table public.early_dismissal_requests
  add column if not exists attendance_recorded_at timestamptz,
  add column if not exists attendance_recorded_by uuid references public.profiles(id) on delete set null;

drop trigger if exists early_dismissal_sync_status_trigger on public.early_dismissal_requests;
drop function if exists public.early_dismissal_sync_status();

drop policy if exists "early_dismissal_requests_approver_update" on public.early_dismissal_requests;
drop function if exists public.can_decide_early_dismissal(uuid);

alter table public.early_dismissal_requests
  drop column if exists status,
  drop column if exists homeroom_decision,
  drop column if exists homeroom_decided_by,
  drop column if exists homeroom_decided_at,
  drop column if exists homeroom_comment,
  drop column if exists vice_principal_decision,
  drop column if exists vice_principal_decided_by,
  drop column if exists vice_principal_decided_at,
  drop column if exists vice_principal_comment;

drop index if exists public.early_dismissal_requests_status_idx;
create index if not exists early_dismissal_requests_open_idx
on public.early_dismissal_requests(dismissal_date desc)
where cancelled_at is null;

drop type if exists public.early_dismissal_decision;
drop type if exists public.early_dismissal_status;

-- There is still no UPDATE policy: withdrawing a request and recording it on the attendance sheet
-- both go through /api/early-dismissal/[id], which re-checks who the caller is server-side.
-- attendance_entries keeps its own RLS, so the attendance write is still staff-only.
comment on table public.early_dismissal_requests is
  '학부모가 제출한 조퇴 신청. 결재 없이 접수되며 모든 교사에게 알림이 전송된다. cancelled_at은 학부모 취소, attendance_recorded_at은 교사가 출석부에 조퇴로 기록한 시점.';

notify pgrst, 'reload schema';
