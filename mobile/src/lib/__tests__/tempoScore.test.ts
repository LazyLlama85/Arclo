import {
  computeTempoScore,
  tempoScoreInputFromSessions,
  TEMPO_SCORE_WEIGHTS,
} from '../tempoScore'
import type { StreakRow } from '../streak'

describe('computeTempoScore', () => {
  it('weights sum to 1.0 (score is a clean 0–1000)', () => {
    const sum = Object.values(TEMPO_SCORE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('MISSION: a consistent beginner out-scores a flaky advanced lifter', () => {
    // Beginner: 3-day goal, completes 3/3 every week for 4 weeks, 12-session streak.
    const beginner = computeTempoScore({
      dueDays: 12,
      trainedDays: 12,
      weeksMetGoal: 4,
      currentStreak: 12,
      goalPerWeek: 3,
    })
    // Advanced: 5-day goal, only 8/20 completed, bursty, streak broken.
    const advanced = computeTempoScore({
      dueDays: 20,
      trainedDays: 8,
      weeksMetGoal: 1,
      currentStreak: 1,
      goalPerWeek: 5,
    })
    expect(beginner.score).toBeGreaterThan(advanced.score)
    expect(beginner.score).toBeGreaterThan(850) // near the top
    expect(advanced.score).toBeLessThan(450)
  })

  it('is bounded 0–1000', () => {
    const zero = computeTempoScore({ dueDays: 0, trainedDays: 0, weeksMetGoal: 0, currentStreak: 0, goalPerWeek: 3 })
    expect(zero.score).toBe(0)
    const maxed = computeTempoScore({ dueDays: 30, trainedDays: 30, weeksMetGoal: 4, currentStreak: 100, goalPerWeek: 3 })
    expect(maxed.score).toBeLessThanOrEqual(1000)
    expect(maxed.score).toBeGreaterThan(950)
  })

  it('cannot be gamed by over-scheduling workouts you do not complete', () => {
    // Same completed work; one person padded their schedule with skips/misses.
    const honest = computeTempoScore({ dueDays: 12, trainedDays: 12, weeksMetGoal: 4, currentStreak: 12, goalPerWeek: 3 })
    const padder = computeTempoScore({ dueDays: 40, trainedDays: 12, weeksMetGoal: 4, currentStreak: 12, goalPerWeek: 3 })
    expect(padder.score).toBeLessThan(honest.score) // completion term punishes the padding
  })

  it('completion component = completed ÷ due', () => {
    const r = computeTempoScore({ dueDays: 10, trainedDays: 7, weeksMetGoal: 2, currentStreak: 3, goalPerWeek: 4 })
    expect(r.components.completion).toBeCloseTo(0.7, 6)
  })
})

describe('tempoScoreInputFromSessions', () => {
  const today = '2026-07-14'
  const mk = (planned_date: string, status: string): StreakRow => ({ planned_date, status })

  it('counts only DUE sessions for completion; future scheduled do not penalise', () => {
    const sessions: StreakRow[] = [
      mk('2026-07-13', 'completed'),
      mk('2026-07-11', 'completed'),
      mk('2026-07-09', 'missed'),
      mk('2026-07-20', 'scheduled'), // future — must be ignored
    ]
    const input = tempoScoreInputFromSessions(sessions, 3, today)
    expect(input.dueDays).toBe(3) // 2 completed + 1 missed; future scheduled excluded
    expect(input.trainedDays).toBe(2)
  })

  it('ignores sessions outside the 28-day window', () => {
    const sessions: StreakRow[] = [
      mk('2026-07-13', 'completed'),
      mk('2026-05-01', 'completed'), // >28 days ago
    ]
    const input = tempoScoreInputFromSessions(sessions, 3, today)
    expect(input.dueDays).toBe(1)
    expect(input.trainedDays).toBe(1)
  })

  it('a perfect 4-week beginner derives a top-tier score', () => {
    // 3 completed sessions per week for 4 weeks, no misses.
    const sessions: StreakRow[] = []
    for (let w = 0; w < 4; w++) {
      // 3 completed per rolling week: 1/3/5, 8/10/12, 15/17/19, 22/24/26 days ago.
      sessions.push(mk(offset(today, -(w * 7 + 1)), 'completed'))
      sessions.push(mk(offset(today, -(w * 7 + 3)), 'completed'))
      sessions.push(mk(offset(today, -(w * 7 + 5)), 'completed'))
    }
    const input = tempoScoreInputFromSessions(sessions, 3, today)
    expect(input.weeksMetGoal).toBe(4)
    expect(computeTempoScore(input).score).toBeGreaterThan(800)
  })
})

function offset(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

// ── Days, not sessions ───────────────────────────────────────────────────────
//
// Founder, 2026-09-15, on his own score of 287: "I don't make my full goal of 6
// workouts but I get about 4, sometimes I skip my planned workout to schedule
// the one I wanna do, my score shouldn't be punished for this."
//
// His real data: 36 sessions came due over 28 days, but only 26 distinct days
// carried one. Counting SESSIONS charged him twice for a single decision — the
// session he abandoned scored a miss AND the one he did scored a completion —
// so swapping in the workout he wanted actively lowered his score.
describe('swapping one session for another is one day, trained', () => {
  const today = '2026-09-15'
  const row = (planned_date: string, status: string, id = `${planned_date}-${status}`) =>
    ({ id, planned_date, status, source: 'plan' }) as never

  it('does not charge a miss for the session you replaced', () => {
    // One day. Planned session abandoned, own session done instead.
    const input = tempoScoreInputFromSessions(
      [row('2026-09-14', 'missed'), row('2026-09-14', 'completed')], 6, today,
    )
    expect(input.dueDays).toBe(1)
    expect(input.trainedDays).toBe(1)
    expect(computeTempoScore(input).components.completion).toBe(1)
  })

  it('a day you genuinely did nothing still counts against you', () => {
    const input = tempoScoreInputFromSessions(
      [row('2026-09-14', 'missed'), row('2026-09-13', 'completed')], 6, today,
    )
    expect(input.dueDays).toBe(2)
    expect(input.trainedDays).toBe(1)
    expect(computeTempoScore(input).components.completion).toBe(0.5)
  })

  it('two sessions in one day is one day, not two', () => {
    // Otherwise an AM/PM split double-counts toward a goal measured in days.
    const input = tempoScoreInputFromSessions(
      [row('2026-09-14', 'completed', 'am'), row('2026-09-14', 'completed', 'pm')], 6, today,
    )
    expect(input.trainedDays).toBe(1)
  })

  it('still cannot be gamed by over-scheduling a day', () => {
    // The mission rule, restated at day level: piling sessions onto days you do
    // not train cannot raise completion.
    const padded = tempoScoreInputFromSessions(
      [
        row('2026-09-14', 'completed'),
        row('2026-09-13', 'missed', 'a'), row('2026-09-13', 'missed', 'b'),
        row('2026-09-12', 'missed', 'c'), row('2026-09-12', 'missed', 'd'),
      ], 6, today,
    )
    expect(padded.dueDays).toBe(3)
    expect(padded.trainedDays).toBe(1)
    expect(computeTempoScore(padded).components.completion).toBeCloseTo(1 / 3)
  })
})
