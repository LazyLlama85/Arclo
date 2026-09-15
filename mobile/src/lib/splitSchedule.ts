// Tempo — materialize a split into scheduled workouts.
//
// Activating a split lays its weekly weekday→workout pattern onto the calendar as
// ordinary `scheduled_workouts` rows (source='split'). This is the split analogue of
// generatePlan's insert loop: same row shape, so the feed/runner/auto-scheduler all
// work unchanged. It's idempotent over a rolling horizon — safe to re-run on app
// open to extend the window as days pass.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Experience, Split, SplitDay, TimeOfDay, WorkoutExerciseConfig } from '@/types'
import { autoScheduleUpcoming, autoSchedulingEnabled } from './autoSchedule'
import { estimateSessionMin } from './durationEstimate'
import { fetchActiveSplit, setActiveSplit, ensureAutoSplit, isAutoSplit } from './splits'
import { generatePlan, type PlanProfile } from './generatePlan'
import {
  chooseSessionStart, toMinutes, minutesToTime, type AvailabilityInputs,
} from '@/lib/availability'
import { sweepScheduledPlanRows } from './retireWorkouts'
import { toDateStr } from './dates'
import { fetchExcludedExerciseIds } from './exerciseExclusions'

const HORIZON_DAYS = 28

// Candidate start times per time-of-day (mirrors generatePlan). These are only
// CANDIDATES: chooseSessionStart keeps whichever the user can actually make given
// wake time, work and school. Before 2026-09-02 this array was used directly, so a
// split could land a session inside school hours exactly like the plan generator
// did — the same bug, in a second place, because the table was duplicated here.
const START_TIMES: Record<TimeOfDay, string[]> = {
  morning:   ['07:00:00', '08:00:00', '06:30:00', '07:30:00'],
  afternoon: ['12:30:00', '15:30:00', '13:00:00', '16:00:00'],
  evening:   ['17:30:00', '18:30:00', '19:00:00', '18:00:00'],
}
// 'HH:MM:SS', local time — comparable directly against planned_start_time.
function nowTimeStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
// ISO weekday 1=Mon … 7=Sun.
function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1
}

/** Wake/bed/work/school for this user, best-effort — defaults are safe. */
async function fetchAvailability(client: SupabaseClient, userId: string): Promise<AvailabilityInputs> {
  try {
    const { data } = await client
      .from('user_profiles')
      .select('wake_time, bedtime, work_start, work_end, school_start, school_end, unavailable_blocks')
      .eq('user_id', userId)
      .maybeSingle()
    return {
      wake_time: (data?.wake_time ?? null) as string | null,
      bedtime: (data?.bedtime ?? null) as string | null,
      work_start: (data?.work_start ?? null) as string | null,
      work_end: (data?.work_end ?? null) as string | null,
      school_start: (data?.school_start ?? null) as string | null,
      school_end: (data?.school_end ?? null) as string | null,
      unavailable_blocks: (data?.unavailable_blocks ?? []) as AvailabilityInputs['unavailable_blocks'],
    }
  } catch {
    return {}
  }
}

/** A start time the user can actually make, preferring their usual hours. */
function startTimeFor(
  times: string[], idx: number, weekday: number, durationMin: number, av: AvailabilityInputs,
): string {
  const rotated = times.map((_, i) => times[(i + idx) % times.length])
  const fallback = Object.values(START_TIMES).flat()
  const candidates = [...rotated, ...fallback]
    .map(t => toMinutes(t))
    .filter((m): m is number => m != null)
  const chosen = chooseSessionStart({ candidates, weekday, durationMin, av })
  return chosen != null ? minutesToTime(chosen) : rotated[0]
}

function estimateDurationMin(config: WorkoutExerciseConfig[]): number {
  return estimateSessionMin(config.map((c) => ({
    sets: c.sets,
    workSec: c.metrics?.includes('duration') && c.duration_sec ? c.duration_sec : null,
    restSec: null,
  })))
}

