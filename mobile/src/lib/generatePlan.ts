import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Experience, TimeOfDay, UnavailableBlock, AdaptationMode } from '@/types'
import { weekProgression, BLOCK_WEEKS } from '@/lib/periodization'
import { estimateSessionMinutes, exerciseCountForDuration } from '@/lib/progression'
import { injuriesToRestrictions } from '@/lib/quickWorkout'
import { expandEquipment, canPerform } from '@/lib/equipmentMatch'
import { sweepScheduledPlanRows } from '@/lib/retireWorkouts'
import { ensureAutoSplit } from '@/lib/splits'
import {
  classifyExercise, slotSide, sideAllows,
  type Slot, type Role, type SlotSide,
} from '@/lib/exerciseProgramming'
import {
  loadFamiliarity, byFamiliarity, noveltySlotIndex,
  NO_HISTORY, type FamiliarityIndex,
} from '@/lib/exerciseFamiliarity'
import { PLAN_RUNWAY_DAYS, formatLocalDate, planNeedsExtension, planExtensionWeeks } from '@/lib/planRollover'
import { captureApiError } from '@/lib/crashReporting'
import { fetchExcludedExerciseIds } from '@/lib/exerciseExclusions'
import {
  chooseSessionStart, toMinutes, minutesToTime, type AvailabilityInputs,
} from '@/lib/availability'

export interface PlanProfile {
  goal: Goal
  experience: Experience
  equipment: string[]
  days_per_week: number
  preferred_duration_min: number
  preferred_time_of_day?: TimeOfDay | null
  // Availability, so a start time can be chosen that the user can actually make.
  // Without these the plan picked purely off preferred_time_of_day and happily
  // scheduled into school or work (founder report, 2026-09-02).
  wake_time?: string | null
  bedtime?: string | null
  work_start?: string | null
  work_end?: string | null
  school_start?: string | null
  school_end?: string | null
  // Optional cardio finisher (onboarding question, Phase 7c). muscle_gain/strength
  // templates carry zero cardio by design (pure hypertrophy/strength focus) —
  // this appends CARDIO as an OPTIONAL trailing slot on those two goals only, so a
  // tight time budget can still drop it first. fat_loss/athletic/general_fitness
  // already bake in a cardio finisher on some days regardless — unaffected.
  include_cardio?: boolean
}

// Hard scheduling constraints the plan must respect: weekdays the user can never
// train (all-day unavailable blocks + the training-days allowlist) and injuries.
interface PlanConstraints {
  blockedWeekdays: Set<number>   // ISO 1=Mon … 7=Sun
  injuries: string[]
  excludedExerciseIds: Set<string>
  /** Wake/bed/work/school + weekday blocks, read here so EVERY caller of
   *  generatePlan gets availability-aware start times, not just the ones that
   *  happen to pass those fields in (splitSchedule.activateAutoPlan did not). */
  availability: AvailabilityInputs
  /** What this user has actually trained before. Loaded here for the same reason
   *  availability is — so EVERY generation path gets familiarity-aware selection
   *  and no caller can forget to pass it. */
  familiarity: FamiliarityIndex
  /** How many positions the plan's rotation has been slid (user_plans.rotation_offset).
   *  Rotates the template array so every generated block continues in the shifted
   *  order — see add_plan_rotation_offset.sql. Absent/0 is today's behaviour
   *  exactly, which is why initial generation never passes it. */
  rotationOffset?: number
}

/** Rotate a template list left by `offset`, normalised into range. Separate and
 *  total so a corrupt/negative stored offset can never throw or produce holes. */
export function rotateTemplates<T>(list: T[], offset: number): T[] {
  if (list.length === 0) return list
  if (!Number.isFinite(offset)) return list
  const n = ((Math.floor(offset) % list.length) + list.length) % list.length
  if (n === 0) return list
  return [...list.slice(n), ...list.slice(0, n)]
}

async function fetchPlanConstraints(client: SupabaseClient, userId: string): Promise<PlanConstraints> {
  const blocked = new Set<number>()
  let injuries: string[] = []
  let availability: AvailabilityInputs = {}
  try {
    const { data } = await client
      .from('user_profiles')
      .select('unavailable_blocks, training_days, injuries, wake_time, bedtime, work_start, work_end, school_start, school_end')
      .eq('user_id', userId)
      .maybeSingle()
    for (const b of ((data?.unavailable_blocks ?? []) as UnavailableBlock[])) {
      if (b.scope === 'weekday' && b.allDay && b.weekday) blocked.add(b.weekday)
    }
    // A non-empty training-days allowlist blocks every other weekday.
    const allowed = (data?.training_days ?? []) as number[]
    if (allowed.length) for (let d = 1; d <= 7; d++) if (!allowed.includes(d)) blocked.add(d)
    injuries = (data?.injuries as string[] | null) ?? []
    availability = {
      wake_time: (data?.wake_time ?? null) as string | null,
      bedtime: (data?.bedtime ?? null) as string | null,
      work_start: (data?.work_start ?? null) as string | null,
      work_end: (data?.work_end ?? null) as string | null,
      school_start: (data?.school_start ?? null) as string | null,
      school_end: (data?.school_end ?? null) as string | null,
      unavailable_blocks: (data?.unavailable_blocks ?? []) as UnavailableBlock[],
    }
  } catch { /* optional columns may not exist yet — no constraints */ }
  // Everything blocked is a contradiction — ignore the blocks rather than emit no plan.
  if (blocked.size >= 7) blocked.clear()
  const excludedExerciseIds = await fetchExcludedExerciseIds(client, userId)
  const familiarity = await loadFamiliarity(client, userId)
  return { blockedWeekdays: blocked, injuries, excludedExerciseIds, availability, familiarity }
}

// Preferred start times per time-of-day, in priority order. These are only
// CANDIDATES now: chooseSessionStart keeps whichever the user can actually make,
// given wake time, work and school. The variety stops a fresh plan reading as the
// same hour every day; the availability check stops it reading as impossible.
const START_TIMES: Record<TimeOfDay, string[]> = {
  morning:   ['07:00:00', '08:00:00', '06:30:00', '07:30:00'],
  afternoon: ['12:30:00', '15:30:00', '13:00:00', '16:00:00'],
  evening:   ['17:30:00', '18:30:00', '19:00:00', '18:00:00'],
}
const TOD_FALLBACK_ORDER: Record<TimeOfDay, TimeOfDay[]> = {
  morning: ['evening', 'afternoon'],
  afternoon: ['evening', 'morning'],
  evening: ['afternoon', 'morning'],
}

/**
 * The start time for one session. Rotates the user's preferred time-of-day for
 * variety, then falls back to the other times of day, and finally to any window
 * the day actually has — because a preference that cannot be met is not a
 * preference, it is a session the user will miss. A student who wakes at 06:30
 * and starts school at 07:00 must not be handed a 07:00 workout.
 */
function startTimeFor(
  tod: TimeOfDay,
  idx: number,
  weekday: number,
  durationMin: number,
  av: AvailabilityInputs,
): string {
  const rotate = (arr: string[]) => arr.map((_, i) => arr[(i + idx) % arr.length])
  const preferred = rotate(START_TIMES[tod])
  const fallback = TOD_FALLBACK_ORDER[tod].flatMap(t => START_TIMES[t])
  const candidates = [...preferred, ...fallback]
    .map(t => toMinutes(t))
    .filter((m): m is number => m != null)

  const chosen = chooseSessionStart({ candidates, weekday, durationMin, av })
  return chosen != null ? minutesToTime(chosen) : preferred[0]
}

// 'HH:MM:SS', local time — comparable directly against planned_start_time.
function nowTimeStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const MIN_DAYS = 2
const MAX_DAYS = 6
const clampDays = (n: number) => Math.min(MAX_DAYS, Math.max(MIN_DAYS, Number.isFinite(n) ? n : 3))

