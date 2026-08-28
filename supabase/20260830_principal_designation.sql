-- Adds the principal (교장) to the school-wide office roster.
-- Run after supabase/20260829_early_dismissal_no_approval.sql in the Supabase SQL Editor.
--
-- school_officers was already keyed by role_key precisely so another office could be added
-- without a schema change, so this migration only seeds the new row. Like the vice principal,
-- the designation is display-only: it carries no approval or permission of its own.

insert into public.school_officers (role_key, person_name)
values ('principal', '홍인숙')
on conflict (role_key) do nothing;

-- Link the seeded name to a real account when exactly one staff account carries that name.
update public.school_officers o
set profile_id = matched.id
from (
  select p.full_name, min(p.id::text)::uuid as id, count(*) as hits
  from public.profiles p
  join public.profile_roles pr on pr.profile_id = p.id and pr.role in ('teacher', 'admin')
  group by p.full_name
) matched
where o.role_key = 'principal'
  and o.profile_id is null
  and matched.hits = 1
  and matched.full_name = o.person_name;

comment on table public.school_officers is
  '학교 단위 직책 명단. 현재 principal(교장), vice_principal(교감)을 사용하며 표시용이다.';

notify pgrst, 'reload schema';
