// Selecting several Target Areas must return all of them, in even shares.
//
// Founder, 2026-09-27: "it gives so many random exercises that aren't balanced to
// the selected muscle groups. If you select core arms and other stuff, it gives
// mostly core and some random exercises."
//
// Four causes, all covered here:
//
//  1. One tier for the whole union. The screen flattened every selected chip into
//     a single `targetMuscles` array and `filterByMuscle` resolved
//     dominant-or-loose ONCE across it, so an area with no dominant match for the
//     user's equipment contributed nothing while a well-stocked area filled the
//     session. Core has the most bodyweight staples in the catalogue, so Core won.
//  2. Slots were allocated by MOVEMENT PATTERN, and patterns aren't areas: Arms
//     owns push + pull, Legs owns squat + hinge, Core owns one. Worse, the pattern
//     list was `new Set(pool.map(e => e.movement_pattern))` — raw table order — so
//     which area got the extra share was decided by nothing at all.
//  3. Schedule avoidance was applied on top of an explicit request, and BEFORE the
//     muscle filter, so "Legs" could not return a leg exercise on a week where
//     legs were scheduled. Its floor only fired when all four resistance patterns
//     were gone; three of four still collapsed the pool.
//  4. The Cardio chip was inert when combined with a muscle chip, because
//     `forcePatterns` replaced the priority list that `targetPattern` fed.

jest.mock('@/lib/moveWorkout', () => ({ resyncMovedWorkout: jest.fn() }))
jest.mock('@/lib/crashReporting', () => ({ captureApiError: jest.fn(), captureException: jest.fn() }))

import { createFakeSupabase } from './fakeSupabase'
import { toDateStr } from '@/lib/dates'
import {
  composeRestrictions, generateQuickWorkout, getScheduleRestrictions, resolveTargetAreas,
} from '@/lib/quickWorkout'
import type { ProfileForQuick, QuickMinutes, QuickPurpose } from '@/lib/quickWorkout'

const USER = 'user-1'
const GYM: ProfileForQuick = {
  goal: 'muscle_gain', experience: 'intermediate', equipment: ['full_gym', 'barbell', 'dumbbells'],
}
const NO_EQUIPMENT: ProfileForQuick = { goal: 'general_fitness', experience: 'beginner', equipment: [] }

function ex(
  id: string, name: string, pattern: string, primary: string[],
  group: string, opts: { equipment?: string[]; secondary?: string[] } = {},
) {
  return {
    id, name, movement_pattern: pattern,
    primary_muscles: primary, secondary_muscles: opts.secondary ?? [],
    required_equipment: opts.equipment ?? ['full_gym'], experience_level: 'beginner',
    is_core: true, popularity: 60, muscle_group: group, user_id: null,
  }
}

