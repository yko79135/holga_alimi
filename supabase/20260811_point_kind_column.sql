-- warning_entries.category (from 20260811_discipline_praise_points.sql) let us infer discipline
-- vs praise from category-text membership, but that breaks for the correction tab: a teacher
-- correcting a date-grid cell has no category to tag. Add an explicit `kind` column instead, so
-- corrections (and any future entry that isn't a category grant) can still be routed correctly.
-- Rows with kind = null are treated as discipline everywhere (matches the original 벌점 behavior
-- for entries that predate this whole point system).
alter table public.warning_entries add column if not exists kind text;
alter table public.warning_entries drop constraint if exists warning_entries_kind_check;
alter table public.warning_entries add constraint warning_entries_kind_check check (kind is null or kind in ('discipline', 'praise'));

update public.warning_entries set kind = 'praise' where kind is null and category in (
  '성적 우수', '과제·활동 성실 수행', '발표 우수', '질문에 훌륭히 답변', '친구를 도와줌',
  '수업 태도 우수', '말씀묵상 성실', '교사 지도에 잘 따름'
);
update public.warning_entries set kind = 'discipline' where kind is null and category in (
  '숙제·과제 미이행', '준비물·교재 미지참', '시험 성적 미달·미응시', '지각·시간 미준수',
  '말씀묵상·QT·경건생활 미이행', '교사 지시 불응', '수업·예배 태도 불량·장난', '거짓말·부정행위',
  '친구·타인에게 부적절한 행동', '학교 규정·물품 관련 위반'
);

-- Parent dashboard feed: switch from category-text filtering to the new kind column, and add a
-- matching praise feed for the new 칭찬 현황 tab.
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
    and coalesce(we.kind, 'discipline') = 'discipline'
  order by we.created_at desc
  limit 50;
$$;

create or replace function public.parent_praise_entries()
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
    and we.kind = 'praise'
  order by we.created_at desc
  limit 50;
$$;

revoke all on function public.parent_praise_entries() from public;
grant execute on function public.parent_praise_entries() to authenticated;

notify pgrst, 'reload schema';
