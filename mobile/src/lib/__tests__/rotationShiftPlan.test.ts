// The plan-backed half of the rotation shift, against a real (faked) database.
//
// rotationShift.test.ts covers the pure sequencing. This covers what actually
// ships: shiftPlanRotation re-stamping upcoming sessions, and — the part that
// is easy to get wrong and impossible to see in a unit test — persisting
// user_plans.rotation_offset so the NEXT generated block continues in the new
// order instead of seaming back to the old one at the horizon.

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
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { createFakeSupabase } from './fakeSupabase'
import { rotateTemplates, shiftPlanRotation, getPlanRotation } from '@/lib/generatePlan'
import { rotationDeltaFor } from '@/lib/rotationShift'
import { toDateStr } from '@/lib/dates'

const USER = 'user-1'
const PLAN = 'plan-1'

// Names matter: the slot classifier keys off them, so these have to read like
// real exercises or every template comes back empty and nothing re-stamps.
function exercisePool() {
  const ex = (id: string, name: string, pattern: string, primary: string[]) => ({
    id, name, movement_pattern: pattern, experience_level: 'beginner',
    required_equipment: ['full_gym'], primary_muscles: primary, secondary_muscles: [],
    is_core: true, popularity: 50, user_id: null,
  })
  return [
    // Push. Two h_push, because PUSH_DAY fills that slot twice in one session.
    ex('bench', 'Barbell Bench Press', 'push', ['chest']),
    ex('incline', 'Incline Dumbbell Press', 'push', ['chest']),
    ex('ohp', 'Overhead Press', 'push', ['shoulders']),
    ex('fly', 'Cable Fly', 'push', ['chest']),
    ex('latraise', 'Lateral Raise', 'push', ['shoulders']),
    ex('pushdown', 'Triceps Pushdown', 'push', ['triceps']),
    // Pull. Two h_pull and two biceps for the same reason.
    ex('pulldown', 'Lat Pulldown', 'pull', ['lats']),
    ex('row', 'Barbell Row', 'pull', ['lats']),
    ex('cablerow', 'Seated Cable Row', 'pull', ['lats']),
    ex('facepull', 'Face Pull', 'pull', ['rear_delts']),
    ex('curl', 'Barbell Curl', 'pull', ['biceps']),
    ex('hammer', 'Hammer Curl', 'pull', ['biceps']),
    // Legs.
    ex('squat', 'Barbell Back Squat', 'squat', ['quads']),
    ex('front', 'Front Squat', 'squat', ['quads']),
    ex('rdl', 'Romanian Deadlift', 'hinge', ['hamstrings']),
    ex('lunge', 'Walking Lunge', 'squat', ['quads']),
    ex('legcurl', 'Leg Curl', 'hinge', ['hamstrings']),
    ex('legext', 'Leg Extension', 'squat', ['quads']),
    ex('calf', 'Standing Calf Raise', 'squat', ['calves']),
    // Core.
    ex('plank', 'Plank', 'core', ['abs']),
    ex('hlr', 'Hanging Leg Raise', 'core', ['abs']),
  ]
}

// Six days a week, muscle gain => templates are Push/Pull/Legs/Push/Pull/Legs.
// This is the founder's own configuration.
function profile() {
  return {
    user_id: USER, goal: 'muscle_gain', experience: 'intermediate',
    equipment: ['full_gym'], days_per_week: 6, preferred_duration_min: 60,
    preferred_time_of_day: 'morning', include_cardio: false,
    unavailable_blocks: [], training_days: [], injuries: [],
  }
}

const day = (n: number) => toDateStr(new Date(Date.now() + n * 864e5))

/** Upcoming sessions from tomorrow, carrying `focuses` in order. */
function upcoming(focuses: string[]) {
  return focuses.map((focus, i) => ({
    id: `w${i}`, user_id: USER, user_plan_id: PLAN, source: 'plan',
    status: 'scheduled', focus, planned_date: day(i + 1),
    planned_start_time: '07:00:00', planned_duration_min: 60,
    week_index: 0, week_offset: 0, exercise_ids: [],
  }))
}

function tables(focuses: string[], rotationOffset = 0) {
  return {
    user_plans: [{
      id: PLAN, user_id: USER, status: 'active', start_date: day(-28),
      adaptation_mode: 'normal', rotation_offset: rotationOffset,
      created_at: day(-28),
    }],
    user_profiles: [profile()],
    exercises: exercisePool(),
    scheduled_workouts: upcoming(focuses),
  } as any
}

