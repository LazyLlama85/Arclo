import type { SupabaseClient } from '@supabase/supabase-js'
import { toDateStr } from '@/lib/dates'

// Marks any committed scheduled_workouts whose planned_date is before today as
// 'missed'. Plan workouts (user_plan_id set) and active-split workouts (source='split')
// are commitments; ad-hoc Quick Workouts / one-off custom sessions (user_plan_id null,
// not from a split) are opportunistic, so leaving one unstarted never reads as missed.
// Returns how many rows were marked MISSED. Errors are swallowed — caller gets 0.
//
// Pause mode (lib/pauseMode.ts) already shifts every future row past the pause
// window before this ever runs, so there's structurally nothing in range to mark
// missed during a pause — this guard is belt-and-suspenders (a stale/leftover row
// must never get marked missed just because a sweep happened to run mid-pause).
//
// ── Work you actually did is never "missed" ──────────────────────────────────
//
// Founder, 2026-09-15: "if you do some of a workout but don't complete it, it
// will count as completed when day ends."
//
// Plenty of real sessions never get the Finish tap: the phone dies, the gym
// closes, you get called away on the last set, you simply forget. The work was
// still done and the sets were still logged. Marking that "missed" is not a
// neutral bookkeeping choice — it breaks the streak, drags the Tempo Score
// down, and feeds `adaptation.refreshAdaptation`, which reads repeated misses
// as a signal to cut the user's volume. So a sweep that mislabels finished work
// does not just look wrong, it actively makes the next weeks easier for someone
// who has been training all along.
//
// The bar is deliberately real logged SETS, not merely an opened log row.
// Opening a session and walking out is genuinely a miss, and crediting that
// would make the streak meaningless in the other direction.
export async function checkMissedWorkouts(client: SupabaseClient, userId: string): Promise<number> {
  const today = toDateStr(new Date())

  const { data: profile } = await client
    .from('user_profiles')
    .select('paused_until')
    .eq('user_id', userId)
    .maybeSingle()
  const pausedUntil = (profile?.paused_until as string | null) ?? null
  if (pausedUntil && today < pausedUntil) return 0

  // Everything that would have been swept before this change.
  const { data: candidates, error: candErr } = await client
    .from('scheduled_workouts')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .lt('planned_date', today)
    .or('user_plan_id.not.is.null,source.eq.split')
  if (candErr) return 0

  const ids = (candidates ?? []).map((r: { id: string }) => r.id)
  if (!ids.length) return 0

  const worked = await sessionsWithLoggedSets(client, userId, ids)

  // Credit the ones that were actually trained. Best-effort and separate from
  // the miss pass below: if this fails we must still not mark them missed, so
  // they simply stay 'scheduled' and get another chance on the next sweep —
  // never silently downgraded to a miss because one write failed.
  if (worked.size) {
    try {
      await client
        .from('scheduled_workouts')
        .update({ status: 'completed' })
        .eq('user_id', userId)
        .eq('status', 'scheduled')
        .in('id', [...worked])
    } catch { /* leave them scheduled; the next sweep retries */ }
  }

  const missing = ids.filter(id => !worked.has(id))
  if (!missing.length) return 0

  const { data, error } = await client
    .from('scheduled_workouts')
    .update({ status: 'missed' })
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .in('id', missing)
    .select('id')

  if (error) return 0
  return data?.length ?? 0
}

/**
 * Of `ids`, which sessions have at least one logged set. Two hops because the
 * link is scheduled_workouts -> workout_logs -> set_logs; a workout_log on its
 * own only proves the session was opened.
 *
 * Total by design: any failure returns an empty set, which means "credit
 * nobody" and leaves the sweep behaving exactly as it did before. Wrongly
 * crediting a session is worse than the status quo; wrongly missing one is the
 * status quo.
 */
async function sessionsWithLoggedSets(
  client: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<Set<string>> {
  try {
    const { data: logs, error: logErr } = await client
      .from('workout_logs')
      .select('id, scheduled_workout_id')
      .eq('user_id', userId)
      .in('scheduled_workout_id', ids)
    if (logErr || !logs?.length) return new Set()

    const bySession = new Map<string, string>() // log id -> session id
    for (const l of logs as { id: string; scheduled_workout_id: string | null }[]) {
      if (l.scheduled_workout_id) bySession.set(l.id, l.scheduled_workout_id)
    }
    if (!bySession.size) return new Set()

    const { data: sets, error: setErr } = await client
      .from('set_logs')
      .select('workout_log_id')
      .in('workout_log_id', [...bySession.keys()])
    if (setErr || !sets?.length) return new Set()

    const out = new Set<string>()
    for (const s of sets as { workout_log_id: string }[]) {
      const sessionId = bySession.get(s.workout_log_id)
      if (sessionId) out.add(sessionId)
    }
    return out
  } catch {
    return new Set()
  }
}
