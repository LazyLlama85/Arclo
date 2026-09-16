// Arclo — a simulated user you can run the real app against.
//
// WHY THIS EXISTS. The unit suite is excellent at "does this function compute
// the right number" and blind to "do these six modules still agree". Every
// serious bug found in the 2026-09 sessions lived in the second category:
//
//   • materializeSplit re-created a session that another module had moved,
//     because one keyed on the date and the other on the day it came from.
//   • A rotation shift renamed sessions while the calendar event and the
//     reminder kept the old name.
//   • A rotation shift during travel mode would have let travel_restore write
//     the previous focus's exercises onto a renamed session.
//
// None of those are visible from inside a single module, and none of them need
// a phone to find. They need a user with a schedule, a few days passing, and
// two features used in sequence. That is what this is.
//
// WHAT IT IS NOT. It does not render React, so it proves nothing about whether
// a button appears or a screen crashes. It runs the real lib modules against
// the in-memory fake client, so it proves that the DATA the app produces is
// coherent after a realistic sequence of events.

import { createFakeSupabase } from '../fakeSupabase'
import { toDateStr } from '@/lib/dates'
import { checkMissedWorkouts } from '@/lib/missedWorkouts'
import { dedupeScheduledWorkouts } from '@/lib/dedupeSchedule'
import { extendActivePlan } from '@/lib/generatePlan'

export const USER = 'harness-user'
export const PLAN = 'harness-plan'

export interface SessionView {
  id: string
  date: string
  focus: string
  status: string
  source: string
  exerciseIds: string[]
}

export interface WorldOptions {
  /** 'YYYY-MM-DD' the simulation starts on. Defaults to a fixed Monday. */
  today?: string
  goal?: string
  experience?: string
  daysPerWeek?: number
  equipment?: string[]
  /** Focus labels for the sessions to seed, starting tomorrow, one per day. */
  upcoming?: string[]
}

// Real exercise names, because the slot classifier keys off them — a pool of
// "ex1/ex2/ex3" silently produces empty sessions and green tests that prove
// nothing. Covers every slot the Push/Pull/Legs templates fill, twice where a
// template uses the same slot twice in one session.
export function exercisePool() {
  const ex = (id: string, name: string, pattern: string, primary: string[]) => ({
    id, name, movement_pattern: pattern, experience_level: 'beginner',
    required_equipment: ['full_gym'], primary_muscles: primary, secondary_muscles: [],
    is_core: true, popularity: 50, user_id: null,
  })
  return [
    ex('bench', 'Barbell Bench Press', 'push', ['chest']),
    ex('incline', 'Incline Dumbbell Press', 'push', ['chest']),
    ex('ohp', 'Overhead Press', 'push', ['shoulders']),
    ex('fly', 'Cable Fly', 'push', ['chest']),
    ex('latraise', 'Lateral Raise', 'push', ['shoulders']),
    ex('pushdown', 'Triceps Pushdown', 'push', ['triceps']),
    ex('pulldown', 'Lat Pulldown', 'pull', ['lats']),
    ex('row', 'Barbell Row', 'pull', ['lats']),
    ex('cablerow', 'Seated Cable Row', 'pull', ['lats']),
    ex('facepull', 'Face Pull', 'pull', ['rear_delts']),
    ex('curl', 'Barbell Curl', 'pull', ['biceps']),
    ex('hammer', 'Hammer Curl', 'pull', ['biceps']),
    ex('squat', 'Barbell Back Squat', 'squat', ['quads']),
    ex('front', 'Front Squat', 'squat', ['quads']),
    ex('rdl', 'Romanian Deadlift', 'hinge', ['hamstrings']),
    ex('lunge', 'Walking Lunge', 'squat', ['quads']),
    ex('legcurl', 'Leg Curl', 'hinge', ['hamstrings']),
    ex('legext', 'Leg Extension', 'squat', ['quads']),
    ex('calf', 'Standing Calf Raise', 'squat', ['calves']),
    ex('plank', 'Plank', 'core', ['abs']),
    ex('hlr', 'Hanging Leg Raise', 'core', ['abs']),
  ]
}

export interface World {
  client: ReturnType<typeof createFakeSupabase>
  tables: Record<string, any[]>
  userId: string
  /** 'YYYY-MM-DD' the simulated clock currently reads. */
  today(): string
  /** Move the simulated clock forward. Uses jest fake timers, so the caller
   *  must be inside a test that installed them (`world.start()` does it). */
  advanceDays(n: number): void
  /** Run the same maintenance chain the app runs on open. */
  openApp(): Promise<void>
  /** Log real sets against a session without "completing" it — a session whose
   *  Finish tap never happened. */
  logSets(sessionId: string, count?: number): void
  /** Mark a session finished the way the runner does. */
  complete(sessionId: string): void
  /** Every session, date-ascending, in a form that reads well in an assertion. */
  schedule(): SessionView[]
  /** Sessions on or after today, date-ascending. */
  upcoming(): SessionView[]
  /** Sessions on a given day. */
  on(date: string): SessionView[]
}

