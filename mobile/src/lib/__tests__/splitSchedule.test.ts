// Regression coverage (B5.5 continuation) for splitSchedule.ts — the OTHER
// caller of the shared sweep (retireWorkouts.sweepScheduledPlanRows) that,
// together with generatePlan.ts, is what the audit's "poisoned Change Plan"
// bug class is about: a stranded 'scheduled' row from an old plan/split
// blocking the new schedule's insert. retireWorkouts.test.ts already locks
// the sweep itself; this locks the caller that activates a SPLIT specifically.

import { createFakeSupabase } from './fakeSupabase'
import { activateSplit, materializeSplit, propagateSplitDayEdit } from '@/lib/splitSchedule'
import type { Split, SplitDay } from '@/types'

jest.mock('@/services/calendarSync', () => ({
  removeWorkoutFromCalendar: jest.fn().mockResolvedValue(undefined),
  addWorkoutToCalendar: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/notifications', () => ({
  cancelWorkoutReminder: jest.fn().mockResolvedValue(undefined),
  scheduleWorkoutReminders: jest.fn().mockResolvedValue(undefined),
  hasReminderPermission: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/services/googleCalendar/CalendarAuthService', () => ({
  isGoogleCalendarConnected: jest.fn().mockResolvedValue(false),
  getGoogleAccessToken: jest.fn().mockResolvedValue(null),
  invalidateGoogleAccessToken: jest.fn(),
}))
jest.mock('@/services/calendarService', () => ({
  getBusyBlocks: jest.fn().mockResolvedValue([]),
  getCalendarPermissionStatus: jest.fn().mockResolvedValue('denied'),
}))
jest.mock('@/lib/crashReporting', () => ({
  captureApiError: jest.fn(),
  captureException: jest.fn(),
}))

const USER = 'user-1'
const TODAY = '2026-07-20' // Monday

function splitDay(over: Partial<SplitDay>): SplitDay {
  return { weekday: 1, label: 'Push', rest: false, exercise_ids: ['ex1'], config: [], ...over }
}

function split(over: Partial<Split> = {}): Split {
  return {
    id: 'split-1', user_id: USER, name: 'My Split', is_active: false,
    kind: 'custom', created_at: TODAY, updated_at: TODAY,
    days: [1, 2, 3, 4, 5, 6, 7].map((wd) => splitDay({ weekday: wd, rest: wd > 5 })),
    ...over,
  }
}

function workoutRow(over: Partial<Record<string, any>>) {
  return {
    id: 'w1', user_id: USER, focus: 'Push', planned_date: TODAY, planned_start_time: '09:00:00',
    planned_duration_min: 45, calendar_event_id: null, calendar_provider: null,
    status: 'scheduled', user_plan_id: null, source: 'custom', split_id: null,
    ...over,
  }
}

