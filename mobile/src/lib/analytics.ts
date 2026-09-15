// Analytics — product event tracking (PostHog).
//
// Kept deliberately separate from crash reporting (see `crashReporting.ts`).
// This module owns "what users do"; that one owns "when/why the app breaks".
//
// Design notes:
// - Reads its key from EXPO_PUBLIC_POSTHOG_KEY. When that's absent (e.g. local
//   dev without a key, or PR previews) every call becomes a safe no-op, so the
//   app behaves identically with or without analytics configured.
// - Events are typed via `EventProperties` so call sites stay consistent and
//   typos / wrong payloads fail at compile time rather than silently in prod.
// - Init is fire-and-forget and PostHog batches/flushes on a background timer,
//   so there's no measurable cost on app startup or on the JS thread.

import { Platform } from 'react-native'
import Constants from 'expo-constants'
import PostHog from 'posthog-react-native'
import { updateProperties } from '@/lib/otaUpdates'

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

const APP_VERSION = Constants.expoConfig?.version ?? 'unknown'

let posthog: PostHog | null = null

// On web (`expo start --web`, used for quick dev), posthog-react-native can't find
// its native storage (expo-file-system / async-storage) and throws "No storage
// available" — which, because init runs at module load, crashes the whole app.
// Give web a localStorage-backed store (falling back to in-memory); native keeps
// its own default storage untouched (we return undefined there).
type MinimalStorage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }
function webCustomStorage(): MinimalStorage | undefined {
  if (Platform.OS !== 'web') return undefined
  const ls = (globalThis as { localStorage?: Storage }).localStorage
  const mem = new Map<string, string>()
  return {
    getItem: (k) => {
      try { return ls ? ls.getItem(k) : (mem.get(k) ?? null) } catch { return mem.get(k) ?? null }
    },
    setItem: (k, v) => {
      try { if (ls) ls.setItem(k, v); else mem.set(k, v) } catch { mem.set(k, v) }
    },
  }
}

/**
 * The canonical set of product events and their payloads. Add new events here
 * — the typed `track()` signature is derived from this map, so every call site
 * is checked against it. Use `undefined` for events that carry no properties.
 */