const DEFAULT_TODAY = '2026-09-14' // a Monday

export function createWorld(opts: WorldOptions = {}): World {
  const start = opts.today ?? DEFAULT_TODAY
  const daysPerWeek = opts.daysPerWeek ?? 6
  const focuses = opts.upcoming ?? ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs']

  jest.useFakeTimers().setSystemTime(new Date(`${start}T05:00:00`))

  const dayFrom = (base: string, n: number) =>
    toDateStr(new Date(new Date(`${base}T00:00:00`).getTime() + n * 864e5))

  const tables: Record<string, any[]> = {
    user_profiles: [{
      user_id: USER,
      goal: opts.goal ?? 'muscle_gain',
      experience: opts.experience ?? 'intermediate',
      equipment: opts.equipment ?? ['full_gym'],
      days_per_week: daysPerWeek,
      preferred_duration_min: 60,
      preferred_time_of_day: 'morning',
      include_cardio: false,
      unavailable_blocks: [], training_days: [], injuries: [],
      paused_until: null, travel_mode: null,
    }],
    // start_date must agree with the seeded sessions' week_offset, or the seed
    // is internally inconsistent and extendActivePlan generates a block that
    // overlaps dates that already have sessions. Real Postgres would reject
    // that on the partial unique index; the fake happily accepts it, and the
    // resulting two-sessions-per-day schedule makes every downstream assertion
    // meaningless. Sessions are seeded at start+1..start+6 with week_offset 0,
    // so the plan starts on `start` and the rollover generates week 1 onward.
    user_plans: [{
      id: PLAN, user_id: USER, status: 'active',
      start_date: start, adaptation_mode: 'normal',
      rotation_offset: 0, created_at: start,
    }],
    exercises: exercisePool(),
    scheduled_workouts: focuses.map((focus, i) => ({
      id: `s${i}`, user_id: USER, user_plan_id: PLAN, split_id: null,
      source: 'plan', status: 'scheduled', focus,
      planned_date: dayFrom(start, i + 1),
      planned_start_time: '07:00:00', planned_duration_min: 60,
      week_index: 0, week_offset: 0, exercise_ids: ['bench'],
      calendar_event_id: null, calendar_provider: null,
    })),
    workout_logs: [],
    set_logs: [],
  }

  const client = createFakeSupabase(tables as never)
  let logSeq = 0

  const view = (r: any): SessionView => ({
    id: r.id, date: r.planned_date, focus: r.focus,
    status: r.status, source: r.source, exerciseIds: r.exercise_ids ?? [],
  })
  const sorted = () =>
    [...tables.scheduled_workouts].sort(
      (a, b) => a.planned_date.localeCompare(b.planned_date) ||
                String(a.planned_start_time).localeCompare(String(b.planned_start_time)),
    )

  const world: World = {
    client, tables, userId: USER,

    today: () => toDateStr(new Date()),

    advanceDays(n) {
      const next = new Date(new Date().getTime() + n * 864e5)
      jest.setSystemTime(next)
    },

    // Mirrors the order in app/(tabs)/index.tsx: dedupe and the missed sweep
    // both run BEFORE extendActivePlan, because either can clear a stale
    // 'scheduled' row that would otherwise block the rollover's insert for that
    // date. If that screen's order changes, change it here too — this is a
    // deliberate duplicate of a sequence that has no single home yet.
    async openApp() {
      await dedupeScheduledWorkouts(client as never, USER)
      await checkMissedWorkouts(client as never, USER)
      await extendActivePlan(client as never, USER)
    },

    logSets(sessionId, count = 3) {
      const logId = `log-${++logSeq}`
      tables.workout_logs.push({
        id: logId, user_id: USER, scheduled_workout_id: sessionId,
        started_at: new Date().toISOString(), completed_at: null,
      })
      for (let i = 0; i < count; i++) {
        tables.set_logs.push({
          id: `${logId}-set-${i}`, workout_log_id: logId,
          exercise_id: 'bench', set_number: i + 1,
          weight_lbs: 135, reps_completed: 8,
          completed_at: new Date().toISOString(),
        })
      }
    },

    complete(sessionId) {
      world.logSets(sessionId)
      const row = tables.scheduled_workouts.find((r: any) => r.id === sessionId)
      if (row) {
        row.status = 'completed'
        row.completed_at = new Date().toISOString()
      }
    },

    schedule: () => sorted().map(view),
    upcoming() {
      const t = world.today()
      return sorted().filter((r: any) => r.planned_date >= t).map(view)
    },
    on: (date) => sorted().filter((r: any) => r.planned_date === date).map(view),
  }

  return world
}

/** Restore real timers. Call in afterEach. */
export function destroyWorld(): void {
  jest.useRealTimers()
}
