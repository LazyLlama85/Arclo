import {
  goalScheme, estimate1RM, estimateSessionMinutes, exerciseCountForDuration, buildPrescription,
  type SetPerformance,
} from '@/lib/progression'
import { weekProgression } from '@/lib/periodization'

describe('progression — goal scheme & duration math', () => {
  it('returns the documented scheme per goal and falls back to general fitness', () => {
    expect(goalScheme('strength')).toEqual({ sets: 4, repLow: 3, repHigh: 6, rest: 180 })
    expect(goalScheme('muscle_gain')).toEqual({ sets: 3, repLow: 8, repHigh: 12, rest: 90 })
    // Unknown goal → general_fitness, never undefined.
    expect(goalScheme('nonsense' as never)).toEqual(goalScheme('general_fitness'))
  })

  it('estimate1RM uses Epley and clamps a single rep to the weight', () => {
    expect(estimate1RM(100, 1)).toBe(100)
    expect(estimate1RM(100, 10)).toBe(133) // 100 * (1 + 10/30) = 133.3 → 133
    expect(estimate1RM(225, 5)).toBe(263) // 225 * (1 + 5/30) = 262.5 → 263
  })

  it('session length rises with exercise count and drops on a deload', () => {
    const three = estimateSessionMinutes(3, 'muscle_gain')
    const five = estimateSessionMinutes(5, 'muscle_gain')
    expect(five).toBeGreaterThan(three)
    expect(estimateSessionMinutes(5, 'muscle_gain', true)).toBeLessThan(five) // fewer sets on deload
    expect(estimateSessionMinutes(0, 'muscle_gain')).toBe(0)
    expect(estimateSessionMinutes(3, 'muscle_gain')).toBeGreaterThanOrEqual(10) // floor
  })

  it('fits fewer heavy lifts than light ones into the same window, clamped 3–7', () => {
    // Strength rests a full 3 min, so a 45-min window fits fewer lifts than a
    // short-rest fat-loss circuit does.
    expect(exerciseCountForDuration(45, 'strength'))
      .toBeLessThanOrEqual(exerciseCountForDuration(45, 'fat_loss'))
    for (const goal of ['strength', 'fat_loss', 'muscle_gain'] as const) {
      const n = exerciseCountForDuration(45, goal)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(7)
    }
    expect(exerciseCountForDuration(0, 'muscle_gain')).toBeGreaterThanOrEqual(3) // bad input → sane default
  })
})

