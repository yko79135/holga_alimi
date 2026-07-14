-- Enable Realtime for dynamic portal data and keep parent/student links unique.
create unique index if not exists parent_students_parent_student_uidx
  on public.parent_students(parent_id, student_id);

alter table public.notices replica identity full;
alter table public.notice_students replica identity full;
alter table public.notice_attachments replica identity full;
alter table public.acknowledgements replica identity full;
alter table public.parent_students replica identity full;
alter table public.students replica identity full;
alter table public.profiles replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notices') then
    alter publication supabase_realtime add table public.notices;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notice_students') then
    alter publication supabase_realtime add table public.notice_students;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notice_attachments') then
    alter publication supabase_realtime add table public.notice_attachments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'acknowledgements') then
    alter publication supabase_realtime add table public.acknowledgements;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'parent_students') then
    alter publication supabase_realtime add table public.parent_students;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'students') then
    alter publication supabase_realtime add table public.students;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
