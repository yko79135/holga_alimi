-- Make invite links reusable: an invite is valid for many signups until it expires or an admin
-- revokes it, not consumed after a single signup. A single used_by FK can't represent "which
-- parents redeemed this link," so redemptions move to their own audit table.

alter table public.signup_invites drop column if exists used_at;
alter table public.signup_invites drop column if exists used_by;
alter table public.signup_invites drop column if exists student_ids;

create table if not exists public.signup_invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.signup_invites(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists signup_invite_redemptions_invite_idx on public.signup_invite_redemptions(invite_id);
create index if not exists signup_invite_redemptions_parent_idx on public.signup_invite_redemptions(parent_id);

alter table public.signup_invite_redemptions enable row level security;

-- Redemption rows are only ever written by the service-role client during account creation
-- (app/api/signup/invite), same as signup_invites itself has no anon/authenticated insert
-- policy -- there is intentionally no insert policy here for the authenticated role.
drop policy if exists "signup_invite_redemptions_admin_select" on public.signup_invite_redemptions;
create policy "signup_invite_redemptions_admin_select" on public.signup_invite_redemptions for select to authenticated using (public.is_admin());

grant select on public.signup_invite_redemptions to authenticated;

notify pgrst, 'reload schema';
