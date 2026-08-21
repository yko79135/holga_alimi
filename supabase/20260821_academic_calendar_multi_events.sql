-- academic_calendar_exceptions used "date" as its primary key, so two different events (e.g. a
-- multi-day 중간고사 and a one-off 종교개혁 기념일) could never both land on the same date -- the
-- second insert would just fail/overwrite the first. Real school calendars routinely have this
-- (see the reference PDF: 중간고사 26-30 overlaps 종교개혁 기념일 on the 30th), so switch to a
-- surrogate id and let "date" be a plain (non-unique) indexed column.
alter table public.academic_calendar_exceptions add column if not exists id uuid not null default gen_random_uuid();
alter table public.academic_calendar_exceptions drop constraint if exists academic_calendar_exceptions_pkey;
alter table public.academic_calendar_exceptions add constraint academic_calendar_exceptions_pkey primary key (id);
create index if not exists academic_calendar_exceptions_date_idx on public.academic_calendar_exceptions (date);
create index if not exists academic_calendar_exceptions_year_idx on public.academic_calendar_exceptions (academic_year);

notify pgrst, 'reload schema';
