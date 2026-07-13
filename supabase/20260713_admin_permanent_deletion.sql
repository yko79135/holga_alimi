-- Run after supabase/20260713_notice_attachments_push.sql.
-- Additive migration for administrator-only permanent deletion and creator/uploader preservation.

drop policy if exists "notices_staff_delete" on public.notices;
drop policy if exists "notices_admin_delete" on public.notices;
create policy "notices_admin_delete" on public.notices for delete to authenticated using (public.is_admin());

drop policy if exists "students_staff_delete" on public.students;
drop policy if exists "students_admin_delete" on public.students;
create policy "students_admin_delete" on public.students for delete to authenticated using (public.is_admin());

do $$
begin
  if to_regclass('public.notice_attachments') is not null then
    drop policy if exists "notice_attachments_staff_delete" on public.notice_attachments;
    drop policy if exists "notice_attachments_admin_delete" on public.notice_attachments;
    create policy "notice_attachments_admin_delete" on public.notice_attachments for delete to authenticated using (public.is_admin());
  end if;
end $$;

drop policy if exists "notice_attachment_objects_staff_delete" on storage.objects;
drop policy if exists "notice_attachment_objects_admin_delete" on storage.objects;
create policy "notice_attachment_objects_admin_delete" on storage.objects for delete to authenticated
using (bucket_id = 'notice-attachments' and public.is_admin());

alter table public.notices alter column created_by drop not null;
alter table public.notices drop constraint if exists notices_created_by_fkey;
alter table public.notices add constraint notices_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;

do $$
begin
  if to_regclass('public.notice_attachments') is not null then
    alter table public.notice_attachments alter column uploaded_by drop not null;
    alter table public.notice_attachments drop constraint if exists notice_attachments_uploaded_by_fkey;
    alter table public.notice_attachments add constraint notice_attachments_uploaded_by_fkey foreign key (uploaded_by) references public.profiles(id) on delete set null;
  end if;
end $$;
