// Tempo Score — a proprietary 0–1000 commitment/consistency score.
//
// MISSION RULE (enforced by tempoScore.test.ts): a beginner who consistently
// completes their sessions must be able to out-score an advanced lifter who skips.
// So there is DELIBERATELY **no** strength / bodyweight / volume / genetics input —
// every component measures showing up, not how much you lift. The frequency term
// counts *completed* sessions (never merely scheduled), so you cannot inflate the
// score by over-scheduling easy workouts you don't do.
//
// ── Days, not sessions (2026-09-15) ──────────────────────────────────────────
//
// Founder, on his own 287: "I don't make my full goal of 6 workouts but I get
// about 4, sometimes I skip my planned workout to schedule the one I wanna do,
// my score shouldn't be punished for this."
//
// He was right, and his data showed why. Over 28 days he had 36 sessions come
// due but trained on only 26 distinct days — his plan schedules more sessions
// than there are training days, because a swapped-in session sits alongside the
// one it replaced. Counting SESSIONS charged him twice for one decision: the
// abandoned session scored a miss, and the workout he actually did scored one
// completion, so choosing his own session actively lowered his score.
//
// Completion is therefore a question about DAYS: on a day you had a commitment,
// did you train? Swapping one session for another is one day, trained. Two
// sessions on one day is still one day. This is the same principle as
// lib/dayStatus.ts, which fixed the identical bug in the Plan calendar.
//
// It does NOT weaken the anti-gaming rule below: someone who schedules 40
// sessions and completes 12 still has ~28 due days against 12 trained ones.
// You cannot inflate a day-level ratio by adding more sessions to a day.
//
// The formula lives here in JS (not SQL) so it can be tuned via an OTA update
// without a migration; the leaderboard RPC returns only the raw components below.

import { sessionStreak, type StreakRow } from './streak'

/** Raw, strength-free inputs. All counts are over a rolling 28-day window. */
export interface TempoScoreInput {
  /** DAYS in the window that carried a commitment which came due
   *  (completed + missed + skipped). Days, not sessions — see below. */
  dueDays: number
  /** Of those, the days you actually trained (at least one completed session). */
  trainedDays: number
  /** How many of the last 4 weeks hit ≥60% of the weekly goal (0–4). */
  weeksMetGoal: number
  /** Current consecutive-completed-session streak. */
  currentStreak: number
  /** The user's chosen weekly target (`user_profiles.days_per_week`). */
  goalPerWeek: number
}

export interface TempoScoreBreakdown {
  /** 0–1000. */
  score: number
  /** Each 0–1, for the "why" breakdown bars on the score card. */
  components: {
    completion: number
    goal: number
    consistency: number
    streak: number
    frequency: number
  }
}

/** Component weights — single source of truth. Sum = 1.0. Tune here, ships via OTA. */
export const TEMPO_SCORE_WEIGHTS = {
  completion: 0.35, // finish what you commit to (completed ÷ due)
  goal: 0.25, // hit your chosen weekly frequency
  consistency: 0.15, // show up EVERY week, not in bursts
  streak: 0.15, // current momentum
  frequency: 0.1, // absolute completed cadence (capped, non-gameable)
} as const

/** A 3-week perfect streak maxes the streak term — keeps momentum from dominating. */
const STREAK_CAP = 21
/** Absolute cadence caps at 4 completed/week, so raw volume can't swamp consistency. */
const FREQUENCY_CAP = 4

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)
/** Guard a sane weekly goal (profiles allow 1–6; default 3 when missing/garbage). */
export const clampGoal = (g: number | null | undefined) =>
  Number.isFinite(g as number) && (g as number) > 0 ? Math.min(7, Math.max(1, Math.round(g as number))) : 3

export function computeTempoScore(input: TempoScoreInput): TempoScoreBreakdown {
  const goalPerWeek = clampGoal(input.goalPerWeek)
  const avgWeeklyCompleted = input.trainedDays / 4

  const completion = input.dueDays > 0 ? clamp01(input.trainedDays / input.dueDays) : 0
  const goal = clamp01(avgWeeklyCompleted / goalPerWeek)
  const consistency = clamp01(input.weeksMetGoal / 4)
  const streak = clamp01(input.currentStreak / STREAK_CAP)
  const frequency = clamp01(avgWeeklyCompleted / FREQUENCY_CAP)

  const w = TEMPO_SCORE_WEIGHTS
  const raw =
    w.completion * completion +
    w.goal * goal +
    w.consistency * consistency +
    w.streak * streak +
    w.frequency * frequency

  return { score: Math.round(1000 * raw), components: { completion, goal, consistency, streak, frequency } }
}

// ── Deriving inputs from a session history (client-side; mirrors the RPC) ────────
// Lets Tempo compute your own score locally from the same StreakRow[] the profile
// already loads, and gives the score engine an end-to-end unit test.

const DAY_MS = 86_400_000

function daysAgoStr(todayStr: string, days: number): string {
  const d = new Date(`${todayStr}T00:00:00Z`)
  return new Date(d.getTime() - days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Derive a TempoScoreInput from settled/scheduled sessions over the last 28 days.
 * Counts DAYS, not sessions: a day is "due" if a commitment on it came due
 * (completed/missed/skipped), and "trained" if anything on it was completed.
 * Future 'scheduled' rows never penalise completion. Weeks are the last 4
 * rolling 7-day buckets ending today.
 */
export function tempoScoreInputFromSessions(
  sessions: StreakRow[],
  goalPerWeek: number,
  todayStr: string,
): TempoScoreInput {
  const windowStart = daysAgoStr(todayStr, 27)
  const inWindow = sessions.filter((s) => s.planned_date >= windowStart && s.planned_date <= todayStr)
  const settled = (s: StreakRow) => s.status === 'completed' || s.status === 'missed' || s.status === 'skipped'

  const due = inWindow.filter(settled)
  const dueDays = new Set(due.map((s) => s.planned_date)).size
  const trainedDays = new Set(
    due.filter((s) => s.status === 'completed').map((s) => s.planned_date),
  ).size

  const goal = clampGoal(goalPerWeek)
  const weekThreshold = Math.max(1, Math.ceil(0.6 * goal))
  let weeksMetGoal = 0
  for (let w = 0; w < 4; w++) {
    const end = daysAgoStr(todayStr, w * 7)
    const start = daysAgoStr(todayStr, w * 7 + 6)
    // Days trained that week, for the same reason: two sessions on one day is
    // one day of training, and must not count as two towards a weekly goal
    // expressed in days.
    const daysTrainedThatWeek = new Set(
      inWindow
        .filter((s) => s.status === 'completed' && s.planned_date >= start && s.planned_date <= end)
        .map((s) => s.planned_date),
    ).size
    if (daysTrainedThatWeek >= weekThreshold) weeksMetGoal++
  }

  return {
    dueDays,
    trainedDays,
    weeksMetGoal,
    currentStreak: sessionStreak(sessions, todayStr),
    goalPerWeek: goal,
  }
}
