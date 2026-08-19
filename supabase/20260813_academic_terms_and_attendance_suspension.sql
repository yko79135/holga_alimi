-- 정학(suspension) attendance status, and an admin-configurable total instructional-day count
-- per semester. This replaces the previous "count elapsed weekdays" approximation used for the
-- parent-facing 출석일 estimate (lib/attendance/schoolDays.ts) -- that approximation ignored
-- holidays and only counted days up to today rather than the full semester.

alter type public.attendance_status add value if not exists 'suspension';

create table if not exists public.academic_terms (
  academic_year int not null,
  semester int not null check (semester in (1,2)),
  total_instructional_days int not null default 90 check (total_instructional_days > 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (academic_year, semester)
);

alter table public.academic_terms enable row level security;

-- Total instructional days is school-calendar info, not private data, so any authenticated
-- account (including parents, for their own 출석일 stats) can read it; only admins can set it.
drop policy if exists "academic_terms_select" on public.academic_terms;
create policy "academic_terms_select" on public.academic_terms for select to authenticated using (true);

drop policy if exists "academic_terms_admin_write" on public.academic_terms;
create policy "academic_terms_admin_write" on public.academic_terms for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select on public.academic_terms to authenticated;
grant insert, update on public.academic_terms to authenticated;

notify pgrst, 'reload schema';
