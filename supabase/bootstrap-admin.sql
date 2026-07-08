-- 1) First create the user in Supabase Dashboard > Authentication > Users.
-- 2) Replace the email below, then run this in SQL Editor.
update public.profiles
set role = 'admin', full_name = '학교 관리자'
where email = 'admin@example.com';
