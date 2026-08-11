-- Run AFTER 20260811_notice_type_praise_custom.sql (this references the 'custom' enum value
-- added there, which cannot be used in the same transaction it was added in).

alter table public.notices add column if not exists custom_type_label text;

alter table public.notices drop constraint if exists notice_custom_type_label_required;
alter table public.notices add constraint notice_custom_type_label_required check (
  (type = 'custom' and custom_type_label is not null and length(trim(custom_type_label)) > 0)
  or type <> 'custom'
);