describe('progression — buildPrescription autoregulation', () => {
  const clean = (w: number, r: number, rpe: number | null = null): SetPerformance =>
    ({ weight_lbs: w, reps: r, rpe })

  it('first time: no weight, "new" direction', () => {
    const p = buildPrescription([], 'muscle_gain', 'h_push')
    expect(p.direction).toBe('new')
    expect(p.suggestedWeight).toBeNull()
    expect(p.lastSummary).toBeNull()
  })

  it('cleared the top of the range at low RPE → add weight (up)', () => {
    const p = buildPrescription([clean(100, 12, 7)], 'muscle_gain', 'h_push')
    expect(p.direction).toBe('up')
    expect(p.suggestedWeight).toBe(105) // +5 upper-body increment
  })

  it('lower-body compounds take a bigger jump', () => {
    const p = buildPrescription([clean(200, 12, 7)], 'muscle_gain', 'squat')
    expect(p.direction).toBe('up')
    expect(p.suggestedWeight).toBe(210) // +10 for squat/hinge
  })

  it('a grind (short reps or very high RPE) backs the load off ~10%', () => {
    const short = buildPrescription([clean(100, 5, null)], 'muscle_gain', 'h_push') // 5 < repLow 8
    expect(short.direction).toBe('down')
    expect(short.suggestedWeight).toBe(90)

    const maxedOut = buildPrescription([clean(100, 10, 9.7)], 'muscle_gain', 'h_push') // rpe ≥ 9.5
    expect(maxedOut.direction).toBe('down')
  })

  it('mid-range performance holds the weight', () => {
    const p = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push')
    expect(p.direction).toBe('hold')
    expect(p.suggestedWeight).toBe(100)
  })

  it('workout feedback nudges volume: too-easy adds a set, too-hard trims one', () => {
    const base = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0)
    const easier = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 1)
    const harder = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, -1)
    expect(easier.sets).toBe(base.sets + 1)
    expect(harder.sets).toBe(base.sets - 1)
  })

  it('low readiness trims a working set', () => {
    const normal = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false)
    const tired = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', true)
    expect(tired.sets).toBe(normal.sets - 1)
  })

  it('a deload week overrides to "down", lightens the load, and reframes the reason', () => {
    const deload = weekProgression(3, 'intermediate', 'normal') // isDeload, 0.85 intensity
    const p = buildPrescription([clean(100, 12, 7)], 'muscle_gain', 'h_push', false, 0, deload)
    expect(p.direction).toBe('down') // even though the raw call was "up"
    expect(p.reason).toBe(deload.note)
    expect(p.suggestedWeight).not.toBeNull()
    expect(p.suggestedWeight!).toBeLessThan(105) // scaled by the 0.85 deload intensity
  })

  it('a deload does not compound on top of a same-session reactive grind-cut', () => {
    // 200 lbs, 5 reps (< repLow 8 for muscle_gain/h_push) → reactive "grind" cut
    // to 180 (200 * 0.9, rounded to the 5 lb increment) BEFORE periodization.
    // The 0.85-intensity deload must scale the ORIGINAL 200, not the already-
    // cut 180 — 200*0.85=170, not 180*0.85=153 (rounds to 155 lbs, a ~23.5%
    // total cut instead of the intended flat 15%).
    const deload = weekProgression(3, 'intermediate', 'normal') // isDeload, 0.85 intensity
    const p = buildPrescription([clean(200, 5, null)], 'muscle_gain', 'h_push', false, 0, deload)
    expect(p.direction).toBe('down')
    expect(p.suggestedWeight).toBe(170)
  })

  it('always clamps working sets to a sane 2–6 range', () => {
    const peak = weekProgression(2, 'intermediate', 'normal') // +1 set
    const p = buildPrescription([clean(100, 10, 8)], 'strength', 'h_push', false, 1, peak)
    expect(p.sets).toBeGreaterThanOrEqual(2)
    expect(p.sets).toBeLessThanOrEqual(6)
  })

  it('the calf slot gets a further rep bump on top of the isolation role (founder: "20 reps for calf raises")', () => {
    // No slot passed: isolation role alone (goal 8-12 + isolation delta 2/4) → 10-16.
    const generic = buildPrescription([], 'muscle_gain', 'squat', false, 0, null, 'isolation', null)
    expect(generic.repLow).toBe(10)
    expect(generic.repHigh).toBe(16)
    // Calf slot on top of the same isolation role → 15-24, in the 15-20+ range
    // calf work is actually programmed at, not a generic accessory's range.
    const calf = buildPrescription([], 'muscle_gain', 'squat', false, 0, null, 'isolation', null, 'calf')
    expect(calf.repLow).toBe(15)
    expect(calf.repHigh).toBe(24)
  })

  it('the calf bump never applies to an unrelated slot', () => {
    const biceps = buildPrescription([], 'muscle_gain', 'pull', false, 0, null, 'isolation', null, 'biceps')
    expect(biceps.repLow).toBe(10)
    expect(biceps.repHigh).toBe(16)
  })
})

