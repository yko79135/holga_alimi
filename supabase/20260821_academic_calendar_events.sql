-- Extends academic_calendar_exceptions from "closure-only" to a general day-entry model: each
-- date can be a school closure (is_closure=true, shown red in the UI) and/or carry an event
-- description (label), matching the admin calendar editor's Google-Calendar-style day popup where
-- both are set independently for any day. Existing rows were always closures, so backfill true.
alter table public.academic_calendar_exceptions add column if not exists is_closure boolean not null default true;

-- Historic PDF-parsed labels carried a redundant "(휴교)" suffix now that closure is shown via
-- color instead of text; strip it from already-saved rows (future parses no longer add it).
update public.academic_calendar_exceptions
set label = coalesce(nullif(trim(regexp_replace(label, '\s*\(\s*휴교\s*\)', '', 'g')), ''), '휴교')
where label ~ '\(\s*휴교\s*\)';

notify pgrst, 'reload schema';
