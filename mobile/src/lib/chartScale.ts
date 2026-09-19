// Arclo — how much of the y-axis a trend is allowed to fill.
//
// Founder, 2026-09-19: "adjust history graphs to be less zoomed in. If you drop
// 10 pounds it looks like you dropped so much."
//
// SvgLineChart normalised straight onto [min, max] of the data, so the largest
// value always sat on the ceiling and the smallest always on the floor. That
// makes every chart look identical regardless of what actually happened: a
// half-pound overnight fluctuation and a thirty-pound cut both render as a line
// crossing the entire frame. The shape carried no information, only the axis
// labels did, and nobody reads those on a small card.
//
// Worse than uninformative, it is misleading in both directions. A beginner who
// drops two pounds sees a cliff and believes something dramatic happened; the
// same chart a month later, after real progress, looks no different.
//
// The fix is a MINIMUM SPAN proportional to the values being plotted. If the
// data moves less than that, the axis keeps the wider span and the line sits
// where it belongs — near the middle, barely sloping. If the data moves more,
// the real range wins and nothing is clipped. It only ever zooms OUT.
//
// Proportional rather than absolute because this chart is shared: bodyweight in
// pounds, estimated 1RM, weekly set counts. Ten units means something different
// in each, but "less than 15% of the typical value" means roughly the same
// thing in all of them.

/** Default minimum y-axis span, as a fraction of the average plotted value. */
export const MIN_SPAN_RATIO = 0.15

/** Fraction of the final span left as breathing room above and below. */
const HEADROOM = 0.12

export interface ChartDomain {
  lo: number
  hi: number
}

/**
 * The y-axis range to plot `values` against.
 *
 * @param minSpanRatio smallest axis span, as a fraction of the average value.
 *        0 restores the old edge-to-edge behaviour for a caller that genuinely
 *        wants every pixel of movement.
 */
export function chartDomain(values: number[], minSpanRatio = MIN_SPAN_RATIO): ChartDomain {
  if (!values.length) return { lo: 0, hi: 1 }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const mid = (min + max) / 2

  // Magnitude, not signed average: a chart of values straddling zero would
  // otherwise average out to nothing and collapse the minimum span it is
  // supposed to enforce.
  const magnitude = values.reduce((a, b) => a + Math.abs(b), 0) / values.length

  let span = Math.max(max - min, Math.abs(magnitude) * Math.max(0, minSpanRatio))

  // Every value identical, and either no ratio or values of zero. There is no
  // scale to infer, so pick one — the line lands dead centre either way, which
  // is the honest picture of "nothing changed".
  if (!Number.isFinite(span) || span <= 0) span = 1

  const pad = span * HEADROOM
  return { lo: mid - span / 2 - pad, hi: mid + span / 2 + pad }
}

/** Map one value to a 0..1 position within a domain, 0 being `lo`. */
export function normalize(value: number, domain: ChartDomain): number {
  const range = domain.hi - domain.lo
  if (range <= 0) return 0.5
  return (value - domain.lo) / range
}
