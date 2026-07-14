-- Allow authenticated teacher/admin warning saves through normal RLS-protected Supabase clients.
-- warning_entries remains an append-only signed-adjustment ledger; corrections INSERT negative deltas.

alter table public.warning_change_batches enable row level security;
alter table public.warning_entries enable row level security;
alter table public.warning_generated_notices enable row level security;

drop policy if exists "warning_batches_staff_insert" on public.warning_change_batches;
create policy "warning_batches_staff_insert" on public.warning_change_batches
for insert to authenticated
with check (public.is_staff() and author_id = (select auth.uid()));

drop policy if exists "warning_batches_staff_update" on public.warning_change_batches;
create policy "warning_batches_staff_update" on public.warning_change_batches
for update to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "warning_entries_staff_insert" on public.warning_entries;
create policy "warning_entries_staff_insert" on public.warning_entries
for insert to authenticated
with check (public.is_staff() and author_id = (select auth.uid()));

drop policy if exists "warning_generated_notices_staff_insert" on public.warning_generated_notices;
create policy "warning_generated_notices_staff_insert" on public.warning_generated_notices
for insert to authenticated
with check (public.is_staff());

drop policy if exists "warning_generated_notices_staff_update" on public.warning_generated_notices;
create policy "warning_generated_notices_staff_update" on public.warning_generated_notices
for update to authenticated
using (public.is_staff())
with check (public.is_staff());

grant insert, update on public.warning_change_batches to authenticated;
grant insert on public.warning_entries to authenticated;
grant insert, update on public.warning_generated_notices to authenticated;