describe('materializeSplit', () => {
  // Early morning: every START_TIMES slot (morning/afternoon/evening) is still
  // ahead of "now", so the same-day past-time guard (tested on its own below)
  // never interferes with these skip/retire assertions.
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T05:00:00`)) })
  afterEach(() => { jest.useRealTimers() })

  it('inserts a row for each non-rest weekday in the 28-day horizon, and none for rest days', async () => {
    const client = createFakeSupabase({ scheduled_workouts: [] })
    const s = split() // Sat/Sun are rest days in this fixture
    const n = await materializeSplit(client, USER, s, 'morning')
    expect(n).toBeGreaterThan(0)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(rows.every((r: any) => r.split_id === s.id)).toBe(true)
    expect(rows.every((r: any) => r.source === 'split')).toBe(true)
    const weekdays = new Set(rows.map((r: any) => ((new Date(`${r.planned_date}T00:00:00`).getDay() + 6) % 7) + 1))
    expect(weekdays.has(6)).toBe(false)
    expect(weekdays.has(7)).toBe(false)
  })

  it('is idempotent — a date the split already owns is never duplicated on re-run', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [workoutRow({ id: 'existing', split_id: 'split-1', planned_date: TODAY })],
    })
    await materializeSplit(client, USER, split(), 'morning')
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('existing')
  })

  it('skips creating TODAY\'s session when its natural slot has already passed — never surface an already-gone window as "today\'s workout"', async () => {
    jest.setSystemTime(new Date(`${TODAY}T12:00:00`)) // noon — every morning slot is behind us
    const client = createFakeSupabase({ scheduled_workouts: [] })
    await materializeSplit(client, USER, split(), 'morning')
    const todayRows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    expect(todayRows).toHaveLength(0)
    // Future days are unaffected — the guard only ever applies to day 0.
    const allRows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(allRows.length).toBeGreaterThan(0)
  })

  // ── split_origin_date: a MOVED session is still "covered" ────────────────
  //
  // The bug: coverage used to be keyed on planned_date, i.e. "does some row sit
  // on this date". Every mover in the app changes planned_date (missed-workout
  // reschedule, reschedule/delay my week, the hourly server-side retime, a
  // manual edit), which left the origin day looking empty — so the next app
  // open cheerfully re-inserted the very session that had just been moved.
  // Symptom: move Monday's Push to Tuesday, reopen the app, and Monday has a
  // Push again. The move reads as undone and the week is over-scheduled.
  it('does not re-create a session that was MOVED off its origin day', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [
        // Materialized for Monday, since moved to Tuesday. Origin stays Monday.
        workoutRow({
          id: 'moved', split_id: 'split-1',
          planned_date: '2026-07-21', split_origin_date: TODAY,
        }),
      ],
    })
    await materializeSplit(client, USER, split(), 'morning')

    const mondayRows = (await client.from('scheduled_workouts').select('*')
      .eq('user_id', USER).eq('planned_date', TODAY)).data
    expect(mondayRows).toHaveLength(0)

    // Exactly one row still descends from Monday — the one we moved.
    const fromMonday = (await client.from('scheduled_workouts').select('*')
      .eq('user_id', USER).eq('split_origin_date', TODAY)).data
    expect(fromMonday).toHaveLength(1)
    expect(fromMonday[0].id).toBe('moved')
  })

  it('stamps split_origin_date on every row it creates', async () => {
    const client = createFakeSupabase({ scheduled_workouts: [] })
    await materializeSplit(client, USER, split(), 'morning')
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(rows.length).toBeGreaterThan(0)
    // Written once, equal to the day it was materialized for.
    expect(rows.every((r: any) => r.split_origin_date === r.planned_date)).toBe(true)
  })

  it('falls back to planned_date for rows predating the migration', async () => {
    // Backfill sets split_origin_date = planned_date, but a row written by an
    // older client between migration and app update can still be null. Such a
    // row must still count as covering the day it sits on, or the duplication
    // bug reopens for exactly those users.
    const client = createFakeSupabase({
      scheduled_workouts: [
        workoutRow({ id: 'legacy', split_id: 'split-1', planned_date: TODAY, split_origin_date: null }),
      ],
    })
    await materializeSplit(client, USER, split(), 'morning')
    const rows = (await client.from('scheduled_workouts').select('*')
      .eq('user_id', USER).eq('planned_date', TODAY)).data
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('legacy')
  })

  it('never materializes the auto-plan mirror (that would duplicate plan-owned sessions)', async () => {
    const client = createFakeSupabase({ scheduled_workouts: [] })
    const n = await materializeSplit(client, USER, split({ kind: 'auto' }), 'morning')
    expect(n).toBe(0)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER)).data
    expect(rows).toHaveLength(0)
  })

  it('is a no-op when every day is rest (nothing to place)', async () => {
    const client = createFakeSupabase({ scheduled_workouts: [] })
    const allRest = split({ days: [1, 2, 3, 4, 5, 6, 7].map((wd) => splitDay({ weekday: wd, rest: true })) })
    const n = await materializeSplit(client, USER, allRest, 'morning')
    expect(n).toBe(0)
  })

  it('re-adds a day the user removed (status skipped) instead of treating it as permanently taken', async () => {
    // Regression: a skipped day used to block this fill forever — "delete a
    // workout" had no way back except adding it manually.
    const client = createFakeSupabase({
      scheduled_workouts: [workoutRow({ id: 'removed', split_id: 'split-1', planned_date: TODAY, status: 'skipped' })],
    })
    const n = await materializeSplit(client, USER, split(), 'morning')
    expect(n).toBeGreaterThan(0)
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    // Both rows now exist: the old skipped one (untouched, kept for history) and
    // a fresh 'scheduled' one filling the day back in.
    expect(rows.some((r: any) => r.status === 'skipped')).toBe(true)
    expect(rows.some((r: any) => r.status === 'scheduled' && r.split_id === 'split-1')).toBe(true)
  })

  it('never re-adds a day marked rescheduled — that row is genuinely superseded, not just skipped', async () => {
    const client = createFakeSupabase({
      scheduled_workouts: [workoutRow({ id: 'superseded', split_id: 'split-1', planned_date: TODAY, status: 'rescheduled' })],
    })
    await materializeSplit(client, USER, split(), 'morning')
    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    // Still just the one row — a 'rescheduled' date reads as taken, same as before this fix.
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('superseded')
  })
})

describe('activateSplit — the poisoned-Change-Plan scenario, for splits', () => {
  // Early morning: every START_TIMES slot (morning/afternoon/evening) is still
  // ahead of "now", so the same-day past-time guard (tested on its own below)
  // never interferes with these skip/retire assertions.
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T05:00:00`)) })
  afterEach(() => { jest.useRealTimers() })

  const MANUAL = { scheduling_mode: 'manual', preferred_time_of_day: 'morning' as const }

  it('retires a stranded plan row on TODAY before materializing the new split on the same date (the exact race that used to poison Change Plan)', async () => {
    const client = createFakeSupabase({
      user_plans: [{ id: 'plan-1', user_id: USER, status: 'active' }],
      splits: [{ ...split(), is_active: false }],
      scheduled_workouts: [
        // Stranded row from the OLD plan, same date the new split will want to use.
        workoutRow({ id: 'old-plan-row', user_plan_id: 'plan-1', planned_date: TODAY, source: 'plan' }),
      ],
      workout_logs: [],
    })

    const result = await activateSplit(client, USER, split(), MANUAL)
    expect(result).toBe('activated')

    const rows = (await client.from('scheduled_workouts').select('*').eq('user_id', USER).eq('planned_date', TODAY)).data
    // The old plan row is gone (retired), and exactly one row — the new split's —
    // occupies today. Never both: that collision is exactly what poisoned Change Plan.
    expect(rows.find((r: any) => r.id === 'old-plan-row')).toBeUndefined()
    expect(rows.some((r: any) => r.split_id === 'split-1')).toBe(true)
  })

  it('marks the old active plan abandoned', async () => {
    const client = createFakeSupabase({
      user_plans: [{ id: 'plan-1', user_id: USER, status: 'active' }],
      splits: [{ ...split(), is_active: false }],
      scheduled_workouts: [],
      workout_logs: [],
    })
    await activateSplit(client, USER, split(), MANUAL)
    const plans = (await client.from('user_plans').select('*').eq('user_id', USER)).data
    expect(plans[0].status).toBe('abandoned')
  })

  it('deactivates a previously-active split when activating a new one', async () => {
    const client = createFakeSupabase({
      user_plans: [],
      splits: [
        { ...split({ id: 'old-split' }), is_active: true },
        { ...split({ id: 'split-1' }), is_active: false },
      ],
      scheduled_workouts: [],
      workout_logs: [],
    })
    await activateSplit(client, USER, split(), MANUAL)
    const splits = (await client.from('splits').select('*').eq('user_id', USER)).data
    const oldOne = splits.find((s: any) => s.id === 'old-split')
    const newOne = splits.find((s: any) => s.id === 'split-1')
    expect(oldOne.is_active).toBe(false)
    expect(newOne.is_active).toBe(true)
  })

  it('returns "failed" without touching the schedule when abandoning the old plan fails', async () => {
    const client = createFakeSupabase(
      {
        user_plans: [{ id: 'plan-1', user_id: USER, status: 'active' }],
        splits: [{ ...split(), is_active: false }],
        scheduled_workouts: [],
        workout_logs: [],
      },
      { failOps: new Set(['user_plans.update']) },
    )
    const result = await activateSplit(client, USER, split(), MANUAL)
    expect(result).toBe('failed')
  })
})