describe('progression — volume-landmark cap (B5.4)', () => {
  const clean = (w: number, r: number, rpe: number | null = null): SetPerformance =>
    ({ weight_lbs: w, reps: r, rpe })

  it('omitting weeklyVolume changes nothing — fully backward compatible', () => {
    const withArg = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0, null, null, undefined)
    const without = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0)
    expect(withArg).toEqual(without)
  })

  it('caps sets and appends an honest note when the muscle group is already near its weekly MRV', () => {
    const p = buildPrescription(
      [clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0, null, null,
      { group: 'chest', setsThisWeek: 19, experience: 'intermediate' }, // MRV 20, room = 1 -> floor wins at 2
    )
    expect(p.sets).toBe(2)
    expect(p.reason).toMatch(/protect recovery/i)
  })

  it('is a no-op when there is plenty of room left this week', () => {
    const capped = buildPrescription(
      [clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0, null, null,
      { group: 'chest', setsThisWeek: 2, experience: 'intermediate' },
    )
    const uncapped = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0)
    expect(capped).toEqual(uncapped)
  })

  it('ignores an unrecognized/cardio/null muscle group rather than throwing', () => {
    const p = buildPrescription(
      [clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0, null, null,
      { group: 'cardio', setsThisWeek: 999, experience: 'intermediate' },
    )
    const without = buildPrescription([clean(100, 10, 8)], 'muscle_gain', 'h_push', false, 0)
    expect(p).toEqual(without)
  })

  it('a deload week is already at the sane 2-set floor, so the volume cap correctly has nothing left to trim', () => {
    const deload = weekProgression(3, 'intermediate', 'normal') // isDeload -> sets already clamped to 2
    const p = buildPrescription(
      [clean(100, 12, 7)], 'muscle_gain', 'h_push', false, 0, deload, null,
      { group: 'chest', setsThisWeek: 19, experience: 'intermediate' }, // would cap a normal week to 2 as well
    )
    expect(p.direction).toBe('down')
    expect(p.sets).toBe(2)
    // No volume note: the cap and the deload's own floor coincide at 2, so nothing
    // actually changed — `capped` correctly reports false rather than a fake note.
    expect(p.reason).toBe(deload.note)
  })

  it('the cap DOES apply on a non-deload week that would otherwise sit above the floor', () => {
    const build = weekProgression(1, 'intermediate', 'normal') // 'build' phase, no volume delta
    const p = buildPrescription(
      [clean(100, 12, 7)], 'muscle_gain', 'h_push', false, 0, build, null,
      { group: 'chest', setsThisWeek: 19, experience: 'intermediate' }, // room = 1, requested = 3 -> floor wins at 2
    )
    expect(p.sets).toBe(2)
    expect(p.reason).toMatch(/protect recovery/i)
  })
})


// ── Strength charts have to survive a rep change ─────────────────────────────
//
// Founder, 2026-09-19: "should the graphs account for reps as well, if you start
// lowering weight, higher ing reps".
//
// They already do, and this pins it. The exercise-progress chart plots best
// estimated 1RM per session, not the heaviest weight lifted, so moving from
// heavy triples to lighter high-rep work reads as roughly flat rather than as a
// collapse. Plotting raw weight would show a cliff for someone who simply
// changed rep range, which is the single most common way a strength chart lies.
describe('estimate1RM across rep ranges', () => {
  it('treats a deload into higher reps as roughly equal strength', () => {
    const heavy = estimate1RM(225, 5)   // a hard five
    const lighter = estimate1RM(185, 12) // same lifter, volume block
    expect(Math.abs(heavy - lighter) / heavy).toBeLessThan(0.05)
  })

  it('still rises when the lifter actually gets stronger', () => {
    expect(estimate1RM(245, 5)).toBeGreaterThan(estimate1RM(225, 5))
    expect(estimate1RM(185, 15)).toBeGreaterThan(estimate1RM(185, 12))
  })

  it('does not reward dropping the weight alone', () => {
    // Fewer reps at a lighter load is genuinely less, and must read that way.
    expect(estimate1RM(135, 5)).toBeLessThan(estimate1RM(225, 5))
  })

  it('a single rep is the weight itself', () => {
    expect(estimate1RM(225, 1)).toBe(225)
    expect(estimate1RM(225, 0)).toBe(225)
  })
})
