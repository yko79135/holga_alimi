-- Extend permanent notice deletion from admin-only back to admin+teacher (is_staff()).
-- 20260713_admin_permanent_deletion.sql tightened this to admin-only; this migration reopens
-- it for notices specifically, now that app/api/admin/notices/[id] and the new bulk-delete
-- route are gated by requireStaff() instead of requireAdmin(). Students stay admin-only --
-- this migration does not touch students_admin_delete.

drop policy if exists "notices_admin_delete" on public.notices;
drop policy if exists "notices_staff_delete" on public.notices;
create policy "notices_staff_delete" on public.notices for delete to authenticated using (public.is_staff());

drop policy if exists "notice_attachments_admin_delete" on public.notice_attachments;
drop policy if exists "notice_attachments_staff_delete" on public.notice_attachments;
create policy "notice_attachments_staff_delete" on public.notice_attachments for delete to authenticated using (public.is_staff());

drop policy if exists "notice_attachment_objects_admin_delete" on storage.objects;
drop policy if exists "notice_attachment_objects_staff_delete" on storage.objects;
create policy "notice_attachment_objects_staff_delete" on storage.objects for delete to authenticated
using (bucket_id = 'notice-attachments' and public.is_staff());
