-- Attendance (출석) tracking: normalized entries mirroring warning_entries conventions.
-- A student with no row for a given date is implicitly 출석 (present) -- rows are only written
-- for exceptions (지각/결석/조퇴/병결) or to correct a prior exception back to 출석.
-- Run after supabase/20260714_parent_dashboard_realtime.sql.

do $$ begin
  create type public.attendance_status as enum ('present','late','absent','early_leave','sick_leave');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attendance_change_type as enum ('exception','correction');
exception when duplicate_object then null; end $$;

alter type public.notice_type add value if not exists 'attendance';

create table if not exists public.attendance_change_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  academic_year int not null,
  semester int not null check (semester in (1,2)),
  month int not null check (month between 1 and 12),
  author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  status text not null default 'committed',
  missing_parent_student_ids uuid[] not null default '{}'
);

create table if not exists public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.attendance_change_batches(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  attendance_date date not null,
  academic_year int not null,
  semester int not null check (semester in (1,2)),
  month int not null check (month between 1 and 12),
  previous_status public.attendance_status,
  new_status public.attendance_status not null,
  change_type public.attendance_change_type not null,
  parent_visible_reason text,
  teacher_note text,
  author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint attendance_entry_change_required check (previous_status is distinct from new_status)
);

create table if not exists public.attendance_generated_notices (
  batch_id uuid not null references public.attendance_change_batches(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  notice_id uuid references public.notices(id) on delete set null,
  recipient_count int not null default 0,
  push_sent_count int not null default 0,
  push_failed_count int not null default 0,
  created_at timestamptz not null default now(),
  primary key (batch_id, student_id)
);

create index if not exists attendance_entries_student_period_idx on public.attendance_entries(student_id, academic_year, semester, month);
create index if not exists attendance_entries_student_date_idx on public.attendance_entries(student_id, attendance_date, created_at desc);
create index if not exists attendance_entries_batch_idx on public.attendance_entries(batch_id);
create index if not exists attendance_generated_notices_notice_idx on public.attendance_generated_notices(notice_id);

alter table public.attendance_change_batches enable row level security;
alter table public.attendance_entries enable row level security;
alter table public.attendance_generated_notices enable row level security;

drop policy if exists "attendance_batches_staff_select" on public.attendance_change_batches;
create policy "attendance_batches_staff_select" on public.attendance_change_batches for select to authenticated using (public.is_staff());
drop policy if exists "attendance_batches_staff_insert" on public.attendance_change_batches;
create policy "attendance_batches_staff_insert" on public.attendance_change_batches for insert to authenticated with check (public.is_staff() and author_id = (select auth.uid()));
drop policy if exists "attendance_batches_staff_update" on public.attendance_change_batches;
create policy "attendance_batches_staff_update" on public.attendance_change_batches for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "attendance_entries_select" on public.attendance_entries;
create policy "attendance_entries_select" on public.attendance_entries for select to authenticated
using (public.is_staff() or (teacher_note is null and public.parent_has_student(student_id)));
drop policy if exists "attendance_entries_staff_insert" on public.attendance_entries;
create policy "attendance_entries_staff_insert" on public.attendance_entries for insert to authenticated
with check (public.is_staff() and author_id = (select auth.uid()));

drop policy if exists "attendance_generated_notices_staff_select" on public.attendance_generated_notices;
create policy "attendance_generated_notices_staff_select" on public.attendance_generated_notices for select to authenticated using (public.is_staff());
drop policy if exists "attendance_generated_notices_staff_insert" on public.attendance_generated_notices;
create policy "attendance_generated_notices_staff_insert" on public.attendance_generated_notices for insert to authenticated with check (public.is_staff());
drop policy if exists "attendance_generated_notices_staff_update" on public.attendance_generated_notices;
create policy "attendance_generated_notices_staff_update" on public.attendance_generated_notices for update to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update on public.attendance_change_batches to authenticated;
grant select, insert on public.attendance_entries to authenticated;
grant select, insert, update on public.attendance_generated_notices to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='attendance_entries') then
    alter publication supabase_realtime add table public.attendance_entries;
  end if;
end $$;

-- Mirrors public.parent_warning_entries(): bypasses RLS's teacher_note restriction via an
-- explicit column list so parents get a clean feed of their children's attendance exceptions.
create or replace function public.parent_attendance_entries()
returns table (
  id uuid,
  student_id uuid,
  attendance_date date,
  new_status public.attendance_status,
  parent_visible_reason text,
  created_at timestamptz,
  student_name text,
  student_grade text
)
language sql
security definer
set search_path = public
as $$
  select ae.id, ae.student_id, ae.attendance_date, ae.new_status,
         ae.parent_visible_reason, ae.created_at, s.name, s.grade
  from public.attendance_entries ae
  join public.students s on s.id = ae.student_id
  where public.parent_has_student(ae.student_id)
  order by ae.created_at desc
  limit 50;
$$;

revoke all on function public.parent_attendance_entries() from public;
grant execute on function public.parent_attendance_entries() to authenticated;

notify pgrst, 'reload schema';
