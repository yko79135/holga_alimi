-- 학교 전체 알림의 세부 대상: 모든 학부모 / 모든 학부모 및 교사 / 모든 교사.
-- 학년·학생 대상 알림은 언제나 학부모용이므로 기본값 'parents'를 그대로 둡니다.

do $$ begin
  create type public.notice_audience as enum ('parents', 'parents_and_staff', 'staff');
exception when duplicate_object then null; end $$;

alter table public.notices
  add column if not exists target_audience public.notice_audience not null default 'parents';

-- Only school-wide notices carry a meaningful audience; everything else stays parent-facing.
alter table public.notices drop constraint if exists notice_audience_scope;
alter table public.notices add constraint notice_audience_scope check (
  target_scope = 'school' or target_audience = 'parents'
);

create index if not exists notices_scope_audience_idx on public.notices(target_scope, target_audience);

-- Re-create the parent-facing select policy so a 교사 전용 공지 never reaches a parent account.
drop policy if exists "notices_select" on public.notices;
create policy "notices_select" on public.notices for select to authenticated
using (
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
);