export type EventProperties = {
  app_open: undefined
  // Fired on every route change (see _layout.tsx's usePathname effect) — the
  // one centralized screen-tracking hook PostHog's own Expo Router guidance
  // recommends, rather than a manual track() call sprinkled per screen (which
  // is how Home and Progress ended up with zero visibility into the funnel —
  // every OTHER screen's events happen to be action events, not views. C9).
  screen_view: { screen: string }
  user_signup: { method: AuthMethod }
  login: { method: AuthMethod }
  onboarding_complete: {
    goal: string
    experience: string
    days_per_week: number
  }
  // Fired once per screen-complete as the user advances through onboarding, so the
  // PostHog funnel can localize drop-off to a step (B0.3 granularity) instead of
  // only knowing the start (signup) and end (onboarding_complete).
  onboarding_step_completed: {
    step: 'basics' | 'why_tempo' | 'schedule' | 'sleep' | 'work_school' | 'train_time' | 'plan_confirmed'
    substeps?: number
  }
  // The optional calendar tap-in — offered twice, at most: the early "why Tempo"
  // differentiator screen (`context: 'why_tempo'`) and, if still unconnected, the
  // plan-preview reveal (`context` omitted — kept optional so the reveal's
  // existing call sites didn't need touching).
  onboarding_calendar_prompt: {
    action: 'connected_google' | 'connected_device' | 'failed' | 'skipped'
    context?: 'why_tempo'
  }
  // A workout session was started (Quick Workout or a planned session).
  session_start: {
    type: SessionType
    duration_min?: number
    purpose?: string
  }
  // A workout session finished and was logged.
  session_end: {
    type: SessionType
    duration_min?: number
  }
  // Core feature usage.
  quick_workout_generated: { minutes: number; purpose: string }
  // "Reschedule my whole week" — the payable magic (B1.3). Fired on every use so
  // B2.2 can trigger the paywall right at this moment once B2.1 gates it as Pro.
  week_reschedule_used: { moved: number; total: number }
  // "Delay my whole week" — the literal push-back companion to reschedule
  // above (offsetDays is the CLAMPED/applied value, which can be less than
  // what the user picked if the week filled up between opening the picker
  // and confirming it).
  week_delay_used: { offsetDays: number; moved: number; total: number }
  workout_feedback_submitted: { feel: string }
  share_card_opened: undefined
  // Auto-progression graduated the user to a harder experience level.
  experience_promoted: { from: string; to: string }
  // ── Retention & activation instrumentation (audit "Critical" tier) ──────────
  // Fired once per user when the core loop is proven — they returned and completed
  // their Nth session (see lib/activation.ACTIVATION_SESSIONS). The activation event
  // PostHog builds retention cohorts and the onboarding→activation funnel from.
  activation_reached: { sessions: number }
  // Fired once per user+provider the first time a calendar is connected — the wedge
  // adoption signal, so retention/consistency can be split by calendar-adopters vs not.
  calendar_connected: { provider: 'google' | 'device' }
  // ── First-time experience (tutorial framework) ──────────────────────────────
  tutorial_started: { tutorial: string; experience?: string }
  tutorial_step_completed: { tutorial: string; step: string; experience?: string }
  tutorial_skipped: { tutorial: string; experience?: string }
  tutorial_completed: { tutorial: string; experience?: string }
  tutorial_replayed: { tutorial: string }
  // ── OTA delivery (lib/otaUpdates) ───────────────────────────────────────────
  // How we know a shipped fix actually reached users, rather than assuming it
  // did because the publish succeeded.
  ota_update_downloaded: Record<string, never>
  ota_update_applied: Record<string, never>
  // ── Day-0 activation (Home's never-trained CTA) ─────────────────────────────
  // The funnel's biggest drop among users with real intent: 30 generated a plan,
  // 10 ever pressed Start (2026-09-08). These two separate the possible causes,
  // which guessing could not: `shown` without `tapped` means they see the offer
  // and decline it (a copy/motivation problem), while few `shown` at all means
  // they never reach a state that offers it (a state problem).
  day0_cta_shown: { focus: string; days_until: number }
  day0_cta_tapped: { choice: 'full_session' | 'build_quicker'; focus: string; days_until: number }
  first_workout_started: { experience?: string }
  first_set_logged: { experience?: string }
  first_workout_completed: { experience?: string; duration_min?: number }
  // ── Guest → permanent account linking (§1.1) ────────────────────────────────
  // `context` distinguishes the Profile card from the post-workout modal.
  guest_save_prompt_shown: { context: 'profile' | 'post_workout' }
  guest_save_started: { method: 'google' | 'apple'; context: 'profile' | 'post_workout' }
  guest_upgraded: { method: 'google' | 'apple'; context: 'profile' | 'post_workout' }
  // ── Tempo Pro / monetization (§10) ──────────────────────────────────────────
  // Derived client-side from RevenueCat entitlement transitions; RevenueCat
  // webhooks remain the source of truth for revenue reporting.
  paywall_shown: { context: string }
  // Why the annual intro offer was or wasn't advertised on this paywall view.
  // Added 2026-08-18 for a founder report ("the year deal doesn't show") that
  // was otherwise undiagnosable without a physical device — see
  // lib/purchases.ts's IntroEligibilityReason for what each value means.
  paywall_intro_offer: { plan: string; reason: string; offer_exists: boolean }
  // Why the paywall could show nothing to buy. Added 2026-08-19 after the
  // paywall reported "Subscriptions aren't available right now" minutes after a
  // purchase sheet had opened fine — the old code collapsed five distinct causes
  // (SDK missing, network failure, no offering, no products from the store, no
  // annual/monthly package) into a single null, making it undiagnosable without
  // a device. See lib/purchases.PlansUnavailableReason for what each means.
  paywall_plans_unavailable: { reason: string; offering_id?: string; package_count: number; retry: boolean }
  paywall_dismissed: { context: string }
  // Which value prop the user actually swiped to on the paywall carousel. This is
  // how we learn WHICH feature sells Pro (vs. which one we merely believe sells
  // it) — `slide` is the PAYWALL_POINTS title, `index` its position.
  paywall_slide_viewed: { slide: string; index: number }
  // The custom paywall's purchase funnel (RevenueCat webhooks remain the revenue truth).
  purchase_started: { plan: string; context: string }
  purchase_completed: { plan: string; context: string }
  // `code`/`message` added 2026-08-18 after App Review rejection 2.1(b): five
  // purchase attempts all failed in under a second, but `reason: 'error'` alone
  // couldn't say WHY — the underlying RevenueCat error only went to Sentry, which
  // isn't queryable alongside the funnel. Capturing the store's own error code
  // here means the next failure is diagnosable from analytics directly.
  purchase_failed: { plan: string; reason: 'cancelled' | 'error'; code?: string; message?: string }
  restore_completed: { restored: boolean }
  trial_started: undefined
  trial_converted: undefined
  subscription_cancelled: undefined
  // ── Social features ──────────────────────────────────────────────────────────
  friend_request_sent: undefined
  friend_request_accepted: undefined
  activity_reacted: { reacted: boolean }
  workout_invite_responded: { action: 'accept' | 'decline' }
  group_created: undefined
  group_joined: undefined
  // ── Onboarding completion ────────────────────────────────────────────────────
  profile_setup_completed: { has_name: boolean; has_weight: boolean }
  profile_setup_skipped: undefined
  // ── Feature engagement ───────────────────────────────────────────────────────
  weekly_report_viewed: undefined
  travel_mode_enabled: { equipment_count: number; duration: string }
  travel_mode_cleared: undefined
  custom_workout_saved: { exercise_count: number; scheduled: boolean }
  pause_mode_started: { days: number }
  pause_mode_resumed: undefined
  achievement_unlocked: { key: string; tier: string }
  progress_photo_compared: undefined
  // §24/§30 L2's free-tier conflict card — the exact funnel this document's
  // own audit named as "your monetization forecast": what % of free users
  // ever see a conflict, and what they do about it.
  conflict_detected: { count: number }
  conflict_resolved_manual: undefined
  conflict_dismissed: undefined
  /** The user slid their plan rotation so a chosen session comes next. */
  rotation_shifted: { positions: number; focus: string }
  // §28 L16 — the funnel step between "connected a calendar" and "started a
  // session": did the plan itself actually get built. Fired once, right after
  // a successful generatePlan() call in onboarding.
  plan_generated: { goal: string; days_per_week: number }
  // ── Tempo Coach (TEMPO_COACH_PLAN.md §8) ────────────────────────────────────
  // `coach_action_applied` with outcome:'applied' is THE metric for this feature.
  // A coach whose proposals are never applied is a chatbot, and we want to find
  // that out from data rather than from vibes.
  coach_opened: { entry: 'home' | 'plan' | 'progress' | 'tab' | 'direct' }
  coach_message_sent: { has_action: boolean; locked: boolean }
  coach_action_proposed: { tool: string }
  coach_action_applied: { tool: string; outcome: 'applied' | 'dismissed' | 'failed' }
}

