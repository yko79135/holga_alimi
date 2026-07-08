-- Run this entire file in the Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'teacher', 'parent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notice_type as enum ('newsletter', 'warning', 'guidance', 'consultation', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.target_scope as enum ('school', 'grade', 'student');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  role public.app_role not null default 'parent',
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade text not null,
  homeroom text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.parent_students (
  parent_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relationship text,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  type public.notice_type not null default 'newsletter',
  title text not null,
  body text not null,
  target_scope public.target_scope not null default 'school',
  target_grade text,
  requires_confirmation boolean not null default false,
  created_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint target_grade_required check (
    (target_scope = 'grade' and target_grade is not null)
    or target_scope <> 'grade'
  )
);

create table if not exists public.notice_students (
  notice_id uuid not null references public.notices(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  primary key (notice_id, student_id)
);

create table if not exists public.acknowledgements (
  notice_id uuid not null references public.notices(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  confirmed_at timestamptz,
  parent_reply text,
  replied_at timestamptz,
  primary key (notice_id, parent_id)
);

create index if not exists parent_students_parent_idx on public.parent_students(parent_id);
create index if not exists parent_students_student_idx on public.parent_students(student_id);
create index if not exists students_grade_idx on public.students(grade);
create index if not exists notices_scope_grade_idx on public.notices(target_scope, target_grade);
create index if not exists notice_students_student_idx on public.notice_students(student_id);
create index if not exists acknowledgements_parent_idx on public.acknowledgements(parent_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'parent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill profiles if auth users existed before this schema was installed.
insert into public.profiles (id, email, full_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin', 'teacher')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.parent_has_student(requested_student uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.parent_students
    where parent_id = (select auth.uid()) and student_id = requested_student
  );
$$;

grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.parent_has_student(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.parent_students enable row level security;
alter table public.notices enable row level security;
alter table public.notice_students enable row level security;
alter table public.acknowledgements enable row level security;

-- Profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_staff());

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles for update to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Students
drop policy if exists "students_select" on public.students;
create policy "students_select" on public.students for select to authenticated
using (public.is_staff() or public.parent_has_student(id));

drop policy if exists "students_staff_insert" on public.students;
create policy "students_staff_insert" on public.students for insert to authenticated
with check (public.is_staff());

drop policy if exists "students_staff_update" on public.students;
create policy "students_staff_update" on public.students for update to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists "students_staff_delete" on public.students;
create policy "students_staff_delete" on public.students for delete to authenticated
using (public.is_staff());

-- Parent/student links
drop policy if exists "parent_students_select" on public.parent_students;
create policy "parent_students_select" on public.parent_students for select to authenticated
using (parent_id = (select auth.uid()) or public.is_staff());

drop policy if exists "parent_students_admin_insert" on public.parent_students;
create policy "parent_students_admin_insert" on public.parent_students for insert to authenticated
with check (public.is_admin());

drop policy if exists "parent_students_admin_delete" on public.parent_students;
create policy "parent_students_admin_delete" on public.parent_students for delete to authenticated
using (public.is_admin());

-- Notices: parents only see school, their child's grade, or their linked child's individual messages.
drop policy if exists "notices_select" on public.notices;
create policy "notices_select" on public.notices for select to authenticated
using (
  public.is_staff()
  or (
    published_at <= now()
    and (
      target_scope = 'school'
      or (
        target_scope = 'grade'
        and exists (
          select 1
          from public.parent_students ps
          join public.students s on s.id = ps.student_id
          where ps.parent_id = (select auth.uid()) and s.grade = notices.target_grade
        )
      )
      or (
        target_scope = 'student'
        and exists (
          select 1
          from public.notice_students ns
          join public.parent_students ps on ps.student_id = ns.student_id
          where ns.notice_id = notices.id and ps.parent_id = (select auth.uid())
        )
      )
    )
  )
);

drop policy if exists "notices_staff_insert" on public.notices;
create policy "notices_staff_insert" on public.notices for insert to authenticated
with check (public.is_staff() and created_by = (select auth.uid()));

drop policy if exists "notices_staff_update" on public.notices;
create policy "notices_staff_update" on public.notices for update to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists "notices_staff_delete" on public.notices;
create policy "notices_staff_delete" on public.notices for delete to authenticated
using (public.is_staff());

-- Individual notice links
drop policy if exists "notice_students_select" on public.notice_students;
create policy "notice_students_select" on public.notice_students for select to authenticated
using (public.is_staff() or public.parent_has_student(student_id));

drop policy if exists "notice_students_staff_insert" on public.notice_students;
create policy "notice_students_staff_insert" on public.notice_students for insert to authenticated
with check (public.is_staff());

drop policy if exists "notice_students_staff_delete" on public.notice_students;
create policy "notice_students_staff_delete" on public.notice_students for delete to authenticated
using (public.is_staff());

-- Read/confirmation/reply records
drop policy if exists "ack_select" on public.acknowledgements;
create policy "ack_select" on public.acknowledgements for select to authenticated
using (parent_id = (select auth.uid()) or public.is_staff());

drop policy if exists "ack_parent_insert" on public.acknowledgements;
create policy "ack_parent_insert" on public.acknowledgements for insert to authenticated
with check (
  parent_id = (select auth.uid())
  and exists (select 1 from public.notices n where n.id = notice_id)
);

drop policy if exists "ack_parent_update" on public.acknowledgements;
create policy "ack_parent_update" on public.acknowledgements for update to authenticated
using (parent_id = (select auth.uid()))
with check (parent_id = (select auth.uid()));

-- Explicit grants used by the browser client. RLS still controls which rows are available.
grant select on public.profiles, public.students, public.parent_students, public.notices, public.notice_students, public.acknowledgements to authenticated;
grant insert, update, delete on public.students, public.notices, public.notice_students to authenticated;
grant insert, update on public.acknowledgements to authenticated;
grant insert, delete on public.parent_students to authenticated;