// Insert split workouts for any date in the rolling horizon that doesn't already
// have one. Returns how many were inserted.
export async function materializeSplit(
  client: SupabaseClient,
  userId: string,
  split: Split,
  preferredTimeOfDay: TimeOfDay | null,
): Promise<number> {
  // The auto (program) mirror is a read-only *projection* of the active plan — the
  // plan already owns those sessions as source='plan' rows (and rolls them forward
  // via extendActivePlan). Materializing the mirror would lay down duplicate
  // source='split' sessions on top of every plan day. Never do it; the mirror is only
  // ever "activated" by regenerating the plan (activateAutoPlan), not materialized.
  if (isAutoSplit(split)) return 0

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const horizonEnd = new Date(today); horizonEnd.setDate(today.getDate() + HORIZON_DAYS)

  // Permanently-excluded exercises (removed from within a live session — see
  // exerciseExclusions.ts) never get re-materialized, even though the split's
  // own saved day config still lists them; filtering here means the split's
  // JSON never needs to be found and rewritten.
  const excluded = await fetchExcludedExerciseIds(client, userId)
  const byWeekday = new Map<number, SplitDay>()
  for (const d of split.days) {
    if (!excluded.size || !d.exercise_ids?.length) { byWeekday.set(d.weekday, d); continue }
    byWeekday.set(d.weekday, {
      ...d,
      exercise_ids: d.exercise_ids.filter((id) => !excluded.has(id)),
      config: d.config?.filter((c) => !excluded.has(c.exercise_id)),
    })
  }
  // Nothing to place if every day is rest/empty (post-exclusion).
  const hasWork = [...byWeekday.values()].some((d) => !d.rest && (d.exercise_ids?.length ?? 0) > 0)
  if (!hasWork) return 0

  // Split days this split already owns in the horizon → skip (idempotent re-runs).
  // A 'skipped' row (the user removed just that one day) is deliberately NOT
  // "taken" — it reads as open again so this fill naturally re-adds it on the
  // next run, instead of leaving a manually-removed day permanently empty.
  // 'rescheduled' rows (superseded by a plan/split change or a dedupe pass)
  // stay excluded — those really are gone, not just a single skipped day.
  //
  // Coverage is keyed on split_origin_date (the day the row was materialized
  // FOR) rather than planned_date (where it currently sits). Keying on the
  // current position was a real duplication bug: any mover that changes
  // planned_date — the missed-workout reschedule, "reschedule my whole week",
  // "delay my week", the hourly server-side retime-sessions, a manual edit —
  // left the origin day looking empty, so the next app open re-inserted the
  // session it had just moved. See add_split_origin_date.sql.
  //
  // The read window is widened either side of the horizon because a MOVED row
  // can sit outside the window its origin belongs to; without the padding a
  // session shifted across the boundary would look uncovered again. Rows
  // predating the migration fall back to planned_date, which is exactly what
  // the backfill set them to.
  const readFrom = new Date(today); readFrom.setDate(today.getDate() - 14)
  const readTo = new Date(horizonEnd); readTo.setDate(horizonEnd.getDate() + 14)
  const { data: existing } = await client
    .from('scheduled_workouts')
    .select('planned_date, split_origin_date')
    .eq('user_id', userId)
    .eq('split_id', split.id)
    .neq('status', 'skipped')
    .gte('planned_date', toDateStr(readFrom))
    .lte('planned_date', toDateStr(readTo))
  const taken = new Set(
    (existing ?? []).map((r: any) => (r.split_origin_date as string | null) ?? (r.planned_date as string)),
  )

  const tod = preferredTimeOfDay ?? 'morning'
  const times = START_TIMES[tod]
  const nowStr = nowTimeStr()
  // Read availability here rather than taking it as an argument: materializeSplit
  // has four call sites and the point is that none of them can forget it.
  const availability = await fetchAvailability(client, userId)
  const rows: object[] = []
  let idx = 0
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = new Date(today); date.setDate(today.getDate() + i)
    const dateStr = toDateStr(date)
    if (taken.has(dateStr)) { idx++; continue }
    const day = byWeekday.get(isoWeekday(date))
    if (!day || day.rest || !(day.exercise_ids?.length)) continue
    // Today specifically: don't lay down a session whose natural slot has already
    // passed — a split activated/built late in the day would otherwise read as
    // overdue within minutes (mirrors generatePlan.ts's identical same-day guard).
    const config = day.config ?? []
    const durationMin = estimateDurationMin(config)
    const startTime = startTimeFor(times, idx, isoWeekday(date), durationMin, availability)
    if (i === 0 && startTime <= nowStr) { idx++; continue }
    rows.push({
      user_id: userId,
      user_plan_id: null,
      split_id: split.id,
      planned_date: dateStr,
      // The day this session was materialized FOR. Written once here and never
      // rewritten — movers only ever change planned_date — so this stays the
      // stable identity of "which split day is this", which is what keeps
      // re-runs idempotent after a session has been moved.
      split_origin_date: dateStr,
      planned_start_time: startTime,
      planned_duration_min: durationMin,
      focus: day.label || 'Workout',
      status: 'scheduled',
      source: 'split',
      exercise_ids: day.exercise_ids,
      exercise_config: config,
    })
    idx++
  }
  if (!rows.length) return 0

  const { error } = await client.from('scheduled_workouts').insert(rows)
  if (error) throw error
  return rows.length
}

