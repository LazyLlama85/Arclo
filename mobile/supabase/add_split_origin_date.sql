-- Arclo — remember WHICH split day a scheduled row came from, not just when it landed.
--
-- The bug this fixes (found 2026-09-14 while designing the missed-session
-- rotation work, but live today and independent of it):
--
-- materializeSplit is idempotent by comparing the split's weekday pattern
-- against the set of dates that already have a row:
--
--     taken = { planned_date of this split's rows in the horizon }
--     for each date in horizon: if !taken.has(date) -> insert byWeekday[date]
--
-- That is only correct while nothing ever MOVES a session. The moment any
-- mover changes planned_date (the missed-workout reschedule, "reschedule my
-- whole week", "delay my week", the hourly server-side retime-sessions, or a
-- manual edit), the origin date goes empty, materializeSplit sees a hole where
-- its pattern says there should be a workout, and inserts a BRAND NEW one.
--
-- Net effect today: move Monday's Push to Tuesday and the next app open can
-- silently hand you a second Push back on Monday. The move looks undone, and
-- the week is now over-scheduled. It is quiet because the duplicate is a
-- legitimately-shaped row on a legitimately-patterned day.
--
-- split_origin_date is the date the row was materialized FOR — written once at
-- insert and never rewritten by any mover (movers only touch planned_date).
-- Coverage is then keyed on origin rather than current position, so a moved
-- session still counts as "this split day is handled" and no duplicate is
-- created.
--
-- Backfilled from planned_date: correct for every existing row precisely
-- because, before this column existed, a row that had moved was already
-- indistinguishable from one that had not. This establishes the invariant
-- going forward rather than trying to reconstruct history it cannot know.
alter table public.scheduled_workouts
  add column if not exists split_origin_date date;

update public.scheduled_workouts
set split_origin_date = planned_date
where split_id is not null
  and split_origin_date is null;

-- materializeSplit's coverage read is (user_id, split_id, split_origin_date
-- range) on every app open, for every split user.
create index if not exists scheduled_workouts_split_origin_idx
  on public.scheduled_workouts (user_id, split_id, split_origin_date)
  where split_id is not null;
