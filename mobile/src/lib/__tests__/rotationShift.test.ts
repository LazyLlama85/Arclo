// The founder's own six-day split, which is the case this exists for.
//
// "if I miss a day then I will want to hit it, if I miss push I want to do it
// next. even if I miss 2 and have no more real rest days."
//
// Push/Pull/Legs twice over, one rest day:
//
//   idx  0     1     2     3     4     5     (rest)
//        Push  Pull  Legs  Push  Pull  Legs
//        Mon   Tue   Wed   Thu   Fri   Sat   Sun
//
// Six positions rather than three: the two Push days are distinct slots and
// can carry different exercises, so collapsing them would lose that.

import { planRotationShift, shiftChangesAnything } from '@/lib/rotationShift'
import type { RotationSlot } from '@/lib/rotationShift'

const FOCUS = ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs']
const CYCLE = 6

/** The week as scheduled, minus whatever was missed. Dates are Mon 2026-09-14 on. */
function week(startIdx: number, count: number, fromDay = 15): RotationSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `w${i}`,
    date: `2026-09-${String(fromDay + i).padStart(2, '0')}`,
    cycleIndex: (startIdx + i) % CYCLE,
  }))
}

const focusOf = (a: { cycleIndex: number }) => FOCUS[a.cycleIndex]

describe('planRotationShift', () => {
  it('puts the missed session next and slides everything after it', () => {
    // Missed Monday's Push (index 0). Tue..Sat still hold Pull/Legs/Push/Pull/Legs.
    const upcoming = week(1, 5)
    const out = planRotationShift(upcoming, CYCLE, 0)

    // Tuesday is now Push. That is the whole point.
    expect(focusOf(out[0])).toBe('Push')
    expect(out.map(focusOf)).toEqual(['Push', 'Pull', 'Legs', 'Push', 'Pull'])

    // Every date is untouched — this rotates content, it never moves a session.
    expect(out.map(a => a.date)).toEqual(upcoming.map(s => s.date))
    expect(out.every(a => a.changed)).toBe(true)
  })

  it('keeps the rest day where it is', () => {
    // Sunday simply has no row, so it is never an input and cannot be consumed.
    const upcoming = week(1, 5)
    const dates = planRotationShift(upcoming, CYCLE, 0).map(a => a.date)
    expect(dates).not.toContain('2026-09-20') // Sunday
    expect(dates).toHaveLength(5)
  })

  it('handles two misses in a row without needing a spare day', () => {
    // Missed Push AND Pull. No rest day is required, because nothing is being
    // crammed in — the rotation just resumes at Push.
    const upcoming = week(2, 4)
    const out = planRotationShift(upcoming, CYCLE, 0)
    expect(out.map(focusOf)).toEqual(['Push', 'Pull', 'Legs', 'Push'])
  })

  it('wraps into the following week instead of running off the end', () => {
    const upcoming = week(3, 8) // past this week's end
    const out = planRotationShift(upcoming, CYCLE, 2)
    expect(out.map(a => a.cycleIndex)).toEqual([2, 3, 4, 5, 0, 1, 2, 3])
  })

  it('re-anchors to any position the user picks, not just a missed one', () => {
    // "Cancel push and schedule legs" — the founder is on a different track and
    // is telling the app where he actually is. Same function, different anchor.
    const upcoming = week(1, 5)
    const out = planRotationShift(upcoming, CYCLE, 2)
    expect(out.map(focusOf)).toEqual(['Legs', 'Push', 'Pull', 'Legs', 'Push'])
  })

  it('reports a no-op when the rotation already continues correctly', () => {
    // Missing the LAST slot of a cycle changes nothing: the next session was
    // already the one that should come next. No sheet, no writes, no event.
    const upcoming = week(0, 5)
    const out = planRotationShift(upcoming, CYCLE, 0)
    expect(out.every(a => !a.changed)).toBe(true)
    expect(shiftChangesAnything(out)).toBe(false)
  })

  it('marks only the slots that actually move', () => {
    const upcoming: RotationSlot[] = [
      { id: 'a', date: '2026-09-15', cycleIndex: 1 },
      { id: 'b', date: '2026-09-16', cycleIndex: 1 }, // already wrong in the DB
    ]
    const out = planRotationShift(upcoming, CYCLE, 1)
    expect(out[0].changed).toBe(false) // stays at 1
    expect(out[1].changed).toBe(true)  // 1 -> 2
  })

  it('is idempotent — applying the same shift twice is a no-op the second time', () => {
    const upcoming = week(1, 5)
    const once = planRotationShift(upcoming, CYCLE, 0)
    const applied = once.map(a => ({ id: a.id, date: a.date, cycleIndex: a.cycleIndex }))
    const twice = planRotationShift(applied, CYCLE, 0)
    expect(twice.every(a => !a.changed)).toBe(true)
  })

  describe('guards', () => {
    it('leaves everything untouched when there is no real cycle', () => {
      // No active split, a lone ad-hoc session, or corrupt data. A shift that
      // cannot be computed must read as "nothing happened", never as a
      // scrambled schedule.
      const upcoming = week(1, 3)
      for (const bad of [0, -1, NaN, Infinity]) {
        const out = planRotationShift(upcoming, bad, 0)
        expect(out.every(a => !a.changed)).toBe(true)
        expect(out.map(a => a.cycleIndex)).toEqual(upcoming.map(s => s.cycleIndex))
      }
    })

    it('normalises a negative anchor rather than indexing off the front', () => {
      // A caller doing `missedIndex - 1` at index 0 would otherwise produce -1.
      const upcoming = week(0, 3)
      const out = planRotationShift(upcoming, CYCLE, -1)
      expect(out.map(a => a.cycleIndex)).toEqual([5, 0, 1])
    })

    it('normalises an anchor past the end of the cycle', () => {
      const upcoming = week(0, 3)
      expect(planRotationShift(upcoming, CYCLE, 7).map(a => a.cycleIndex)).toEqual([1, 2, 3])
    })

    it('handles an empty schedule', () => {
      expect(planRotationShift([], CYCLE, 0)).toEqual([])
      expect(shiftChangesAnything([])).toBe(false)
    })

    it('handles a one-position cycle (same session every time)', () => {
      const upcoming = week(0, 3)
      const out = planRotationShift(upcoming.map(s => ({ ...s, cycleIndex: 0 })), 1, 0)
      expect(out.every(a => a.cycleIndex === 0)).toBe(true)
      expect(out.every(a => !a.changed)).toBe(true)
    })
  })
})