// Activate a split: it becomes the user's schedule. Clears the generated plan's and
// any other split's FUTURE scheduled rows (completed/missed history + ad-hoc Quick
// Workouts are kept), marks the split active, materializes it, and — in auto mode —
// places the new sessions at calendar-aware times.
//
// The old schedule is retired BEFORE the new one is inserted, so a failure between
// the two must not masquerade as "nothing happened": once the split is active,
// materialization failing (gym wifi, mid-chain drop) returns 'activated_pending' —
// the split IS the schedule now, and refreshActiveSplit lays the sessions down on
// the next app open. Callers must tell the user that, not "try again".
export type ActivateSplitResult = 'activated' | 'activated_pending' | 'failed'

export async function activateSplit(
  client: SupabaseClient,
  userId: string,
  split: Split,
  profile: { preferred_time_of_day?: TimeOfDay | null; scheduling_mode?: string } | null,
): Promise<ActivateSplitResult> {
  try {
    // Retire the generated plan so the calendar doesn't show both.
    const { error: abandonErr } = await client
      .from('user_plans')
      .update({ status: 'abandoned' })
      .eq('user_id', userId)
      .eq('status', 'active')
    if (abandonErr) return 'failed'

    // Retire today-forward, not-yet-done plan/split sessions (other sources are
    // user one-offs) via the same FK-safe sweep generatePlan uses — a bulk DELETE
    // dies on any session the user ever started (workout_logs FK), which used to
    // leave the old schedule behind UNDER the new one.
    await sweepScheduledPlanRows(client, userId)

    if (!(await setActiveSplit(client, userId, split.id))) return 'failed'

    // Re-fetch so we materialize the freshly-activated row (is_active true). From
    // here the split is active: a failure below is a scheduling delay, not a
    // failed activation.
    try {
      const active = await fetchActiveSplit(client, userId)
      await materializeSplit(client, userId, active ?? { ...split, is_active: true }, profile?.preferred_time_of_day ?? null)
    } catch {
      return 'activated_pending'
    }

    if (autoSchedulingEnabled(profile)) {
      try { await autoScheduleUpcoming(client, userId) } catch { /* keep default times */ }
    }
    return 'activated'
  } catch {
    return 'failed'
  }
}

// Activate the auto-generated program (the kind='auto' mirror split). Unlike a
// custom split, this REGENERATES the periodized plan from the user's current
// profile — schedule, equipment, injuries — rather than materializing a static
// weekly copy, so the mesocycle/deload logic is preserved. generatePlan clears any
// active plan + splits first, then ensureAutoSplit re-marks the mirror active.
export async function activateAutoPlan(
  client: SupabaseClient,
  userId: string,
  profile: {
    goal?: Goal | null; experience?: Experience | null; equipment?: string[] | null
    days_per_week?: number | null; preferred_duration_min?: number | null
    preferred_time_of_day?: TimeOfDay | null; scheduling_mode?: string
  } | null,
): Promise<boolean> {
  try {
    const planProfile: PlanProfile = {
      goal: (profile?.goal ?? 'general_fitness') as Goal,
      experience: (profile?.experience ?? 'beginner') as Experience,
      equipment: (profile?.equipment ?? []) as string[],
      days_per_week: profile?.days_per_week ?? 3,
      preferred_duration_min: profile?.preferred_duration_min ?? 45,
      preferred_time_of_day: profile?.preferred_time_of_day ?? null,
    }
    await generatePlan(client, userId, planProfile)      // also runs ensureAutoSplit
    await ensureAutoSplit(client, userId, planProfile.goal)
    if (autoSchedulingEnabled(profile)) {
      try { await autoScheduleUpcoming(client, userId) } catch { /* keep default times */ }
    }
    return true
  } catch {
    return false
  }
}

