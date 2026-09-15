// Arclo — slide the rotation, don't shuffle the calendar.
//
// Founder, 2026-09-14, on his own six-day split: "if I miss a day then I will
// want to hit it, if I miss push I want to do it next" and "sometimes I will
// just cancel push and schedule legs, because I skipped or am on a different
// track."
//
// Both of those are the SAME operation, which is why this module is one
// function rather than a policy engine: the user says which rotation position
// happens next, and everything after it follows in cycle order.
//
// ── Why content, not dates ──────────────────────────────────────────────────
//
// The obvious implementation is a date cascade: push the missed session to
// tomorrow, shove tomorrow's to the day after, absorb the overflow into a rest
// day. It was the first design and it is the wrong one. Moving dates means
// re-running availability and free-slot search, tearing down and rebuilding
// synced calendar events, re-pointing local reminders, honouring the
// one-session-per-day partial unique index, and fighting materializeSplit's
// day coverage — six load-bearing systems, to express something the user
// described purely in terms of content ("cancel push, schedule legs").
//
// Rotating CONTENT along fixed slots gets the same result with none of that.
// Monday's Push was missed, so Tuesday (same date, same 7am, same calendar
// event) simply becomes Push, Wednesday becomes Pull, and so on. The rest day
// stays where the user put it, because a rest day is the ABSENCE of a row and
// therefore never an input here.
//
// The tradeoff, stated plainly: the missed session is not "made up". Over any
// given week you still train the number of days you train. What you no longer
// do is SKIP a muscle group — which for anyone running Push/Pull/Legs is the
// thing that actually matters, and is exactly what the founder was doing by
// hand, one cancel-and-re-add at a time.
//
// Pure and I/O-free on purpose: the caller owns mapping a cycle position back
// to real exercises (split day config, or a plan template) and writing rows.

/** One upcoming work session. Rest days have no row, so they never appear. */
export interface RotationSlot {
  id: string
  /** 'YYYY-MM-DD'. Never modified — it is the fixed peg the rotation slides along. */
  date: string
  /** Which position in the rotation this slot currently holds (0-based). */
  cycleIndex: number
}

export interface RotationAssignment {
  id: string
  date: string
  /** The position this slot should hold after the shift. */
  cycleIndex: number
  /** False when the slot already held this position, so callers can skip the write. */
  changed: boolean
}

/**
 * Re-stamp every upcoming slot so the rotation continues from `anchorIndex`.
 *
 * @param slots       upcoming work sessions in DATE ASCENDING order. The caller
 *                    is responsible for that ordering and for excluding
 *                    completed sessions — a finished workout is history and
 *                    must never be re-stamped.
 * @param cycleLength how many positions the rotation has (Push/Pull/Legs twice
 *                    a week is 6, not 3: the two Push days are distinct
 *                    positions and can legitimately carry different exercises).
 * @param anchorIndex the position to place on the FIRST upcoming slot. For a
 *                    missed session that is the missed session's own index
 *                    ("do it next"); for a manual override it is whatever the
 *                    user picked ("I'm actually on legs").
 */
export function planRotationShift(
  slots: RotationSlot[],
  cycleLength: number,
  anchorIndex: number,
): RotationAssignment[] {
  // A non-positive or non-finite cycle is meaningless (no split, a single
  // ad-hoc session, corrupt data). Return the slots untouched rather than
  // dividing by zero or inventing an order — a shift that cannot be computed
  // must read as "nothing happened", never as a scrambled schedule.
  if (!Number.isFinite(cycleLength) || cycleLength <= 0) {
    return slots.map(s => ({ id: s.id, date: s.date, cycleIndex: s.cycleIndex, changed: false }))
  }

  const len = Math.floor(cycleLength)
  // Normalise into [0, len). JS '%' keeps the sign of the dividend, so a
  // negative anchor (an upstream off-by-one, or a caller subtracting 1 from
  // index 0) would otherwise produce a negative position and silently index
  // nothing on the far side.
  const start = ((Math.floor(anchorIndex) % len) + len) % len

  return slots.map((s, i) => {
    const cycleIndex = (start + i) % len
    return { id: s.id, date: s.date, cycleIndex, changed: cycleIndex !== s.cycleIndex }
  })
}

/**
 * True when a shift would visibly change anything. Lets a caller avoid showing
 * a confirmation sheet, writing rows, or logging an adaptation event for a
 * no-op — which happens more often than it sounds, e.g. missing the LAST
 * session of a cycle, where the rotation already continues correctly.
 */
export function shiftChangesAnything(assignments: RotationAssignment[]): boolean {
  return assignments.some(a => a.changed)
}
