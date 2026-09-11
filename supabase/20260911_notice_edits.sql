-- 20260904_notice_type_preparation.sql 다음에 실행한다.
--
-- 발송한 알림의 제목·내용·첨부파일을 나중에 고칠 수 있게 한다. 이미 읽은 학부모가 바뀐 글을
-- 모르고 지나치지 않도록, 언제 누가 고쳤는지를 알림에 함께 남긴다.
-- 다시 실행해도 안전하다.

alter table public.notices
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references public.profiles(id);

comment on column public.notices.edited_at is '발송 후 제목·내용·첨부파일을 마지막으로 고친 시각. 한 번도 고치지 않았으면 null.';
comment on column public.notices.edited_by is '마지막으로 고친 교사/관리자.';

notify pgrst, 'reload schema';
