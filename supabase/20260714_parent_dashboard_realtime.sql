-- Safe parent-dashboard invalidation events for realtime refreshes.
create table if not exists public.parent_dashboard_events (
  id bigint generated always as identity primary key,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  entity_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists parent_dashboard_events_parent_created_idx
on public.parent_dashboard_events(parent_id, created_at desc);

alter table public.parent_dashboard_events enable row level security;

drop policy if exists "parent_dashboard_events_parent_select" on public.parent_dashboard_events;
create policy "parent_dashboard_events_parent_select"
on public.parent_dashboard_events for select to authenticated
using (parent_id = auth.uid());

drop policy if exists "parent_dashboard_events_staff_insert" on public.parent_dashboard_events;
create policy "parent_dashboard_events_staff_insert"
on public.parent_dashboard_events for insert to authenticated
with check (public.is_staff());

grant select, insert on public.parent_dashboard_events to authenticated;
grant usage, select on sequence public.parent_dashboard_events_id_seq to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'parent_dashboard_events'
  ) then
    alter publication supabase_realtime
      add table public.parent_dashboard_events;
  end if;
end $$;

create or replace function public.parent_warning_entries()
returns table (
  id uuid,
  student_id uuid,
  warning_date date,
  entry_type public.warning_entry_type,
  delta int,
  parent_visible_reason text,
  created_at timestamptz,
  student_name text,
  student_grade text
)
language sql
security definer
set search_path = public
as $$
  select we.id, we.student_id, we.warning_date, we.entry_type, we.delta,
         we.parent_visible_reason, we.created_at, s.name, s.grade
  from public.warning_entries we
  join public.students s on s.id = we.student_id
  where public.parent_has_student(we.student_id)
  order by we.created_at desc
  limit 50;
$$;

revoke all on function public.parent_warning_entries() from public;
grant execute on function public.parent_warning_entries() to authenticated;

notify pgrst, 'reload schema';
