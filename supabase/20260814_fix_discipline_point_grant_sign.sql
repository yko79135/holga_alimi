-- app/api/warnings/grant/route.ts previously stored discipline-point grants (the "훈계 점수"
-- dropdown tab) with delta = -points while new_value = points and previous_value = 0. That
-- breaks the delta = new_value - previous_value invariant the rest of the app relies on: the
-- grid-based "정정" flow, points-stats totals, and parent notice text all sum `delta` directly.
-- Every discipline point given through that tab was silently *subtracting* from the student's
-- displayed discipline total instead of adding, and its change_type was mislabeled "correction"
-- instead of "addition". Code fix: app/api/warnings/grant/route.ts.
--
-- This backfills existing rows written by that buggy code path. The predicate only matches rows
-- that currently violate the invariant, restricted to discipline-kind grant entries (identified
-- by category being set and previous_value being the grant flow's hardcoded 0) -- grid-based
-- entries already satisfy the invariant and are left untouched.
--
-- Note: this corrects the ledger (points-stats, future totals) but cannot retroactively fix the
-- text of notices already sent to parents -- those were generated with the wrong total baked in
-- as static text at send time.
update public.warning_entries
set delta = new_value - previous_value,
    change_type = 'addition'
where kind = 'discipline'
  and category is not null
  and previous_value = 0
  and delta <> (new_value - previous_value);
