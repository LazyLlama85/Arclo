// "If you click + and add a workout it shouldn't just schedule for 7am that's
// already past, it should find an available time from after you add to the day."
//
// The builder opened on a hardcoded 07:00:00 and only moved off it if an async,
// calendar-aware suggestion came back. That suggestion can legitimately return
// null — no free window left, no calendar access, a failed fetch — and in every
// one of those cases the past time stayed.

import {
  defaultStartTime, DEFAULT_PREFERRED, DEFAULT_LATEST,
} from '@/lib/defaultStartTime'

/** A Date at a local wall-clock time on 2026-09-20. */
const at = (h: number, m = 0) => new Date(2026, 8, 20, h, m, 0)
const TODAY = '2026-09-20'
const TOMORROW = '2026-09-21'

describe('defaultStartTime', () => {
  it('never proposes a time that has already passed today', () => {
    // The reported bug, at the hour it was reported.
    expect(defaultStartTime(TODAY, at(14, 0))).toBe('14:30:00')
  })

  it('keeps the morning slot when the morning has not happened yet', () => {
    expect(defaultStartTime(TODAY, at(5, 0))).toBe(DEFAULT_PREFERRED)
    expect(defaultStartTime(TODAY, at(6, 0))).toBe(DEFAULT_PREFERRED)
  })

  it('moves off the preferred time the moment it stops being reachable', () => {
    // 06:45 plus a 30 minute lead is 07:15, so 07:00 is no longer makeable.
    expect(defaultStartTime(TODAY, at(6, 45))).toBe('07:15:00')
  })

  it('leaves a future day alone', () => {
    // Tomorrow is not constrained by today's clock, whatever time it is now.
    expect(defaultStartTime(TOMORROW, at(23, 0))).toBe(DEFAULT_PREFERRED)
    expect(defaultStartTime(TOMORROW, at(2, 0))).toBe(DEFAULT_PREFERRED)
  })

  it('rounds to something a person would actually write down', () => {
    // 14:37 + 30 = 15:07, which reads as an accident.
    expect(defaultStartTime(TODAY, at(14, 37))).toBe('15:15:00')
    expect(defaultStartTime(TODAY, at(9, 1))).toBe('09:45:00')
  })

  it('stops proposing a real start once the day is gone', () => {
    // Rather than 23:45, which is not a workout, it proposes the latest the day
    // allows. Obviously late reads as "today is basically over", which is true;
    // a past time reads as a bug.
    expect(defaultStartTime(TODAY, at(22, 30))).toBe(DEFAULT_LATEST)
    expect(defaultStartTime(TODAY, at(23, 59))).toBe(DEFAULT_LATEST)
  })

  it('honours a caller-supplied preference', () => {
    expect(defaultStartTime(TOMORROW, at(12, 0), { preferred: '18:00:00' })).toBe('18:00:00')
    // Still never in the past, even with an early preference.
    expect(defaultStartTime(TODAY, at(19, 0), { preferred: '06:00:00' })).toBe('19:30:00')
  })

  it('respects a custom lead and rounding', () => {
    expect(defaultStartTime(TODAY, at(14, 0), { leadMinutes: 0, roundToMinutes: 30 })).toBe('14:00:00')
    expect(defaultStartTime(TODAY, at(14, 1), { leadMinutes: 0, roundToMinutes: 30 })).toBe('14:30:00')
  })

  describe('guards', () => {
    it('falls back rather than throwing on a bad date', () => {
      // Runs in a screen's initial state, where a throw is a blank screen.
      for (const bad of ['', 'not-a-date', '2026-9-1', '20260920']) {
        expect(defaultStartTime(bad, at(14, 0))).toBe(DEFAULT_PREFERRED)
      }
    })

    it('falls back rather than throwing on a bad preferred time', () => {
      expect(defaultStartTime(TOMORROW, at(9, 0), { preferred: 'nonsense' })).toBe(DEFAULT_PREFERRED)
      expect(defaultStartTime(TOMORROW, at(9, 0), { preferred: '99:99:99' })).toBe(DEFAULT_PREFERRED)
    })

    it('always returns a well-formed HH:MM:SS', () => {
      for (let h = 0; h < 24; h++) {
        for (const m of [0, 7, 29, 59]) {
          expect(defaultStartTime(TODAY, at(h, m))).toMatch(/^\d{2}:\d{2}:00$/)
        }
      }
    })

    it('uses the local date, not UTC', () => {
      // Late-evening local time is already tomorrow in UTC. Comparing against a
      // UTC date would call today "a future day" and hand back 07:00 — the very
      // bug being fixed, reintroduced through the back door.
      const lateTonight = at(23, 0)
      expect(defaultStartTime(TODAY, lateTonight)).not.toBe(DEFAULT_PREFERRED)
    })
  })
})