describe('propagateSplitDayEdit — N2 "this day, going forward" (2026-08-02)', () => {
  // materializeSplit only ever INSERTS a row for an open date — it never
  // re-syncs an already-materialized one after the template changes. Without
  // this function, a "permanent" edit made today would have zero effect on
  // any already-scheduled instance of the same weekday within the rolling
  // horizon (the next ~4 weeks) — only on whatever gets freshly materialized
  // past it. These tests lock the fix: both the template AND every already-
  // scheduled, not-yet-done instance of the SAME weekday update, while a
  // DIFFERENT weekday, a PAST instance, and an already-completed instance are
  // all left alone — and a sibling day's own independent customization
  // survives, since the operation applies to each row's own current list,
  // never a copy of the calling session's list.
  const NEXT_MONDAY = '2026-07-27'
  const A_THURSDAY = '2026-07-23'   // weekday 4 — must never be touched by a weekday-1 edit
  const A_PAST_MONDAY = '2026-07-13' // before TODAY — must never be touched

  function fixture() {
    return {
      splits: [split({
        days: [1, 2, 3, 4, 5, 6, 7].map((wd) => splitDay({ weekday: wd, rest: wd > 5, exercise_ids: ['ex1'] })),
      })],
      scheduled_workouts: [
        workoutRow({ id: 'today', split_id: 'split-1', planned_date: TODAY, exercise_ids: ['ex1'] }),
        // A sibling Monday already has its OWN extra exercise — an
        // operation-based propagation must preserve it, not overwrite it.
        workoutRow({ id: 'next-monday', split_id: 'split-1', planned_date: NEXT_MONDAY, exercise_ids: ['ex1', 'ex-extra'] }),
        workoutRow({ id: 'thursday', split_id: 'split-1', planned_date: A_THURSDAY, exercise_ids: ['ex1'] }),
        workoutRow({ id: 'past-monday', split_id: 'split-1', planned_date: A_PAST_MONDAY, exercise_ids: ['ex1'] }),
        workoutRow({ id: 'completed-monday', split_id: 'split-1', planned_date: TODAY, status: 'completed', exercise_ids: ['ex1'] }),
      ],
    }
  }

  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T09:00:00`)) })
  afterEach(() => { jest.useRealTimers() })

  it('an "add" propagates to the template and every already-scheduled instance of the same weekday, preserving a sibling day\'s own customization', async () => {
    const client = createFakeSupabase(fixture())
    await propagateSplitDayEdit(client, USER, 'split-1', 1, { type: 'add', exerciseId: 'ex-new' })

    const splits = (await client.from('splits').select('*').eq('id', 'split-1')).data
    const mondayTemplate = (splits[0].days as SplitDay[]).find((d) => d.weekday === 1)!
    expect(mondayTemplate.exercise_ids).toEqual(['ex1', 'ex-new'])

    const rows = (await client.from('scheduled_workouts').select('*').eq('split_id', 'split-1')).data
    const byId = new Map(rows.map((r: any) => [r.id, r]))
    expect(byId.get('today').exercise_ids).toEqual(['ex1', 'ex-new'])
    // The sibling Monday's pre-existing 'ex-extra' survives — the op applied
    // to ITS OWN list, not a copy of today's.
    expect(byId.get('next-monday').exercise_ids).toEqual(['ex1', 'ex-extra', 'ex-new'])
    expect(byId.get('thursday').exercise_ids).toEqual(['ex1'])       // untouched — different weekday
    expect(byId.get('past-monday').exercise_ids).toEqual(['ex1'])    // untouched — before today
    expect(byId.get('completed-monday').exercise_ids).toEqual(['ex1']) // untouched — not 'scheduled'
  })

  it('a "remove" only removes the id where present, on the template and every matching-weekday scheduled instance', async () => {
    const client = createFakeSupabase(fixture())
    await propagateSplitDayEdit(client, USER, 'split-1', 1, { type: 'remove', exerciseId: 'ex1' })

    const splits = (await client.from('splits').select('*').eq('id', 'split-1')).data
    const mondayTemplate = (splits[0].days as SplitDay[]).find((d) => d.weekday === 1)!
    expect(mondayTemplate.exercise_ids).toEqual([])

    const rows = (await client.from('scheduled_workouts').select('*').eq('split_id', 'split-1')).data
    const byId = new Map(rows.map((r: any) => [r.id, r]))
    expect(byId.get('today').exercise_ids).toEqual([])
    expect(byId.get('next-monday').exercise_ids).toEqual(['ex-extra']) // only ex1 removed, ex-extra stays
    expect(byId.get('thursday').exercise_ids).toEqual(['ex1'])        // untouched
  })

  it('a "swap" only replaces the id where present, leaving a row that never had it unaffected', async () => {
    const client = createFakeSupabase(fixture())
    await propagateSplitDayEdit(client, USER, 'split-1', 1, { type: 'swap', fromId: 'ex1', toId: 'ex2' })

    const rows = (await client.from('scheduled_workouts').select('*').eq('split_id', 'split-1')).data
    const byId = new Map(rows.map((r: any) => [r.id, r]))
    expect(byId.get('today').exercise_ids).toEqual(['ex2'])
    expect(byId.get('next-monday').exercise_ids).toEqual(['ex2', 'ex-extra'])
    expect(byId.get('thursday').exercise_ids).toEqual(['ex1']) // different weekday, untouched
  })
})
