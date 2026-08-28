-- Homeroom teachers, the vice principal, and parent-submitted early dismissal (조퇴) requests.
-- Run after supabase/20260826_point_categories.sql in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Homeroom mechanism
-- ---------------------------------------------------------------------------
-- students.grade is a free-text label ("G1", "1학년", ...), so the assignment table is keyed by
-- that label. teacher_name keeps the roster usable before the teacher's account exists; once an
-- account is created an admin links it and teacher_id is what every permission check uses.
create table if not exists public.homeroom_assignments (
  grade text primary key,
  teacher_id uuid references public.profiles(id) on delete set null,
  teacher_name text not null default '',
  updated_at timestamptz not null default now()
);

-- One row per school-wide office. Only 'vice_principal' (교감) is used today; the table is keyed
-- by role_key so a principal/head-of-year can be added later without another migration.
create table if not exists public.school_officers (
  role_key text primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  person_name text not null default '',
  updated_at timestamptz not null default now()
);

-- Grade number -> homeroom teacher, per the school's current assignment.
create or replace function public.default_homeroom_teacher_name(grade_label text)
returns text
language sql
immutable
as $$
  select case (substring(grade_label from '\d+'))::int
    when 1 then '임예을'
    when 2 then '홍성혜'
    when 3 then '홍성혜'
    when 4 then '고영찬'
    when 5 then '오민진'
    when 6 then '오민진'
    when 7 then '송재승'
    when 8 then '이은총'
    when 9 then '이은총'
    when 10 then '이은총'
    when 11 then '이은총'
    when 12 then '이은총'
    else null
  end
$$;

-- Seed the canonical G1..G12 labels plus whatever labels the student roster actually uses.
insert into public.homeroom_assignments (grade, teacher_name)
select grade, public.default_homeroom_teacher_name(grade)
from (
  select 'G' || generate_series(1, 12) as grade
  union
  select distinct grade from public.students where grade is not null and grade <> ''
) labels
where public.default_homeroom_teacher_name(grade) is not null
on conflict (grade) do nothing;

insert into public.school_officers (role_key, person_name)
values ('vice_principal', '이은총')
on conflict (role_key) do nothing;

-- Link the seeded names to real accounts where an unambiguous staff account already exists.
update public.homeroom_assignments a
set teacher_id = matched.id
from (
  select p.full_name, min(p.id::text)::uuid as id, count(*) as hits
  from public.profiles p
  join public.profile_roles pr on pr.profile_id = p.id and pr.role in ('teacher', 'admin')
  group by p.full_name
) matched
where a.teacher_id is null and matched.hits = 1 and matched.full_name = a.teacher_name;

update public.school_officers o
set profile_id = matched.id
from (
  select p.full_name, min(p.id::text)::uuid as id, count(*) as hits
  from public.profiles p
  join public.profile_roles pr on pr.profile_id = p.id and pr.role in ('teacher', 'admin')
  group by p.full_name
) matched
where o.profile_id is null and matched.hits = 1 and matched.full_name = o.person_name;

create index if not exists homeroom_assignments_teacher_idx on public.homeroom_assignments(teacher_id);

-- ---------------------------------------------------------------------------
-- 2. Early dismissal (조퇴) requests
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.early_dismissal_decision as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.early_dismissal_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

-- status is derived from the two decision columns (see public.early_dismissal_sync_status) so a
-- row can never claim "approved" while one approver is still pending.
create table if not exists public.early_dismissal_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  dismissal_date date not null,
  dismissal_time time,
  reason text not null,
  guardian_name text,
  guardian_contact text,
  returns_same_day boolean not null default false,
  status public.early_dismissal_status not null default 'pending',
  homeroom_decision public.early_dismissal_decision not null default 'pending',
  homeroom_decided_by uuid references public.profiles(id) on delete set null,
  homeroom_decided_at timestamptz,
  homeroom_comment text,
  vice_principal_decision public.early_dismissal_decision not null default 'pending',
  vice_principal_decided_by uuid references public.profiles(id) on delete set null,
  vice_principal_decided_at timestamptz,
  vice_principal_comment text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "확인": every teacher is notified of a new request and can mark that they have seen it. This is