// Ids are prefixed by area so a session can be classified by what it actually
// trained rather than by re-deriving muscle membership in the assertions.
const CATALOGUE = [
  // Legs — two patterns, so "did Legs get balanced internally" is testable.
  ex('legs-squat-1', 'Barbell Back Squat', 'squat', ['quads'], 'legs', { secondary: ['glutes'] }),
  ex('legs-squat-2', 'Leg Press', 'squat', ['quads'], 'legs'),
  ex('legs-squat-3', 'Bulgarian Split Squat', 'squat', ['quads'], 'legs'),
  ex('legs-hinge-1', 'Romanian Deadlift', 'hinge', ['hamstrings'], 'legs'),
  ex('legs-hinge-2', 'Machine Seated Leg Curl', 'hinge', ['hamstrings'], 'legs'),
  ex('legs-hinge-3', 'Barbell Hip Thrust', 'hinge', ['glutes'], 'glutes'),
  // Arms — biceps are 'pull', triceps are 'push'.
  ex('arms-pull-1', 'Barbell Curl', 'pull', ['biceps'], 'arms'),
  ex('arms-pull-2', 'Dumbbell Hammer Curl', 'pull', ['biceps'], 'arms'),
  ex('arms-pull-3', 'Dumbbell Preacher Curl', 'pull', ['biceps'], 'arms'),
  ex('arms-push-1', 'Triceps Pushdown', 'push', ['triceps'], 'arms'),
  ex('arms-push-2', 'Barbell Skull Crusher', 'push', ['triceps'], 'arms'),
  ex('arms-push-3', 'Bench Dip', 'push', ['triceps'], 'arms'),
  // Core — the area that used to swallow the whole session.
  ex('core-1', 'Plank', 'core', ['abs'], 'core', { equipment: ['bodyweight'] }),
  ex('core-2', 'Cable Crunch', 'core', ['abs'], 'core'),
  ex('core-3', 'Hanging Leg Raise', 'core', ['abs'], 'core', { equipment: ['bodyweight'] }),
  ex('core-4', 'Russian Twist', 'core', ['obliques'], 'core', { equipment: ['bodyweight'] }),
  ex('core-5', 'Hollow Body Hold', 'core', ['abs'], 'core', { equipment: ['bodyweight'] }),
  ex('core-6', 'Dead Bug', 'core', ['abs'], 'core', { equipment: ['bodyweight'] }),
  // Chest / back / shoulders, so "Upper Body" coverage is testable.
  ex('chest-1', 'Barbell Bench Press', 'push', ['chest'], 'chest', { secondary: ['triceps'] }),
  ex('chest-2', 'Dumbbell Incline Bench Press', 'push', ['chest'], 'chest'),
  ex('chest-3', 'Machine Chest Press', 'push', ['chest'], 'chest'),
  ex('back-1', 'Barbell Bent-Over Row', 'pull', ['lats'], 'back'),
  ex('back-2', 'Lat Pulldown', 'pull', ['lats'], 'back'),
  ex('shoulders-1', 'Machine Shoulder Press', 'push', ['shoulders'], 'shoulders'),
  ex('shoulders-2', 'Cable Lateral Raise', 'push', ['shoulders'], 'shoulders'),
  // Cardio, for the Cardio-plus-a-muscle-area case.
  ex('cardio-1', 'Treadmill Running', 'cardio', ['full_body'], 'cardio', { equipment: ['bodyweight'] }),
  ex('cardio-2', 'Rowing Machine', 'cardio', ['full_body'], 'cardio'),
]

/** Everything the user has scheduled, so nothing collapses the pool by accident. */
const NO_SCHEDULE = { scheduled_workouts: [] }

async function build(
  keys: string[], minutes: number,
  opts: { purpose?: QuickPurpose; profile?: ProfileForQuick; catalogue?: typeof CATALOGUE } = {},
) {
  const { TARGET_AREA_OPTIONS } = await import('@/lib/quickWorkout')
  const muscles = [...new Set(keys.flatMap(k =>
    TARGET_AREA_OPTIONS.find(o => o.key === k)?.muscles ?? []))]
  // The screen derives the label from the chips' own text and passes it for the
  // title; mirror that here so title assertions mean something.
  const labels = keys
    .map(k => TARGET_AREA_OPTIONS.find(o => o.key === k)?.label)
    .filter((l): l is string => !!l)
  const client = createFakeSupabase({
    exercises: opts.catalogue ?? CATALOGUE, user_profiles: [], ...NO_SCHEDULE,
  } as never)
  return generateQuickWorkout(
    client, USER,
    {
      minutes: minutes as QuickMinutes,
      purpose: opts.purpose ?? 'muscle_growth',
      targetMuscles: muscles.length ? muscles : undefined,
      targetAreaKeys: keys,
      targetAreaLabel: labels.join(' & ') || null,
      targetPattern: keys.includes('cardio') ? 'cardio' : undefined,
    },
    opts.profile ?? GYM,
  )
}

/** Which of the id prefixes the session actually touched. */
const areasIn = (ids: string[]) =>
  new Set(ids.map(id => id.replace(/-.*$/, '')))

