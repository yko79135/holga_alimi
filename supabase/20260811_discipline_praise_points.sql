-- "수업" (class period) master list for the discipline/praise point grant form's dropdown.
-- No such concept existed in the schema before; admins manage this list, teachers just pick from it.
create table if not exists public.class_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.class_periods enable row level security;

drop policy if exists "class_periods_select" on public.class_periods;
create policy "class_periods_select" on public.class_periods for select to authenticated using (true);

drop policy if exists "class_periods_admin_write" on public.class_periods;
create policy "class_periods_admin_write" on public.class_periods for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.class_periods to authenticated;
grant insert, update on public.class_periods to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='class_periods') then
    alter publication supabase_realtime add table public.class_periods;
  end if;
end $$;

-- Category + class tagging for the new dropdown-based "훈계 점수" / "칭찬 점수" grant flow.
-- Both reuse warning_entries (entry_type='daily', category set determines discipline vs praise)
-- so the existing monthly SUM aggregation, audit trail, and notice/push pipeline keep working
-- unchanged for legacy grid-based entries (category stays null for those).
alter table public.warning_entries add column if not exists category text;
alter table public.warning_entries add column if not exists class_period_id uuid references public.class_periods(id) on delete set null;

alter table public.warning_entries drop constraint if exists warning_entries_category_check;
alter table public.warning_entries add constraint warning_entries_category_check check (
  category is null or category in (
    '숙제·과제 미이행', '준비물·교재 미지참', '시험 성적 미달·미응시', '지각·시간 미준수',
    '말씀묵상·QT·경건생활 미이행', '교사 지시 불응', '수업·예배 태도 불량·장난', '거짓말·부정행위',
    '친구·타인에게 부적절한 행동', '학교 규정·물품 관련 위반',
    '성적 우수', '과제·활동 성실 수행', '발표 우수', '질문에 훌륭히 답변', '친구를 도와줌',
    '수업 태도 우수', '말씀묵상 성실', '교사 지도에 잘 따름'
  )
);

-- The parent dashboard's recent-entries feed previously mixed every warning_entries row
-- together; now that praise-category rows live in the same table, exclude them here so the
-- "훈계 현황" list on the parent dashboard doesn't show praise-point grants.
create or replace function public.parent_warning_entries()
returns table (
  id uuid,
  student_id uuid,
  warning_date date,
  entry_type public.warning_entry_type,
  delta int,
  parent_visible_reason text,
  created_at timestamptz,
  student_name text,
  student_grade text
)
language sql
security definer
set search_path = public
as $$
  select we.id, we.student_id, we.warning_date, we.entry_type, we.delta,
         we.parent_visible_reason, we.created_at, s.name, s.grade
  from public.warning_entries we
  join public.students s on s.id = we.student_id
  where public.parent_has_student(we.student_id)
    and (we.category is null or we.category not in (
      '성적 우수', '과제·활동 성실 수행', '발표 우수', '질문에 훌륭히 답변', '친구를 도와줌',
      '수업 태도 우수', '말씀묵상 성실', '교사 지도에 잘 따름'
    ))
  order by we.created_at desc
  limit 50;
$$;

notify pgrst, 'reload schema';
