-- 희월 정산 (grace conversion), part 2/2: run this after
-- 20260815_grace_conversion_enum.sql has been committed (separate statement/transaction, since
-- Postgres won't let a freshly-added enum value be used before that).
--
-- Automatic monthly-ish settlement that converts accumulated praise points into a reduction of
-- discipline points (20 praise points -> 1 grace unit -> -1 discipline point). Reuses
-- warning_entries/warning_change_batches rather than a new table: the conversion amount is
-- derived by summing existing praise/discipline deltas (including any prior grace_conversion
-- entries, which already reduced those sums), so no separate "carryover balance" state needs to
-- be tracked -- see app/api/warnings/grace-settlement/route.ts.
alter table public.warning_entries drop constraint if exists warning_daily_date_required;
alter table public.warning_entries add constraint warning_daily_date_required check (
  (entry_type = 'daily' and warning_date is not null)
  or (entry_type in ('grace_adjustment', 'grace_conversion') and warning_date is null)
);

notify pgrst, 'reload schema';
