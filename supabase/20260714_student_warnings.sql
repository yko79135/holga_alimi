-- Normalized student warning management, generated warning notices, and realtime support.
do $$ begin
  create type public.warning_entry_type as enum ('daily','grace_adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.warning_change_type as enum ('addition','correction','cancellation','grace_adjustment');
exception when duplicate_object then null; end $$;

alter table public.notices add column if not exists source_type text;
alter table public.notices add column if not exists source_id uuid;
create index if not exists notices_warning_source_idx on public.notices(source_type, source_id) where source_type = 'warning_update';

create table if not exists public.warning_change_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  academic_year int not null,
  semester int not null check (semester in (1,2)),
  month int not null check (month between 1 and 12),
  author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  status text not null default 'committed',
  missing_parent_student_ids uuid[] not null default '{}'
);

create table if not exists public.warning_entries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.warning_change_batches(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  warning_date date,
  academic_year int not null,
  semester int not null check (semester in (1,2)),
  month int not null check (month between 1 and 12),
  entry_type public.warning_entry_type not null,
  change_type public.warning_change_type not null,
  previous_value int not null,
  new_value int not null,
  delta int not null check (delta <> 0),
  parent_visible_reason text,
  teacher_note text,
  author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint warning_daily_date_required check ((entry_type = 'daily' and warning_date is not null) or (entry_type = 'grace_adjustment' and warning_date is null))
);

create table if not exists public.warning_generated_notices (
  batch_id uuid not null references public.warning_change_batches(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  notice_id uuid references public.notices(id) on delete set null,
  recipient_count int not null default 0,
  push_sent_count int not null default 0,
  push_failed_count int not null default 0,
  created_at timestamptz not null default now(),
  primary key (batch_id, student_id)
);

create index if not exists warning_entries_student_period_idx on public.warning_entries(student_id, academic_year, semester, month);
create index if not exists warning_entries_date_idx on public.warning_entries(warning_date);
create index if not exists warning_entries_batch_idx on public.warning_entries(batch_id);
create index if not exists warning_generated_notices_notice_idx on public.warning_generated_notices(notice_id);

alter table public.warning_change_batches enable row level security;
alter table public.warning_entries enable row level security;
alter table public.warning_generated_notices enable row level security;

drop policy if exists "warning_batches_staff_select" on public.warning_change_batches;
create policy "warning_batches_staff_select" on public.warning_change_batches for select to authenticated using (public.is_staff());
drop policy if exists "warning_entries_select" on public.warning_entries;
create policy "warning_entries_select" on public.warning_entries for select to authenticated using (public.is_staff() or (teacher_note is null and public.parent_has_student(student_id)));
drop policy if exists "warning_generated_notices_staff_select" on public.warning_generated_notices;
create policy "warning_generated_notices_staff_select" on public.warning_generated_notices for select to authenticated using (public.is_staff());

grant select on public.warning_change_batches, public.warning_entries, public.warning_generated_notices to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='warning_entries') then
    alter publication supabase_realtime add table public.warning_entries;
  end if;
end $$;