// Choose which ISO weekdays (1=Mon … 7=Sun) the plan trains on: skip every blocked
// day, then spread the sessions across what's left to maximise recovery between
// them (3 days over a full week → Mon/Wed/Fri; Wed blocked → Mon/Thu/Sat; only the
// weekend free → Sat/Sun). If fewer days are available than requested, the plan
// trains on all of them rather than putting a session on a forbidden day.
function chooseDaySlots(daysPerWeek: number, blocked: Set<number>): number[] {
  const candidates = [1, 2, 3, 4, 5, 6, 7].filter(d => !blocked.has(d))
  const n = Math.min(daysPerWeek, candidates.length)
  if (n <= 0) return [1, 3, 5].slice(0, daysPerWeek) // defensive — blocked is never all-7
  const stride = candidates.length / n
  const slots: number[] = []
  for (let i = 0; i < n; i++) {
    const pick = candidates[Math.floor(i * stride)]
    if (!slots.includes(pick)) slots.push(pick)
  }
  return slots
}

/**
 * Day-slots to use for the CURRENT week when a plan is generated mid-week.
 *
 * The plan's normal slots are absolute weekdays (a 3-day plan is Mon/Wed/Fri).
 * Generating on a Wednesday means Monday is already gone and Wednesday's own
 * start time is usually behind the clock, so those slots used to be skipped
 * outright — the sessions were deleted, not moved. A Wednesday-morning signup
 * on a 3-day plan kept exactly ONE session (Friday), and the onboarding reveal
 * screen — captioned "Your first week, planned." — showed five rest days and
 * two workouts to someone who had just asked to train three times a week
 * (observed on device 2026-07-22). A Sunday signup kept ZERO.
 *
 * This re-lays the week's sessions across the days that are actually left,
 * honouring the plan's own rhythm rather than cramming: `gap` is derived from
 * the user's weekly frequency (a 3-day plan trains every ~2 days and keeps that
 * spacing; a 5-day plan is consecutive by design and stays consecutive). It
 * never invents more sessions than the plan asks for, and never schedules more
 * than the remaining days allow.
 *
 * Pure and total so it can be unit-tested; the caller keeps its own past-date
 * guards, so nothing here can produce a past-dated session.
 *
 * @param plannedSlots  the plan's normal weekday slots (1=Mon … 7=Sun)
 * @param todaySlot     today's weekday, 1=Mon … 7=Sun
 * @param todayUsable   whether today's start time is still ahead of the clock
 * @param blocked       weekdays the user marked unavailable
 */
export function currentWeekSlots(
  plannedSlots: number[],
  todaySlot: number,
  todayUsable: boolean,
  blocked: Set<number>,
): number[] {
  const earliest = todayUsable ? todaySlot : todaySlot + 1
  const candidates: number[] = []
  for (let d = earliest; d <= 7; d++) if (!blocked.has(d)) candidates.push(d)
  if (!candidates.length || !plannedSlots.length) return []

  const target = Math.min(plannedSlots.length, candidates.length)
  // The plan's own training rhythm: 3 days/week → every ~2 days; 5+ → consecutive.
  const gap = Math.max(1, Math.floor(7 / plannedSlots.length))

  const out: number[] = []
  let last = Number.NEGATIVE_INFINITY
  for (const d of candidates) {
    if (out.length >= target) break
    if (d - last >= gap) { out.push(d); last = d }
  }
  return out
}

const EXPERIENCE_ORDER: Experience[] = ['beginner', 'intermediate', 'advanced']

function getStartMonday(): Date {
  // Always anchor to THIS week's Monday. Past-dated sessions in the start week are
  // skipped at insert time (see the loop below), so a mid-week signup never gets
  // workouts dated before today — which the missed-workout sweep would otherwise
  // immediately flag as "missed" on day one. Late-week signups simply start their
  // first sessions on the remaining training days this week (or next Monday).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monBased = (today.getDay() + 6) % 7 // Mon=0 … Sun=6
  const monday = new Date(today)
  monday.setDate(today.getDate() - monBased)
  return monday
}

// Delegates to the shared formatter in planRollover so the rollover kernel and the
// plan generator can never disagree on how a planned_date is spelled.
function formatDate(d: Date): string {
  return formatLocalDate(d)
}

// A session as a coach would write it: an ORDERED list of slots, each with a
// tier (its place in the hierarchy — power → primary → … → isolation → finisher)
// and one or more acceptable slots in preference order. Order in the array IS the
// session order, so exercises come out power → heavy compound → accessory →
// isolation → core/cardio without any post-sort.
type Tier = 'power' | 'primary' | 'secondary' | 'accessory' | 'isolation' | 'core' | 'cardio'
export interface SlotSpec {
  slots: Slot[]           // acceptable slots, most-preferred first
  tier: Tier
  optional?: boolean      // dropped first when the time budget is tight
  preferRole?: Role       // e.g. prefer explosive movements for an athletic power slot
}
export interface SessionTemplate { focus: string; slots: SlotSpec[] }

// ── Slot-spec shorthands ──────────────────────────────────────────────────────
const S = (slots: Slot[], tier: Tier, opts: { optional?: boolean; preferRole?: Role } = {}): SlotSpec =>
  ({ slots, tier, ...opts })
const CORE: SlotSpec = S(['core'], 'core', { optional: true })
const CARDIO: SlotSpec = S(['cardio'], 'cardio')

// ── Reusable session shapes ───────────────────────────────────────────────────
const PUSH_DAY: SessionTemplate = { focus: 'Push', slots: [
  S(['h_push'], 'primary'), S(['v_push'], 'secondary'), S(['h_push'], 'accessory'),
  S(['chest_iso'], 'isolation', { optional: true }), S(['lat_raise'], 'isolation'),
  S(['triceps'], 'isolation'), CORE,
] }
const PULL_DAY: SessionTemplate = { focus: 'Pull', slots: [
  S(['v_pull'], 'primary'), S(['h_pull'], 'secondary'), S(['h_pull'], 'accessory'),
  S(['rear_delt'], 'isolation'), S(['biceps'], 'isolation'),
  S(['biceps'], 'isolation', { optional: true }), CORE,
] }
const LEGS_DAY: SessionTemplate = { focus: 'Legs', slots: [
  S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge', 'squat'], 'accessory'),
  S(['knee_flexion'], 'isolation'), S(['quad_iso'], 'isolation'),
  S(['calf'], 'isolation'), CORE,
] }
const UPPER_A: SessionTemplate = { focus: 'Upper A', slots: [
  S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
  S(['v_pull'], 'secondary'), S(['lat_raise'], 'isolation'), S(['biceps'], 'isolation'),
  S(['triceps'], 'isolation'),
] }
const UPPER_B: SessionTemplate = { focus: 'Upper B', slots: [
  S(['v_push'], 'primary'), S(['v_pull'], 'primary'), S(['h_push'], 'secondary'),
  S(['h_pull'], 'secondary'), S(['rear_delt'], 'isolation'), S(['triceps'], 'isolation'),
  S(['biceps'], 'isolation'),
] }
const LOWER_A: SessionTemplate = { focus: 'Lower A', slots: [
  S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge', 'squat'], 'accessory'),
  S(['knee_flexion'], 'isolation'), S(['quad_iso'], 'isolation'), S(['calf'], 'isolation'),
] }
const LOWER_B: SessionTemplate = { focus: 'Lower B', slots: [
  S(['hinge'], 'primary'), S(['squat'], 'secondary'), S(['lunge'], 'accessory'),
  S(['knee_flexion'], 'isolation'), S(['glute_iso'], 'isolation'), S(['calf'], 'isolation'),
] }
const fullBody = (focus: string, order: Slot[], finisher: SlotSpec = CORE): SessionTemplate => ({
  focus,
  slots: [
    S([order[0]], 'primary'), S([order[1]], 'secondary'),
    S([order[2]], 'accessory'), S([order[3]], 'accessory', { optional: true }),
    finisher,
  ],
})

// ── Goal-specific programs ────────────────────────────────────────────────────

// Cardio is OPTIONAL and dropped first by the time-budget trimmer (S(...,
// {optional:true})) — asking for it never guarantees it survives a short session,
// same honesty as every other optional slot in this file.
const CARDIO_OPT: SlotSpec = S(['cardio'], 'cardio', { optional: true })
const withCardio = (t: SessionTemplate, on: boolean): SessionTemplate =>
  on ? { ...t, slots: [...t.slots, CARDIO_OPT] } : t

