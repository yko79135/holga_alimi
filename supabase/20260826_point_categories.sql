-- 훈계/칭찬 점수 카테고리를 관리자 화면에서 추가할 수 있도록 하드코딩된 목록을 테이블로 옮깁니다.
-- 기존에는 lib/warnings/categories.ts의 상수와 warning_entries_category_check 제약이 목록을
-- 고정하고 있어서, 새 카테고리를 넣으려면 코드 배포가 필요했습니다.
create table if not exists public.point_categories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('discipline', 'praise')),
  name text not null check (length(trim(name)) > 0),
  -- 부여 폼 드롭다운에 "거짓말 (10/5점)"처럼 붙는 참고 점수 안내입니다. 입력값을 제한하지는
  -- 않고 안내만 하므로 자유 문자열입니다.
  point_hint text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

create index if not exists point_categories_kind_idx on public.point_categories (kind, sort_order, name);

alter table public.point_categories enable row level security;

drop policy if exists "point_categories_select" on public.point_categories;
create policy "point_categories_select" on public.point_categories for select to authenticated using (true);

drop policy if exists "point_categories_admin_write" on public.point_categories;
create policy "point_categories_admin_write" on public.point_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.point_categories to authenticated;
grant insert, update, delete on public.point_categories to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='point_categories') then
    alter publication supabase_realtime add table public.point_categories;
  end if;
end $$;

-- 기존 하드코딩 목록을 그대로 초기 데이터로 넣습니다. 이미 실행한 적이 있으면 관리자가 바꾼
-- 이름/안내/정렬을 덮어쓰지 않도록 do nothing으로 둡니다.
insert into public.point_categories (kind, name, point_hint, sort_order)
values
  ('discipline', '숙제·과제 미이행', '1점', 10),
  ('discipline', '준비물·교재 미지참', '1점', 20),
  ('discipline', '시험 성적 미달·미응시', '1점', 30),
  ('discipline', '지각·시간 미준수', '1점', 40),
  ('discipline', '말씀묵상·QT·경건생활 미이행', '1점', 50),
  ('discipline', '교사 지시 불응', '1점', 60),
  ('discipline', '수업·예배 태도 불량·장난', '1점', 70),
  ('discipline', '거짓말', '10/5점', 80),
  ('discipline', '부정행위', '20/10점', 90),
  ('discipline', '친구·교사간 폭행', '10~30점', 100),
  ('discipline', '미디어 규정', '5점', 110),
  ('praise', '성적 우수', null, 10),
  ('praise', '과제·활동 성실 수행', null, 20),
  ('praise', '발표 우수', null, 30),
  ('praise', '질문에 훌륭히 답변', null, 40),
  ('praise', '친구를 도와줌', null, 50),
  ('praise', '수업 태도 우수', null, 60),
  ('praise', '말씀묵상 성실', null, 70),
  ('praise', '교사 지도에 잘 따름', null, 80)
on conflict (kind, name) do nothing;

-- 고정 목록 제약을 걷어내고, 대신 point_categories에 등록된 값인지 트리거로 확인합니다.
-- CHECK는 서브쿼리를 쓸 수 없고, 카테고리를 지우거나 이름을 바꿔도 과거 기록은 그대로 남아야
-- 하므로 외래키 대신 트리거를 씁니다.
alter table public.warning_entries drop constraint if exists warning_entries_category_check;
alter table public.warning_entries add constraint warning_entries_category_check check (
  category is null or length(trim(category)) > 0
);

create or replace function public.validate_warning_entry_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category is null or new.category = '직접 입력' then
    return new;
  end if;
  -- 과거 기록 수정 시에는 검사하지 않습니다. 그 사이 카테고리가 삭제·변경됐더라도 점수 수정은
  -- 계속 가능해야 합니다.
  if tg_op = 'UPDATE' and new.category is not distinct from old.category then
    return new;
  end if;
  if not exists (
    select 1 from public.point_categories pc
    where pc.name = new.category
      and pc.kind = coalesce(new.kind, 'discipline')
  ) then
    raise exception 'unknown point category: % (kind %)', new.category, coalesce(new.kind, 'discipline')
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists warning_entries_category_valid on public.warning_entries;
create trigger warning_entries_category_valid
  before insert or update of category, kind on public.warning_entries
  for each row execute function public.validate_warning_entry_category();

notify pgrst, 'reload schema';
