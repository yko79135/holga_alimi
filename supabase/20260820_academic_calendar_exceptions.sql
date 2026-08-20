-- Real school-calendar data to replace the flat total_instructional_days estimate with actual
-- day-by-day counting: academic_calendar_exceptions holds the specific weekday dates the school
-- is closed (방학, 재량휴교, 공휴일 등), and academic_terms gains start_date/end_date so the app
-- knows which calendar dates belong to which semester. total_instructional_days/its columns stay
-- as-is and remain the fallback for any term that hasn't had a calendar uploaded yet.

alter table public.academic_terms add column if not exists start_date date;
alter table public.academic_terms add column if not exists end_date date;

create table if not exists public.academic_calendar_exceptions (
  date date primary key,
  academic_year int not null,
  label text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.academic_calendar_exceptions enable row level security;

-- Same access shape as academic_terms: school-calendar info isn't private, so any authenticated
-- account can read it (parents need it for their own 출석 stats); only admins can write it.
drop policy if exists "academic_calendar_exceptions_select" on public.academic_calendar_exceptions;
create policy "academic_calendar_exceptions_select" on public.academic_calendar_exceptions for select to authenticated using (true);

drop policy if exists "academic_calendar_exceptions_admin_write" on public.academic_calendar_exceptions;
create policy "academic_calendar_exceptions_admin_write" on public.academic_calendar_exceptions for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select on public.academic_calendar_exceptions to authenticated;
grant insert, update, delete on public.academic_calendar_exceptions to authenticated;

notify pgrst, 'reload schema';
