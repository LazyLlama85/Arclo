// Arclo — did this day count as trained?
//
// Founder, 2026-09-15: "pretend you cancel your plan exercise but do a new one
// or something similar, it still shows green in plan."
//
// The Plan calendar used to require EVERY session on a day to be 'completed'
// before the day read as trained. That is wrong the moment a day holds more
// than one row, which is exactly what happens when someone swaps their planned
// session for a different one: the abandoned session sits there as 'missed'
// next to the workout they actually did, and drags the whole day down with it.
// The user trained. The day should say so.
//
// An explicitly removed session is already 'skipped' and is filtered out before
// this ever sees it, so only the 'missed' case was visibly broken — but the rule
// is expressed here in terms of what a day MEANS rather than by listing statuses
// to ignore, so a future status cannot silently reopen the same bug.
//
// Pure and list-based so it can be unit-tested; the Plan tab passes the day's
// live rows straight in.

export type DayWorkoutStatus = 'scheduled' | 'completed' | 'missed' | 'skipped' | 'rescheduled'

export interface DaySummary {
  /** Something was trained and nothing is still outstanding — the green state. */
  trained: boolean
  /** Nothing was trained and at least one commitment went unmet. */
  missed: boolean
}

export function summarizeDay(statuses: readonly DayWorkoutStatus[]): DaySummary {
  if (!statuses.length) return { trained: false, missed: false }

  const anyDone = statuses.includes('completed')
  // A session still waiting to happen means the day is not finished yet, so it
  // is neither green nor red — today's remaining workout must not be painted as
  // a success just because an earlier one is done.
  const anyPending = statuses.includes('scheduled')

  const trained = anyDone && !anyPending
  return { trained, missed: !trained && statuses.includes('missed') }
}
