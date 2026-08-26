-- handle_new_user()와 sync_profile_email()은 auth.users 트리거로만 호출되는데 security definer라
-- PostgREST의 /rest/v1/rpc 경로에도 노출돼 있었습니다(Supabase security advisor 경고).
-- 트리거 발동 시에는 EXECUTE 권한을 검사하지 않으므로(권한 검사는 트리거 생성 시점에만 이뤄집니다)
-- 회수해도 회원가입·이메일 변경 시 프로필 동기화는 그대로 동작합니다.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_profile_email() from public, anon, authenticated;

notify pgrst, 'reload schema';
