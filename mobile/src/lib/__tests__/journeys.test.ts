// End-to-end journeys through the real modules, no phone required.
//
// These are the tests that would have caught this session's bugs. Each one is a
// short story about a person, not a call to one function, because every serious
// defect found recently lived in the seam between two modules that each passed
// their own unit tests.
//
// If you are adding a feature, add a journey here that uses it AFTER something
// else, and then keep using the app afterwards. The bugs live in "and then".

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

import { createWorld, destroyWorld } from './harness/world'
import { getPlanRotation, shiftPlanRotation } from '@/lib/generatePlan'
import { rotationDeltaFor } from '@/lib/rotationShift'
import { summarizeDay, type DayWorkoutStatus } from '@/lib/dayStatus'

afterEach(() => destroyWorld())

describe('journey: a busy lifter misses Monday', () => {
  it('marks it missed, then "do Push next" slides the whole rotation', async () => {
    const world = createWorld() // 6-day PPLPPL, sessions start tomorrow

    // Monday's Push is tomorrow. Let it pass untouched.
    world.advanceDays(2)
    await world.openApp()

    const missed = world.schedule().filter(s => s.status === 'missed')
    expect(missed).toHaveLength(1)
    expect(missed[0].focus).toBe('Push')

    // The app offers to put Push next.
    const rot = (await getPlanRotation(world.client as never, world.userId))!
    expect(rot).not.toBeNull()
    const target = rot.cycle.indexOf('Push')
    const delta = rotationDeltaFor(rot.nextIndex, target, rot.cycle.length)
    const shifted = await shiftPlanRotation(world.client as never, world.userId, delta)
    expect(shifted.length).toBeGreaterThan(0)

    // The very next session he has is now Push.
    expect(world.upcoming()[0].focus).toBe('Push')
  })

  it('does not leave a seam when the plan later rolls over', async () => {
    // The bug rotation_offset exists to prevent: re-stamping does not change the
    // plan's row COUNT, so a rollover that ignored the stored slide would resume
    // the ORIGINAL alignment and butt two identical focuses together.
    const world = createWorld()
    world.advanceDays(2)
    await world.openApp()

    const rot = (await getPlanRotation(world.client as never, world.userId))!
    await shiftPlanRotation(
      world.client as never, world.userId,
      rotationDeltaFor(rot.nextIndex, rot.cycle.indexOf('Push'), rot.cycle.length),
    )

    // Run the app forward until the plan has to generate more sessions.
    world.advanceDays(5)
    await world.openApp()

    const live = world.schedule().filter(s => s.status === 'scheduled')
    expect(live.length).toBeGreaterThan(6) // rollover actually produced more

    // A Push/Pull/Legs rotation never trains the same focus twice in a row.
    // That single invariant catches the seam wherever it appears.
    const focuses = live.map(s => s.focus.replace(/\s*\(Deload\)$/, ''))
    for (let i = 1; i < focuses.length; i++) {
      expect(`${focuses[i - 1]} -> ${focuses[i]}`).not.toBe(`${focuses[i]} -> ${focuses[i]}`)
    }
  })
})

describe('journey: the session that never got its Finish tap', () => {
  it('counts as trained, not missed, once the day ends', async () => {
    // Phone died on the last set. The sets are in the database; the Finish tap
    // never happened. Calling that "missed" breaks the streak AND feeds
    // refreshAdaptation, which reads repeated misses as a reason to cut volume.
    const world = createWorld()
    const session = world.upcoming()[0]

    world.advanceDays(1)      // it is now that session's day
    world.logSets(session.id) // he trains, and logs three sets
    world.advanceDays(1)      // the day ends
    await world.openApp()

    expect(world.schedule().find(s => s.id === session.id)!.status).toBe('completed')
  })

  it('still counts an opened-but-untrained session as missed', async () => {
    const world = createWorld()
    const session = world.upcoming()[0]

    world.advanceDays(1)
    world.logSets(session.id, 0) // opened the session, logged nothing, left
    world.advanceDays(1)
    await world.openApp()

    expect(world.schedule().find(s => s.id === session.id)!.status).toBe('missed')
  })
})

describe('journey: trained something other than what was planned', () => {
  it('the day still reads as trained', async () => {
    const world = createWorld()
    const planned = world.upcoming()[0]

    world.advanceDays(1)
    // He skips the planned Push and does his own session instead.
    world.tables.scheduled_workouts.push({
      id: 'own', user_id: world.userId, user_plan_id: null, split_id: null,
      source: 'quick', status: 'completed', focus: 'Quick · Arms',
      planned_date: planned.date, planned_start_time: '18:00:00',
      planned_duration_min: 30, exercise_ids: ['curl'],
      calendar_event_id: null, calendar_provider: null,
    })
    world.advanceDays(1)
    await world.openApp()

    // The planned one is missed; the one he did is completed.
    const day = world.on(planned.date)
    expect(day.map(s => s.status).sort()).toEqual(['completed', 'missed'])

    // And the calendar paints it green, because he trained.
    const summary = summarizeDay(day.map(s => s.status as DayWorkoutStatus))
    expect(summary).toEqual({ trained: true, missed: false })
  })
})

describe('journey: the rotation shift keeps its satellites honest', () => {
  it('hands back everything needed to re-point the calendar event and reminder', async () => {
    // Both embed the focus in their text, so a rename that skips them leaves the
    // phone announcing a session the user no longer has.
    const world = createWorld()
    world.tables.scheduled_workouts[0].calendar_event_id = 'evt-1'
    world.tables.scheduled_workouts[0].calendar_provider = 'device'

    world.advanceDays(2)
    await world.openApp()

    const rot = (await getPlanRotation(world.client as never, world.userId))!
    const shifted = await shiftPlanRotation(
      world.client as never, world.userId,
      rotationDeltaFor(rot.nextIndex, rot.cycle.indexOf('Push'), rot.cycle.length),
    )

    for (const s of shifted) {
      expect(s.focus).toBeTruthy()
      expect(s.planned_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(s.planned_start_time).toBeTruthy()
      // The focus handed back is the NEW one, or the calendar would be rebuilt
      // with the name we just moved away from.
      const row = world.tables.scheduled_workouts.find((r: any) => r.id === s.id)
      expect(s.focus).toBe(row.focus)
    }
  })

  it('offers nothing at all while the user is travelling', async () => {
    // travelSchedule stashes pre-travel exercises and writes them back verbatim
    // when travel ends, which would land the OLD focus's exercises on a renamed
    // session.
    const world = createWorld()
    world.advanceDays(2)
    await world.openApp()

    world.tables.user_profiles[0].travel_mode = {
      equipment: ['dumbbells'], until: '2026-12-01', label: 'Hotel',
    }
    expect(await getPlanRotation(world.client as never, world.userId)).toBeNull()
  })
})
