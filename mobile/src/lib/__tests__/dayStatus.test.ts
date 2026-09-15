// "Cancel your plan exercise but do a new one ... it still shows green in plan."
//
// The Plan calendar required EVERY session on a day to be 'completed'. With two
// rows on one day — the planned session you abandoned, and the one you actually
// did — that is never true, so a day you genuinely trained read as untrained.

import { summarizeDay } from '@/lib/dayStatus'
import type { DayWorkoutStatus } from '@/lib/dayStatus'

const day = (...s: DayWorkoutStatus[]) => summarizeDay(s)

describe('summarizeDay', () => {
  it('counts the day as trained when you did something else instead', () => {
    // The reported case: planned session abandoned, different workout done.
    expect(day('missed', 'completed')).toEqual({ trained: true, missed: false })
    expect(day('completed', 'missed')).toEqual({ trained: true, missed: false })
  })

  it('still counts an ordinary completed day', () => {
    expect(day('completed')).toEqual({ trained: true, missed: false })
    expect(day('completed', 'completed')).toEqual({ trained: true, missed: false })
  })

  it('does not call a day trained while a session is still to come', () => {
    // A two-a-day where the morning is done and the evening is not. Painting
    // that green would tell the user they are finished when they are not.
    expect(day('completed', 'scheduled')).toEqual({ trained: false, missed: false })
  })

  it('reports a genuinely missed day', () => {
    expect(day('missed')).toEqual({ trained: false, missed: true })
    expect(day('missed', 'missed')).toEqual({ trained: false, missed: true })
  })

  it('is neutral about a day that has not happened yet', () => {
    expect(day('scheduled')).toEqual({ trained: false, missed: false })
    expect(day('scheduled', 'missed')).toEqual({ trained: false, missed: true })
  })

  it('is neutral about an empty day', () => {
    expect(day()).toEqual({ trained: false, missed: false })
  })

  it('does not treat a removed session as a miss on its own', () => {
    // 'skipped' rows are filtered out upstream, but the rule must not depend on
    // that filtering to be correct.
    expect(day('skipped')).toEqual({ trained: false, missed: false })
    expect(day('skipped', 'completed')).toEqual({ trained: true, missed: false })
  })
})