// Roll the horizon forward for the active split, if any. Cheap + idempotent — safe
// to call on app open. Returns inserted count (0 when no active split).
export async function refreshActiveSplit(
  client: SupabaseClient,
  userId: string,
  preferredTimeOfDay: TimeOfDay | null,
): Promise<number> {
  const active = await fetchActiveSplit(client, userId)
  // No active split, or the active "split" is the auto plan mirror (owned by the plan,
  // not materialized here — see materializeSplit): nothing to roll forward.
  if (!active || isAutoSplit(active)) return 0
  return materializeSplit(client, userId, active, preferredTimeOfDay)
}

// ── "This day, going forward" — N2, founder-requested 2026-08-02 ────────────
//
// The scope-clarity fix for add/swap/remove on a split-sourced workout. Before
// this, "permanent" only ever rewrote the split TEMPLATE (`splits.days`) — but
// materializeSplit above only ever INSERTS a row for a date that doesn't have
// one yet; it never re-syncs an ALREADY-materialized row after the template
// changes. So a "permanent" edit made today silently had no effect on any of
// the next ~4 weeks' worth of already-scheduled instances of that same
// weekday (the entire rolling HORIZON_DAYS window) — it only took effect on
// whatever gets freshly materialized past that horizon, which reads to a user
// as "I permanently added it and NONE of my upcoming Fridays show it." This
// function is the real fix: it updates the template (for the far future) AND
// every already-scheduled, not-yet-done instance of that weekday from today
// forward (for the near future), so "going forward" actually means what it
// says on every day it's supposed to.
export type SplitDayEditOp =
  | { type: 'add'; exerciseId: string }
  | { type: 'remove'; exerciseId: string }
  | { type: 'swap'; fromId: string; toId: string }

function applyOpToIds(ids: string[], op: SplitDayEditOp): string[] {
  switch (op.type) {
    case 'add': return ids.includes(op.exerciseId) ? ids : [...ids, op.exerciseId]
    case 'remove': return ids.filter((id) => id !== op.exerciseId)
    case 'swap': return ids.includes(op.fromId) ? ids.map((id) => (id === op.fromId ? op.toId : id)) : ids
  }
}

/**
 * Apply an add/remove/swap OPERATION (not a final exercise list) to a split
 * day, going forward: the template, plus every already-materialized,
 * not-yet-done instance of `weekday` from today onward. Operation-based
 * (rather than "copy this session's current list everywhere") on purpose —
 * two different days of the same weekday can already carry independent
 * customizations (e.g. Friday's Pull day was swapped differently from
 * Monday's), and this must never clobber one day's own edits just because
 * another day's edit is now going forward. Best-effort per row; a failure on
 * one instance never blocks the others or the template.
 */
export async function propagateSplitDayEdit(
  client: SupabaseClient,
  userId: string,
  splitId: string,
  weekday: number,
  op: SplitDayEditOp,
): Promise<void> {
  try {
    const { data: splitRow } = await client.from('splits').select('*').eq('id', splitId).maybeSingle()
    if (splitRow) {
      const split = splitRow as Split
      const days = split.days.map((day) => {
        if (day.weekday !== weekday || day.rest) return day
        return { ...day, exercise_ids: applyOpToIds(day.exercise_ids ?? [], op) }
      })
      await client.from('splits').update({ days }).eq('id', splitId)
    }
  } catch { /* the already-materialized rows below still carry the edit */ }

  try {
    const today = toDateStr(new Date())
    const { data: rows } = await client
      .from('scheduled_workouts')
      .select('id, planned_date, exercise_ids')
      .eq('user_id', userId)
      .eq('split_id', splitId)
      .eq('status', 'scheduled')
      .gte('planned_date', today)
    for (const row of (rows ?? []) as { id: string; planned_date: string; exercise_ids: string[] | null }[]) {
      const d = new Date(`${row.planned_date}T00:00:00`)
      const rowWeekday = ((d.getDay() + 6) % 7) + 1
      if (rowWeekday !== weekday) continue
      const nextIds = applyOpToIds(row.exercise_ids ?? [], op)
      // .then(ok, err) not try/catch per-row — one row's failure must not abort
      // the loop and leave the rest of the week's instances stale.
      await client.from('scheduled_workouts').update({ exercise_ids: nextIds }).eq('id', row.id).then(() => {}, () => {})
    }
  } catch { /* template update above still lands; best-effort on the rest */ }
}