function muscleSessions(days: number, cardio = false): SessionTemplate[] {
  const list = days === 2 ? [UPPER_A, LOWER_A]
    : days === 3 ? [PUSH_DAY, PULL_DAY, LEGS_DAY]
    : days === 4 ? [UPPER_A, LOWER_A, UPPER_B, LOWER_B]
    : days === 5 ? [PUSH_DAY, PULL_DAY, LEGS_DAY, UPPER_A, LOWER_A]
    : [PUSH_DAY, PULL_DAY, LEGS_DAY, PUSH_DAY, PULL_DAY, LEGS_DAY] // 6 — PPL ×2
  return list.map(t => withCardio(t, cardio))
}

function strengthSessions(days: number, cardio = false): SessionTemplate[] {
  // Fewer movements, compound-dominant, minimal isolation.
  const squat: SessionTemplate = { focus: 'Squat Day', slots: [
    S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge', 'squat'], 'accessory'),
    S(['knee_flexion'], 'isolation', { optional: true }), CORE,
  ] }
  const press: SessionTemplate = { focus: 'Press Day', slots: [
    S(['h_push'], 'primary'), S(['v_push'], 'secondary'), S(['h_pull'], 'accessory'),
    S(['triceps'], 'isolation', { optional: true }), CORE,
  ] }
  const dead: SessionTemplate = { focus: 'Deadlift Day', slots: [
    S(['hinge'], 'primary'), S(['squat'], 'secondary'), S(['h_pull'], 'accessory'),
    S(['knee_flexion'], 'isolation', { optional: true }), CORE,
  ] }
  const pull: SessionTemplate = { focus: 'Pull Day', slots: [
    S(['v_pull'], 'primary'), S(['h_pull'], 'secondary'), S(['rear_delt'], 'isolation'),
    S(['biceps'], 'isolation'), CORE,
  ] }
  const upper: SessionTemplate = { focus: 'Upper', slots: [
    S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
    S(['biceps'], 'isolation', { optional: true }), CORE,
  ] }
  const list = days === 2 ? [squat, press]
    : days === 3 ? [squat, press, dead]
    : days === 4 ? [squat, press, dead, pull]
    : days === 5 ? [squat, press, dead, pull, upper]
    : [squat, press, pull, dead, upper, squat]
  return list.map(t => withCardio(t, cardio))
}

function fatLossSessions(days: number): SessionTemplate[] {
  // Full-body density work; a cardio finisher keeps the heart rate up.
  const fbA = fullBody('Full Body A', ['squat', 'h_push', 'h_pull', 'hinge'], CARDIO)
  const fbB = fullBody('Full Body B', ['hinge', 'v_push', 'v_pull', 'squat'], CARDIO)
  const fbC = fullBody('Full Body C', ['squat', 'h_push', 'h_pull', 'lunge'], CARDIO)
  const cond: SessionTemplate = { focus: 'Conditioning', slots: [
    S(['squat', 'lunge'], 'primary'), S(['h_push'], 'secondary'), S(['h_pull'], 'accessory'),
    CARDIO, CORE,
  ] }
  const upCi: SessionTemplate = { focus: 'Upper Circuit', slots: [
    S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
    CARDIO, CORE,
  ] }
  if (days === 2) return [fbA, fbB]
  if (days === 3) return [fbA, fbB, fbC]
  if (days === 4) return [fbA, fbB, fbC, cond]
  if (days === 5) return [fbA, fbB, fbC, cond, upCi]
  return [fbA, fbB, fbC, cond, upCi, fbA]
}

function athleticSessions(days: number): SessionTemplate[] {
  const power: SessionTemplate = { focus: 'Power', slots: [
    S(['hinge', 'squat'], 'power', { preferRole: 'power' }), S(['squat'], 'primary'),
    S(['h_push'], 'secondary'), S(['lunge'], 'accessory'), CARDIO,
  ] }
  const upper: SessionTemplate = { focus: 'Upper Power', slots: [
    S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
    S(['v_pull'], 'secondary'), CORE,
  ] }
  const lower: SessionTemplate = { focus: 'Lower Power', slots: [
    S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge'], 'accessory'),
    S(['knee_flexion'], 'isolation'), CARDIO,
  ] }
  const cond: SessionTemplate = { focus: 'Conditioning', slots: [
    S(['squat', 'lunge'], 'power', { preferRole: 'power' }), S(['h_push'], 'secondary'),
    CARDIO, S(['carry', 'core'], 'accessory'), CORE,
  ] }
  const full = fullBody('Full Body', ['squat', 'h_push', 'h_pull', 'hinge'], CARDIO)
  if (days === 2) return [upper, lower]
  if (days === 3) return [power, upper, lower]
  if (days === 4) return [power, upper, lower, cond]
  if (days === 5) return [power, upper, lower, cond, full]
  return [power, upper, lower, cond, full, power]
}

function generalSessions(days: number): SessionTemplate[] {
  const fbA = fullBody('Full Body A', ['squat', 'hinge', 'h_push', 'h_pull'])
  const fbB = fullBody('Full Body B', ['h_push', 'h_pull', 'squat', 'hinge'])
  const fbC = fullBody('Full Body C', ['hinge', 'squat', 'v_pull', 'v_push'])
  const upper: SessionTemplate = { focus: 'Upper Body', slots: [
    S(['h_push'], 'primary'), S(['h_pull'], 'primary'), S(['v_push'], 'secondary'),
    S(['v_pull'], 'secondary'), S(['lat_raise'], 'isolation', { optional: true }), CORE,
  ] }
  const lower: SessionTemplate = { focus: 'Lower Body', slots: [
    S(['squat'], 'primary'), S(['hinge'], 'secondary'), S(['lunge', 'squat'], 'accessory'),
    S(['knee_flexion'], 'isolation'), S(['calf'], 'isolation', { optional: true }), CORE,
  ] }
  if (days === 2) return [fbA, fbB]
  if (days === 3) return [fbA, fbB, fbC]
  if (days === 4) return [upper, lower, fbA, fbB]
  if (days === 5) return [fbA, upper, lower, fbB, fbC]
  return [upper, lower, fbA, upper, lower, fbB]
}

function buildSessionTemplates(goal: Goal, days: number, includeCardio = false): SessionTemplate[] {
  const n = clampDays(days)
  switch (goal) {
    case 'muscle_gain':  return muscleSessions(n, includeCardio)
    case 'strength':     return strengthSessions(n, includeCardio)
    case 'fat_loss':     return fatLossSessions(n)
    case 'athletic':     return athleticSessions(n)
    default:             return generalSessions(n)
  }
}

// ── Exercise selection ────────────────────────────────────────────────────────

export interface ExRow {
  id: string
  name: string
  movement_pattern: string
  experience_level: string
  required_equipment: string[]
  primary_muscles?: string[] | null
  secondary_muscles?: string[] | null
  is_core?: boolean | null
  popularity?: number | null
}

// Sort so the highest-value exercise comes first: prefer more equipment options
// (barbells > dumbbells > bodyweight), then well-known staples over long-tail
// variants (popularity), and breadth of primary muscles.
function sortPool(pool: ExRow[], goal: Goal, fam: FamiliarityIndex = NO_HISTORY): ExRow[] {
  const eqScore = (eq: string[]): number => {
    if (eq.includes('barbell'))   return goal === 'strength' ? 10 : 5
    if (eq.includes('full_gym'))  return 4
    if (eq.includes('dumbbells')) return 3
    if (eq.includes('kettlebell')) return 3
    if (eq.includes('resistance_bands')) return 2
    return 1 // bodyweight
  }
  // Movements the user has actually trained come first; with no history every
  // pair ties here and the original equipment/popularity order is untouched.
  return [...pool].sort((a, b) =>
    byFamiliarity(a.id, b.id, fam) ||
    eqScore(b.required_equipment) - eqScore(a.required_equipment) ||
    (b.popularity ?? 30) - (a.popularity ?? 30)
  )
}

// How many exercises a slot pool keeps for session rotation. Big enough for
// week-to-week variety, small enough that every pick is a movement a coach would
// actually program (pools are popularity-sorted before the cap).
const SLOT_POOL_CAP = 10

