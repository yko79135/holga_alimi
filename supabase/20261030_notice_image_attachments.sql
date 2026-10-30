-- Run after supabase/20260713_notice_attachments_push.sql.
-- 가정통신문 등 알림 첨부에 PDF뿐 아니라 이미지(JPG, PNG, GIF, WEBP)도 올릴 수 있게 한다.
-- 허용 목록은 lib/notice-security.ts의 ATTACHMENT_TYPES와 같아야 한다.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
where id = 'notice-attachments';

alter table public.notice_attachments drop constraint if exists notice_attachment_pdf;
alter table public.notice_attachments drop constraint if exists notice_attachment_type;
alter table public.notice_attachments add constraint notice_attachment_type check (
  mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp')
  and size_bytes > 0 and size_bytes <= 20971520
);

notify pgrst, 'reload schema';