const focusesIn = (t: any) =>
  [...t.scheduled_workouts]
    .sort((a: any, b: any) => a.planned_date.localeCompare(b.planned_date))
    .map((r: any) => r.focus)

describe('shiftPlanRotation', () => {
  it('makes the missed session the next one and slides the rest', async () => {
    // Monday's Push was missed. What remains is Pull/Legs/Push/Pull/Legs.
    const t = tables(['Pull', 'Legs', 'Push', 'Pull', 'Legs'])
    const client = createFakeSupabase(t)

    // "Do Push next": Push is position 0, the next session currently holds 1.
    const delta = rotationDeltaFor(1, 0, 6)
    const changed = await shiftPlanRotation(client, USER, delta)

    expect(changed).toBeGreaterThan(0)
    expect(focusesIn(t)).toEqual(['Push', 'Pull', 'Legs', 'Push', 'Pull'])
  })

  it('leaves every date and time untouched — it rotates content, not the calendar', async () => {
    const t = tables(['Pull', 'Legs', 'Push', 'Pull', 'Legs'])
    const before = t.scheduled_workouts.map((r: any) => `${r.planned_date} ${r.planned_start_time}`)
    const client = createFakeSupabase(t)

    await shiftPlanRotation(client, USER, rotationDeltaFor(1, 0, 6))

    const after = t.scheduled_workouts.map((r: any) => `${r.planned_date} ${r.planned_start_time}`)
    expect(after).toEqual(before)
  })

  it('gives each re-stamped session real exercises for its NEW focus', async () => {
    const t = tables(['Pull', 'Legs', 'Push', 'Pull', 'Legs'])
    const client = createFakeSupabase(t)
    await shiftPlanRotation(client, USER, rotationDeltaFor(1, 0, 6))

    const first = t.scheduled_workouts.find((r: any) => r.id === 'w0')
    expect(first.focus).toBe('Push')
    expect(first.exercise_ids.length).toBeGreaterThan(0)
    // A Push day must not come back full of rows and curls.
    const pullOnly = ['pulldown', 'row', 'cablerow', 'curl', 'hammer']
    expect(first.exercise_ids.some((id: string) => pullOnly.includes(id))).toBe(false)
  })

  it('persists rotation_offset so the next generated block continues the new order', async () => {
    // This is the seam the offset exists to prevent: re-stamping alone does not
    // change the row COUNT, so the next rollover would resume from the original
    // alignment and put two Push days back to back.
    const t = tables(['Pull', 'Legs', 'Push', 'Pull', 'Legs'])
    const client = createFakeSupabase(t)
    await shiftPlanRotation(client, USER, rotationDeltaFor(1, 0, 6))
    expect(t.user_plans[0].rotation_offset).toBe(5) // back one == forward five
  })

  it('accumulates across repeated shifts rather than resetting', async () => {
    const t = tables(['Pull', 'Legs', 'Push', 'Pull', 'Legs'], 5)
    const client = createFakeSupabase(t)
    await shiftPlanRotation(client, USER, 5)
    expect(t.user_plans[0].rotation_offset).toBe(4) // (5 + 5) mod 6
  })

  it('re-anchors to any focus the user picks, not just a missed one', async () => {
    // "Cancel push, I'm on legs." Next currently holds Push (0), target Legs (2).
    const t = tables(['Push', 'Pull', 'Legs', 'Push', 'Pull'])
    const client = createFakeSupabase(t)
    await shiftPlanRotation(client, USER, rotationDeltaFor(0, 2, 6))
    expect(focusesIn(t)).toEqual(['Legs', 'Push', 'Pull', 'Legs', 'Push'])
  })

  describe('safety', () => {
    it('is a no-op for a zero delta — no writes, no offset change', async () => {
      const t = tables(['Pull', 'Legs', 'Push'])
      const client = createFakeSupabase(t)
      expect(await shiftPlanRotation(client, USER, 0)).toBe(0)
      expect(focusesIn(t)).toEqual(['Pull', 'Legs', 'Push'])
      expect(t.user_plans[0].rotation_offset).toBe(0)
    })

    it('is a no-op for a full-cycle delta', async () => {
      const t = tables(['Pull', 'Legs', 'Push'])
      const client = createFakeSupabase(t)
      expect(await shiftPlanRotation(client, USER, 6)).toBe(0)
      expect(focusesIn(t)).toEqual(['Pull', 'Legs', 'Push'])
    })

    it('never touches sessions already completed or missed', async () => {
      const t = tables(['Pull', 'Legs', 'Push', 'Pull', 'Legs'])
      t.scheduled_workouts.push(
        { id: 'done', user_id: USER, user_plan_id: PLAN, source: 'plan', status: 'completed',
          focus: 'Push', planned_date: day(-1), planned_start_time: '07:00:00', week_index: 0, exercise_ids: [] },
        { id: 'gone', user_id: USER, user_plan_id: PLAN, source: 'plan', status: 'missed',
          focus: 'Push', planned_date: day(-2), planned_start_time: '07:00:00', week_index: 0, exercise_ids: [] },
      )
      const client = createFakeSupabase(t)
      await shiftPlanRotation(client, USER, rotationDeltaFor(1, 0, 6))

      expect(t.scheduled_workouts.find((r: any) => r.id === 'done').focus).toBe('Push')
      expect(t.scheduled_workouts.find((r: any) => r.id === 'gone').focus).toBe('Push')
    })

    it('returns 0 rather than throwing when there is no active plan', async () => {
      const t = tables(['Pull', 'Legs'])
      t.user_plans = []
      const client = createFakeSupabase(t)
      expect(await shiftPlanRotation(client, USER, 1)).toBe(0)
    })

    it('returns 0 when nothing is scheduled ahead', async () => {
      const t = tables([])
      const client = createFakeSupabase(t)
      expect(await shiftPlanRotation(client, USER, 1)).toBe(0)
    })

    it('ignores a non-finite delta', async () => {
      const t = tables(['Pull', 'Legs', 'Push'])
      const client = createFakeSupabase(t)
      expect(await shiftPlanRotation(client, USER, NaN)).toBe(0)
      expect(t.user_plans[0].rotation_offset).toBe(0)
    })
  })
})