describe('Quick Workout balances the areas you selected', () => {
  // Which area leads is rotated by the day seed (dayOfYear + minutes), so each
  // of these walks three durations: that covers every rotation of a 3-area
  // selection whatever today's date is. A test that only held on some days would
  // be worse than none.
  it.each([40, 50, 60])('Core + Arms + Legs returns all three at %i minutes, not mostly Core (the reported bug)', async (minutes) => {
    const w = await build(['core', 'arms', 'legs'], minutes)
    const ids = w.exercises.map(e => e.id)

    expect(ids.length).toBeGreaterThanOrEqual(3)
    expect(areasIn(ids)).toEqual(new Set(['core', 'arms', 'legs']))
    // Even shares: with 3 areas no single one may take more than its share plus
    // one. Core taking 4 of 5 slots is the exact failure being fixed.
    const perArea = ['core', 'arms', 'legs'].map(
      a => ids.filter(id => id.startsWith(a)).length)
    expect(Math.max(...perArea) - Math.min(...perArea)).toBeLessThanOrEqual(1)
  })

  it.each([15, 20, 30])('still reaches every selected area in a %i-minute window', async (minutes) => {
    // The short windows are where an unbalanced allocation does the most damage:
    // there are only three or four slots, so one greedy area takes the session.
    const w = await build(['core', 'arms', 'legs'], minutes)
    expect(areasIn(w.exercises.map(e => e.id))).toEqual(new Set(['core', 'arms', 'legs']))
  })

  it('does not silence a selected area that only matches loosely', async () => {
    // The old code resolved dominant-or-loose ONCE for the whole union: Core
    // matched dominantly, so the loose tier never ran and Arms — whose only
    // no-equipment option is a push-up, dominant muscle 'chest' — contributed
    // nothing at all. Each area now resolves its own tier.
    const bodyweight = [
      ex('core-1', 'Plank', 'core', ['abs'], 'core', { equipment: ['bodyweight'] }),
      ex('core-2', 'Sit-Up', 'core', ['abs'], 'core', { equipment: ['bodyweight'] }),
      ex('core-3', 'Russian Twist', 'core', ['obliques'], 'core', { equipment: ['bodyweight'] }),
      ex('core-4', 'Dead Bug', 'core', ['abs'], 'core', { equipment: ['bodyweight'] }),
      ex('arms-pushup', 'Push-Up', 'push', ['chest', 'triceps'], 'chest', { equipment: ['bodyweight'] }),
    ]
    const w = await build(['core', 'arms'], 20, { profile: NO_EQUIPMENT, catalogue: bodyweight })
    const ids = w.exercises.map(e => e.id)

    expect(ids).toContain('arms-pushup')
    expect(ids.every(id => id.startsWith('core'))).toBe(false)
  })

  it('balances inside an area too — Arms gets biceps AND triceps', async () => {
    const w = await build(['arms'], 40)
    const patterns = w.exercises.map(e => e.movement_pattern)
    expect(patterns).toContain('push')   // triceps
    expect(patterns).toContain('pull')   // biceps
    // Not three curls and nothing else.
    expect(w.exercises.every(e => e.id.startsWith('arms'))).toBe(true)
  })

  it('balances inside Legs too — quads AND posterior chain', async () => {
    const w = await build(['legs'], 40)
    const patterns = w.exercises.map(e => e.movement_pattern)
    expect(patterns).toContain('squat')
    expect(patterns).toContain('hinge')
  })

  it('Upper Body covers chest, back, shoulders and arms', async () => {
    // A single pooled "Upper Body" allocated by pattern could come back as
    // chest/lats/chest/lats with no shoulders or arms at all. It is split into
    // sub-areas so each gets a share.
    const w = await build(['upper_body'], 60)
    const ids = w.exercises.map(e => e.id)
    expect(areasIn(ids)).toEqual(new Set(['chest', 'back', 'shoulders', 'arms']))
  })

  it('Cardio combined with a muscle area actually includes cardio', async () => {
    // Cardio composes via targetPattern, which forcePatterns used to discard
    // outright whenever a muscle filter was active — so the chip did nothing.
    const w = await build(['legs', 'cardio'], 40)
    const ids = w.exercises.map(e => e.id)
    expect(ids.some(id => id.startsWith('cardio'))).toBe(true)
    expect(ids.some(id => id.startsWith('legs'))).toBe(true)
  })

  it('Chest + Arms returns triceps work, not just presses and curls', async () => {
    // The sharpest case for allocating by area rather than by pattern. Chest and
    // Arms both live on 'push'. Pooled together, pickBest ranks by how many
    // muscles an exercise works, so every 'push' slot went to a chest compound
    // and Arms was left with 'pull' alone — bench, incline bench, curl, hammer
    // curl, and not one triceps movement in an explicit Arms request.
    const w = await build(['chest', 'arms'], 40)
    const ids = w.exercises.map(e => e.id)
    expect(ids.some(id => id.startsWith('chest'))).toBe(true)
    expect(ids.some(id => id.startsWith('arms-pull'))).toBe(true)
    expect(ids.some(id => id.startsWith('arms-push'))).toBe(true)
  })

  it('leads with the compounds rather than the order it allocated in', async () => {
    // Area round-robin interleaves (legs, arms, core, legs…), which is the right
    // way to allocate a session and the wrong way to perform one.
    const w = await build(['core', 'legs'], 40)
    const first = w.exercises[0]
    expect(['squat', 'hinge']).toContain(first.movement_pattern)
  })
})