export type AuthMethod = 'google' | 'apple' | 'guest'
export type SessionType = 'quick' | 'planned'

type EventName = keyof EventProperties

// Properties attached to every event automatically.
//
// `app_version` is the NATIVE build's version and is identical for every user on
// a given build whether or not they have taken an OTA update. On 2026-09-04 that
// turned out to hide a three-day delivery failure completely: every event read
// "1.0.1" and looked healthy while nobody was actually running the shipped JS.
// The `js_update_*` properties (see lib/otaUpdates) identify the bundle that is
// really running, so "did this fix reach anyone" is now a groupable question.
function superProperties() {
  return {
    platform: Platform.OS,
    app_version: APP_VERSION,
    ...updateProperties(),
  }
}

/**
 * Initialise analytics once, at app startup. Safe to call when no key is
 * configured — it simply leaves analytics disabled.
 */
export function initAnalytics(): void {
  if (posthog || !POSTHOG_KEY) return
  try {
    posthog = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // Don't capture the very first app session synchronously; let the batch
      // queue flush on its own schedule so startup stays cheap.
      flushAt: 20,
      flushInterval: 30_000,
      // undefined on native (use the default device storage); localStorage on web.
      customStorage: webCustomStorage(),
    })
    posthog.register(superProperties())
  } catch {
    // Analytics must never break the app. If init throws (e.g. no storage
    // provider on an unusual platform), leave it disabled — every track() no-ops.
    posthog = null
  }
}

/**
 * Track a product event. No-ops if analytics isn't configured.
 *
 *   track('app_open')
 *   track('login', { method: 'apple' })
 */
export function track<E extends EventName>(
  event: E,
  ...args: EventProperties[E] extends undefined ? [] : [EventProperties[E]]
): void {
  if (!posthog) return
  posthog.capture(event, args[0] as Record<string, any> | undefined)
}

/**
 * Associate subsequent events with a signed-in user. Call on sign-in and on
 * app start when a session already exists.
 */
export function identifyUser(userId: string): void {
  if (!posthog) return
  posthog.identify(userId, superProperties())
}

/** Clear identity on sign-out so the next user starts a fresh anonymous id. */
export function resetUser(): void {
  if (!posthog) return
  posthog.reset()
}
