-- Run this entire file in the Supabase SQL Editor.
--
-- public.profiles.email was only ever written when an auth user was created
-- (on_auth_user_created). Confirming a login-email change updates auth.users.email but left
-- profiles.email on the old address, which makes /api/admin/users report the account as
-- "정보 불일치" and shows the stale address anywhere profiles.email is read (학부모 목록 등).

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles
  set email = coalesce(new.email, '')
  where id = new.id and email is distinct from coalesce(new.email, '');
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute procedure public.sync_profile_email();

-- Backfill profiles whose email drifted from auth.users before this trigger existed.
update public.profiles p
set email = coalesce(u.email, '')
from auth.users u
where u.id = p.id and p.email is distinct from coalesce(u.email, '');