// A session's own emphasis, from the slots its template actually asks for. Used
// to bound affinity fallback (below): a session that is wholly push or wholly
// pull never borrows from the other side, while a genuinely mixed day (Upper,
// Full Body) is free to use both. `core`/`cardio`/`carry` are side-less and are
// ignored when working the emphasis out, so a Push day is still "push" despite
// its core finisher.
function templateSide(template: SessionTemplate): SlotSide | 'mixed' {
  const sides = new Set<SlotSide>()
  for (const spec of template.slots) {
    for (const slot of spec.slots) {
      const side = slotSide(slot)
      if (side !== 'neutral') sides.add(side)
    }
  }
  if (sides.size === 0) return 'neutral'
  if (sides.size === 1) return [...sides][0]
  return 'mixed'
}

// When a slot's own pool runs dry, which OTHER slots still serve the same job — a
// thin knee_flexion borrows another hamstring movement, never a plank. Keeps the
// coaching intent intact rather than padding with whatever's left.
const SLOT_AFFINITY: Record<Slot, Slot[]> = {
  squat: ['lunge', 'hinge'],
  hinge: ['glute_iso', 'squat'],
  lunge: ['squat', 'quad_iso'],
  knee_flexion: ['hinge', 'glute_iso'],
  quad_iso: ['lunge', 'squat'],
  glute_iso: ['hinge', 'lunge'],
  calf: ['quad_iso'],
  h_push: ['v_push', 'chest_iso'],
  v_push: ['h_push', 'lat_raise'],
  chest_iso: ['h_push'],
  triceps: ['h_push'],
  h_pull: ['v_pull', 'rear_delt'],
  v_pull: ['h_pull'],
  rear_delt: ['h_pull', 'lat_raise'],
  lat_raise: ['v_push', 'rear_delt'],
  biceps: ['h_pull'],
  core: [],
  cardio: ['core'],
  carry: ['core'],
}

// Tiers that demand a multi-joint movement — an isolation (curl, shrug, calf)
// must never fill a primary/secondary/accessory compound slot.
const COMPOUND_TIERS = new Set<Tier>(['power', 'primary', 'secondary', 'accessory'])

// Fill a template's ordered slots with the best available exercise for each,
// enforcing role fit (compound slots reject isolation work), anti-redundancy (no
// two picks share a lift family — never two deadlift variants), rotation for
// week-to-week variety, and a time budget (optional/tail slots drop first).
// `rotation` is a per-focus occurrence index so the FIRST time a session appears
// it opens with the canonical lift (back squat), then varies. Returns ids in
// session order.
export function selectForSlots(
  bySlot: Partial<Record<Slot, ExRow[]>>,
  template: SessionTemplate,
  rotation: number,
  target: number,
  fam: FamiliarityIndex = NO_HISTORY,
): string[] {
  const required = template.slots.filter(s => !s.optional)
  const optional = template.slots.filter(s => s.optional)
  const chosen = [...required, ...optional].slice(0, Math.max(1, target))

  const usedIds = new Set<string>()
  const usedFamilies = new Set<string>()
  const ids: string[] = []
  // One slot per session may deliberately go to a movement the user has never
  // done — the last one, and only for someone with enough of a base to benefit.
  // Everything before it is ordered familiar-first by sortPool. See
  // exerciseFamiliarity for why this is bounded rather than free-running.
  const noveltyAt = noveltySlotIndex(fam, chosen.length)

  // Pick the first eligible exercise from a slot pool. `gated` enforces the
  // compound-tier role rule; a second ungated pass is the safety net so a
  // thin-equipment slot is never left empty on a technicality.
  const tryPick = (
    pool: ExRow[] | undefined, spec: SlotSpec, offset: number, gated: boolean,
    preferNew = false,
  ): boolean => {
    if (!pool?.length) return false
    const roleOrdered = spec.preferRole
      ? [...pool].sort((a, b) =>
          (classifyExercise(b).role === spec.preferRole ? 1 : 0) -
          (classifyExercise(a).role === spec.preferRole ? 1 : 0))
      : pool
    // Split the pool by familiarity and rotate WITHIN the preferred half.
    //
    // `rotation` deliberately starts the scan at a different index each week, for
    // week-to-week variety. Applied across the whole pool it would step straight
    // past a lift the user knows onto one they have never done, so the variety
    // knob would silently undo the familiarity one — the same trap Quick Workout's
    // pickBest hit. Rotating inside a single tier keeps both properties.
    //
    // With no history every exercise falls in the same tier, `preferred` is the
    // whole pool and `rest` is empty, so this is byte-for-byte the old behaviour.
    const wantKnown = !preferNew
    const preferred = roleOrdered.filter(e => (fam.sessions(e.id) > 0) === wantKnown)
    const rest = preferred.length ? roleOrdered.filter(e => !preferred.includes(e)) : []
    const scan = (list: ExRow[]): boolean => {
      for (let k = 0; k < list.length; k++) {
        const ex = list[(rotation + offset + k) % list.length]
        if (!ex || usedIds.has(ex.id)) continue
        const cls = classifyExercise(ex)
        if (usedFamilies.has(cls.family)) continue
        if (gated && COMPOUND_TIERS.has(spec.tier) && cls.role !== 'compound' && cls.role !== 'power') continue
        usedIds.add(ex.id); usedFamilies.add(cls.family); ids.push(ex.id)
        return true
      }
      return false
    }
    // Preferred tier first; the other half is a fallback so a slot is never left
    // empty just because everything familiar was already used this session.
    return scan(preferred.length ? preferred : roleOrdered) || (rest.length ? scan(rest) : false)
  }

  // What this session is FOR. Affinity fallback may never cross it, so a Push day
  // whose lateral-raise pool is empty widens into another press — never into a
  // rear-delt row (production bug, 2026-09-03; see slotSide in exerciseProgramming).
  const side = templateSide(template)

  chosen.forEach((spec, i) => {
    // Preferred slots first, then affinity neighbours — each in preference order.
    // A template's OWN slots are always honoured (a Press Day may ask for h_pull
    // on purpose); only the borrowed neighbours are side-checked.
    const order: Slot[] = [...spec.slots]
    for (const s of spec.slots) {
      for (const a of SLOT_AFFINITY[s] ?? []) {
        if (!order.includes(a) && sideAllows(side, a)) order.push(a)
      }
    }
    const wantNew = i === noveltyAt
    for (const slot of order) if (tryPick(bySlot[slot], spec, i, true, wantNew)) return
    for (const slot of order) if (tryPick(bySlot[slot], spec, i, false, wantNew)) return
    // Nothing fit (thin equipment/injury) — leave it out; a short honest session
    // beats padding a Push day with planks.
  })

  return ids
}


// ── Cleanup stale plan data ───────────────────────────────────────────────────