describe('an area that matches nothing', () => {
  it('still produces a workout, but stops calling it that area', async () => {
    // A workout is always produced (that is the whole feature), so a request
    // nothing can satisfy falls back to full body. The title has to say so:
    // "40-Minute Arms Muscle" full of squats is a lie about what is in it.
    const catalogue = [
      ex('legs-squat-1', 'Bodyweight Squat', 'squat', ['quads'], 'legs', { equipment: ['bodyweight'] }),
      ex('core-1', 'Plank', 'core', ['abs'], 'core', { equipment: ['bodyweight'] }),
    ]
    const w = await build(['arms'], 20, { profile: NO_EQUIPMENT, catalogue })
    expect(w.exercises.length).toBeGreaterThan(0)
    expect(w.title).toContain('Full Body')
    expect(w.title).not.toContain('Arms')
    // And the control: when the area DOES land, the title names it.
    const landed = await build(['arms'], 20, { catalogue: CATALOGUE })
    expect(landed.title).toContain('Arms')
  })
})

describe('composeRestrictions', () => {
  const injury = { avoidMuscles: ['knee', 'quads'], avoidPatterns: ['squat' as const] }
  const schedule = { avoidMuscles: [], avoidPatterns: ['push' as const, 'hinge' as const] }

  it('lets the schedule vote when Tempo is the one choosing', () => {
    const r = composeRestrictions(injury, schedule, false)
    expect(r.avoidPatterns.sort()).toEqual(['hinge', 'push', 'squat'])
  })

  it('stops the schedule voting once the user has named a Target Area', () => {
    const r = composeRestrictions(injury, schedule, true)
    expect(r.avoidPatterns).toEqual(['squat'])   // the injury, and only the injury
    expect(r.avoidMuscles).toEqual(['knee', 'quads'])
  })

  it('never drops an injury', () => {
    for (const explicit of [true, false]) {
      expect(composeRestrictions(injury, schedule, explicit).avoidMuscles)
        .toEqual(expect.arrayContaining(['knee', 'quads']))
    }
  })

  it('treats an unfetched schedule as no preference rather than throwing', () => {
    expect(composeRestrictions(injury, null, false)).toEqual(injury)
  })
})

describe('muscle_group refines area membership', () => {
  it('a Chest pick excludes a pullover the catalogue files under Back', async () => {
    // Dumbbell Pullover is primary_muscles[0] = 'chest' but muscle_group 'back',
    // so a dominant-muscle match alone accepted it as chest work.
    const catalogue = [
      ex('chest-1', 'Barbell Bench Press', 'push', ['chest'], 'chest'),
      ex('chest-2', 'Dumbbell Incline Bench Press', 'push', ['chest'], 'chest'),
      ex('back-pullover', 'Dumbbell Pullover', 'pull', ['chest'], 'back'),
    ]
    const w = await build(['chest'], 40, { catalogue })
    expect(w.exercises.map(e => e.id)).not.toContain('back-pullover')
  })

  it('but a Mobility session still gets the stretches for that area', async () => {
    // Every stretch in the catalogue is muscle_group 'mobility' while keeping the
    // muscle it stretches as its dominant one, so filing by group alone would
    // throw away every stretch a "Legs Mobility" request exists to deliver.
    const catalogue = [
      ex('legs-squat-1', 'Bodyweight Squat', 'squat', ['quads'], 'legs', { equipment: ['bodyweight'] }),
      ex('legs-stretch-1', 'Lying (side) Quads Stretch', 'mobility', ['quads'], 'mobility', { equipment: ['bodyweight'] }),
      ex('legs-stretch-2', 'Standing Hamstring Stretch', 'mobility', ['hamstrings'], 'mobility', { equipment: ['bodyweight'] }),
    ]
    const w = await build(['legs'], 20, { purpose: 'mobility', profile: NO_EQUIPMENT, catalogue })
    expect(w.exercises.some(e => e.id.startsWith('legs-stretch'))).toBe(true)
  })
})

