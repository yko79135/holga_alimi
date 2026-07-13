-- Run this additive migration in the Supabase SQL Editor after supabase/schema.sql.
create extension if not exists pgcrypto;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notice-attachments', 'notice-attachments', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf'];

create table if not exists public.notice_attachments (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint notice_attachment_pdf check (mime_type = 'application/pdf' and size_bytes > 0 and size_bytes <= 20971520)
);
create index if not exists notice_attachments_notice_idx on public.notice_attachments(notice_id);
create index if not exists notice_attachments_uploaded_by_idx on public.notice_attachments(uploaded_by);
alter table public.notice_attachments enable row level security;
drop policy if exists "notice_attachments_select" on public.notice_attachments;
create policy "notice_attachments_select" on public.notice_attachments for select to authenticated
using (public.is_staff() or exists (select 1 from public.notices n where n.id = notice_attachments.notice_id));
drop policy if exists "notice_attachments_staff_insert" on public.notice_attachments;
create policy "notice_attachments_staff_insert" on public.notice_attachments for insert to authenticated
with check (public.is_staff() and uploaded_by = (select auth.uid()));
drop policy if exists "notice_attachments_staff_delete" on public.notice_attachments;
create policy "notice_attachments_staff_delete" on public.notice_attachments for delete to authenticated using (public.is_staff());

drop policy if exists "notice_attachment_objects_staff_insert" on storage.objects;
create policy "notice_attachment_objects_staff_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'notice-attachments' and public.is_staff());
drop policy if exists "notice_attachment_objects_staff_delete" on storage.objects;
create policy "notice_attachment_objects_staff_delete" on storage.objects for delete to authenticated
using (bucket_id = 'notice-attachments' and public.is_staff());

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_own_select" on public.push_subscriptions;
create policy "push_subscriptions_own_select" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "push_subscriptions_own_insert" on public.push_subscriptions;
create policy "push_subscriptions_own_insert" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "push_subscriptions_own_update" on public.push_subscriptions;
create policy "push_subscriptions_own_update" on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "push_subscriptions_own_delete" on public.push_subscriptions;
create policy "push_subscriptions_own_delete" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, delete on public.notice_attachments to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