async function clearActivePlans(client: SupabaseClient, userId: string): Promise<void> {
  // Generating a plan switches the user back to the auto-generated program, so any
  // active custom split is retired too — otherwise it would keep materializing
  // workouts on top of the new plan on every app open.
  const { error: splitErr } = await client
    .from('splits')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true)
  if (splitErr) throw splitErr

  // Retire EVERY still-scheduled plan-linked or split-sourced session from today
  // forward, not just the active plan's. Rows stranded under an abandoned plan
  // (e.g. an older failed change) still occupy the one-plan-per-day unique slot,
  // so leaving them behind made every future plan insert fail. Sweeping them all
  // both prevents and heals that state. Completed/missed history, past rows the
  // missed-workout sweep still owes a verdict, and ad-hoc quick/custom sessions
  // are kept.
  await sweepScheduledPlanRows(client, userId)

  const { data: active, error: activeErr } = await client
    .from('user_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (activeErr) throw activeErr
  if (!active?.length) return

  const { error: abandonErr } = await client
    .from('user_plans')
    .update({ status: 'abandoned' })
    .in('id', active.map((p: any) => p.id))
  if (abandonErr) throw abandonErr
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function generatePlan(
  client: SupabaseClient,
  userId: string,
  profile: PlanProfile,
): Promise<void> {
  await clearActivePlans(client, userId)

  // Hard constraints captured in onboarding/settings: never-train weekdays and
  // injuries. The plan itself must respect them — auto-scheduling only ever moves
  // TIMES on a day, so a workout born on a forbidden day could never be saved.
  const constraints = await fetchPlanConstraints(client, userId)
  const days = clampDays(profile.days_per_week)

  // ── Find best matching program ──────────────────────────────────────────────
  const { data: programs, error: progErr } = await client
    .from('programs')
    .select('id, goals, experience_level, days_per_week')

  if (progErr) throw progErr
  if (!programs?.length) throw new Error('No programs found in the database.')

  const goalPool = programs.filter((p: any) => p.goals.includes(profile.goal))
  const basePool = goalPool.length ? goalPool : programs

  let expPool = basePool.filter((p: any) => p.experience_level === profile.experience)
  if (!expPool.length) expPool = basePool.filter((p: any) => p.experience_level === 'beginner')
  if (!expPool.length) expPool = basePool

  const best = expPool.find((p: any) => p.days_per_week === days)
    ?? expPool.reduce((acc: any, p: any) =>
      Math.abs(p.days_per_week - days) < Math.abs(acc.days_per_week - days) ? p : acc
    )

  // ── Create user_plan ────────────────────────────────────────────────────────
  const startMonday = getStartMonday()
  const endDate = new Date(startMonday)
  endDate.setDate(startMonday.getDate() + 28)

  const { data: planRow, error: planErr } = await client
    .from('user_plans')
    .insert({
      user_id: userId,
      program_id: best.id,
      start_date: formatDate(startMonday),
      end_date: formatDate(endDate),
      status: 'active',
    })
    .select('id')
    .single()

  if (planErr) throw planErr
  if (!planRow) throw new Error('Failed to create plan.')

  // A fresh plan starts a normal mesocycle (overload weeks 1–3, deload week 4).
  // The adaptation engine re-stamps these later if signals call for recovery/deload.
  const ctx = await buildBlockContext(client, { ...profile, days_per_week: days }, constraints)
  const workouts = buildBlockRows(ctx, userId, planRow.id, startMonday, 0, BLOCK_WEEKS, 'normal', 0)

  const { error: insertErr } = await client.from('scheduled_workouts').insert(workouts)
  if (insertErr) throw insertErr

  // Surface the new program in My Splits as an activatable mirror (best-effort).
  await ensureAutoSplit(client, userId, profile.goal)
}

// ── Shared block machinery (initial plan + rollover use the same path) ────────

interface BlockBuildCtx {
  slots: number[]
  templates: SessionTemplate[]
  bySlot: Partial<Record<Slot, ExRow[]>>
  targetCount: number
  timeOfDay: TimeOfDay
  experience: Experience
  goal: Goal
  /** Wake/bed/work/school, so every start time is one the user can make. */
  availability: AvailabilityInputs
  /** Session length used to check a start actually FITS before the next commitment. */
  sessionMinutes: number
  /** Days the user marked unavailable — needed to re-lay the current week (see currentWeekSlots). */
  blockedWeekdays: Set<number>
  /** What the user has trained before — biases selection toward known movements. */
  familiarity: FamiliarityIndex
}

async function buildBlockContext(
  client: SupabaseClient,
  profile: PlanProfile,
  constraints: PlanConstraints,
): Promise<BlockBuildCtx> {
  // ── Filter exercises by equipment + experience ──────────────────────────────
  // Only the curated CORE pool is programmable — the full library (1300+ rows)
  // exists for search/swaps/manual building, but a generated plan must read like
  // a coach wrote it, not a random walk through cable-machine variants.
  const { data: allEx, error: exErr } = await client
    .from('exercises')
    .select('id, name, movement_pattern, experience_level, required_equipment, primary_muscles, secondary_muscles, is_core, popularity')
    .is('user_id', null)

  if (exErr) throw exErr

  const userExpIdx = EXPERIENCE_ORDER.indexOf(profile.experience)
  const equipment = expandEquipment(profile.equipment)

  // Equipment-match first; experience is applied per-pattern below as a PREFERENCE
  // (one tier above the user's level is kept as backup) instead of a hard cut — a
  // thin library must never leave a movement pattern empty when a slightly
  // harder-labelled machine exercise would do.
  const expIdxOf = (ex: ExRow) => EXPERIENCE_ORDER.indexOf(ex.experience_level as Experience)
  const filtered = ((allEx ?? []) as ExRow[]).filter(ex =>
    expIdxOf(ex) <= userExpIdx + 1 &&
    canPerform(ex, equipment) &&
    !constraints.excludedExerciseIds.has(ex.id)
  )

  if (!filtered.length) {
    throw new Error(
      'No exercises found for your equipment and experience level. ' +
      'Make sure the exercises table is seeded in Supabase.'
    )
  }

  // Respect injuries with the same mapping Quick Workouts use — the plan must not
  // program squats onto bad knees. If the filter would empty the pool entirely,
  // fall back to the unfiltered set rather than generate nothing.
  const { avoidMuscles, avoidPatterns } = injuriesToRestrictions(constraints.injuries)
  const avoidM = new Set(avoidMuscles)
  const avoidP = new Set<string>(avoidPatterns as string[])
  const safe = filtered.filter(ex =>
    !avoidP.has(ex.movement_pattern) &&
    ![...(ex.primary_muscles ?? []), ...(ex.secondary_muscles ?? [])].some(m => avoidM.has(m))
  )
  const pool = safe.length ? safe : filtered

  // Group by coaching SLOT (via the classifier), not the coarse movement_pattern —
  // this is what lets a Legs day distinguish a squat from a leg extension from a
  // calf raise. Mobility rows are warm-up/cooldown work, never a training slot.
  // Within each slot, prefer the curated core pool (fall back to the full library
  // only when equipment/injury filters left it empty), the user's own level first
  // (sorted by goal-relevance + popularity), then one-tier-above backups.
  const bySlot: Partial<Record<Slot, ExRow[]>> = {}
  for (const ex of pool) {
    if (ex.movement_pattern === 'mobility') continue
    const slot = classifyExercise(ex).slot
    ;(bySlot[slot] ??= []).push(ex)
  }
  for (const slot of Object.keys(bySlot) as Slot[]) {
    const all = bySlot[slot]!
    const core = all.filter(ex => ex.is_core === true)
    const source = core.length ? core : all
    const inLevel = source.filter(ex => expIdxOf(ex) <= userExpIdx)
    const backup = source.filter(ex => expIdxOf(ex) > userExpIdx)
    bySlot[slot] = [
      ...sortPool(inLevel, profile.goal, constraints.familiarity),
      ...sortPool(backup, profile.goal, constraints.familiarity),
    ].slice(0, SLOT_POOL_CAP)
  }

  const days = clampDays(profile.days_per_week)
  return {
    slots: chooseDaySlots(days, constraints.blockedWeekdays),
    blockedWeekdays: constraints.blockedWeekdays,
    familiarity: constraints.familiarity,
    // Rotated by the plan's persisted rotation_offset so a shifted rotation
    // survives the next block instead of snapping back at the horizon (see
    // add_plan_rotation_offset.sql). Offset 0 leaves the array identical.
    templates: rotateTemplates(
      buildSessionTemplates(profile.goal, days, profile.include_cardio),
      constraints.rotationOffset ?? 0,
    ),
    bySlot,
    // How many exercises fit the user's preferred session length FOR THIS GOAL —
    // a strength day (full 3-min rests) fits fewer lifts than a fat-loss circuit
    // in the same wall-clock window. Duration is then derived from the count we
    // actually place, so the time shown always matches the real work + rest.
    targetCount: exerciseCountForDuration(profile.preferred_duration_min, profile.goal),
    timeOfDay: profile.preferred_time_of_day ?? 'morning',
    experience: profile.experience,
    goal: profile.goal,
    // Profile fields win when the caller supplied them; otherwise the values
    // fetchPlanConstraints already read. Either way every generation is
    // availability-aware.
    availability: {
      ...constraints.availability,
      ...(profile.wake_time != null ? { wake_time: profile.wake_time } : {}),
      ...(profile.bedtime != null ? { bedtime: profile.bedtime } : {}),
      ...(profile.work_start != null ? { work_start: profile.work_start } : {}),
      ...(profile.work_end != null ? { work_end: profile.work_end } : {}),
      ...(profile.school_start != null ? { school_start: profile.school_start } : {}),
      ...(profile.school_end != null ? { school_end: profile.school_end } : {}),
    },
    sessionMinutes: profile.preferred_duration_min,
  }
}

function buildBlockRows(
  ctx: BlockBuildCtx,
  userId: string,
  planId: string,
  startMonday: Date,
  weekFrom: number,
  weekCount: number,
  mode: AdaptationMode,
  sessionCountStart: number,
): object[] {
  const todayStr = formatDate(new Date())
  const nowStr = nowTimeStr()
  const rows: object[] = []
  let sessionCount = sessionCountStart
  // Start times are per-weekday now: the same session is a different hour on a
  // school day than on a Saturday, because the free windows differ.
  const startAt = (weekday: number, idx: number) =>
    startTimeFor(ctx.timeOfDay, idx, weekday, ctx.sessionMinutes, ctx.availability)
  // Per-focus occurrence index drives exercise rotation, so the FIRST Push/Pull/
  // Legs each open with the canonical top lift and later ones vary. Seeded from
  // the rotation offset so a rollover block keeps varying rather than resetting.
  const focusRotation = new Map<string, number>()

  for (let week = weekFrom; week < weekFrom + weekCount; week++) {
    // weekProgression cycles the wave modulo the block length, so week 5 starts a
    // fresh Base week — the plan repeats its mesocycle instead of ending.
    const progression = weekProgression(week, ctx.experience, mode)

    // Mid-week generation: re-lay THIS calendar week's sessions across the days
    // that are actually left, instead of silently dropping the ones already
    // past (see currentWeekSlots). Keyed on the real date, not the week index —
    // for the rollover/extension path `startMonday` is the plan's ORIGINAL start,
    // so week 0 there is not necessarily the current week.
    const weekMonday = new Date(startMonday)
    weekMonday.setDate(startMonday.getDate() + week * 7)
    const isCurrentWeek = formatDate(weekMonday) === formatDate(getStartMonday())
    const slotsForWeek = isCurrentWeek
      ? currentWeekSlots(
          ctx.slots,
          ((new Date().getDay() + 6) % 7) + 1, // today, 1=Mon … 7=Sun
          startAt(((new Date().getDay() + 6) % 7) + 1, sessionCount) > nowStr,
          ctx.blockedWeekdays,
        )
      : ctx.slots

    for (const slot of slotsForWeek) {
      const date = new Date(startMonday)
      date.setDate(startMonday.getDate() + week * 7 + (slot - 1))

      // Never create a past-dated session (mid-week signups): it would be marked
      // "missed" instantly. Skip without consuming a template so rotation stays intact.
      if (formatDate(date) < todayStr) continue
      // Same guard for TODAY specifically: a signup late in the day would otherwise
      // still get a same-day session dated with a start time already behind "now" —
      // not "missed" by the DB sweep (date isn't in the past), but it reads as
      // overdue within minutes of finishing onboarding. Push to the next valid day
      // instead of forcing a session into a window that's already gone.
      if (formatDate(date) === todayStr && startAt(slot, sessionCount) <= nowStr) continue

      const template = ctx.templates[sessionCount % ctx.templates.length]
      const rot = (focusRotation.get(template.focus) ?? Math.floor(sessionCountStart / ctx.templates.length))
      focusRotation.set(template.focus, rot + 1)
      const exerciseIds = selectForSlots(ctx.bySlot, template, rot, ctx.targetCount, ctx.familiarity)

      rows.push({
        user_id: userId,
        user_plan_id: planId,
        planned_date: formatDate(date),
        planned_start_time: startAt(slot, sessionCount),
        planned_duration_min: estimateSessionMinutes(exerciseIds.length, ctx.goal, progression.isDeload),
        focus: progression.isDeload ? `${template.focus} (Deload)` : template.focus,
        status: 'scheduled',
        source: 'plan',
        exercise_ids: exerciseIds,
        week_index: week,
        // The pure date-offset meaning of `week` — never rewritten by
        // adaptation.applyAdaptationMode (only week_index is), so rollover
        // can always trust it to mean "weeks since plan start" (see
        // add_week_offset.sql / MASTER_FIX_PLAN.md F1).
        week_offset: week,
        progression,
      })

      sessionCount++
    }
  }
  return rows
}

// ── Plan rollover — the plan never just ends ──────────────────────────────────
// The runway/week-count decision lives in the pure, unit-tested `planRollover`
// kernel (PLAN_RUNWAY_DAYS / planNeedsExtension / planExtensionWeeks) — this
// orchestrates the DB reads/writes around it.

// When the active plan's last scheduled session is within PLAN_RUNWAY_DAYS (or
// already past), materialize the next 4-week block: week_index keeps counting up,
// the mesocycle wave cycles (weekProgression is modulo the block), and the new
// block reflects the user's CURRENT profile — days, equipment, injuries, blocked
// weekdays, and the plan's adaptation_mode. Runs on app open; cheap no-op while
// there's runway; returns how many sessions were added. Best-effort by design.
export async function extendActivePlan(client: SupabaseClient, userId: string): Promise<number> {
  try {
    const { data: plan } = await client
      .from('user_plans')
      .select('id, start_date, adaptation_mode, rotation_offset')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!plan) return 0

    const { data: lastRow } = await client
      .from('scheduled_workouts')
      .select('planned_date')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .order('planned_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!lastRow) return 0 // a plan with no sessions at all isn't ours to revive

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (!planNeedsExtension(lastRow.planned_date as string, today, PLAN_RUNWAY_DAYS)) return 0

    // week_offset (not week_index — see add_week_offset.sql) is the field that
    // actually means "weeks since plan start"; week_index can have been
    // re-anchored by adaptation.applyAdaptationMode and no longer means that.
    const { data: lastWeekRow } = await client
      .from('scheduled_workouts')
      .select('week_offset')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .order('week_offset', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastWeek = (lastWeekRow?.week_offset as number | null) ?? (BLOCK_WEEKS - 1)

    const { data: p } = await client
      .from('user_profiles')
      .select('goal, experience, equipment, days_per_week, preferred_duration_min, preferred_time_of_day, wake_time, bedtime, work_start, work_end, school_start, school_end')
      .eq('user_id', userId)
      .maybeSingle()
    if (!p) return 0

    const profile: PlanProfile = {
      goal: (p.goal ?? 'general_fitness') as Goal,
      experience: (p.experience ?? 'beginner') as Experience,
      equipment: (p.equipment ?? []) as string[],
      days_per_week: clampDays(p.days_per_week ?? 3),
      preferred_duration_min: p.preferred_duration_min ?? 45,
      preferred_time_of_day: (p.preferred_time_of_day ?? null) as TimeOfDay | null,
      wake_time: (p.wake_time ?? null) as string | null,
      bedtime: (p.bedtime ?? null) as string | null,
      work_start: (p.work_start ?? null) as string | null,
      work_end: (p.work_end ?? null) as string | null,
      school_start: (p.school_start ?? null) as string | null,
      school_end: (p.school_end ?? null) as string | null,
    }
    const constraints = await fetchPlanConstraints(client, userId)
    // The plan's persisted rotation slide, so a re-stamp and the next generated
    // block agree on which template a given position carries.
    const ctx = await buildBlockContext(client, profile, {
      ...constraints,
      rotationOffset: (plan.rotation_offset as number | null) ?? 0,
    })

    // Continue the exercise/start-time rotation where the plan left off.
    const { count } = await client
      .from('scheduled_workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
    const sessionCountStart = count ?? 0

    // If the plan went stale (user away for weeks), generate enough weeks to reach
    // today + a full block; past-dated rows are skipped, so only the future lands.
    const startMonday = new Date(`${plan.start_date}T00:00:00`)
    const weeksSinceStart = Math.max(0, Math.floor((today.getTime() - startMonday.getTime()) / (7 * 86_400_000)))
    const { weekFrom, weekCount } = planExtensionWeeks({ lastWeek, weeksSinceStart })

    const rows = buildBlockRows(
      ctx, userId, plan.id as string, startMonday,
      weekFrom, weekCount,
      ((plan.adaptation_mode ?? 'normal') as AdaptationMode), sessionCountStart,
    )
    if (!rows.length) return 0

    // One row at a time, not one bulk insert: a single stale row already
    // occupying a target date (scheduled_workouts_one_plan_per_day) used to
    // fail the WHOLE statement, silently voiding the entire block. Each row
    // now succeeds or fails independently, so one blocked date can't cost the
    // other ~27. Failures are reported (not swallowed) so a persistent block
    // is at least visible in Sentry instead of silently reopening the cliff
    // on every app open.
    let inserted = 0
    for (const row of rows) {
      const { error } = await client.from('scheduled_workouts').insert(row)
      if (error) {
        captureApiError('extendActivePlan.insert', error, { userId, planId: plan.id, row })
      } else {
        inserted++
      }
    }
    if (inserted === 0) return 0

    // Push the plan's bookkeeping end-date out to cover the new block (best-effort).
    const endDate = new Date(startMonday)
    endDate.setDate(startMonday.getDate() + (weekFrom + weekCount) * 7)
    await client.from('user_plans').update({ end_date: formatDate(endDate) }).eq('id', plan.id)

    return inserted
  } catch (err) {
    // Rollover must never break app open — but a silent catch{return 0} here
    // was exactly how the plan-cliff bug went unnoticed; report it now.
    captureApiError('extendActivePlan', err, { userId })
    return 0
  }
}

// ── Re-stamp the live plan for a profile change (experience level-up) ──────────

function stripDeloadFocus(focus: string): string {
  return focus.replace(/\s*\(Deload\)\s*$/i, '')
}

// When the user's experience level changes mid-block (the auto-progression engine
// promotes beginner → intermediate → advanced as they succeed), the coming weeks
// should reflect it *now*, not only at the next 4-week rollover — otherwise a
// celebrated "level up" wouldn't visibly change tomorrow's session. This re-selects
// level-appropriate exercises for every FUTURE plan session and re-computes its
// periodization directive (a beginner's gentle wave vs. an intermediate's overload
// peak), preserving each session's date/time/focus/week position. Idempotent and
// best-effort; returns how many sessions were updated.
export async function restampFuturePlanForExperience(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  try {
    const { data: plan } = await client
      .from('user_plans')
      .select('id, adaptation_mode, rotation_offset')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!plan) return 0 // a split-driven user has no active plan to re-stamp

    const { data: p } = await client
      .from('user_profiles')
      .select('goal, experience, equipment, days_per_week, preferred_duration_min, preferred_time_of_day, include_cardio, wake_time, bedtime, work_start, work_end, school_start, school_end')
      .eq('user_id', userId)
      .maybeSingle()
    if (!p) return 0

    const profile: PlanProfile = {
      goal: (p.goal ?? 'general_fitness') as Goal,
      experience: (p.experience ?? 'beginner') as Experience,
      equipment: (p.equipment ?? []) as string[],
      days_per_week: clampDays(p.days_per_week ?? 3),
      preferred_duration_min: p.preferred_duration_min ?? 45,
      preferred_time_of_day: (p.preferred_time_of_day ?? null) as TimeOfDay | null,
      wake_time: (p.wake_time ?? null) as string | null,
      bedtime: (p.bedtime ?? null) as string | null,
      work_start: (p.work_start ?? null) as string | null,
      work_end: (p.work_end ?? null) as string | null,
      school_start: (p.school_start ?? null) as string | null,
      school_end: (p.school_end ?? null) as string | null,
      include_cardio: !!p.include_cardio,
    }
    const constraints = await fetchPlanConstraints(client, userId)
    // The plan's persisted rotation slide, so a re-stamp and the next generated
    // block agree on which template a given position carries.
    const ctx = await buildBlockContext(client, profile, {
      ...constraints,
      rotationOffset: (plan.rotation_offset as number | null) ?? 0,
    })
    const mode = (plan.adaptation_mode ?? 'normal') as AdaptationMode

    // Map each session's focus back to its template so re-selection stays true to
    // the day (a "Push" day re-picks pushes at the new level, never pulls).
    const focusToTemplate = new Map<string, SessionTemplate>()
    for (const t of buildSessionTemplates(profile.goal, profile.days_per_week, profile.include_cardio)) {
      focusToTemplate.set(t.focus, t)
    }

    const todayStr = formatDate(new Date())
    const { data: future } = await client
      .from('scheduled_workouts')
      .select('id, focus, week_index')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .eq('source', 'plan')
      .eq('status', 'scheduled')
      .gte('planned_date', todayStr)
      .order('planned_date', { ascending: true })
      .order('planned_start_time', { ascending: true })
    if (!future?.length) return 0

    // Continue the exercise rotation from where the completed/past sessions left off
    // so re-picked days don't all collapse onto the same top-of-pool exercises.
    const { count: prior } = await client
      .from('scheduled_workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .eq('source', 'plan')
      .lt('planned_date', todayStr)

    // Per-focus rotation, seeded from how many of each focus already ran, so a
    // re-stamp keeps varying from where the plan was rather than resetting.
    const templatesLen = Math.max(1, buildSessionTemplates(profile.goal, profile.days_per_week, profile.include_cardio).length)
    const focusRotation = new Map<string, number>()
    const priorRot = Math.floor((prior ?? 0) / templatesLen)
    let changed = 0
    // Fixed 2026-08-02: this loop used to discard `{ error }` and count every
    // row as changed regardless — a failed write on the "LEVEL UP" re-stamp
    // left some of the week's future sessions silently un-promoted (still on
    // the old experience level's exercise selection) with no signal anywhere
    // that it happened. Mirrors adaptation.ts's applyAdaptationMode: a failure
    // is reported, not silently ignored, and never counted as a success.
    const failedIds: string[] = []
    for (const w of future) {
      const baseFocus = stripDeloadFocus(w.focus as string)
      const template = focusToTemplate.get(baseFocus)
      if (!template) continue // custom-renamed / unknown focus — leave it untouched
      const rot = focusRotation.get(baseFocus) ?? priorRot
      focusRotation.set(baseFocus, rot + 1)
      const exerciseIds = selectForSlots(ctx.bySlot, template, rot, ctx.targetCount, ctx.familiarity)
      if (!exerciseIds.length) continue
      const weekIndex = (w.week_index as number | null) ?? 0
      const progression = weekProgression(weekIndex, profile.experience, mode)
      const { error } = await client
        .from('scheduled_workouts')
        .update({
          exercise_ids: exerciseIds,
          progression,
          focus: progression.isDeload ? `${baseFocus} (Deload)` : baseFocus,
          planned_duration_min: estimateSessionMinutes(exerciseIds.length, profile.goal, progression.isDeload),
        })
        .eq('id', w.id)
      if (error) { failedIds.push(w.id as string); continue }
      changed++
    }
    if (failedIds.length) {
      captureApiError('restampFuturePlanForExperience', new Error('partial restamp failure'), {
        userId, failedCount: failedIds.length, totalCount: future.length, failedIds,
      })
    }
    return changed
  } catch {
    return 0 // never break the celebration / app open on a re-stamp hiccup
  }
}

// ── Rotation shift — "I missed push, I want push next" ───────────────────────
//
// Founder, 2026-09-14, on his own six-day plan: "if I miss a day then I will
// want to hit it, if I miss push I want to do it next", and "sometimes I will
// just cancel push and schedule legs because I'm on a different track".
//
// Both are one operation: slide the rotation so a chosen position happens next.
// The pure sequencing lives in `lib/rotationShift.ts`; this is the plan-backed
// half — it re-stamps the already-scheduled future sessions AND persists the
// slide on the plan so the next generated block continues in the new order
// rather than seaming back to the old one at the horizon.
//
// Deliberately rotates CONTENT along the existing dates. Nothing here touches
// planned_date or planned_start_time, so synced calendar events, local
// reminders, the one-session-per-day index and the whole availability/free-slot
// machinery are all untouched. A rest day is the absence of a row, so it stays
// exactly where the user put it.

export interface PlanRotationState {
  planId: string
  /** Focus labels in the plan's CURRENT order, e.g. Push/Pull/Legs/Push/Pull/Legs. */
  cycle: string[]
  /** Upcoming, not-yet-done sessions in date order. */
  upcoming: { id: string; focus: string; date: string }[]
  /** Which cycle position the first upcoming session currently holds. */
  nextIndex: number
}

// A focus can appear twice in one cycle (a 6-day muscle plan is PPL twice), so
// indexOf is ambiguous between position 0 and position 3. That ambiguity is
// harmless here and resolving it would need state we do not store: the two
// entries ARE the same template, so anchoring on either produces an identical
// downstream sequence. The only difference is the per-focus exercise rotation
// index, which is seeded from history further down regardless.
function indexOfFocus(cycle: string[], focus: string): number {
  const i = cycle.indexOf(stripDeloadFocus(focus))
  return i < 0 ? 0 : i
}

/** Read the plan's rotation as it stands. Null when there is nothing to shift. */
export async function getPlanRotation(
  client: SupabaseClient,
  userId: string,
): Promise<PlanRotationState | null> {
  try {
    const { data: plan } = await client
      .from('user_plans')
      .select('id, rotation_offset')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!plan) return null

    const { data: p } = await client
      .from('user_profiles')
      .select('goal, days_per_week, include_cardio')
      .eq('user_id', userId)
      .maybeSingle()
    if (!p) return null

    const cycle = rotateTemplates(
      buildSessionTemplates(
        (p.goal ?? 'general_fitness') as Goal,
        (p.days_per_week as number) ?? 3,
        !!p.include_cardio,
      ),
      (plan.rotation_offset as number | null) ?? 0,
    ).map(t => t.focus)
    if (cycle.length < 2) return null // a 1-session cycle cannot be rotated

    const todayStr = formatDate(new Date())
    const { data: future } = await client
      .from('scheduled_workouts')
      .select('id, focus, planned_date')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .eq('source', 'plan')
      .eq('status', 'scheduled')
      .gte('planned_date', todayStr)
      .order('planned_date', { ascending: true })
      .order('planned_start_time', { ascending: true })

    const upcoming = ((future ?? []) as any[]).map(r => ({
      id: r.id as string, focus: r.focus as string, date: r.planned_date as string,
    }))
    if (!upcoming.length) return null

    return {
      planId: plan.id as string,
      cycle,
      upcoming,
      nextIndex: indexOfFocus(cycle, upcoming[0].focus),
    }
  } catch {
    return null
  }
}

/**
 * Slide the rotation by `delta` positions and re-stamp every upcoming session.
 * Returns how many sessions actually changed (0 on any failure, or when the
 * shift is a no-op — e.g. missing the last session of a cycle, where the
 * rotation already continues correctly).
 *
 * Only ever called from an explicit user action. Nothing in the app applies a
 * rotation shift in the background: silently rewriting somebody's week on app
 * open is precisely the behaviour this feature must not have.
 */
export async function shiftPlanRotation(
  client: SupabaseClient,
  userId: string,
  delta: number,
): Promise<number> {
  try {
    if (!Number.isFinite(delta)) return 0

    const { data: plan } = await client
      .from('user_plans')
      .select('id, adaptation_mode, rotation_offset')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!plan) return 0

    const { data: p } = await client
      .from('user_profiles')
      .select('goal, experience, equipment, days_per_week, preferred_duration_min, preferred_time_of_day, include_cardio, wake_time, bedtime, work_start, work_end, school_start, school_end')
      .eq('user_id', userId)
      .maybeSingle()
    if (!p) return 0

    const profile: PlanProfile = {
      goal: (p.goal ?? 'general_fitness') as Goal,
      experience: (p.experience ?? 'beginner') as Experience,
      equipment: (p.equipment ?? []) as string[],
      days_per_week: (p.days_per_week as number) ?? 3,
      preferred_duration_min: (p.preferred_duration_min as number) ?? 45,
      preferred_time_of_day: (p.preferred_time_of_day ?? null) as TimeOfDay | null,
      wake_time: (p.wake_time ?? null) as string | null,
      bedtime: (p.bedtime ?? null) as string | null,
      work_start: (p.work_start ?? null) as string | null,
      work_end: (p.work_end ?? null) as string | null,
      school_start: (p.school_start ?? null) as string | null,
      school_end: (p.school_end ?? null) as string | null,
      include_cardio: !!p.include_cardio,
    }

    // The UNROTATED cycle: anchoring is computed in base-template space so the
    // stored offset and the re-stamped rows cannot drift apart.
    const base = buildSessionTemplates(profile.goal, profile.days_per_week, profile.include_cardio)
    const len = base.length
    if (len < 2) return 0

    const oldOffset = (plan.rotation_offset as number | null) ?? 0
    const step = ((Math.floor(delta) % len) + len) % len
    if (step === 0) return 0

    const todayStr = formatDate(new Date())
    const { data: future } = await client
      .from('scheduled_workouts')
      .select('id, focus, week_index')
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .eq('source', 'plan')
      .eq('status', 'scheduled')
      .gte('planned_date', todayStr)
      .order('planned_date', { ascending: true })
      .order('planned_start_time', { ascending: true })
    if (!future?.length) return 0

    const rotatedOld = rotateTemplates(base, oldOffset).map(t => t.focus)
    const anchor = (indexOfFocus(rotatedOld, (future[0] as any).focus as string) + oldOffset + step) % len
    const newOffset = (((oldOffset + step) % len) + len) % len

    // Persist the slide FIRST. If the re-stamp loop then fails part-way, the
    // plan and every future block still agree on the new order, and the next
    // app open's own re-stamp paths converge on it — the opposite ordering
    // would leave rows in a new order that generation keeps undoing.
    const { error: offsetErr } = await client
      .from('user_plans')
      .update({ rotation_offset: newOffset })
      .eq('id', plan.id)
      .eq('user_id', userId)
    if (offsetErr) return 0

    const constraints = await fetchPlanConstraints(client, userId)
    const ctx = await buildBlockContext(client, profile, { ...constraints, rotationOffset: newOffset })
    const mode = (plan.adaptation_mode ?? 'normal') as AdaptationMode

    // Seed each focus's exercise-rotation index from how much of that focus has
    // already run, so a shift keeps varying rather than resetting everyone to
    // the top of the pool (same rule as the experience re-stamp).
    const { count: prior } = await client
      .from('scheduled_workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('user_plan_id', plan.id)
      .eq('source', 'plan')
      .lt('planned_date', todayStr)
    const priorRot = Math.floor((prior ?? 0) / len)
    const focusRotation = new Map<string, number>()

    let changed = 0
    const failedIds: string[] = []
    for (let i = 0; i < future.length; i++) {
      const w = future[i] as any
      const template = base[(anchor + i) % len]
      const baseFocus = template.focus
      // Already carrying the right session — no write, no churn.
      if (stripDeloadFocus(w.focus as string) === baseFocus) continue

      const rot = focusRotation.get(baseFocus) ?? priorRot
      focusRotation.set(baseFocus, rot + 1)
      const exerciseIds = selectForSlots(ctx.bySlot, template, rot, ctx.targetCount, ctx.familiarity)
      // An empty selection would blank the session. Leave the row exactly as it
      // was rather than hand the user an empty workout.
      if (!exerciseIds.length) continue

      const weekIndex = (w.week_index as number | null) ?? 0
      const progression = weekProgression(weekIndex, profile.experience, mode)
      const { error } = await client
        .from('scheduled_workouts')
        .update({
          focus: progression.isDeload ? `${baseFocus} (Deload)` : baseFocus,
          exercise_ids: exerciseIds,
          progression,
          planned_duration_min: estimateSessionMinutes(exerciseIds.length, profile.goal, progression.isDeload),
        })
        .eq('id', w.id)
        .eq('user_id', userId)
      if (error) { failedIds.push(w.id as string); continue }
      changed++
    }

    if (failedIds.length) {
      captureApiError('shiftPlanRotation', new Error('partial rotation shift failure'), {
        userId, failedCount: failedIds.length, totalCount: future.length, failedIds,
      })
    }
    return changed
  } catch {
    return 0
  }
}