describe('getPlanRotation', () => {
  it('reports the cycle and where the next session sits in it', async () => {
    const client = createFakeSupabase(tables(['Pull', 'Legs', 'Push', 'Pull', 'Legs']))
    const state = await getPlanRotation(client, USER)
    expect(state).not.toBeNull()
    expect(state!.cycle).toEqual(['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs'])
    expect(state!.nextIndex).toBe(1) // Pull
    expect(state!.upcoming).toHaveLength(5)
  })

  it('reflects an already-shifted plan', async () => {
    const client = createFakeSupabase(tables(['Legs', 'Push', 'Pull'], 2))
    const state = await getPlanRotation(client, USER)
    expect(state!.cycle).toEqual(['Legs', 'Push', 'Pull', 'Legs', 'Push', 'Pull'])
  })

  it('returns null when there is no plan to rotate', async () => {
    const t = tables(['Pull'])
    t.user_plans = []
    expect(await getPlanRotation(createFakeSupabase(t), USER)).toBeNull()
  })
})

describe('rotateTemplates', () => {
  const abc = ['a', 'b', 'c', 'd']

  it('rotates left by the offset', () => {
    expect(rotateTemplates(abc, 1)).toEqual(['b', 'c', 'd', 'a'])
    expect(rotateTemplates(abc, 3)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('treats a zero or full-cycle offset as identity', () => {
    expect(rotateTemplates(abc, 0)).toEqual(abc)
    expect(rotateTemplates(abc, 4)).toEqual(abc)
    expect(rotateTemplates(abc, 8)).toEqual(abc)
  })

  it('normalises a negative offset instead of producing holes', () => {
    expect(rotateTemplates(abc, -1)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('survives corrupt input', () => {
    expect(rotateTemplates(abc, NaN)).toEqual(abc)
    expect(rotateTemplates(abc, Infinity)).toEqual(abc)
    expect(rotateTemplates([], 3)).toEqual([])
  })
})

describe('rotationDeltaFor', () => {
  it('expresses "make this position next" as a forward slide', () => {
    expect(rotationDeltaFor(1, 0, 6)).toBe(5) // back one == forward five
    expect(rotationDeltaFor(0, 2, 6)).toBe(2)
    expect(rotationDeltaFor(3, 3, 6)).toBe(0) // already there
  })

  it('is total over nonsense input', () => {
    expect(rotationDeltaFor(1, 0, 0)).toBe(0)
    expect(rotationDeltaFor(NaN, 0, 6)).toBe(0)
    expect(rotationDeltaFor(1, NaN, 6)).toBe(0)
  })
})
