-- Multi-role accounts for Holy Guide Christian School.
-- Run in Supabase SQL Editor, then refresh PostgREST schema cache if needed: NOTIFY pgrst, 'reload schema';

create table if not exists public.profile_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key (profile_id, role)
);

create index if not exists profile_roles_role_idx on public.profile_roles(role);
create index if not exists profile_roles_assigned_by_idx on public.profile_roles(assigned_by);

insert into public.profile_roles (profile_id, role)
select id, role from public.profiles where role is not null
on conflict do nothing;

create or replace function public.has_role(requested_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profile_roles pr
    where pr.profile_id = (select auth.uid()) and pr.role = requested_role
  );
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin'::public.app_role) or public.has_role('teacher'::public.app_role);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin'::public.app_role);
$$;

create or replace function public.parent_has_student(requested_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('parent'::public.app_role) and exists (
    select 1 from public.parent_students ps
    where ps.parent_id = (select auth.uid()) and ps.student_id = requested_student
  );
$$;

grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.parent_has_student(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested_role public.app_role;
  role_text text;
begin
  role_text := coalesce(new.raw_user_meta_data ->> 'role', 'parent');
  if role_text in ('admin', 'teacher', 'parent') then requested_role := role_text::public.app_role; else requested_role := 'parent'::public.app_role; end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), requested_role)
  on conflict (id) do update set email = excluded.email, full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);
  insert into public.profile_roles (profile_id, role) values (new.id, requested_role) on conflict do nothing;
  return new;
end;
$$;

alter table public.profile_roles enable row level security;

drop policy if exists "profile_roles_self_select" on public.profile_roles;
create policy "profile_roles_self_select" on public.profile_roles for select to authenticated
using (profile_id = (select auth.uid()) or public.is_admin());

drop policy if exists "profile_roles_admin_insert" on public.profile_roles;
create policy "profile_roles_admin_insert" on public.profile_roles for insert to authenticated
with check (public.is_admin() and assigned_by = (select auth.uid()));

drop policy if exists "profile_roles_admin_delete" on public.profile_roles;
create policy "profile_roles_admin_delete" on public.profile_roles for delete to authenticated
using (public.is_admin());

grant select, insert, delete on public.profile_roles to authenticated;

notify pgrst, 'reload schema';
