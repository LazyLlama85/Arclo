// "If you drop 10 pounds it looks like you dropped so much."
//
// SvgLineChart normalised onto [min, max], so the largest value always sat on
// the ceiling and the smallest on the floor. Every chart looked the same
// regardless of what happened, which is misleading in both directions: two
// pounds of noise reads as a cliff, and real progress a month later looks no
// different.

import { chartDomain, normalize, MIN_SPAN_RATIO } from '@/lib/chartScale'

/** Where a value lands vertically, 0 = bottom of the chart, 1 = top. */
const at = (v: number, values: number[], ratio?: number) =>
  normalize(v, chartDomain(values, ratio))

describe('chartDomain', () => {
  it('stops a small change filling the whole chart', () => {
    // 185 down to 175 on a body that weighs ~180. Real, worth seeing, not a cliff.
    const cut = [185, 183, 181, 179, 177, 175]
    const top = at(185, cut)
    const bottom = at(175, cut)

    // It still visibly descends.
    expect(top).toBeGreaterThan(bottom)
    // But nowhere near edge to edge, which is what it used to do.
    expect(top - bottom).toBeLessThan(0.6)
    expect(top).toBeLessThan(0.95)
    expect(bottom).toBeGreaterThan(0.05)
  })

  it('makes noise look like noise', () => {
    // Same scale, but the day-to-day fluctuation everyone has. Under the old
    // behaviour this drew exactly the same picture as the ten-pound cut above.
    const noise = [180.2, 179.8, 180.4, 180.0, 179.9]
    const spread = at(180.4, noise) - at(179.8, noise)
    expect(spread).toBeLessThan(0.1)

    // And that is the whole point: the cut must read as bigger than the wobble.
    const cut = [185, 183, 181, 179, 177, 175]
    expect(at(185, cut) - at(175, cut)).toBeGreaterThan(spread * 3)
  })

  it('still uses the real range when the change is genuinely large', () => {
    // A 100 to 200 lb bench over a training block. The floor must not shrink it.
    const bench = [100, 120, 140, 160, 180, 200]
    const d = chartDomain(bench)
    expect(d.lo).toBeLessThan(100)
    expect(d.hi).toBeGreaterThan(200)
    // Close to the full height, minus only the headroom.
    expect(at(200, bench) - at(100, bench)).toBeGreaterThan(0.7)
  })

  it('never clips a value', () => {
    for (const values of [[185, 175], [100, 200], [5, 5, 5], [0, 0], [-3, 9]]) {
      const d = chartDomain(values)
      for (const v of values) {
        expect(normalize(v, d)).toBeGreaterThanOrEqual(0)
        expect(normalize(v, d)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('puts an unchanged run through the middle', () => {
    // Not pinned to the floor, which read as crashed data rather than "stable".
    expect(at(180, [180, 180, 180, 180])).toBeCloseTo(0.5, 5)
  })

  it('handles values either side of zero', () => {
    // Magnitude, not signed average: averaging these to ~0 would collapse the
    // minimum span this exists to enforce.
    const d = chartDomain([-10, 10])
    expect(d.hi - d.lo).toBeGreaterThan(20)
    expect(normalize(0, d)).toBeCloseTo(0.5, 5)
  })

  describe('guards', () => {
    it('survives an empty series', () => {
      expect(chartDomain([])).toEqual({ lo: 0, hi: 1 })
    })

    it('survives all zeroes', () => {
      const d = chartDomain([0, 0, 0])
      expect(d.hi).toBeGreaterThan(d.lo)
      expect(normalize(0, d)).toBeCloseTo(0.5, 5)
    })

    it('ratio 0 restores edge-to-edge for a caller that wants it', () => {
      const values = [185, 175]
      // Only the headroom keeps it off the rim.
      expect(at(185, values, 0)).toBeGreaterThan(0.85)
      expect(at(175, values, 0)).toBeLessThan(0.15)
    })

    it('ignores a negative ratio rather than inverting the axis', () => {
      const values = [185, 175]
      const d = chartDomain(values, -5)
      expect(d.hi).toBeGreaterThan(d.lo)
    })

    it('a single point does not divide by zero', () => {
      const d = chartDomain([180])
      expect(d.hi).toBeGreaterThan(d.lo)
      expect(normalize(180, d)).toBeCloseTo(0.5, 5)
    })
  })

  it('exports a sane default ratio', () => {
    expect(MIN_SPAN_RATIO).toBeGreaterThan(0)
    expect(MIN_SPAN_RATIO).toBeLessThan(1)
  })
})
