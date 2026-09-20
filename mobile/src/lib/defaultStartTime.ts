// Arclo — the time a manually added workout should default to.
//
// Founder, 2026-09-20: "if you click + and add a workout it shouldn't just
// schedule for 7am that's already past, it should find an available time from
// after you add to the day."
//
// The workout builder opened with a hardcoded '07:00:00'. It asks
// reschedule.suggestTimeOnDate for something calendar-aware, which IS
// now-aware, but that is async and it can legitimately return null — a day with
// no free window left, no calendar access, or a failed fetch. In all of those
// the hardcoded value stayed, so adding a workout at 2pm proposed 7am, seven
// hours in the past. It also flashed 7am for the moment before the suggestion
// resolved, which is long enough to tap Save.
//
// This is the floor underneath that suggestion, not a replacement for it: a
// time that is never in the past, computed synchronously so there is nothing to
// wait for and nothing to flash.

/** 'HH:MM:SS' -> minutes since midnight. Null for anything unparseable. */
function toMinutes(hhmmss: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmmss)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return h * 60 + min
}

function toTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

/** Local 'YYYY-MM-DD' for a Date. Deliberately not toISOString, which is UTC and
 *  is a different day from "today" for much of the world for part of every day. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface DefaultStartOptions {
  /** Where the day would ideally start when there is no time pressure. */
  preferred?: string
  /** Minimum gap between now and the proposed start, so it is actually makeable. */
  leadMinutes?: number
  /** Round up to this boundary. A workout at 14:37 reads as an accident. */
  roundToMinutes?: number
  /** Latest start the day will ever propose. */
  latestStart?: string
}

export const DEFAULT_PREFERRED = '07:00:00'
export const DEFAULT_LEAD_MIN = 30
export const DEFAULT_ROUND_MIN = 15
export const DEFAULT_LATEST = '21:30:00'

/**
 * A start time for `dateStr` that is never in the past.
 *
 * A future day keeps the preferred time. Today takes the later of the preferred
 * time and "now, plus a lead, rounded up" — so adding a workout at 2pm proposes
 * the same afternoon, not the morning that already went.
 *
 * Total by design: unparseable input falls back to the preferred time rather
 * than throwing, because this runs in a screen's initial state where a throw is
 * a blank screen.
 */
export function defaultStartTime(
  dateStr: string,
  now: Date = new Date(),
  opts: DefaultStartOptions = {},
): string {
  const preferred = opts.preferred ?? DEFAULT_PREFERRED
  const preferredMin = toMinutes(preferred) ?? toMinutes(DEFAULT_PREFERRED)!
  const lead = opts.leadMinutes ?? DEFAULT_LEAD_MIN
  const round = Math.max(1, opts.roundToMinutes ?? DEFAULT_ROUND_MIN)
  const latestMin = toMinutes(opts.latestStart ?? DEFAULT_LATEST) ?? toMinutes(DEFAULT_LATEST)!

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return toTime(preferredMin)

  // Only today is constrained by the clock. A past date is the caller's problem
  // to reject; proposing a time for it is still better than proposing nothing.
  if (dateStr !== localDateStr(now)) return toTime(preferredMin)

  const nowMin = now.getHours() * 60 + now.getMinutes()
  const earliest = Math.ceil((nowMin + lead) / round) * round

  // Past the point where a sensible start remains, stop pretending: propose the
  // latest the day allows rather than 11:45pm. The user can still override, and
  // an obviously-late suggestion reads as "today is basically gone", which is
  // true, where a past time reads as a bug.
  if (earliest > latestMin) return toTime(Math.max(latestMin, preferredMin > latestMin ? latestMin : preferredMin))

  return toTime(Math.max(preferredMin, earliest))
}
