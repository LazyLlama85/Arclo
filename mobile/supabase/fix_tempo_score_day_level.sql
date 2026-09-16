-- Arclo — Tempo Score counts DAYS, not sessions.
--
-- Founder, 2026-09-15, on his own score of 287: "I don't make my full goal of 6
-- workouts but I get about 4, sometimes I skip my planned workout to schedule
-- the one I wanna do, my score shouldn't be punished for this."
--
-- His data over 28 days: 36 sessions came due across only 26 distinct days. A
-- plan schedules more sessions than there are training days, because a swapped-in
-- session sits alongside the one it replaced. Counting SESSIONS charged him twice
-- for one decision — the abandoned session scored a miss AND the workout he
-- actually did scored a completion — so choosing his own session lowered his
-- score. Completion is a question about days: on a day you had a commitment, did
-- you train?
--
-- This mirrors the client change in lib/tempoScore.ts; the two MUST agree or a
-- user's own score disagrees with the one their friends see on the leaderboard.
-- Only due_28 / completed_28 change (now distinct planned_date). The weekly
-- columns already counted distinct days for active_days_this_week.
--
-- It does not weaken the anti-gaming rule: piling extra sessions onto days you
-- do not train cannot raise a day-level ratio.
create or replace function public.friends_leaderboard_v2()
returns table (
  user_id uuid, display_name text, avatar_url text, username text,
  scheduled_this_week bigint, completed_this_week bigint, active_days_this_week bigint,
  current_streak int,
  due_28 bigint, completed_28 bigint, weeks_met_goal int, goal_per_week int
)
language sql stable security definer set search_path = public as $$
  with members as (
    select case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end as uid
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
    union
    select auth.uid()
  )
  select
    p.user_id, p.display_name, p.avatar_url, p.username,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status in ('completed', 'missed', 'skipped')) as scheduled_this_week,
    (select count(*) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status = 'completed') as completed_this_week,
    (select count(distinct sw.planned_date) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= date_trunc('week', current_date)::date
        and sw.status = 'completed') as active_days_this_week,
    public.current_session_streak(p.user_id) as current_streak,
    -- DAYS that carried a commitment which came due.
    (select count(distinct sw.planned_date) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= current_date - 27 and sw.planned_date <= current_date
        and sw.status in ('completed', 'missed', 'skipped')) as due_28,
    -- DAYS you actually trained.
    (select count(distinct sw.planned_date) from public.scheduled_workouts sw
      where sw.user_id = p.user_id
        and sw.planned_date >= current_date - 27 and sw.planned_date <= current_date
        and sw.status = 'completed') as completed_28,
    (select count(*)::int
      from generate_series(0, 3) as g(w)
      where (select count(distinct sw.planned_date) from public.scheduled_workouts sw
              where sw.user_id = p.user_id and sw.status = 'completed'
                and sw.planned_date >= current_date - (g.w * 7 + 6)
                and sw.planned_date <= current_date - (g.w * 7))
            >= greatest(1, ceil(0.6 * coalesce(nullif(p.days_per_week, 0), 3)))) as weeks_met_goal,
    coalesce(nullif(p.days_per_week, 0), 3) as goal_per_week
  from members m
  join public.user_profiles p on p.user_id = m.uid
  where auth.uid() is not null
    and (p.user_id = auth.uid() or p.privacy_stats in ('public', 'friends'));
$$;
revoke execute on function public.friends_leaderboard_v2() from public, anon;
grant execute on function public.friends_leaderboard_v2() to authenticated;
