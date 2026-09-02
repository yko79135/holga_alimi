-- 개인 전용 테스트 데이터(더미 학부모·학생) + 관리자 화면 탭 권한.
-- supabase/20260901_notice_target_audience.sql 다음에 Supabase SQL Editor에서 실행하세요.
--
-- profiles.test_owner_id / students.test_owner_id 가 비어 있으면 지금까지와 똑같은 실제 데이터입니다.
-- 값이 채워져 있으면 그 계정 한 명에게만 존재하는 테스트용 행이고, 다른 로그인에서는 아래 조회
-- 정책이 통째로 걸러냅니다. 서버의 service_role 경로는 RLS를 지나가지 않으므로 같은 규칙을
-- lib/test-data.ts 와 app/api/admin/* 에서 다시 한 번 적용합니다.

alter table public.profiles add column if not exists test_owner_id uuid references public.profiles(id) on delete cascade;
alter table public.students add column if not exists test_owner_id uuid references public.profiles(id) on delete cascade;

comment on column public.profiles.test_owner_id is '값이 있으면 그 계정에게만 보이는 테스트용 계정입니다. 실제 학부모·교사 계정은 항상 null입니다.';
comment on column public.students.test_owner_id is '값이 있으면 그 계정에게만 보이는 테스트용 학생입니다. 실제 학생은 항상 null입니다.';

create index if not exists profiles_test_owner_idx on public.profiles(test_owner_id) where test_owner_id is not null;
create index if not exists students_test_owner_idx on public.students(test_owner_id) where test_owner_id is not null;

-- 테스트 행 소유자 판정. 실제 데이터(null)는 언제나 보입니다.
create or replace function public.test_row_visible(owner_id uuid)
returns boolean language sql stable set search_path = public as $$
  select owner_id is null or owner_id = (select auth.uid());
$$;

-- 정책 안에서 다른 테이블을 들여다봐야 하는 자리용. security definer 로 두어 참조 대상 테이블의
-- 정책을 다시 타지 않게 합니다(순환 참조 방지).
create or replace function public.test_profile_visible(target_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.test_row_visible((select p.test_owner_id from public.profiles p where p.id = target_profile));
$$;

create or replace function public.test_student_visible(target_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.test_row_visible((select s.test_owner_id from public.students s where s.id = target_student));
$$;

-- 개별 학생 대상 공지가 통째로 남의 테스트 학생만 향하고 있으면 발송 기록에서도 감춥니다.
-- 학교 전체·학년 공지는 notice_students 행이 없으므로 항상 그대로 보입니다.
create or replace function public.notice_hidden_by_test_students(target_notice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.notice_students ns where ns.notice_id = target_notice)
    and not exists (
      select 1
      from public.notice_students ns
      join public.students s on s.id = ns.student_id
      where ns.notice_id = target_notice
        and (public.test_row_visible(s.test_owner_id) or public.parent_has_student(s.id))
    );
$$;

grant execute on function public.test_row_visible(uuid) to authenticated;
grant execute on function public.test_profile_visible(uuid) to authenticated;
grant execute on function public.test_student_visible(uuid) to authenticated;
grant execute on function public.notice_hidden_by_test_students(uuid) to authenticated;

-- Profiles: 본인 계정은 테스트 계정이어도 본인에게 보여야 합니다(더미 계정으로 로그인한 경우).
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
using (
  (id = (select auth.uid()) or public.is_staff())
  and (id = (select auth.uid()) or public.test_row_visible(test_owner_id))
);

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles for update to authenticated
using (public.is_admin() and public.test_row_visible(test_owner_id))
with check (public.is_admin() and public.test_row_visible(test_owner_id));

-- Students: 연결된 학부모(더미 학부모 포함)는 자기 자녀를 계속 볼 수 있어야 합니다.
drop policy if exists "students_select" on public.students;
create policy "students_select" on public.students for select to authenticated
using (
  (public.is_staff() or public.parent_has_student(id))
  and (public.test_row_visible(test_owner_id) or public.parent_has_student(id))
);

drop policy if exists "students_staff_insert" on public.students;
create policy "students_staff_insert" on public.students for insert to authenticated
with check (public.is_staff() and public.test_row_visible(test_owner_id));

drop policy if exists "students_staff_update" on public.students;
create policy "students_staff_update" on public.students for update to authenticated
using (public.is_staff() and public.test_row_visible(test_owner_id))
with check (public.is_staff() and public.test_row_visible(test_owner_id));

drop policy if exists "students_staff_delete" on public.students;
drop policy if exists "students_admin_delete" on public.students;
create policy "students_admin_delete" on public.students for delete to authenticated
using (public.is_admin() and public.test_row_visible(test_owner_id));

-- Parent/student links
drop policy if exists "parent_students_select" on public.parent_students;
create policy "parent_students_select" on public.parent_students for select to authenticated
using (
  (parent_id = (select auth.uid()) or public.is_staff())
  and (
    parent_id = (select auth.uid())
    or (public.test_profile_visible(parent_id) and public.test_student_visible(student_id))
  )
);

drop policy if exists "parent_students_admin_insert" on public.parent_students;
create policy "parent_students_admin_insert" on public.parent_students for insert to authenticated
with check (public.is_admin() and public.test_profile_visible(parent_id) and public.test_student_visible(student_id));

drop policy if exists "parent_students_admin_delete" on public.parent_students;
create policy "parent_students_admin_delete" on public.parent_students for delete to authenticated
using (public.is_admin() and public.test_profile_visible(parent_id) and public.test_student_visible(student_id));

-- Multi-role rows
drop policy if exists "profile_roles_self_select" on public.profile_roles;
create policy "profile_roles_self_select" on public.profile_roles for select to authenticated
using (profile_id = (select auth.uid()) or (public.is_admin() and public.test_profile_visible(profile_id)));

drop policy if exists "profile_roles_admin_insert" on public.profile_roles;
create policy "profile_roles_admin_insert" on public.profile_roles for insert to authenticated
with check (public.is_admin() and assigned_by = (select auth.uid()) and public.test_profile_visible(profile_id));

drop policy if exists "profile_roles_admin_delete" on public.profile_roles;
create policy "profile_roles_admin_delete" on public.profile_roles for delete to authenticated
using (public.is_admin() and public.test_profile_visible(profile_id));

-- Individual notice links
drop policy if exists "notice_students_select" on public.notice_students;
create policy "notice_students_select" on public.notice_students for select to authenticated
using ((public.is_staff() and public.test_student_visible(student_id)) or public.parent_has_student(student_id));

-- 읽음·확인 기록: 남의 더미 학부모가 남긴 확인 기록은 발송 기록 집계에서 빠집니다.
drop policy if exists "ack_select" on public.acknowledgements;
create policy "ack_select" on public.acknowledgements for select to authenticated
using (parent_id = (select auth.uid()) or (public.is_staff() and public.test_profile_visible(parent_id)));

-- Notices: 본문은 그대로 두고, 남의 테스트 학생만 대상으로 하는 개별 공지만 감춥니다.
drop policy if exists "notices_select" on public.notices;
create policy "notices_select" on public.notices for select to authenticated
using (
  not public.notice_hidden_by_test_students(id)
  and (
    public.is_staff()
    or (
      published_at <= now()
      and (
        (target_scope = 'school' and target_audience <> 'staff')
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
  )
);

-- ---------------------------------------------------------------------------
-- 실제 배정: 관리자 화면 탭 + 나만 보이는 더미 학부모/학생
-- ---------------------------------------------------------------------------
do $$
declare
  owner_email constant text := 'yko79135@gmail.com';
  dummy_parent_email constant text := 'dummy.parent@holyguide.test';
  dummy_parent_name constant text := '테스트 학부모';
  dummy_student_name constant text := '테스트 학생';
  dummy_student_grade constant text := 'G4';
  owner_id uuid;
  dummy_parent_id uuid;
  dummy_student_id uuid;
begin
  select id into owner_id from auth.users where lower(email) = owner_email;
  if owner_id is null then
    raise exception '% 계정을 찾을 수 없습니다. 그 이메일로 로그인 계정을 먼저 만든 뒤 다시 실행하세요.', owner_email;
  end if;

  -- 1) 관리자 화면 / 학부모 화면 탭 전환에 필요한 권한. 기존 권한은 그대로 둡니다.
  insert into public.profile_roles (profile_id, role)
  values (owner_id, 'admin'), (owner_id, 'parent')
  on conflict (profile_id, role) do nothing;
  -- profiles.role 은 화면 하나만 쓰던 시절의 단일 권한 칸입니다. 다중 권한에서는 admin 이
  -- 우선이므로(lib/roles.ts APP_ROLES 순서) 옛 칸도 맞춰 둡니다.
  update public.profiles set role = 'admin' where id = owner_id and role is distinct from 'admin';

  -- 2) 더미 학부모 계정. 비밀번호는 일부러 쓸 수 없는 값으로 둡니다 -- 이 계정은 로그인용이
  -- 아니라 "학부모가 어떻게 보이는지" 확인용이고, 실제로 로그인해 봐야 한다면 계정 관리 탭의
  -- 비밀번호 재설정으로 새 비밀번호를 넣으면 됩니다.
  select id into dummy_parent_id from auth.users where lower(email) = dummy_parent_email;
  if dummy_parent_id is null then
    dummy_parent_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', dummy_parent_id, 'authenticated', 'authenticated',
      dummy_parent_email, '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', dummy_parent_name, 'role', 'parent'),
      now(), now(), '', '', '', ''
    );
  end if;

  insert into public.profiles (id, email, full_name, role, test_owner_id)
  values (dummy_parent_id, dummy_parent_email, dummy_parent_name, 'parent', owner_id)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name, role = 'parent', test_owner_id = excluded.test_owner_id;

  insert into public.profile_roles (profile_id, role) values (dummy_parent_id, 'parent')
  on conflict (profile_id, role) do nothing;

  -- 3) 더미 학생. 학년은 이미 쓰고 있는 라벨을 골라야 남의 화면에 빈 학년 줄이 생기지 않습니다.
  select id into dummy_student_id from public.students
  where test_owner_id = owner_id and name = dummy_student_name;
  if dummy_student_id is null then
    insert into public.students (name, grade, homeroom, active, test_owner_id)
    values (dummy_student_name, dummy_student_grade, null, true, owner_id)
    returning id into dummy_student_id;
  end if;

  -- 더미 학부모에게 연결하고, 같은 학생을 내 계정에도 연결합니다. 뒤쪽 연결 덕분에 따로
  -- 로그인하지 않고 헤더에서 학부모 화면으로 전환하기만 하면 이 학생이 보입니다.
  insert into public.parent_students (parent_id, student_id, relationship)
  values (dummy_parent_id, dummy_student_id, '테스트'), (owner_id, dummy_student_id, '테스트')
  on conflict (parent_id, student_id) do nothing;
end $$;

notify pgrst, 'reload schema';
