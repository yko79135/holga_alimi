-- Parent self-service signup via admin-issued, single-use, expiring invite links.
-- Redemption always goes through app/api/signup/invite using the service-role client, so RLS
-- here only needs to gate the admin-facing generate/list/revoke actions. There is intentionally
-- no anon or authenticated-parent policy at all -- that is what keeps invite rows unreadable
-- and unlistable to an unauthenticated visitor beyond the public route validating one token.

create table if not exists public.signup_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  role public.app_role not null default 'parent',
  student_ids uuid[] not null default '{}',
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists signup_invites_created_by_idx on public.signup_invites(created_by);
create index if not exists signup_invites_pending_idx on public.signup_invites(expires_at) where used_at is null and revoked_at is null;

alter table public.signup_invites enable row level security;

drop policy if exists "signup_invites_admin_select" on public.signup_invites;
create policy "signup_invites_admin_select" on public.signup_invites for select to authenticated using (public.is_admin());
drop policy if exists "signup_invites_admin_insert" on public.signup_invites;
create policy "signup_invites_admin_insert" on public.signup_invites for insert to authenticated with check (public.is_admin() and created_by = (select auth.uid()));
drop policy if exists "signup_invites_admin_update" on public.signup_invites;
create policy "signup_invites_admin_update" on public.signup_invites for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "signup_invites_admin_delete" on public.signup_invites;
create policy "signup_invites_admin_delete" on public.signup_invites for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.signup_invites to authenticated;

notify pgrst, 'reload schema';