describe('an explicit Target Area is not overruled by the schedule', () => {
  it('drops the avoid-what-is-scheduled preference when only one pattern would survive', async () => {
    // Push today + Legs tomorrow avoids push, squat AND hinge, leaving only
    // 'pull'. The old floor required ZERO surviving patterns to fire, so this
    // collapsed the pool to core plus a couple of curls — the same bug with one
    // pattern of camouflage.
    const today = toDateStr(new Date())
    const tomorrow = toDateStr(new Date(Date.now() + 864e5))
    const client = createFakeSupabase({
      scheduled_workouts: [
        { id: 'w1', user_id: USER, focus: 'Push', status: 'scheduled', planned_date: today, exercise_ids: ['chest-1'] },
        { id: 'w2', user_id: USER, focus: 'Legs', status: 'scheduled', planned_date: tomorrow, exercise_ids: ['legs-squat-1'] },
      ],
    } as never)

    const r = await getScheduleRestrictions(client, USER)
    expect(r.avoidPatterns).toEqual([])
  })

  it('still returns leg work for a Legs request while legs are scheduled', async () => {
    // The screen no longer merges schedule restrictions into an explicit pick at
    // all; this proves the engine honours that by passing none.
    const client = createFakeSupabase({
      exercises: CATALOGUE, user_profiles: [],
      scheduled_workouts: [
        { id: 'w1', user_id: USER, focus: 'Legs', status: 'scheduled',
          planned_date: toDateStr(new Date(Date.now() + 864e5)), exercise_ids: ['legs-squat-1'] },
      ],
    } as never)

    const w = await generateQuickWorkout(
      client, USER,
      {
        minutes: 40, purpose: 'muscle_growth',
        targetAreaKeys: ['legs'],
        targetMuscles: ['quads', 'hamstrings', 'glutes', 'calves'],
        restrictions: { avoidMuscles: [], avoidPatterns: [] },
      },
      GYM,
    )
    expect(w.exercises.length).toBeGreaterThan(0)
    expect(w.exercises.every(e => e.id.startsWith('legs'))).toBe(true)
  })
})

describe('resolveTargetAreas', () => {
  it('ignores "Pick for me", which is a reset rather than an area', () => {
    expect(resolveTargetAreas(['surprise'], undefined)).toEqual([])
  })

  it('expands Upper Body into its sub-areas', () => {
    const keys = resolveTargetAreas(['upper_body'], undefined).map(a => a.key)
    expect(keys).toEqual([
      'upper_body.chest', 'upper_body.back', 'upper_body.shoulders', 'upper_body.arms',
    ])
  })

  it('leaves Cardio on its own to the original pattern-priority path', () => {
    // On its own the Cardio chip is not promoted to an area — that path is
    // unchanged. Combined with a muscle area it becomes one, so it gets a share.
    expect(resolveTargetAreas(['cardio'], undefined)).toEqual([])
    expect(resolveTargetAreas(['legs', 'cardio'], undefined).map(a => a.key))
      .toEqual(['legs', 'cardio'])
  })

  it('treats a bare targetMuscles array as one anonymous area', () => {
    expect(resolveTargetAreas(undefined, ['biceps', 'triceps'])).toEqual([
      { key: 'target', muscles: ['biceps', 'triceps'] },
    ])
  })

  it('deduplicates overlapping selections', () => {
    const keys = resolveTargetAreas(['arms', 'upper_body'], undefined).map(a => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
