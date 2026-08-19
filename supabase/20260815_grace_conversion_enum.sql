-- 희월 정산 (grace conversion), part 1/2: new warning_entries.entry_type value.
--
-- Postgres can't use a new enum value in the same transaction it was added in, so this is split
-- from 20260815_grace_conversion_constraint.sql -- run this one first, on its own.
alter type public.warning_entry_type add value if not exists 'grace_conversion';