-- separate from approving, which only the homeroom teacher and vice principal can do.
create table if not exists public.early_dismissal_acknowledgements (
  request_id uuid not null references public.early_dismissal_requests(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (request_id, staff_id)
);

create index if not exists early_dismissal_requests_student_idx on public.early_dismissal_requests(student_id, dismissal_date desc);
create index if not exists early_dismissal_requests_parent_idx on public.early_dismissal_requests(parent_id, created_at desc);
create index if not exists early_dismissal_requests_status_idx on public.early_dismissal_requests(status, dismissal_date desc);
create index if not exists early_dismissal_acknowledgements_staff_idx on public.early_dismissal_acknowledgements(staff_id);

create or replace function public.early_dismissal_sync_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if new.homeroom_decision = 'rejected' or new.vice_principal_decision = 'rejected' then
    new.status := 'rejected';
  elsif new.homeroom_decision = 'approved' and new.vice_principal_decision = 'approved' then
    new.status := 'approved';
  else
    new.status := 'pending';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists early_dismissal_sync_status_trigger on public.early_dismissal_requests;
create trigger early_dismissal_sync_status_trigger
before insert or update on public.early_dismissal_requests
for each row execute function public.early_dismissal_sync_status();

revoke all on function public.early_dismissal_sync_status() from public;
revoke all on function public.default_homeroom_teacher_name(text) from public;

-- ---------------------------------------------------------------------------
-- 3. Approval authority helpers
-- ---------------------------------------------------------------------------
create or replace function public.homeroom_teacher_of(grade_label text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select teacher_id from public.homeroom_assignments where grade = grade_label;
$$;

create or replace function public.vice_principal_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select profile_id from public.school_officers where role_key = 'vice_principal';
$$;

-- True when the caller may record a homeroom or vice-principal decision on the request: the
-- grade's homeroom teacher, the vice principal, or -- only while one of those slots has no linked
-- account -- an admin standing in, so a request is never stuck waiting on a teacher who has not
-- been given a portal account yet.
create or replace function public.can_decide_early_dismissal(request uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.early_dismissal_requests r
    join public.students s on s.id = r.student_id
    where r.id = request
      and (
        (select auth.uid()) = public.homeroom_teacher_of(s.grade)
        or (select auth.uid()) = public.vice_principal_id()
        or (
          public.is_admin()
          and (public.homeroom_teacher_of(s.grade) is null or public.vice_principal_id() is null)
        )
      )
  );
$$;

grant execute on function public.homeroom_teacher_of(text) to authenticated;
grant execute on function public.vice_principal_id() to authenticated;
grant execute on function public.can_decide_early_dismissal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------------
alter table public.homeroom_assignments enable row level security;
alter table public.school_officers enable row level security;
alter table public.early_dismissal_requests enable row level security;
alter table public.early_dismissal_acknowledgements enable row level security;

-- Homeroom rosters are ordinary school information: any signed-in user may read them, only
-- admins may change them.
drop policy if exists "homeroom_assignments_select" on public.homeroom_assignments;
create policy "homeroom_assignments_select" on public.homeroom_assignments for select to authenticated using (true);
drop policy if exists "homeroom_assignments_admin_write" on public.homeroom_assignments;
create policy "homeroom_assignments_admin_write" on public.homeroom_assignments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "school_officers_select" on public.school_officers;
create policy "school_officers_select" on public.school_officers for select to authenticated using (true);
drop policy if exists "school_officers_admin_write" on public.school_officers;
create policy "school_officers_admin_write" on public.school_officers for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Parents see only their own requests; every teacher/admin sees all of them, which is what the
-- "notify all teachers" requirement implies.
drop policy if exists "early_dismissal_requests_select" on public.early_dismissal_requests;
create policy "early_dismissal_requests_select" on public.early_dismissal_requests for select to authenticated
using (public.is_staff() or parent_id = (select auth.uid()));

drop policy if exists "early_dismissal_requests_parent_insert" on public.early_dismissal_requests;
create policy "early_dismissal_requests_parent_insert" on public.early_dismissal_requests for insert to authenticated
with check (parent_id = (select auth.uid()) and public.parent_has_student(student_id));

-- There is deliberately no parent UPDATE policy: a parent withdrawing their own request goes
-- through /api/early-dismissal/[id], which re-checks ownership server-side. Without a policy a
-- parent cannot reach the decision columns from the browser at all.
drop policy if exists "early_dismissal_requests_parent_update" on public.early_dismissal_requests;

drop policy if exists "early_dismissal_requests_approver_update" on public.early_dismissal_requests;
create policy "early_dismissal_requests_approver_update" on public.early_dismissal_requests for update to authenticated
using (public.can_decide_early_dismissal(id)) with check (public.can_decide_early_dismissal(id));

drop policy if exists "early_dismissal_acks_select" on public.early_dismissal_acknowledgements;
create policy "early_dismissal_acks_select" on public.early_dismissal_acknowledgements for select to authenticated
using (public.is_staff());

drop policy if exists "early_dismissal_acks_staff_insert" on public.early_dismissal_acknowledgements;
create policy "early_dismissal_acks_staff_insert" on public.early_dismissal_acknowledgements for insert to authenticated
with check (public.is_staff() and staff_id = (select auth.uid()));

drop policy if exists "early_dismissal_acks_staff_delete" on public.early_dismissal_acknowledgements;
create policy "early_dismissal_acks_staff_delete" on public.early_dismissal_acknowledgements for delete to authenticated
using (staff_id = (select auth.uid()));

grant select on public.homeroom_assignments, public.school_officers to authenticated;
grant insert, update, delete on public.homeroom_assignments, public.school_officers to authenticated;
grant select, insert, update on public.early_dismissal_requests to authenticated;
grant select, insert, delete on public.early_dismissal_acknowledgements to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='early_dismissal_requests') then
    alter publication supabase_realtime add table public.early_dismissal_requests;
  end if;
end $$;

notify pgrst, 'reload schema';
