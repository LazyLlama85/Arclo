# Arclo (formerly Fitaround, formerly Tempo) — System Architecture & Feature Overview

A detailed description of everything Arclo is — frontend, backend, features, data, integrations.

> **Rebrand in progress, name still provisional (2026-08-05):** the product was renamed from
> "Tempo" to "Fitaround" on 2026-08-04 ("Tempo" collided with a SoftBank-backed competitor's
> registered trademarks — see `tempo-name-collision-risk` in project memory), then from
> "Fitaround" to "Arclo" the next day. Arclo is being used to start the App Store review process
> but is explicitly **not locked in** — expect it may change again, which is exactly why
> `mobile/src/constants/brand.ts` exists as the single source of truth for the display name; all
> in-app copy and the marketing site (`web/`) read from or have been updated to it. **Left
> deliberately unchanged, by design:** the iOS bundle id / Android package (`com.fittempo.app`),
> the EAS project slug (`tempo`), the deep-link `scheme`/`associatedDomains` in `mobile/app.json`
> (still `fittempo.app`), and internal component/file names that happen to contain an old word
> (`TempoTabBar`, `TempoWordmark`, `TempoPulse`, `TempoSheet`, `TempoLottie`,
> `TempoErrorBoundary`, `tempoScore.ts`, the `TempoScore` leaderboard metric type, the
> `db.tempo_score` column). Renaming those is a bigger, more deliberate native-rebuild step the
> founder chose to defer — don't "fix" them as drive-by cleanup; they're not stale, they're
> intentionally out of scope until that step happens (and especially not worth doing while the
> name itself is still provisional). This document below still refers to those real identifiers
> by their real (current) names.
>
> **2026-08-24 brand-leak sweep.** A pass over rendered copy (not comments, not identifiers)
> found four places that still said "Tempo" as literal user-facing text and now read
> `BRAND_NAME`: `quick-workout.tsx`'s lead-in, `calendar-setup.tsx`'s privacy hint,
> `pause-mode.tsx`'s intro, and `progression.ts`'s "log the weight" coaching reason. The
> Quick Workout one was live in App Store screenshot 4, so this was a real store-metadata
> mismatch, not just cosmetics. The component/file names listed above are still deliberately
> untouched — only rendered strings were in scope.

> **Moderation (App Store Guideline 1.2), added 2026-08-25.** The age rating declares
> user-generated content — correctly, since usernames (`updateUsername`) and group names
> (`create_group`) are free text shown to other people — so the app must offer a way to REPORT
> content and a way to BLOCK a user. Migration `mobile/supabase/add_moderation_block_report.sql`
> (**applied**) adds `blocked_users` + `content_reports` with RLS, the `is_blocked(a,b)` helper
> (symmetric: if either party blocks, neither sees the other), and the `block_user` /
> `unblock_user` / `list_blocked_users` / `report_content` RPCs. `block_user` also deletes any
> friendship in either direction, and the `friendships` INSERT policy now refuses a request from
> a blocked party, so a block cannot be walked around by re-requesting. **Enforcement is
> server-side by necessity:** every discovery surface reads through a SECURITY DEFINER RPC, which
> bypasses RLS, so all eight (`search_profiles`, `get_public_profiles`, `friend_feed`,
> `friend_events`, `friends_leaderboard`, `friends_leaderboard_v2`, `group_leaderboard`,
> `friend_overview`) were re-created with their live bodies preserved verbatim plus one
> `is_blocked` predicate. Client: `lib/moderation.ts` (I/O) + `lib/moderationReasons.ts` (the
> pure, testable half — same split rationale as `proPlans.ts`/`purchases.ts`),
> `components/ModerationMenu.tsx`, and `app/blocked-users.tsx` reached from Settings → Account.
> The menu lives on `friend-profile.tsx` because every social surface opens a person through
> `/friend-profile?userId=…`, so one placement covers feed, both leaderboards, activity events,
> the friends list, and group members.

> **Rest-timer Live Activity SHELVED 2026-08-26 (not deleted).** It rendered as a blank dark
> capsule on a real device — no ring, no label, no countdown (`EXECUTION_STATUS.md` N7) — and
> diagnosing `expo-widgets`' SwiftUI compilation pass needs Xcode on a Mac. Rather than ship a
> visibly broken Lock Screen surface into App Review as Guideline 2.1 bait, it was switched off at
> the **module-resolution** layer: `widgets/RestTimerActivity.ios.tsx` moved to
> `widgets/dormant/`, which nothing imports, so Metro finds no platform override and iOS now
> resolves `@/widgets/RestTimerActivity` to the same no-op stub Android/web always used. The two
> call sites (`plan.tsx`, `_layout.tsx`) were **not touched** — all four functions return void and
> no caller reads a result, so the in-app rest timer is unaffected. Verified by exporting the iOS
> bundle and reading its source map: only the stub is bundled, nothing from `dormant/`, and zero
> `@expo/ui/swift-ui` modules. The file stays under `src/` so `tsc` keeps compiling it; to restore
> the feature, move it back one directory. `expo-widgets` stays in `app.json` deliberately —
> removing it is a native change to a working build config, and an unused widget extension is not
> something Apple cites.

> **Objectionable-name filtering added 2026-08-26** (`add_moderation_name_filter.sql`, **applied**),
> closing the third of Guideline 1.2's four requirements after report/block covered two. Three
> fields are user-authored and shown to others: `user_profiles.username`, `user_profiles.display_name`
> and `groups.name`. Enforcement is a BEFORE trigger on `user_profiles` plus a check inside
> `create_group`, **not** client-side — both profile fields are written straight to the table under
> RLS, so a client check would be bypassable. `is_objectionable_text()` uses three lists: an
> **allowlist** whose tokens are dropped entirely (this is what stops "Scunthorpe", "spicy",
> "shiitake", "flame retardant"), a **whole-token** list for profanity that appears inside innocent
> words, and an **unambiguous** list matched against the concatenated remainder to catch "fuckyou"
> and separator/leetspeak evasion. Both sides of every comparison go through `mod_norm` (strip
> non-letters *then* collapse repeats) — an earlier version collapsed first and let the plain
> spelling of the worst slur through while catching the evaded one. Verified against an 80-case
> corpus with zero failures and against all 61 live profiles and every existing group (none
> flagged); the trigger only inspects a field that actually changed, so a legacy name can never
> block an unrelated profile edit. Client: `updateUsername` gained a `blocked` result, `createGroup`
> now returns a `CreateGroupResult` discriminating `blocked` from `failed`, and the display-name
> save **stops discarding its error** — it previously swallowed every failure and reported success.

> **Active fix roadmap:** `EXECUTION_STATUS.md`'s Open Backlog section is the execution-ready
> inventory of everything still wrong in the code/logic/UI described below (absorbed from the
> retired `MASTER_FIX_PLAN.md`, a 2026-07-19 full-codebase review), with per-item files/scope.
> `PRODUCT_AUDIT.html` carries the honest re-score that review produced (a separate Product Score
> vs. Market Proof Score). Read `EXECUTION_STATUS.md` before starting new work on any system this
> document describes.

---

## 1. What Arclo is
A **fitness operating system that adapts to your real life**. Instead of a static program, Arclo
generates a periodized training plan, schedules it around your actual calendar, adapts week-to-week
from your performance and recovery, and — the wedge feature — turns any spare 5–60 minutes into a
purposeful **Quick Workout**. One shared promise: *"no matter how busy your day gets, Arclo keeps
you moving."*

- **Platforms:** iOS + Android (Expo/React Native), iOS bundle id `com.fittempo.app` / Android package `com.fittempo.app`, v1.0.0. A separate
  static **web** marketing site lives in `web/`.
- **Auth modes:** Apple Sign In, Google OAuth, and guest/anonymous.

---

## 2. Tech stack
- **Mobile app** (`mobile/`): Expo SDK ~56, React Native 0.85, React 19, **expo-router** (file-based
  routing, typed routes, React Compiler on), dark-mode-first design system.
- **Client state:** **zustand** for auth/session (`src/stores/auth.ts`); **TanStack Query** for all
  server data (caching, refetch, error→Sentry funnel), with
  `@tanstack/react-query-persist-client` + `@tanstack/query-sync-storage-persister` (both JS-only)
  persisting the training cache to the SQLite-backed `localStorage` for instant cold starts.
- **Backend:** **Supabase** — Postgres (with Row-Level Security), Auth, Edge Functions (Deno),
  Storage, and `pg_cron` + `pg_net` for scheduling.
- **Telemetry:** **PostHog** (product analytics) + **Sentry** (crash/error). Both no-op without keys.
- **Fonts/UI:** Inter (`@expo-google-fonts/inter`) for body/UI **and display** (ExtraBold set
  tight — the separate Bricolage Grotesque display face was removed 2026-07-22)
  + **JetBrains Mono** (numerals) loaded in the root layout for the redesign type system;
  `@expo/vector-icons` (Ionicons), `expo-image`, `react-native-reanimated`,
  `react-native-gesture-handler`, `expo-glass-effect`.

---

## 3. Frontend

### 3.1 Navigation & routes (`src/app/`, expo-router)
- **Root** `_layout.tsx`: wraps the app in a **persisted** React Query provider
  (`PersistQueryClientProvider` + sync-localStorage persister; JSON-safe training query roots —
  `scheduled_workouts`, `progress_workouts`, `next_workout`, `block_phase`, `missed_workouts`,
  `recovery_today` — are dehydrated for 24 h so cold starts paint real content instantly) + dark
  `ThemeProvider`, loads fonts, initializes analytics + crash reporting, wires the React Query
  error→`captureApiError` funnel, **wires `focusManager` to `AppState`** (stale queries refetch on
  app foreground), routes notification taps to the right screen, and Sentry-wraps the root.
- **Tabs** `(tabs)/`: **`index`** ("Today" — Home/Schedule), **`plan`** ("Plan", formerly "Train" —
  hub + workout runner), **`progress`**, **`profile`** ("You"). All four mount at startup
  (`lazy: false`) so switches are instant and nothing mounts mid-transition; the stock bar is replaced by
  **`TempoTabBar`** (floating dock, animated active states, raised amber **GO** button →
  quick-workout; hides while the keyboard is up). **iOS glass treatment (2026-07-18):** the dock's
  background is now `expo-blur`'s `BlurView` (a real `UIVisualEffectView` blur, `intensity=78`,
  `tint` following the app's light/dark mode) layered behind a translucent tint
  (`` `${C.background}A6` ``) instead of the flat opaque `C.background` it used before — a genuine
  glass LOOK, though not Apple's literal iOS-26 `UIGlassEffect` API (not exposed through
  `expo-blur`). **iOS only, deliberately** — Android's blur path needs a `BlurTargetView` wired to a
  specific host view via a `blurMethod` prop, which can't be verified without a physical Android
  device on hand; Android keeps its unchanged opaque look rather than risk shipping unverified native
  blur config. Required splitting what was one `dock` view into three nested ones — `dockShadow`
  (shadow only, unchanged values) → `dockClip` (the rounded pill's `borderRadius`/border/
  `overflow:'hidden'`, needed to clip the blur to the shape) → `dock` (the original flex row, now
  layout-only) — because RN clips a view's own box-shadow to nothing the moment `overflow:'hidden'`
  is set on that same view, so the shadow and the clip can't live on one node. Needs `expo-blur`
  (added, `npx expo install`) and one native rebuild before it's visible on a device — pure
  background swap, otherwise: same GO button, same active-state animations, same tutorial spotlight
  targets, same `sessionActive`-hide behavior, all untouched.
- **Data freshness (the "stale tab" fix):** tab switches are neither mounts nor window focus, so
  screens use `useRefreshOnFocus(...roots)` (`src/hooks/useRefreshOnFocus.ts`) to invalidate their
  query roots on every re-focus, and every workout-state mutation calls
  `invalidateTrainingData(queryClient)` (`src/lib/queryInvalidation.ts`). Route modals blur/refocus
  the tab beneath them, so closing a mutating modal also triggers a refresh.
  **Real gap found and fixed (2026-07-19):** `train_splits` — the query behind Plan's "Current
  Split" card, carrying its own 5-minute `staleTime` — was missing from `TRAINING_KEYS` entirely.
  A Change Plan replan deactivates the old split and activates the new Tempo-generated one, but
  Plan (already mounted all session via `lazy:false`) kept its stale pre-replan `hubSplits` cache
  for up to 5 minutes, or until the app fully restarted — reported as "plan takes a long time until
  you reload." Added `['train_splits']` to `TRAINING_KEYS`. Also hardened the first-ever entry into
  `(tabs)` for a brand-new user: `onboarding/profile-setup.tsx`'s `postOnboardingRoute()` (the one
  choke point both Save and Skip funnel through) now calls `invalidateTrainingData(queryClient)`
  immediately before `router.replace('/(tabs)')`, so nothing mounting for the first time can read a
  cache entry any earlier onboarding step happened to leave behind.
  **Change Plan now visibly confirms the switch (2026-07-19):** replan's exit
  (`onboarding/plan-preview.tsx`'s `enterApp()`) used to silently drop the user on Home — the only
  proof the new plan was active was going to Plan and checking. Now lands on `/(tabs)/plan` directly
  (with a one-shot `justSwitched` param) and Plan shows a brief, self-dismissing "Switched to your
  new Tempo-generated plan" banner above the split card (`PopIn`, auto-hides after 5s, the param is
  cleared via `router.setParams` the instant it's read so it can't re-fire on an unrelated later
  focus).
- **Onboarding stack** `onboarding/`: `goal → why-tempo → schedule → sleep → work-school →
  train-time → plan-preview` — **7 numbered steps (2026-07-17 restructure to 6, then 2026-07-18
  added `why-tempo`)**. The founder's own
  device-testing feedback drove this: the old `schedule` screen packed Days/Minutes/scheduling-mode/
  a calendar-preview mockup onto one screen, and the old `availability` screen packed Sleep/Work
  hours/School hours/Preferred time/Off-days onto another — both read as "squished together." Each
  concept now gets its own lighter screen. **`goal` is a single merged "Basics" screen** — a
  3-or-4-card sequence (goal → experience → equipment → build-mode, new users only) behind one
  header + progress bar + sub-step dots (formerly three separate pushed screens; `experience.tsx`/
  `equipment.tsx` removed, route name `goal` kept so the `(tabs)` gate redirect and Profile → Change
  Plan re-entry are unchanged). **Experience is now a vertical option list** (matching Goal/
  Equipment), not a horizontal segmented control — years-training is the whole answer (Beginner
  0-1yr / Intermediate 1-3yr / Advanced 3+yr, on both the list and nowhere else); the old preview
  card (intensity meter + sample lifts) is gone entirely, per the founder's explicit ask to just
  pick one, no glimpse. **The 4th Basics card ("How do you want to train?")** — Guided vs. "I'll
  build my own" — is new-users-only; see §3.1's Basics description above for why (an existing
  replanner always regenerates, so offering a no-generation path there would leave the old plan's
  sessions unretired).
  **`schedule`** now asks ONLY Days Per Week + Minutes Per Session (+ the optional cardio question
  for muscle_gain/strength) — the old auto-vs-manual scheduling-mode picker and its calendar-preview
  mockup are gone from onboarding entirely (the founder: the choice + a mockup implying the exact
  time varies day-to-day cluttered the screen and undersold consistency). New users silently default
  to `scheduling_mode: 'auto'` (the same default the picker always defaulted to); an existing user
  re-planning keeps whatever they already had — never silently reset. Manual mode is still fully
  available afterward from Settings → Automatic Scheduling. **Connecting a calendar has moved out of
  the required path** — a first-time "Connect your calendar" Home context banner (lowest priority)
  plus Profile → Calendar (`calendar-setup.tsx`) own it now, so a new user's path to a first workout
  never touches OAuth (a user who never connects still gets auto placement from the free-slot engine).
  **`schedule` also captures the time-budget question (B3.3)** — MINUTES PER SESSION (30/45/60/75/90,
  pre-filled from the saved profile on Change Plan re-entry) — previously never asked anywhere, so
  every new user silently got a hardcoded 45-minute `preferred_duration_min`. This is a real input,
  not cosmetic: it flows through the whole chain and directly sets `preferred_duration_min`, which
  `generatePlan`'s `exerciseCountForDuration` uses to decide how many exercises fit a session.
  **`sleep`** (new, split off the old `availability`) asks only Wake/Bedtime. **`work-school`** (new)
  merges what used to be two separate Work Hours / School Hours sections into ONE question ("I have
  set work or school hours" + a single start/end pair) — writes the SAME times into both
  `work_start`/`work_end` AND `school_start`/`school_end` so every existing consumer of either field
  (`lib/availability.ts`'s busy-window builder, `autoSchedule.ts`, `reschedule.ts` — all of which
  already treat the two fields additively) keeps working with zero changes. **`train-time`** (new)
  asks Preferred Time to Train + Days I Never Train, and is now the screen that does the actual
  `user_profiles` upsert (the old `availability` screen's job) — its "consistently" framing replaces
  the old "then varies the exact time so your week isn't robotic" hint, and the religious-observance
  example ("e.g. Shabbat") in the off-days hint is gone (kept generic: "a standing commitment, or any
  day you simply rest"). Then `plan-preview`
  (primed notification ask — an explainer sheet *before* the one-shot OS prompt; push-token
  registration happens here on grant, never at sign-in) `→ profile-setup` (name, avatar, and an
  **optional starting weight** that seeds the weight trend + goal countdown on day one; the weight
  field is now a real drag-to-set `Slider`, not a bare text input — see §3.3).
  **Post-onboarding paywall (2026-07-18):** `profile-setup.postOnboardingRoute()` presents `/paywall`
  (`context: 'onboarding'`) as a dismissible modal over Home right as a NEW user enters the app — the
  highest-converting placement per category benchmarks. Dormant-safe: gated on `useProAccess().locked`
  (`proEnabled && !isPro`), so while Pro is off it never fires and the free flow is byte-for-byte
  unchanged. Replan users skip it (they never reach `profile-setup`), and custom-build users skip it
  (they go straight to `split-editor`); both hit Pro gates naturally later instead.
  **Plan generation gets a real "Personalizing your plan…" screen** (2026-07-17): a full-screen
  `SvgProgressRing` tracking `BUILD_STEPS`' real progress through the save → generate → auto-schedule
  → reminders chain replaces the old small footer text row, which could read as stuck on a slow
  connection (the founder: "it was taking a while… i refreshed and it worked"). Refreshing mid-chain
  was already safe by the existing design (`onboarding_complete` only flips after `generatePlan`
  succeeds, so a refresh just correctly restarts onboarding from `goal`) — the ring doesn't change
  that safety, it just makes the wait legible instead of looking frozen.
  **Change Plan re-entry is first-class:** every step pre-fills from the saved profile (current
  goal/experience/equipment preselected; days-per-week and a previously chosen calendar reflected;
  the split sleep/work-school/train-time screens each show their own saved values instead of
  defaults), the final upsert **merges** the weekday off-day chips with any dated/timed unavailable
  blocks added in Settings (it used to wipe them), and `plan-preview` detects a re-plan
  (`onboarding_complete` already true): copy flips to "Your new plan is ready", the notification
  primer is skipped (permission is just re-checked), `display_name`/`avatar_url`/
  `preferred_duration_min` are never clobbered by the upsert (identity fields only seed when
  empty), training query caches are invalidated so the tabs paint the new plan immediately, and
  on success it pops the whole onboarding stack back into the app instead of re-running
  profile-setup.
  `plan-preview` also guards double-taps with a **ref latch** (state alone can't stop two taps
  in one frame). Its **`askForReminders()` primed ask can no longer hang the funnel (fixed
  2026-07-22)**: it is `await`ed mid-chain *after* the plan is already generated, and it used to
  resolve only from its two `Alert.alert` button callbacks with `cancelable: false` and no timeout
  — so if the alert never presented, the user sat on "Personalizing your plan…" forever with a
  fully-built plan they could not reach, and the enclosing `try/catch` could not rescue them (an
  unresolved promise is not an exception). Reproduced on web, where `Alert.alert` is a no-op;
  native can hit the same shape if an alert fails to present (one already up, app backgrounded).
  It now always settles: web skips the ask, native races the alert against a 30s timeout, and
  `resolve` is latched so it fires once. Declining is the safe default — missing a primed ask
  beats losing the app. It proactively refreshes the auth session before the save chain, auto-retries once
  after a silent token refresh on JWT failures, and maps failures to actionable copy (offline vs
  session vs server — `lib/saveErrors.ts`) with Try Again / Not now actions; the sleep/work-school/
  train-time steps share the same silent refresh-retry pattern where they write. **`onboarding_complete`
  flips only AFTER `generatePlan` succeeds** (a separate update), so a mid-chain failure + force-quit
  can't produce an "onboarded" account with no plan at next launch.
- **First-time experience (framework):** a reusable, **device-local, opt-in** tutorial engine
  (`lib/tutorial.ts` state/defs + `stores/tutorial.ts` reactive layer + `components/TutorialOverlay.tsx`
  spotlight + `useTutorialTarget`/`useOnceTip` hooks). State (armed/completedSteps/skipped/first-*)
  persists to localStorage per user — steps complete offline, a failed API can't mark them done, and
  an app upgrade never resets them (a `version` retires steps without wiping progress). Tutorials are
  **armed only at the new-user moment** (`plan-preview`, non-replan), so existing users / re-planners /
  reinstalls never see them.
  **Auto-scroll fix for below-the-fold steps (2026-07-19):** a step whose target was scrolled out of
  view (e.g. Plan tour's `plan_split`/`plan_library`, further down the hub than `plan_calendar`) used
  to just point at empty space or fail to render sensibly at all — `measureInWindow` reports a target's
  TRUE window position regardless of scroll, so an off-screen target produced a wildly out-of-range
  rect, and the tooltip's `sh - hole.y` math could push the card off the top of the screen entirely
  (read by the founder as "step 3 doesn't show"). Fixed with a new opt-in **scroll-into-view**: screens
  call `useTutorialScrollContainer()` (`components/TutorialOverlay.tsx`) once and spread
  `{scrollRef, onScroll}` onto their main `ScrollView`, registering a `{scrollTo, getScrollY}` pair in
  `stores/tutorial.ts` (a plain interface, not the raw ScrollView instance — sidesteps RN-version-
  specific native-method names like `getScrollableNode`/`getInnerViewNode`). `useTutorialTarget(id,
  {scrollIntoView: true})` then scrolls the container to bring the target to ~30% down the screen
  before measuring, re-measuring once the scroll settles. **Opt-in, not automatic**: the tab bar's
  GO/Progress/Profile targets (`TempoTabBar.tsx`) are fixed-position and live OUTSIDE any scrollable
  content, so they don't pass the flag — scrolling the page could never move them, and attempting to
  would just be a pointless animation on Home-tour steps that already worked fine. Wired into Plan
  (`plan.calendar`/`plan.split`/`plan.library`, all `scrollIntoView: true`) and Home (`home.today`,
  same).
  **Single reveal (fixed 2026-07-17 — `app/welcome.tsx` deleted):** a fresh account used to see the
  plan summarized TWICE in a row — `plan-preview`'s own 7-day animated reveal, then a separate
  `/welcome` screen repeating Goal/Schedule/Program/First-workout with its own "Explore My Plan" CTA,
  gated by `(tabs)/_layout` and re-shown on reopen until completed. Genuine, felt redundancy, not a
  taste call. Now there's exactly one reveal (`plan-preview`'s), and its own "Enter Tempo →" tap calls
  `completeStep('welcome_done')` directly — same force-close-proof completion flag several other
  screens gate their own first-run tours on (Home/Plan spotlight tours, the Concepts tour), just
  satisfied one screen earlier instead of via a second screen. `T.welcome` is no longer armed at all;
  the constant stays defined (existing persisted state safely deserializes) but nothing arms or reads
  it anymore. **`home_tour`** is a 5-step spotlight (calendar → today's card → GO → Progress →
  Profile) that dims the screen + cuts a hole around a measured target + floats a tooltip, without
  freezing the UI; auto-starts once on first Home focus after Welcome. (Step 2's `home.today` target
  is anchored to the stable "today" day-group, which always renders in week/day view — not just the
  hero card, which only exists when today has a workout; previously a new user whose first session
  wasn't today got no spotlight on that step.) **`first_workout`** fires
  `first_workout_started`/`first_set_logged` and the existing coach overlay; the **first completed
  session** gets a bigger `workout-complete` celebration + a "First Tempo Session" card and sets the
  durable `firstWorkoutCompleted` flag. **Bug fix, 2026-07-16:** `workout-complete.tsx`'s celebration
  no longer trusts that local flag alone — it's device-local storage, so a reinstall, a new device, or
  an account that already had real workout history before this flag existed all read it as unset,
  which wrongly showed "First workout complete" (day-one messaging + its own paywall trigger) to an
  established user (reported: completed an ad-hoc workout outside their regular split and got the
  day-one celebration). Now defaults to false and only flips true once the real completed-workout
  count (`useProgressStats`, already fetched for this screen) confirms `totalWorkouts <= 1` — the same
  "never trust a device-local fire-once flag for a factual claim, check the real count" principle
  already applied to B3.2's progressive disclosure. `plan.tsx`'s `first_workout_started`/
  `first_set_logged` analytics still key off the same local flag (lower stakes — no user-visible text,
  just funnel accuracy) and weren't changed in this pass; a future cleanup could align them too.
  **Onboarding Phase 7 additions (2026-07-17):** the Basics screen's experience
  card now shows the years-training range next to each level (Beginner 0-1yr /
  Intermediate 1-3yr / Advanced 3+yr) on both the segmented tabs and the preview
  card — a concrete self-placement question instead of pure vibes. A **4th Basics
  card** ("How do you want to train?") asks Guided vs. "I'll build my own,"
  shown to **new users only** (a replan always regenerates, so offering a
  no-generation path there would leave the old plan's future sessions unretired
  instead of replaced — `goal.tsx`'s `isReplan`/`cardCount` gate). Choosing
  "build my own" carries a `buildMode=custom` param through
  `schedule→availability→plan-preview`; `plan-preview.tsx` skips `generatePlan`/
  `autoScheduleUpcoming`/the week-reveal entirely but still saves goal/experience/
  equipment/schedule and flips `onboarding_complete` (an onboarded account with no
  plan/split yet is already a supported state — same as any existing user before
  their first Change Plan), then routes through `profile-setup` into
  `/split-editor` — pushed on top of `(tabs)` (not `replace`d), the exact same
  push-while-in-tabs pattern `my-splits.tsx` already uses, so its own Close button
  lands correctly on `(tabs)` with no new navigation behavior. `schedule.tsx`
  also gained an **optional cardio-finisher toggle**, shown only for
  `muscle_gain`/`strength` (the two goals whose templates carry zero cardio by
  design — asking elsewhere would be a question that does nothing).
  `user_profiles.include_cardio` (new column, applied) threads into
  `lib/generatePlan.ts`'s `withCardio()`, which appends an **optional** trailing
  CARDIO slot (dropped first under a tight time budget, same as every other
  optional slot) — wired at both call sites that build session templates
  (`generatePlan` itself and `restampFuturePlanForExperience`) so they can't drift
  apart. A dependency-free **`components/Slider.tsx`** (PanResponder-based, no
  native module) replaced profile-setup's plain weight `TextInput` with a
  drag-to-set control (big number + slider, "type an exact number" fallback for
  precision) — an untouched slider never writes a value, so leaving it alone
  still skips the optional weigh-in exactly like before.
  **Slider bug fix + redesign (2026-07-19):** dragging the weight slider inside
  onboarding's `ScrollView` used to scroll the PAGE instead of moving the thumb —
  `PanResponder` claimed the responder on `onStartShouldSetPanResponder`, but
  without ALSO claiming it in the capture phase and refusing every termination
  request, the ancestor ScrollView's own native pan recognizer could still win
  mid-drag. Fixed with `onStartShouldSetPanResponderCapture` /
  `onMoveShouldSetPanResponderCapture` (claim before any ancestor gets a say) +
  `onPanResponderTerminationRequest: () => false` (never hand the gesture back
  once granted). Same pass gave the slider a real redesign: a floating value
  bubble (`formatValue` prop) pops above the thumb while dragging, the thumb
  scales up + its shadow deepens on grab, a subtle top-highlight gradient on the
  fill, and faint tick marks at 0/25/50/75/100%. **Custom avatar photo made
  first-class in every avatar picker (2026-07-19):** both onboarding's grid and
  Profile's Edit-Profile grid only ever showed the 8 icon presets — uploading a
  real photo (already supported via `lib/avatar.uploadAvatar`) had no presence in
  the grid itself, and re-opening Edit Profile after uploading one incorrectly
  showed the FIRST preset as "selected" (icon/color match failed against a photo
  URL) — worse, hitting Save in that state would silently overwrite the uploaded
  photo with that preset. New `CUSTOM_AVATAR_ID` sentinel (`lib/avatar.ts`) fixes
  both: each grid now has an extra tile *before* the presets — a dashed-border
  blank "image-outline" placeholder when no photo is set, or the real photo with
  a small camera badge (matching the hero avatar's existing edit affordance) once
  one exists; tapping it opens the picker. Onboarding stages the upload in local
  state (`customPhotoUrl`) and commits it on "Enter Tempo" like every other field
  there; Profile's grid reuses `handleAvatarPress` as-is (immediate upload + save,
  matching the hero avatar's existing behavior) and now also sets `avatarId` to
  the sentinel on success so the tile shows selected. `saveProfile()` only writes
  a preset's `tempo:` value when a preset (not the photo) is the active choice, so
  Save can never again clobber an uploaded photo.
  **The wedge, made honest and felt at the reveal (2026-07-17):** the reveal's title
  used to read *"Already on your calendar"* unconditionally — literally untrue for
  the common case, since calendar connection isn't part of onboarding's required
  path. `plan-preview.tsx` now checks `isGoogleCalendarConnected()` /
  `getCalendarPermissionStatus()` when the reveal mounts: connected → keeps that
  copy; not connected (most new users) → **"Your first week, planned."** with a
  subtitle carrying forward the same "Tempo schedules every session around your
  real life..." concept the Concepts tour now teaches, in place, on Home/Plan. Underneath the 7-day list, an **optional, skippable calendar
  tap-in** ("See it with your real calendar") offers Google or device connect
  right there — reusing `connectGoogleCalendar`/`requestCalendarPermissions`
  and the SAME error-copy mapping `calendar-setup.tsx` uses (extracted to
  `services/googleCalendar/connectErrors.ts` so the two call sites can't drift
  apart). A successful connect re-runs `autoScheduleUpcoming` and re-fetches the
  reveal list live, so the magic is felt immediately, not just promised — never
  blocks "Enter Tempo →". New `onboarding_calendar_prompt` analytics event
  (`connected_google`/`connected_device`/`failed`/`skipped`) tracks the offer's
  real conversion once a build ships. **Per-step funnel analytics (B0.3):** each
  of the 7 onboarding screens now fires `onboarding_step_completed` on advance —
  previously only `onboarding_complete` (the very end) existed, so there was zero
  visibility into where users actually dropped off.
  **`why-tempo.tsx` — the differentiator screen (new, 2026-07-18):** the wedge
  fix above only reaches a user at step 6 of 6, right before they enter the app —
  by then they've already answered five questions with no idea Tempo works
  differently from a plain workout logger. New screen, new-users-only (a
  re-planner skips straight from Basics to Schedule — they already know the app,
  and this screen doesn't check for an existing calendar connection), inserted
  right after Basics while attention is highest: **"Most apps just log
  workouts. Tempo schedules them — around your real week."**, a small hand-built
  entrance animation (a workout block sliding into the gap between two calendar
  commitments — `Animated.spring` + `Animated.timing`, same house style as
  `SvgProgressRing`/`TempoPulse`, no Lottie, with the same "never stuck
  invisible" safety net every entrance in `components/motion.tsx` uses: values
  start at rest, dip to hidden only in the same synchronous tick the animation
  starts, and a JS deadline force-snaps to rest if the native driver ever
  stalls), and the SAME optional calendar tap-in the reveal offers — reusing
  `connectGoogleCalendar`/`requestCalendarPermissions`/`friendlyConnectError`
  verbatim, not a second implementation. The one real constraint this screen
  has that the reveal doesn't: no `user_profiles` row is guaranteed to exist
  yet this early (`train-time.tsx` does the first upsert, several screens
  later), so it never writes `preferred_calendar` directly — it forwards the
  connected provider through the same params chain every other onboarding
  answer already rides (`schedule.tsx` now explicitly threads a
  `preferredCalendar` param it didn't need before; `sleep`/`work-school`/
  `train-time` already forward unlisted params via `{...params}`/`params`
  wholesale, so they needed no change beyond a type annotation), and
  `plan-preview.tsx`'s existing upsert — which already read a
  `preferredCalendar` param before this change, evidently built with this
  exact follow-up in mind — persists it. `trackCalendarConnected` (already
  de-duped per user+provider) fires from here too, so `calendar_connected` is
  now captured at the earliest true moment rather than only at the reveal.
  Onboarding is 7 steps end to end now, not 6 — every screen's `TOTAL_STEPS`
  and `STEP N OF` label shifted accordingly (`goal.tsx` 1, `why-tempo.tsx` 2,
  `schedule.tsx` 3, `sleep.tsx` 4, `work-school.tsx` 5, `train-time.tsx` 6,
  `plan-preview.tsx` 7).
  **`plan_tour` (2026-07-17):** a second spotlight tour for the Plan
  tab — calendar (Week/Month + reschedule), current split, and the library doors — armed at the same
  new-user moment as the others and fired independently on Plan's own first post-welcome focus (a
  user may open Plan before ever settling on Home, so it doesn't wait on `home_tour` completing).
  Adding it required generalizing `TutorialOverlay.tsx`'s previously-hardcoded
  `activeTour === T.homeTour ? HOME_TOUR_STEPS : EMPTY_STEPS` ternary into one lookup,
  `lib/tutorial.ts`'s new `TOUR_STEPS: Record<TutorialId, TutorialStep[]>` — the single place both
  the overlay and `stores/tutorial.ts`'s step-completion/skip/replay logic now read from, so adding
  a future tour is purely "new id + new step array," no ternary to touch.
  **`concepts_tour` (replaces the `how-tempo-works.tsx` slideshow, 2026-07-18):** the old screen
  taught the same vocabulary the spotlight tours assume — what a workout/split is, the
  previously-conflated distinction between Tempo **generating** a workout's exercises and Tempo
  **scheduling** its day/time, adding/editing workouts, the calendar, equipment & goals — as a
  separate 7-page swipe deck, triggered via the lighter `shouldShowTip`/`markTipSeen` one-off
  mechanism. It's now taught IN PLACE, as a genuine cross-screen `TutorialStep[]` tour
  (`CONCEPTS_TOUR_STEPS`, `lib/tutorial.ts`) spotlighting the real Home/Plan/Profile UI the concepts
  describe, ordered to minimize screen hops (Home ×3 → Plan ×3 → Profile ×1 — 2 navigations total,
  not the slideshow's original linear order). Required one new capability in
  `TutorialOverlay.tsx`: each `TutorialStep` may now carry an optional `screen` href; a ref-tracked
  effect pushes the router there the first time the tour lands on a step whose screen differs from
  the last one it pushed to (tracked via plain refs — `lastScreenRef`/`lastTourRef` — rather than
  `usePathname`, since the only question that matters is "did this overlay already navigate here for
  this tour," which needs no pathname-format assumptions). Because all four tabs mount eagerly
  (`(tabs)/_layout.tsx`'s `lazy: false`), a Home→Plan hop is just the tab becoming visible, not a
  fresh mount — but Profile's own screen still needs its target's ref actually laid out, so the
  target re-measure effect polls the store's live `measurers` map several times over ~1.5s (200ms /
  450ms / 800ms / 1300ms) instead of the single one-shot retry same-screen steps needed, reading
  fresh each attempt so a target that registers mid-poll is still caught. Two new spotlight targets
  needed adding: `home.add_fab` (Home's "+" FAB — now wrapped in a plain ref-able `View`, since
  `PressableScale` is a function component and can't take a ref directly, same reason the GO button
  wraps itself in `TempoTabBar.tsx`) and `profile.training` (the whole Training card — goal/
  experience/days/equipment — on Profile, which also gained its own `useTutorialScrollContainer`
  wiring since that card can sit below the fold). `concept_generate` deliberately reuses the
  `plan.split` target (not the workout runner) — spotlighting a real in-progress session would mean
  starting one just to teach a definition, a genuine side effect the tour has no business causing.
  `how-tempo-works.tsx` is deleted; its `Stack.Screen` registration and Home's push-on-first-focus
  effect are gone with it. **Profile → Replay App Tour** re-arms `concepts_tour`, `home_tour`, and
  `plan_tour` together, then drops the user on Home, where `concepts_tour` auto-starts exactly like
  every other tour (armed + not-done + no active tour) — no manual `startTour` call needed from
  Settings. Analytics: `tutorial_started`/`step_completed`/`skipped`/`completed`/`replayed` +
  `first_workout_*` (experience-tagged; platform/app_version are auto super-props).
- **Other screens/modals:** `sign-in`, `quick-workout`, `availability`,
  **`settings`** (new, 2026-07-16/17 — every "how the app behaves" row moved off Profile: Calendar &
  Scheduling, Notifications, Subscription, Tester Tools, App, Account, sign-out/delete; reached via
  Profile's header gear icon, registered in `_layout.tsx` as a `slide_from_bottom` modal),
  `travel-mode` (now Pro-gated-but-teased — see §10), `legal` (Privacy + Terms), `workout-complete`
  `weekly-report` (Sunday progress recap), `plan-explainer` ("why this week" periodization explanation),
  **`workout-builder`** (two modes: **create/edit** a saved workout = name + exercises → library,
  with no scheduling UI; **schedule** = opened with a `date` param from Add Workout, adds date/time +
  a Schedule action — the time is **smart-pre-filled** from the free-slot engine
  (`reschedule.suggestTimeOnDate`) with a "you're free at this time" hint, and a manually picked
  time is never overwritten. **Fixed (2026-07-19):** tapping Schedule used to show a blocking
  `Alert` with a "Done" button gating the actual `router.back()` — meaning the one piece of proof
  it worked (the new entry on the calendar right behind this screen) was hidden behind a dialog the
  user had to dismiss first. Now closes immediately on success (a haptic replaces the modal;
  failure still alerts, since a real error should interrupt), same as the actual point of the
  action), **`my-workouts`** (manage templates +
  custom exercises), **`my-splits`** (the Program/Split layer — list/activate/edit splits),
  **`split-editor`** (author a weekly split: name + 7-day weekday→workout pattern),
  **`workout-history`** (the training log — every completed session, newest first, with
  sets/volume/minutes per row), **`session-detail`** (one completed session's full set-by-set
  record + its PRs; opened from a completed card's **Details** on Home or a History row; each
  exercise links to its trend; **no longer pure read-only (2026-07-16/17)** — tapping a logged set
  opens it inline-editable (weight/reps/duration/distance per its tracked fields, plus a "per side?"
  toggle when it has a weight), saving an `UPDATE` to the existing `set_logs` row and calling
  `invalidateTrainingData` so volume/PR numbers — always derived live from `set_logs`, never cached —
  reflect the correction immediately; see the runner's matching edit flow below), **`exercise-library`** (browse/search the whole ~1,360-move library —
  instant ranked search + muscle-group & equipment filter chips, with **variant families collapsed**
  (barbell/dumbbell/cable versions under one expandable row, representative = shortest name on a
  relevance tie so the plainest variant leads) → the form-guide sheet; also doubles as an **add-to-
  workout picker** — every row/family carries an add-circle toggle, and a floating "Add to a
  workout" bar appears once ≥1 is picked, pushing `/workout-builder?addExerciseIds=…` pre-loaded
  with the picks. Reached from the Plan tab header (book icon, always visible) — no longer linked
  from Profile), **`exercise-progress`** (one lift's strength story: per-session best est-1RM line trend,
  best-ever tiles, Δ vs a month ago, and — **`LAUNCH_SCORE_PLAN.md` T2.1, 2026-07-23** — a **Pro-gated
  PR forecast card** (`lib/prForecast.computePRForecast`): a real least-squares fit of the same
  free e1RM history the chart already shows, projected to the next round-number milestone
  (`nextMilestone`, now exported from `lib/goalProjection.ts` and shared) as a calendar date, not
  "N weeks" — "235 lbs by October 15." Deliberately more honest than `goalProjection.ts`'s Home-hero
  ETA, which assumes a fixed rate by experience level because it only has one bench-max number;
  here there's real per-session data for the specific lift on screen, so the module fits an actual
  trend instead of assuming one. Returns null — renders nothing, not a lock icon over nothing — below
  4 sessions, under a 14-day span, on a flat/declining trend, or when the projection is over a year
  out; only the DISPLAY is Pro-gated (`<ProGate feature="pr_forecasting">`), so a free user with
  enough history gets a real, earned paywall moment rather than a tease with no insight behind it.
  New gate id `pr_forecasting` in `proFeatures.ts` (deliberately not reusing `long_horizon_planning`'s
  copy, which describes a different, larger, unbuilt feature) + a `PAYWALL_POINTS` bullet, added the
  moment the surface went live. 8 new unit tests. Opened from PR rows on Progress/Profile/**`pr-browser`**
  and from session-detail), **`pr-browser`** (search ANY exercise, not just your 5 most recent PRs, then
  jump to its `exercise-progress` trend), **`muscle-history`** (added 2026-07-31 — full training
  history for a *muscle*, not a single lift: `exercise-progress` already owns the per-exercise
  strength story, and one lift's weight isn't comparable to another's, so this aggregates every
  exercise touching a muscle group (`muscleGroup` param, coarse) or a specific muscle
  (`muscleSlug` param, fine — e.g. "biceps" vs. "triceps", matched against `primary_muscles`/
  `secondary_muscles` via the shared `useExerciseLibrary` cache) into a Monday-bucketed
  **sets-per-week** trend + a tappable per-exercise breakdown that drills into `exercise-progress`
  for the lift-level detail, rather than re-showing a second chart. 3M/6M/1Y/All range chips.
  **Fixed 2026-08-02 — vocabulary mismatch broke it for most muscles:** `muscleSlug` arrives as a
  `BodyMuscle` (e.g. `'quadriceps'`, from `muscle-map`'s fine intelligence), but `primary_muscles`/
  `secondary_muscles` are stored in the exercise library's own raw vocabulary (e.g. `'quads'`) —
  comparing them directly matched almost nothing, so most muscles falsely showed "No history yet"
  even with real logged sets. Now routes both sides through `bodyMuscleOf()` (`lib/fitnessInsights.ts`
  — the same mapper `fineMuscleIntelligence()` already uses) before comparing. Also fixed the same
  session: the `set_logs` query capped at 4000 rows was ordered ascending *before* the cap, so a
  power user past the limit kept their oldest sets instead of their most recent — now orders
  descending, caps, then reverses for the chronological bucketing logic.
  **Free/Pro history horizon added 2026-08-02 (founder-requested):** free sees the last 4 months of
  history, Pro sees all of it — a new `lib/historyHorizon.ts` (`FREE_HISTORY_MONTHS = 4`,
  `historyCutoffDate`/`historyCutoffIso`) plus a new `full_history` gate in `proFeatures.ts`, extending
  the existing "depth & horizon" model the same way `pr_forecasting` already does for one lift's
  forward projection — this is the read-BACKWARD counterpart. Data is never deleted for a free user;
  this is a read-time clamp only, so buying Pro immediately reveals everything that was always there.
  Here specifically: the range chips gained a **4M** option as the real free ceiling, with 6M/1Y/All
  now lock-icon chips that open the paywall instead of changing the range (a `locked`-aware
  `effectiveRange` also clamps the underlying filter as a defense-in-depth backstop, independent of
  the chip UI). The same gate is also applied in `exercise-progress.tsx` (the trend chart + PR-forecast
  input, NOT the all-time "BEST EST. 1RM"/"HEAVIEST SET" tiles or the "last session" line — those are
  current-state facts, not history browsing, so they stay unclamped by design) and `workout-history.tsx`
  (a date filter + a raised row cap for Pro, since a flat 90-row cap for everyone would have quietly
  undercut "unlimited" for an actually active power user). `progress.tsx`'s own dashboard charts were
  deliberately NOT touched in this pass — they mix current-state stats with historical charts via the
  shared `useProgressStats` hook in ways that need a careful, separate read before gating safely; a
  named follow-up, not an oversight. Also caught and fixed the same session: the paywall's compare
  table and `launch.html` both already claimed free users get "full history," predating this gate —
  both corrected to the accurate 4-month/unlimited split. Opened
  from Body Intelligence's per-muscle and per-group detail cards ("See history"); `exercise-progress`
  itself gained a new entry point too — a "See training history" row in `ExerciseFormSheet` (the form
  guide sheet used by the Library, Plan runner, and session-detail), so a lift's history is reachable
  from wherever its form guide already is, not only from PR rows), **`calendar-setup`** (dedicated connect/disconnect screen
  for Google + Device Calendar, replacing the old `Alert.alert` checklist; shows a "needs
  reconnecting" banner when `googleCalendarNeedsReconnect()` is true), **`calendar-picker`**
  (B1.5 — Pro-gated "Choose calendars" modal, reached from `calendar-setup`'s Google card once
  connected; dormant until the calendar-list OAuth scope is granted), **`edit-session`** (edit any scheduled session — incl. Tempo-generated — from
  the hub's "Edit workout" chip: add/remove/reorder exercises, pin sets/reps; only *touched*
  exercises get a pinned `exercise_config` entry so untouched plan exercises keep adaptive
  targets. **Fixed 2026-08-02 — silently destroyed weight/duration/distance/rep-range targets on
  every save:** `EditItem` only ever tracked `sets`/`reps`, and `save()` unconditionally wrote
  `weight_lbs`/`duration_sec`/`distance_m` as `null` and collapsed any real rep *range* to a single
  number, for every pinned exercise on every save — even ones the user never touched, since this
  screen has no UI to edit those fields at all. Now each `EditItem` carries its `origConfig` (the
  config row as loaded) and a `touched` flag set only when its own stepper is bumped; `save()`
  writes an untouched item's original config back verbatim, and a touched item still preserves its
  original weight/duration/distance — only sets/reps actually change), **`social`** (Friends home — decluttered so the scroll is only content: requests →
  workout invites → leaderboard → activity feed → groups → friends → a Privacy row. The "loose"
  actions moved into sheets: a header **＋** opens **Add friends** (your friend-code card + search by
  name/@username/code + redeem a shared workout), a **New group / join** button opens the Groups
  sheet, and **Privacy & sharing** opens the tap-to-cycle privacy sheet (workouts/stats/activity/
  **availability**). Feed rows have a one-tap 🔥 reaction), **`friend-profile`** (privacy-gated
  @handle + member-since, **Schedule together**, badges, streak / longest /
  this-week cards, totals — workouts / sets / **volume in display unit** / favorite muscle / goal /
  this-month — recent activity + browsable workouts with "Save to My Workouts" attributed copies),
  **`shared-workout`** (share-link landing for a **workout or a whole split** — metadata chips
  (exercises/days · ~duration · equipment) + one-tap import), and **`w/[code]`** (deep-link route
  for `tempo.app/w/<code>` / `tempo://w/<code>` → shared-workout).

### 3.2 Screen responsibilities
- **Home / Today** (`(tabs)/index.tsx`) — **IA redesign, 2026-07-16 (Phase 1 of 2, plan approved by
  the founder after a full Working Method write-up):** Home is now **today only**. The audit's own
  #1 finding — *"make the hero a day-timeline, not a to-do card"* — plus a founder-flagged density
  complaint (too much to scroll through: Day/Week/Month, a range row, a weekly-target card, a
  calendar strip, a flat list) drove a real IA split, not just a visual pass: **all multi-day
  scheduling (Day/Week/Month, "Reschedule my whole week," the calendar strip) moved to the Plan
  tab** (formerly Train — see below), which now owns the whole week. Home fetches only today's
  `scheduled_workouts` + today's calendar events (`todayStr` on both query keys — no more
  week/month range fetch), merges them into one time-sorted `todayItems` list (the exact same
  merge/hero-pick logic that used to run per-day across a whole `dayGroups` array, now collapsed to
  one day), and renders them on a **vertical timeline**: a continuous decorative rail line
  (`components/DayTimeline.tsx`'s `TimelineRail`) behind the naturally-flowing, **completely
  unchanged** `renderWorkout`/`renderEvent` cards, with a `GapRow` between items showing the real
  free time between them ("2h 15m free") — `lib/dayTimeline.ts`'s new `buildDayGaps` (pure,
  unit-tested), extending the same module the first day-timeline pass added earlier the same day.
  Deliberately **not** time-proportional / absolutely-positioned by minute (card heights vary too
  much — a MISSED badge, an overdue prompt, a conflict note all add height — and this RN0.85/
  React19/new-arch stack already has a history of silent rendering bugs this session); the rail is
  a single decorative element behind ordinary document flow, carrying none of that per-item risk.
  This supersedes the same-day's first pass (`DayTimelineStrip`, a horizontal ruler above the list)
  — the founder's own device screenshot showed it reading as a weak afterthought, so it's gone,
  replaced by making the card list itself the timeline.
  **Hierarchy pass (2026-07-16, after the founder's device review of the first attempt):** the
  first version put a rail next to the *existing dense card* and changed nothing else — the founder
  correctly called it noise with no hierarchy ("too many elements competing at the same size and
  intensity"). The structural fix: **the timeline is a DISPLAY; the action bar is separate and sits
  BELOW it** (matching the reference design, where `Start Session` is outside the timeline entirely).
  So `renderWorkout` now renders only status/title/one meta line, and a single `renderHeroActions`
  bar underneath the whole timeline owns the primary CTA + focus caption + the "lacking time?" link.
  Both read the same `workoutState(w)` helper so display and action can't disagree about what state
  today's session is in. Secondary actions (Add to Calendar, Details, Edit, Skip) moved into the
  tap-to-expand state — one tap away, **not removed**. Added an **eyebrow + big headline**
  ("SCHEDULED TODAY" / "Your Window to Build Muscle", the goal in the user's own language) as the
  hierarchy anchor. Two real bugs fixed in the same pass: the readiness chip and the primary glow
  were both rendering on **completed** workouts — readiness advice about a decision already made,
  and a finished session as the loudest thing on screen. **Context strip:**
  `ContextItem` gained `chipOnly`, implementing the audit's explicit "demote goal countdown,
  block-phase, and 3 of the 4 banner types → one calm chip row" — goal/block/report/travel can now
  never take the banner slot (they were out-shouting today's session at the top of the screen); the
  banner is reserved for something needing an ACTION or reporting something BROKEN (missed,
  calendar-disconnected, welcome-back). Their `primary()` renderers are intentionally kept (dead but
  one flag-flip from being re-promoted). **Weekly target** rebuilt: the old ring + bar showed the
  same number twice — now one bar, a `N / target` count, and a line that says where you stand.

  **Round 2 (same day, second device review):** the rail line now fades in/out at each end instead
  of cutting hard past the first/last item — `components/DayTimeline.tsx`'s `TimelineRail` measures
  its own rendered height (`onLayout`) and draws a real `react-native-svg` `LinearGradient`
  (0→1→1→0 opacity stops) rather than a percentage-based CSS fade, so the fade length
  (`RAIL_FADE_PX`, 26px) stays constant whether the day has two items or ten; guarded against a
  fade longer than a very short rail. **All-done day gets its own screen, not the regular
  timeline**: `dayComplete` (every scheduled workout today is `'completed'`) switches Home to a
  completion card — a checkmark, "Session Complete," real logged minutes + lifted volume (summed
  from `set_logs` for today's actual `workout_logs`, warm-ups excluded, matching every other volume
  calculation in the app — **not** a fabricated number) — followed by a "NEXT UP" row (the existing
  `nextWorkout` query, already fetched) and each finished session collapsed to a quiet reachable row
  (→ `session-detail`), never a glowing struck-through card with no CTA. The headline personalizes
  to "Nice work, {first name}." off `profile.display_name`'s first token (falls back to a name-free
  greeting if the value looks like an email or is implausible). **A two-tile stats row** closes the
  screen: Total Volume (all-time, with an 8-week sparkline reusing `stats.weekVolumes` — the exact
  bars Progress's own chart already computes, zero new data) and Sessions + current streak.
  **Deliberately no heart-rate/steps tile** despite the founder's reference design showing one —
  Tempo has no HealthKit integration (B5.2, unbuilt); a fabricated biometric number would be worse
  than the tile not existing. Both tiles gate on `stats.totalWorkouts > 0` so a brand-new account
  doesn't see an all-zero row.
  **Hero card gets three additions** (still the same `renderWorkout` function, hero-branch only):
  a **readiness chip** ("88% ready · go hard," reusing `readinessFromHistory`/`intensityFromReadiness`
  off the SAME `useProgressStats(userId)` call Home already made — zero new queries — tapping through
  to Progress, which owns the full readiness card); **tap-to-expand** on the hero title, revealing a
  lazily-fetched (only once expanded) exercise-name list + `describeSession()`'s "why this workout"
  headline (a lightweight peek query — `id, name, movement_pattern, primary_muscles` — deliberately
  NOT the full prescription/warmup/log-resuming load `plan.tsx`'s runner does); and a **"Lacking
  time?" escape hatch** (audit: *"add this inline"*) that marks today's session skipped (reusing the
  existing `skipWorkout` path) and routes to the existing `/quick-workout` generator for a real
  15-minute session, confirmed via `OptionSheet` first — deliberately NOT a new "shrink this session"
  abbreviation engine, which would have been much larger, unrequested scope.
  **Bug fix (2026-07-17):** the readiness chip described above was computed (`readiness`/
  `intensity` via `useMemo`) but had **zero JSX consumer** — it never actually rendered anywhere,
  silently, since whichever pass built it. Now genuinely rendered in a `heroMetaRow` right under the
  headline, alongside a **streak indicator** the founder specifically asked for: the streak number
  (`stats.streak`, from `lib/streak.ts`'s `sessionStreak()`) now shows in a **muted/outlined style**
  whenever this branch renders (which only happens before today's session is done), and in the
  **hot ember color** in the `dayComplete` branch — "keep the number, just make it look
  paused-not-broken until it's earned." **Real bug fixed 2026-07-17:** the "confirmed correct
  already" claim above was wrong for one real path — swapping today's session for a Quick Workout
  (or any same-day skip) marks the original row `'skipped'` immediately, and `sessionStreak` used to
  treat that as a settled break the instant it happened, zeroing the streak before the replacement
  session was even started. Fixed at the source: `isCommittedMiss`/`isSettledBreak` in
  `lib/streak.ts` now only count a miss/skip as breaking the streak once that day is actually in the
  PAST (`day < todayStr`) — today's own miss/skip is judged tomorrow, never zeroing the streak
  mid-day. `longestSessionStreak` got the same fix for consistency.
  **Phase 8 — Feed button (2026-07-17):** the header's recovery-check-in ring is gone, replaced by a
  **Feed button** (`notifications-outline` + a red count badge) — the founder's original ask
  ("instead of recovery button, have a feed button that shows notifications, progress, friend
  requests"), scoped down per the plan's own "no new backend" constraint: the badge count is
  `eligibleContext.length + socialNotifs` — literally today's already-computed `contextItems`
  eligibility (missed workout, calendar reconnect, rest day, travel mode, goal ETA, weekly report,
  quick-workout suggestion) plus the same pending-requests/invites count Profile's Friends badge
  already showed, now shared via a new `lib/social.ts` export, `fetchSocialNotifCount` (one query,
  reused by both screens instead of two separate implementations of the same two count queries).
  Tapping Feed opens an `OptionSheet` listing every eligible item (reusing each `contextItems` entry's
  own `chip.label`/`chip.icon`/`chip.onPress` — selecting one does exactly what its chip already did)
  plus a "Friends — N new" row that routes to `/social`. **No new table, no new screen for the list
  itself** — genuinely just an aggregator over signals that already existed.
  **Badge fixed to actually clear once viewed (2026-07-17):** the count used to just be
  `eligibleContext.length + socialNotifs` — a live snapshot of what's currently eligible, so it never
  went away even after the user opened the Feed and looked at everything (the founder: "should go
  away once viewed"). New `lib/feedSeen.ts` (same device-local idiom as `lib/badges.ts`'s
  unviewed-badge count): context items are keyed `${id}:${todayStr}` (dated, not permanent — most of
  them, like rest-day advice or the Quick Workout suggestion, are legitimately eligible again
  tomorrow with different content, and a permanent key would wrongly suppress that), social's count
  is tracked as an acknowledged number. Opening the Feed (`openFeed`) marks everything currently
  showing as seen; the badge (`feedCount`) now counts only items NOT in the seen set plus any real
  increase in social notifications since last acknowledged. The sheet's own list is unaffected — it
  still shows every currently-eligible item regardless of seen state, only the header badge reflects
  "unviewed." The recovery check-in
  itself (still the same `RecoveryCheckIn` sheet, untouched) relocated into the hero's `heroMetaRow`
  next to the readiness chip — reachable in the 3 most common Home states (a scheduled day not yet
  done, a completed day, and a rest day with a real next session ahead) via a small "Daily check-in" /
  "Checked in · N" chip; the one narrower remaining case (a genuinely empty plan, no session today or
  ahead) has no dedicated entry point yet — a real, documented gap, not silently dropped.
  **Today's-context strip** (`contextItems` array, unchanged from before this redesign): the
  contextual banners — missed-workout reschedule, Google-reconnect, travel-mode, rest-day advice,
  block-phase (mesocycle position), goal-countdown ETA, weekly-report nudge (Sun/Mon), Quick Workout
  suggestion (`lib/quickSuggestion`) — stay priority-resolved so at most one shows as a full banner,
  the rest as swipeable chips. **Bug fix (2026-07-17):** the whole strip — banner AND the chip row —
  used to be gated on `primaryContext` alone, so on any day with no banner-eligible item (no missed/
  reconnect/rest-advice), every `chipOnly` item (goal ETA, travel mode, block phase, weekly report)
  was silently hidden too, even though each was individually eligible; now shows whenever there's a
  banner OR at least one chip. **Block-phase item disabled (2026-08-09, founder):** the "Week 4 ·
Deload"-style periodization label read as noise, not useful information — the ask was to just
follow the split without a running commentary on which week type it is. `eligible: false` on the
`id: 'block'` item in `contextItems` (`(tabs)/index.tsx`); the underlying auto-adjustment (lighter
loads on a deload week, via `lib/periodization.ts`) is untouched, only this persistent label is
gone. The reactive `id: 'adaptation'` item (recovery/deload started or ended, tied to a real
behavior change from missed sessions) and the in-session runner banner
(`workout.progression.note` on `plan.tsx`) were deliberately left alone — both explain an actual
change when it happens rather than labeling every week regardless. **Goal ETA fixed the same day** (founder: "it says goal ETA but there
  isn't even an ETA… illogical"): `lib/goalProjection.ts`'s `GoalProjection` gained a `hasEta` field —
  false only for the "not enough signal yet" fallback (`"Log your weight to see your ETA"`, no real
  countdown in it), true for every genuine projection. The Home chip's eligibility now requires
  `projection?.hasEta`, so the no-signal placeholder never masquerades as an actual "Goal ETA" again.
  **Feed redesigned into a real notification center (2026-07-22)**, replacing the OptionSheet
  described above (founder: it just re-showed the same eligible items — "same Goal ETA every day" —
  with no history, no read state, and none of the actual server-sent retention pushes visible
  anywhere in the app). `contextItems`/`primaryContext`/`overflowContext` (Home's own live banner +
  chip row, above) are **completely unchanged** — that's normal live dashboard state, never the
  complaint. What changed is only what happens with that same eligibility data for the Feed
  specifically: **`lib/feedLog.ts`** (new) is a real append-only local log — `logFeedItem(userId,
  item, cooldownMs)` writes an entry once per logical id, then suppresses re-writes for
  `cooldownMs` (default 7 days) even if the item stays eligible the whole time, so it reads as
  message history instead of a live mirror. Home's render now calls `feedBodyFor(id)` (plain-text
  body + an optional routable `screen` per context item, kept separate from `contextItems`'s own
  JSX `primary()` renderers so the live banner was never at risk while wiring this) and logs each
  eligible item via a `useEffect` keyed on the eligible-id-set (not the array reference, so it
  doesn't fire every render). Read/unread state is per-occurrence (`getLastReadAt`/`markRead`/
  `isUnread` — `item.createdAt > lastReadAt[id]`), so a re-occurrence after the cooldown expires is
  genuinely unread again even though the same logical id was read once before. **New `app/feed.tsx`**
  (a real modal screen, not a sheet, since this is now something you browse, not a quick action
  menu): merges `lib/feedLog.ts`'s local entries with a live query against **`notification_log`**
  (`status='sent'`, last 30 days) — the server-sent retention pushes (missed_workout,
  streak_at_risk, weekly_report, etc.) were already logged there and RLS-readable by the owning
  user, just never read by the client until now (see §4.2's retention-push entry). Tapping an item
  routes via the same `data.screen` → route mapping `_layout.tsx`'s push-tap listener already uses
  (`routeForScreen` in `feed.tsx`, kept in sync with that switch by hand — no shared constant yet).
  The "Friends & invites" row stays a live pinned count (not logged — `fetchSocialNotifCount` has no
  per-event history to log), still acknowledged via `feedSeen.ts`'s `setSeenSocialCount` on view,
  matching the old sheet's behavior. **Deliberately NOT logged:** local on-device reminders
  (pre-workout 30-min alerts, the rest-timer alert) — `scheduleWorkoutReminders` runs broadly and
  repeatedly across every re-sync for many future workouts, so logging at schedule time would
  flood the feed with duplicates days before they're relevant, and there's no reliable "it actually
  fired" callback for a backgrounded local notification without deeper native work. `lib/feedSeen.ts`
  is trimmed to just the still-used social-count functions (`feedItemKey`/`getSeenFeedItems`/
  `markFeedItemsSeen` — the old per-day dated-key tracking — deleted, fully superseded by
  `feedLog.ts`'s per-occurrence read-state). `tsc` clean, full suite green, new `feedLog.test.ts`.
  **Second real gap, fixed 2026-07-17** (founder: "what's the point of goal ETA, there is no ETA, it
  just takes you to momentum"): even with `hasEta` fixed, tapping the collapsed Goal ETA CHIP (i.e.
  when it loses the single-banner slot to something else) just navigated to `/(tabs)/progress` —
  which has zero goal-projection UI anywhere, so it read as a dead end into an unrelated tab (whose
  actual top section is the unrelated "Momentum" habit card). The chip's `onPress` now opens a small
  `TempoSheet` showing the real projection content directly (icon, headline, sub, progress bar — the
  same content the primary card renders), with a "View full progress" button as an optional deeper
  link to Progress, rather than the tab switch being the only outcome.
  **Rest-day advice re-tuned the same day** (founder: "don't push rest days too much, some people
  only need one rest day a week, don't discourage from workouts"): `lib/trainingLoad.ts`'s
  `restDayAdvice` raised its "affirm a rest day" threshold from 3→6 consecutive training days (a
  6-day/week trainer with one rest day was getting nagged every week at the old threshold), and
  dropped the "consider a rest day" branch entirely — it used to fire even on a day the user already
  has a workout scheduled, which is actively discouraging a planned session, not just affirming an
  open one. **Weekly-target card** moved to directly under the timeline (the
  audit: *"the single best retention mechanic on the screen — keep it prominent"*) instead of above
  everything else. **Empty-day states simplified**: rest day with a real next session ahead shows
  the existing "YOUR PLAN / next workout" card; a genuinely empty plan (no session today or ahead)
  shows one "Add a workout" prompt — the old third branch (rest day within an otherwise-populated
  *week* range) no longer applies now that Home has no week range to compare against.
  **Add Workout** FAB (opens `AddWorkoutSheet`, defaults to today); recovery check-in entry (this is
  where you *log* a check-in — **relocated 2026-07-17, Phase 8**, see the Feed-button paragraph
  below); "ignore event" to free time. On open, Home still runs plan rollover, split-horizon refresh, conflict
  resolution, and the 14-day reminder reconciliation sweep, and the `AppState`-driven missed-workout
  re-check on a new calendar day — none of that changed. **Home tour**: the old two-step "this is
  your calendar" + "your next session" pair collapsed into one step (`lib/tutorial.ts`
  `HOME_TOUR_STEPS`) anchored on the timeline itself, since there's no separate calendar strip left
  on Home to spotlight on its own; the anchor now wraps the ENTIRE conditional render (loading/error/
  empty/timeline) in one always-present `View` so the tour target survives every branch, matching
  the invariant the old per-day anchor relied on. **Not yet on-device verified** — flagged 🔍, needs
  the checklist in `EXECUTION_STATUS.md`'s session log before this can be trusted, same discipline
  as every other live-UI batch this session.
- **Plan** (`(tabs)/plan.tsx`, formerly "Train" — **IA redesign Phase 2, 2026-07-16**): a **hub**
  and a **live session** in one tab; the tab file/route is unchanged, only the label and the hub
  content. Plan now owns **all multi-day scheduling** (moved from Home in Phase 1): a `[Week |
  Month]` toggle + range row + a **"Reschedule my whole week"** icon button (the exact
  `lib/reschedule.ts` engine, UI relocated verbatim from Home) sit above a week strip / month grid
  (`renderDayCell`, also moved from Home, using Plan's own lightweight `plan_cal_workouts` range
  query — day/status only, no calendar-event merge, since Plan's calendar only needs to know which
  days have a workout for the dots). **Tapping a day** shows that day's session below the calendar:
  selecting **today** shows the full pre-existing session card (hero focus, readiness chip, exercise
  list, "why this workout," Start/Resume — unchanged, since the runner's own `workout` state always
  resolves to today's session regardless of what's selected in the calendar); selecting **any other
  day** shows a lighter read-only summary (focus, time, duration, exercise count) with an **Edit**
  button into `edit-session.tsx`. Below that: a condensed **CURRENT SPLIT** card (name, days/week,
  split-day labels, **Edit Split** → `my-splits`) — the audit's "one Programs door," replacing the
  old full Splits list. Then **LIBRARY & TOOLS**: three simple navigation rows (Exercise Library,
  Manage Workouts, History) — not an inline searchable list; that removed the old segmented
  Workouts view's own template-browsing UI, since `my-workouts` already does that job.
  The `[Week | Month]` month grid carries a **dot legend** (Scheduled / Done / Missed) — without it
  a month of numbers is an unexplained colour code — and the selected-day card names the day it's
  showing ("THURSDAY, JUL 16 · SCHEDULED"), since "Rest day" alone gave no clue which cell you tapped.
  **The old 4-way segmented control (`components/TrainSegments.tsx`: Session/Readiness/Splits/
  Workouts) is gone, file deleted** — none of its non-Session segments survived in a form the new
  design still needed: **Readiness** moved to a chip on the session card (tapping through to
  Progress's full `ReadinessCard` + muscle-map, the same "point of decision, not a full tab"
  treatment Home's hero chip got in Phase 1) — the underlying `readinessFromHistory`/
  `intensityFromReadiness` computation stays, feeding the same chip; **Splits**' full list became
  the condensed current-split card above; **Workouts**' inline list became a nav row. `muscleRecovery`
  (only ever feeding the deleted `TrainReadinessView`) is unused now too. **Not touched, still
  runner-critical:** `muscleTimeline` → `weeklySetsByGroup` (B5.4's real weekly-set counts per
  muscle group) still feeds `buildPrescription`'s MRV cap at all 3 live call sites — that's a
  completely separate concern from the display-only readiness chip and was never part of the
  segmented-control cleanup. The hub renders **even on a rest day / when nothing is scheduled today**
  (today's session branch shows an empty state; the calendar, split card, and library rows stay
  usable regardless).
  **Discarding** an unstarted session now **fully cancels** it — drops it from the plan (status
  `rescheduled`, so it's ignored by the streak + never re-synced) **and** removes its synced calendar
  event (best-effort, `removeWorkoutFromCalendar`) so no ghost workout lingers. The **finish screen**
  (`workout-complete.tsx`) uses the `Elevation` depth ramp. The **live
  session runner is deliberately untouched** — every hub change is inside the `!sessionActive` branch,
  and Splits/Workouts actions route to the existing screens (single source of truth). Hub/loading/empty headers carry only the wordmark + avatar — no back
  button (it's a tab, not a pushed screen); only the live session keeps its chevron-down
  leave-to-hub control. You only enter the live logger deliberately (hub button, or an
  explicit start from Home / Quick Workout which pass a `workoutId`), and the `workout_logs` row +
  timer are created **on start, not on view** — so browsing the hub never spawns a phantom session.
  **Load lifecycle:** the hub reloads on every tab focus (never mid-session; in-flight +
  15s-freshness guards), so completions, new plans, and date changes are always reflected; a
  passed `workoutId` param is **consumed** via `setParams` after starting, so re-starting the same
  workout re-triggers cleanly, and finishing resets the tab behind the summary so returning shows
  a fresh hub.
  The live session builds per-exercise **prescriptions** (autoregulation + periodization + readiness
  + feedback bias), pre-fills sets, smart exercise swaps, form guide + exercise GIFs. **Coach card
  decluttered (bug fix, 2026-07-16):** the set rows are already pre-filled with the exact target
  reps/weight (`initialSets` seeds `reps` from `p.repHigh`, `lbs` from `p.suggestedWeight`), so the
  card above them no longer repeats a redundant "N reps × M sets" line — it now shows only when
  there's a genuine trend to report (`p.direction !== 'new'`: GO UP/HOLD/BACK OFF + the specific
  reason, e.g. "You cleared 12 reps last time — add 5 lbs."), which is exactly the "final-set,
  improved-from-last-time" signal worth surfacing. A brand-new exercise (no logged history for that
  exact `exercise_id`) shows no card at all now — removed the boilerplate "First time on this lift?"
  paragraph that repeated on every such exercise; the pre-filled rep target is already visible in the
  first set row. (Note: exercise-selection **rotation** for week-to-week variety means a specific
  `exercise_id` often really is new even for an experienced user on a long-running split — the card
  reflects that honestly rather than fabricating a trend that doesn't exist; a future iteration could
  track progression per movement-pattern/slot instead of exact exercise id to reduce how often that
  happens, not attempted here.)
  **"Delay my whole week" (2026-08-04, new Pro feature, `lib/delayWeek.ts` + `lib/reschedule.ts`):**
  the literal companion to "Reschedule my whole week" above — instead of re-optimizing each workout
  onto its best day, this pushes every remaining `status:'scheduled'` workout in the CURRENT
  Sunday-start calendar week later by a single fixed offset (1–6 days, picked from a dynamic
  `OptionSheet`), preserving relative day spacing and each workout's original time. Deliberately
  scoped to **only this week**: `computeMaxDelayDays`/`planDelayWeek` (pure, unit-tested in
  `delayWeek.test.ts`) cap the offset so no shifted workout can land past the week's last day
  (`lib/dates.ts`'s new `weekEndStr`) — which is also what guarantees it can never collide with the
  `scheduled_workouts_one_plan_per_day` partial unique index (`fix_duplicate_scheduled_workouts.sql`),
  since every 'scheduled' row inside `[today, weekEnd]` is included in the shift and none can be
  pushed onto or past a day outside that range. No calendar-slot search is needed (times are kept
  as-is, only the date moves), so unlike reschedule this never touches calendar-permission state.
  Two entry points read fresh, live data rather than trusting a stale UI snapshot: `getDelayWeekInfo`
  (read-only, builds the offset picker and reports "nothing to delay" / "already at the week's edge")
  and `delayWholeWeek` (re-reads + re-clamps at commit time, so a race between opening the picker and
  confirming — a workout completing, or filling the last open day — can only ever reduce the applied
  offset, never spill it into next week). Same Pro gate as reschedule (`schedule_optimization` —
  extended rather than a new `ProFeatureId`, since it's the same Smart Scheduling pillar), same
  partial-failure handling as `rescheduleWholeWeek` (per-row update, a failed row is never counted as
  "moved," `captureApiError` on partial failure, `adaptation_events` trigger `'delay_week'`). UI lives
  next to the reschedule icon button in Plan's range row (`play-forward-outline`). Not wired into
  Tempo Coach's action layer — out of scope for this batch, `reschedule_week` remains Coach's only
  scheduling action.
  **Scheduling / split-recovery bug fixes (2026-07-16/17, direct founder reports):** (1) "Reschedule
  my whole week" (`lib/reschedule.ts`'s `rescheduleWholeWeek`) only ever re-slotted EXISTING
  `scheduled_workouts` rows — if a split day had been deleted/skipped first, it stayed missing after
  a reschedule. Now calls the same fill logic `materializeSplit` (`lib/splitSchedule.ts`) already uses
  for the active split, for each weekday in the horizon with no live row, BEFORE re-slotting — so a
  reschedule can't skip re-creating a day that should exist. (2) A soft-deleted day
  (`status:'skipped'`, the established remove-a-workout pattern — never a real `DELETE`) was
  permanently orphaned: `materializeSplit`'s "already taken" existing-dates query had no status
  filter, so it read a skipped date as occupied forever. Fixed the query to exclude
  `status = 'skipped'` (a skipped date now reads as open again — `'rescheduled'` days still correctly
  stay excluded, since those are genuinely superseded by a plan/split change, not a single-day
  removal) — this alone means the next app-open split-horizon refresh self-heals a skipped day with
  no user action. Plan's day-card also gained an immediate affordance so the user isn't stuck waiting
  for that sweep: selecting a day the active split expects a workout on, but has none for, shows
  "Unscheduled this week — Add it back" with a one-tap button that re-runs the same fill logic for
  just that day. (3) Plan's hub said "No session scheduled today" even once today's only session was
  already completed — `loadWorkout()`'s fallback only ever queried for a `'scheduled'` row; it now
  falls back to checking for a `'completed'` row on today's date and shows "Today's session is done"
  instead of the generic empty state. (4) Connecting/reconnecting a calendar left a stale-looking
  workout until a force-quit — `calendar-setup.tsx` fired `syncUpcomingWorkouts` fully fire-and-forget
  with zero query invalidation, and Home's `range_events` key wasn't in `useRefreshOnFocus`'s list
  either. Fixed at both ends: `calendar-setup.tsx` now invalidates `['range_events', userId]` +
  `['scheduled_workouts', userId]` after every connect/disconnect path, and `lib/queryInvalidation.ts`'s
  shared `TRAINING_KEYS` gained `['range_events']` + `['plan_cal_workouts']` so this exact class of
  staleness can't recur at any other mutation call site either (the same fix covers the "onboarding
  scheduled nothing until calendar connected" report — `generatePlan` always wrote the rows
  immediately; the stale-query gap was the real cause, surfacing differently on first run).
  (5) A signup or split activation/build later in the day could still get a same-day session dated
  with a start time already behind "now" (`generatePlan.ts`'s and `splitSchedule.ts`'s fixed
  `START_TIMES` arrays had no awareness of the actual clock) — not `'missed'` by the DB sweep (the
  date isn't in the past), but reading as overdue within minutes of finishing onboarding (2026-07-17
  founder report: "don't schedule a workout that's already past and say they missed it"). Both
  engines now skip creating today's row when its natural slot has already passed, mirroring the
  existing past-date skip exactly (`generatePlan.ts`'s comment: "Never create a past-dated session…";
  the same logic now also covers "today, but too late for this slot").
  (6) **Those two skips deleted the sessions instead of moving them, gutting the first week
  (fixed 2026-07-23, `generatePlan.currentWeekSlots`).** The plan's day-slots are absolute weekdays
  (a 3-day plan is Mon/Wed/Fri), so generating on a Wednesday dropped Monday (past) *and* Wednesday
  (start time behind the clock) and kept only Friday — one session. A Friday or Saturday signup kept
  **zero**. Observed on device: `plan-preview`'s reveal, captioned *"Your first week, planned."*,
  showed five rest days and two workouts to a user who had just asked to train three times a week.
  `currentWeekSlots(plannedSlots, todaySlot, todayUsable, blocked)` now re-lays the current calendar
  week across the days that are actually left, honouring the plan's own rhythm rather than cramming:
  the minimum gap is derived from weekly frequency (`floor(7 / daysPerWeek)`), so a 3-day plan keeps
  rest days between sessions while a 5-day plan stays consecutive as its design intends. It never
  exceeds `days_per_week` and never exceeds the days remaining. Effect for a 3-day plan, sessions in
  the signup week: Mon 2→3, Tue 2→3, Wed 1→2, Thu 1→2, Fri 0→1, Sat 0→1, Sun 0→0 (the week really
  is over). It is keyed on the **calendar date**, not the week index — the rollover/extension path
  passes the plan's *original* `start_date` as `startMonday`, so week 0 there is not necessarily the
  current week — and the per-slot past-date guards are deliberately left intact underneath, so no
  redistribution can ever produce a past-dated row. Covered by
  `__tests__/currentWeekSlots.test.ts` (11 tests, verified failing 4/11 against the old
  drop-only behaviour).
  **Set logging is instant:** tapping ✓ logs the set immediately (light haptic, rest timer
  auto-starts at the workout's effective rest); **RPE is an optional post-log follow-up bar**
  that updates the `set_logs` row — it never gates logging or the timer. Each set row has a
  **trash icon** (confirm → local removal + server-side `set_logs` delete + renumbering of later
  sets). A **"+ Add Exercise"** button mid-session opens the picker then an explicit **"this
  session only vs. permanently"** choice (permanent = scheduled row + the owning split day).
  The header's labeled **Pause** control opens a sheet — **Resume later** (progress saved; open
  log resumes from hub/restart) or **End workout** (finishes, or discards a zero-set session
  including its log row). Exercise completion plays a medium haptic and **auto-expands the next
  incomplete exercise**. The hub carries an **Edit workout** chip → `edit-session` modal.
  **Gym reality (July 2026):** every exercise has a **⋯ menu** — Swap (equipment-aware),
  **Move to end** (machine occupied — come back later), **Move up/down** (reorder mid-workout,
  persisted to the scheduled row's `exercise_ids`), and **Skip for today** (removes from the
  session + its logged sets, keeps it in the plan). **Warm-up sets** (`set_logs.is_warmup`):
  "+ Warm-up" inserts a W-tagged set before the first unlogged set; warm-ups render as `W` /
  "warm-up" and are **excluded from PREV, progression, and every volume/PR aggregation** (prs,
  useProgressStats, wrapped, weeklyReport, exercise-progress, session-detail, workout-history,
  friend overview) — completion treats a warm-up-only session as empty. A **session-note FAB**
  writes `workout_logs.notes` ("bench felt heavy today"), loaded on resume and shown in
  session-detail. A **one-time first-session coach overlay** (localStorage-gated) explains
  logging / rest / the ⋯ menu / pause. **PERF:** the PREV/prescription history query is bounded
  (`.limit`) + warm-up-filtered instead of scanning all-time `set_logs`.
  **Fixed — PREV blanking after pause/resume (2026-07-31):** pausing a workout sets `sessionActive`
  false while the log stays open; the next focus event re-runs `loadWorkout`, which re-fetches this
  same PREV/prescription history. That query wasn't excluding the *current* (resumed) log's own
  rows, so once even one set was logged today its `completed_at` — newer than the true last session
  — made it look like "last session," and PREV blanked for every set not yet logged today. The
  history fetch now filters out `resumedLog?.id`'s own rows.
  **Refined 2026-08-02:** that exclusion originally ran in JS *after* the query's `.limit()`, so for a
  workout with many exercises where several already had a set logged today, today's own rows (sorted
  first, being most recent) could eat into the capped budget before it reached far enough back for
  later exercises — theoretical, "low likelihood" per the audit that found it, but a one-line move:
  `.neq('workout_log_id', resumedLog.id)` is now IN the query itself, so the limit is only ever spent
  on genuinely relevant historical rows.
  **Honest time estimates** (`lib/durationEstimate`): hub + header use a realistic static
  estimate (prescribed rests + per-exercise setup/transition time) scaled by a **historical pace
  factor** (median actual/planned over recent sessions), and once sets land the header shows an
  **adaptive "~N min left"** blending observed pace with the static per-set cost.
  **Gym-proofing:** the session timer and rest timer are **wall-clock-based** (locking the phone
  never freezes them), the rest timer finishes with a **vibration + a scheduled OS notification**
  (covers a locked phone) instead of an Alert, the screen stays awake during a live session
  (`expo-keep-awake`), and an **open log left behind by a killed app is adopted and its sets
  rehydrated** (stale ones are zero-length-closed) so no duplicate `workout_logs` rows are ever
  minted. **Complete Workout has guardrails**: a 0-set completion is blocked and a <50%-logged one
  asks first — an accidental tap can't mint a fake session into streak/consistency/adaptation.
  **Rest-timer Live Activity, iOS only (2026-07-18, device-untested):**
  `src/widgets/RestTimerActivity.ios.tsx` (real implementation) + a bare `RestTimerActivity.tsx`
  no-op sibling for Android/web (2026-07-19 fix — `@expo/ui/swift-ui`'s components call into a
  native view manager that doesn't exist off iOS, and merely *importing* the file broke Android AND
  web bundling even behind a `Platform.OS` runtime check, since the import itself executes before
  any guard can run; Metro's platform-extension resolution keeps the two files apart instead, the
  standard fix for this class of problem). — Lock Screen + Dynamic Island via `expo-widgets`
  (config-plugin driven; `expo-live-activity`, the
  package this was originally researched against, turned out deprecated on npm mid-session, hence the
  pivot). Shows the resting exercise's name and a countdown ring/digits that tick via SwiftUI's own
  native `Text`/`ProgressView` `timerInterval`+`countsDown` props (the OS animates these itself from a
  start/end `Date` pair — no per-second JS push, sidestepping ActivityKit's own update-rate limits).
  Wired at exactly the 3 places the wall-clock rest timer already lives in `(tabs)/plan.tsx`:
  `startRest`/`adjustRest`/`stopRest` call `startRestActivity`/`updateRestActivity`/`endRestActivity`
  respectively (the tick effect's own auto-end-at-zero branch calls `endRestActivity` too); every
  session-ending path (`finishWorkout`, `discardSession`, `onPauseChoice`'s pause branch) already
  routed through `stopRest`, so all of them end the Activity for free. `_layout.tsx`'s app-open effect
  calls `endStaleRestActivities()` as a force-quit-mid-rest safety net (iOS auto-expires stale
  Activities on its own timeout regardless, but this is faster and explicit). **A real architectural
  constraint, not a style choice:** the widget file imports ONLY from `expo-widgets` and
  `@expo/ui/swift-ui*` — never Tempo's own theme/constants modules — because `expo-widgets` compiles
  its `'widget'`-directive-marked layout function into native SwiftUI via an isolated build-time
  bundling pass that stubs out `react`/`react-native`/`expo` entirely (see the package's own
  `metro.config.js`); pulling in a normal RN module there would break that pass. Colors are hardcoded
  hex literals for the same reason. **Deliberately iOS-only for now** (the founder's own call, given
  a choice, after learning Android 16's "Live Updates" equivalent has no library at all — genuine
  from-scratch Kotlin, sequenced as a later follow-up once this is proven on a device). **Needs one
  new native rebuild before ANY of this is visible or testable** — nothing here can be verified by
  `eas update`, the simulator, or by reading the code; the founder's on-device pass after the next EAS
  build is what actually proves the layout, the Dynamic Island regions, and the countdown all render
  correctly.
  **Fixed 2026-08-02 — total cold-launch crash on a from-scratch native build, not a simulator
  quirk.** `_layout.tsx` imports `endStaleRestActivities` from this file at module scope; `expo-widgets`'s
  own module chain (`index.js` → `Widgets.js` → `ExpoWidgets.ios.js`) calls
  `requireNativeModule('ExpoWidgets')` eagerly at ITS top level, so a static `import { createLiveActivity }
  from 'expo-widgets'` throws the instant this file loads if the widget extension's native module isn't
  linked into the running binary yet — before ANY try/catch in this file can run, since imports execute
  at module-load time, ahead of every function body (the `factory = (() => { try {...} } catch {} })()`
  guard only ever wrapped the `createLiveActivity()` *call*, not the import). Confirmed live on a fresh
  `pod install` + 0-error Xcode build. Fixed by moving `createLiveActivity` from a static import to a
  guarded `require('expo-widgets')` *inside* the existing try/catch — deferring evaluation to exactly
  the point already designed to tolerate "native module not compiled in yet." Traced (via the actual
  package source, `node_modules/expo-widgets/build/*` and `node_modules/@expo/ui/src/swift-ui/modifiers/
  index.ts`) that `@expo/ui/swift-ui/modifiers` has the identical eager-`requireNativeModule('ExpoUI')`
  pattern but is NOT implicated here — it's imported earlier in file order than `expo-widgets`, so if
  `ExpoUI` were also unlinked, the crash would have named it first; the live repro specifically named
  `ExpoWidgets.ios.js:2`, meaning `@expo/ui` was already linked and only the newer `expo-widgets`
  dependency wasn't. Left untouched (also lower-risk to touch: `Text`/`VStack`/`HStack`/`ProgressView`
  and the modifier functions ARE referenced inside the `'widget'`-directive `restTimerLayout` function
  itself, so converting those specific imports to a dynamic `require()` risked breaking the *separate*
  widget-compile Metro pass's static analysis of that function — `createLiveActivity` is never
  referenced inside `restTimerLayout`, so it carried none of that risk). **Still needs one more real
  device/EAS build to fully close**: this fix proves the crash is gone, not that Live Activities
  correctly render on hardware — that was never provable from a Mac Simulator pass to begin with.
  **Lottie + Tempo Coach, a real vector mascot (2026-07-19):** the founder wants a genuine "Duolingo
  feel" — a recurring mascot, a live logo moment at sign-in — which the app's existing hand-built
  `Animated`+SVG house style (`SvgProgressRing`, `TempoPulse`, `celebration.tsx`'s `ConfettiBurst`)
  isn't suited to: rigged character animation is what Lottie exists for. Added `lottie-react-native`
  + `components/TempoLottie.tsx`, a thin wrapper with Reduced Motion support (freezes on a static
  frame rather than vanishing), a `progress` prop for driving playback from real app state instead of
  free-running, non-square sizing (`width`/`height`, not just a square `size`), and an
  `onAnimationFailure` guard that hides the view rather than crashing whatever screen embedded it —
  new infrastructure alongside the existing hand-built primitives, not a replacement for them.
  **🚨 CRITICAL, UNFIXED (2026-07-22) — the muscle figure renders BLANK on Android.** Confirmed on
  the emulator with real training data: `app/muscle-map.tsx` shows its toggles (Front/Back,
  Status/Heatmap/Rank) and its "Recovery by muscle" readout (Quads 0%, Glutes 0%), but the body
  itself is an empty gap — not even the `border` outline draws. The same screen renders correctly
  on web, so it is platform-specific, and **the signature Pro feature currently shows nothing on
  the platform the app actually ships to.** Diagnosis so far: (1) **`react-native-svg` itself works
  on native** — `SvgProgressRing` (Progress → Consistency Score) draws its arc correctly, so this
  is not a broken SVG pipeline; (2) there is exactly **one** copy of `react-native-svg` (15.15.4) in
  `node_modules`, so it is not the classic duplicate-instance bug, even though
  `react-native-body-highlighter` declares it as a direct dependency (`^15.9.0`) rather than a peer;
  (3) **3.2.0 is already the latest** published version, so there is no version bump to take; (4) the
  app runs `newArchEnabled=true`, and this codebase already has one library that "silently renders
  nothing" on this RN 0.85 / React 19 / new-arch stack (`@gorhom/bottom-sheet`, see the sheets
  note), so a Fabric incompatibility is the leading hypothesis. The notable structural difference
  between the working and broken cases is that `SvgProgressRing` uses numeric `width`/`height` with
  **no `viewBox`**, while the library renders `<Svg viewBox="0 0 724 1448" width={200*scale}
  height={400*scale}>`. **Not yet determined:** whether Tempo's own `viewBox`-based charts
  (`SvgLineChart`, `SvgGrowBar` — every trend chart in Progress/exercise-progress/weekly-report)
  are affected too. That check needs an account with non-zero volume history and is the first thing
  to do next, because it decides whether this is one broken feature or every chart in the app.
  **⚠ Known ASSET defect (2026-07-22) — two coach poses are clipped in the source art, not by
  layout.** Founder reported the sprinting coach looking cut off; measuring every pose's vector
  bounds against its composition proved it is the artwork. Six poses carry a clean ~10px margin
  (e.g. `idle` 170 wide, paths 10.5→159.5). Two do not: **`sprinting`** (285 wide, paths 9.5→**284**
  — head and forward arm sliced) and **`wave`** (320 wide, paths 102.5→**319** — waving fingertips
  sliced). Critically the paths *stop at* the edge rather than continuing past it, so the missing
  art is absent from the vector data — **widening the composition would only add empty space; this
  is not fixable in code.** `wave` has a second defect: 102px of dead space on its LEFT against 1px
  on the right, so `TempoLottie` scales that emptiness into the box and the coach renders visibly
  offset right — and `wave` is the **sign-in screen**, the first thing every user sees. Fix is to
  re-export both poses with the ~10px margin the other six already use, and to crop `wave`'s left
  dead space. Source PNGs live in `brand-assets/coach-poses/` and show the same clipping.
  `@lottiefiles/dotlottie-react` is also required (`lottie-react-native`'s own web-platform
  fallback imports it directly — this project's `app.json` still exposes a `web` target for local
  `expo start` preview, and Metro resolves platform-specific files even for a module that's really
  only meant to run on iOS/Android here, so the dependency has to exist regardless). That package's
  own player is WASM-based (`@lottiefiles/dotlottie-web`'s `dotlottie-player.wasm`) — Metro's default
  resolver doesn't treat `.wasm` as a bundleable asset, so **this project's first-ever
  `metro.config.js`** exists solely to push `'wasm'` onto `resolver.assetExts`. Verified end to end
  with a real `npx expo export --platform web` (not just a guess) — first failed on the wasm
  resolution, then (after the metro.config fix) failed differently on
  `requireNativeViewManager is not available on web` from the Live Activity widget file below, then
  succeeded cleanly once that was also split by platform.
  **The character itself is the blue runner from the app icon** (`brand-assets/app-icon-512.png`) —
  the founder identified it as "Tempo Coach" and supplied a reference sheet
  (`brand-assets/tempo-coach-reference-sheet.jpeg`) extending it into 8 poses (idle, walking,
  sprinting, pondering, pointing, wave, high-five, jumping jack). **First pass got this wrong**: an
  initial version embedded the raster crop directly in the Lottie file and just animated its
  transform — the founder correctly flagged that motion can't fix a soft source, and the cropped
  poses (~200-400px, from a JPEG) were genuinely too low-res to hold up animated. Fixed by tracing
  each isolated pose into REAL vector shapes instead (`skimage.measure.find_contours` →
  `approximate_polygon` simplification → Catmull-Rom tangent smoothing so round parts like the head
  don't facet), emitting true bodymovin shape layers — crisp at any size, 4-6KB per file, and the
  vectorization incidentally cleans up the JPEG compression noise along the edges as a side effect of
  simplifying. `mobile/scripts/vectorize-coach-pose.py` (Python — a one-off build tool, not part of
  the app's own JS dependencies) does the trace; `assets/lottie/README.md` documents the full
  pipeline and pose→placement mapping. **Wired today:** `assets/lottie/coach/wave.json` above the
  logo on `sign-in.tsx`, `sprinting.json` as a badge above `FocusMode.tsx`'s rest ring while resting
  (an idea for later: drive it via `progress` synced to `restSecondsLeft / restTotal` instead of the
  current free-running loop — same principle as `SvgProgressRing`'s `value` prop), `pointing.json`
  beside the calendar animation on `onboarding/why-tempo.tsx`, and `highfive.json` (one-shot, not
  looping) alongside the existing confetti on `workout-complete.tsx`. `idle`/`walking`/`pondering`/
  `jumpjack` are traced and ready but not placed yet — `pondering` is an obvious fit for
  `plan-preview.tsx`'s "Personalizing your plan…" generating screen. Also bundled (not shown in any
  screen): `assets/lottie/LottieLogo1.json`, the official example animation from the
  `lottie-react-native` repo itself (Apache 2.0, same repo as the dependency) — kept purely as an
  on-device test fixture to isolate a native-Lottie-setup problem from a Tempo-Coach-file problem.
  **Needs the same native rebuild as the Live Activity/tab-bar-blur work above** before any of it
  renders — code-verified only; the traced shape data was checked against an independent renderer
  written for this purpose (parses the same `v`/`i`/`o` bodymovin path fields a real Lottie engine
  would and rasterizes them, confirming the shapes and transforms are structurally correct), which is
  a meaningfully stronger check than the earlier hand-authored `pulse.json` ever got — but it is
  still not a real Lottie/ActivityKit render on a device.
  **Offline honesty:** starting a session verifies the `workout_logs` row actually inserted
  (otherwise an alert + stay on the hub — never a session where nothing can save); a set whose
  `set_logs` insert fails is visibly un-checked (one "didn't save" alert per session, the
  unchecked ✓ tells the rest — and the un-check is a no-op if the exercise was swapped out while
  the insert was in flight, instead of crashing on the missing row); and Complete only celebrates
  after the completion writes verify — a failed save keeps the session live with a "tap Complete
  again" alert instead of showing confetti over an unsaved workout. All three failure alerts
  classify the error through `saveErrors.describeSaveError`, so an expired session in the gym
  isn't mislabeled "check your connection".
  **Offline set-log retry queue (`lib/pendingSetLogs.ts`, 2026-07-24):** the visible "tap ✓ to
  retry" above only lives in React state — if the user closes the app before retrying, the set was
  gone (never written anywhere durable). Scoped fix, not a generic offline-write framework
  (deliberately — CLAUDE.md's guardrails on unrequested abstraction): on a failed `set_logs` insert,
  `handleSetDone` also stages the exact payload in a local JSON queue (extends `prefStorage.ts`'s
  existing write-both-ways storage, one key, not a second mechanism); on a successful insert
  (first attempt OR manual retry) it clears any stale queued entry for that same natural key
  (`workout_log_id:exercise_id:set_number`) so a later flush can't double-insert it. The queue is
  replayed once, at cold app-open, from the SAME single-owner sweep F5 established
  (`index.tsx`'s effect) — mount-only, matching that fix's own "don't add a resume-time sweep"
  guidance, and independent of everything else in the sequence so it runs first. A device that
  stays offline across many opens keeps retrying rather than losing entries; a hard cap (200)
  prevents unbounded growth if it never reconnects. 7 unit tests (`pendingSetLogs.test.ts`). The rest-length picker is a branded `OptionSheet`
  (60/90s/**2min suggested**/3min/**custom stepper**) rather than an Alert (Android caps alerts at
  3 buttons); the pick **persists as that workout's rest** (`lib/restPrefs`, SQLite localStorage)
  and drives the auto-started rest after every set.
  **Editable completed sets + unilateral weight (2026-07-16/17):** a logged set could previously only
  be fixed by delete-and-redo (`removeSet`). Tapping a done set now re-opens it as editable inputs;
  saving issues an `UPDATE` to the existing `set_logs` row (`saveSetEdit`) instead of a new insert,
  then calls `invalidateTrainingData` — `session-detail.tsx` gained the identical tap-to-edit-inline
  pattern (see §3.1), since "logged it wrong, want to fix it after the fact" is squarely a
  post-session need too. A new **"×2 per side" toggle** next to the weight input (both surfaces)
  covers unilateral work with **no schema change**: `lib/unilateralPrefs.ts` (mirrors
  `lib/restPrefs.ts`'s device-local, per-exercise-name-keyed localStorage pattern exactly) remembers
  the choice per exercise, and the typed number is doubled into `weight_lbs` at write time — every
  existing volume/PR calculation, which already reads `weight_lbs` directly, needed zero changes.
  **Quick Workout re-scoping / session-active signal (2026-07-16/17):** the founder kept the GO tab
  button but asked that it not compete with a live session. New one-boolean `stores/sessionActive.ts`
  (matches the size/shape of small existing stores like `stores/entitlements.ts`) — `plan.tsx` syncs
  its local `sessionActive` state into it on mount/change and resets it false on unmount; siblings
  can't share React state directly, hence the store. `components/TempoTabBar.tsx`'s GO button reads
  it and hides (`pointerEvents:'none'`) while a session is live.
  **GO chooser + more Quick Workout entry points (2026-07-18):** GO used to jump straight into
  today's due session with no way to choose otherwise. New `components/GoChooserSheet.tsx` — when
  `todayRows` has a `status:'scheduled'` row, `TempoTabBar`'s `GoButton.handlePress` now opens this
  sheet (two cards: continue today's session, or "Quick Workout instead" → `/quick-workout`) instead
  of navigating immediately. The no-session fallback path (auto-generate + start instantly, no
  picker) is untouched — the chooser only inserts itself when there's a real choice to make.
  `AddWorkoutSheet` also gained a **Quick Workout row** (flash icon, under "Build a new workout"),
  shown only when the sheet is open on **today** (`isToday(date)`) — Quick Workout always schedules
  for right now, so it's hidden when the tapped calendar day is some other date.
  **Active-session Focus Mode (2026-07-16/17):** a new full-screen, ADDITIVE view for whichever set is
  currently in play — `components/FocusMode.tsx`, built after the founder's own reference screenshot
  (large center ring, rest timer with −/+ adjust, form-reference preview, Skip/Done taking up the
  whole screen, "especially for the rest timer"). Auto-opens when a rest timer starts
  (`restSecondsLeft` goes non-null right after `startRest(...)`); a manual "Focus" button on the
  exercise-card header opens it too. The ring (reusing `SvgProgressRing`, not new SVG code) shows a
  live countdown while resting or the target-rep count while active; −/+ adjusts rest duration live;
  the form preview reuses the exact same `getExerciseGifSource` resolution the exercise card's own
  thumbnail already uses (curated clip → RapidAPI ExerciseDB clip → none), fetched once, not
  re-fetched. Skip/Done wire to the exact existing handlers — `stopRest()` (skip while resting),
  `removeSet()` (skip while not resting), `handleSetDone()` (done either way) — **no new logging
  semantics**, just a different full-screen frame around the same state. Everything the runner
  already had — the scrollable exercise list, ⋯ menu, RPE bar, warm-up toggle, trash, add-exercise,
  Pause sheet — keeps working completely unchanged; Focus Mode is a second way to view the SAME
  state, closing it returns to the normal list with nothing lost.
  **"How much did you do?" while resting (2026-07-17):** previously Focus Mode had no weight/reps
  input at all — a set completed from inside Focus Mode logged whatever `set.lbs`/`set.reps` were
  already typed in the LIST view beforehand (often nothing, if the user never left Focus Mode). Now,
  while resting, Focus Mode shows an inline editor for the SET THAT JUST LOGGED (tracked separately
  from `focusExId`/`focusIdx`, which track the upcoming set) with weight/reps fields pre-filled from
  the just-inserted `set_logs` row. Editing reuses the exact existing `updateSet`/`saveSetEdit` path
  Phase 2's editable-after-done feature already built (an `UPDATE` by `workout_log_id` + `exercise_id`
  + `set_number`, not a new write path) — so this is the SAME edit-after-logging mechanism the list
  view exposes via its checkmark-tap-to-edit UI, just reachable without leaving Focus Mode.
  **Auto-dismiss after acknowledgment (2026-07-31):** this "HOW MUCH DID YOU DO?" card used to stay
  up for the *entire* rest period even after the user edited/saved it or rated RPE, which read as
  "still needs input" rather than "recorded." `FocusMode` now takes a `lastSetKey` prop (e.g.
  `"exId:idx"`, since `lastSetFields` is a freshly-built array — a new reference — every render and
  can't identify "same set" on its own) and collapses the whole card once the user saves a field or
  taps an RPE chip, keyed so the *next* set's card still shows normally.
  On finish updates logs, fires adaptation re-eval, and routes to the celebration screen. When
  nothing is scheduled the hub shows the Quick Workout empty state (never a dead end); hub links
  include **History** (`workout-history`).
- **Celebration** (`workout-complete.tsx`): momentum lead (trained-despite-missing / volume vs last
  week / streak), aggressive **PR highlights**, streak/consistency spike, difficulty check-in, share.
- **Weekly Report** (`weekly-report.tsx`): the "am I improving?" recap — workouts vs last week,
  volume %Δ, estimated strength gains, weight trend, consistency, new PRs; shareable.
- **Plan Explainer** (`plan-explainer.tsx`): explains the current mesocycle phase (volume/intensity/
  recovery dials) and when the next deload lands; opened by tapping the Home phase banner.
- **Home** also surfaces a **goal countdown** ("12 weeks to lose 10 lbs"), a rich next-workout empty
  state (never a blank calendar) — which shows an actionable **Start now** only when the next session
  is today, otherwise a **locked "Scheduled for <day>"** state plus an "add a workout today" link —
  and a Sun/Mon weekly-report entry. **Day-0 exception (2026-07-22):** when the user has never
  completed a session (`stats.totalWorkouts === 0`) that locked bar is replaced by a live primary
  **"Start your first workout"** button plus an honest "Or wait for <focus> on <day> — your plan runs
  either way" hint. Reason: `generatePlan` drops week-0 slots already in the past (a Wednesday-morning
  signup on a Mon/Wed/Fri plan keeps only Friday), so a brand-new user could finish seven onboarding
  steps and land on a greyed-out lock icon that merely restated the "NEXT WORKOUT · FRIDAY" line
  right above it, with the only real action demoted to a text link. The gate is deliberately
  `totalWorkouts === 0`, not "no session today": for a user who HAS trained, a rest day must keep
  reading as rest — promoting "train now" to everyone would encourage overtraining. Only the
  never-trained case, where there is no recovery to protect, gets the live CTA.
- **Layout:** screens with a fixed bottom CTA give their `ScrollView` `flex: 1` (so it scrolls
  instead of pushing the footer off-screen) and pad the footer by the bottom safe-area inset on
  edges-`top` modals — so action buttons are always reachable on every device.
  **Every bottom sheet pads its bottom by `max(safe-area inset, spacing)`** (profile modals,
  Edit/Add-workout, time picker, form guide, share sheet, option sheet, custom-exercise sheet)
  so actions clear the home indicator; input-bearing sheets (body log, edit profile, custom
  exercise, split day editor) wrap in `KeyboardAvoidingView`, and input-bearing screens
  (travel mode's label field, availability, profile-setup, workout builder) use keyboard insets
  so the keyboard never covers a field or its Save button. Long option lists inside sheets
  (equipment, injuries) scroll within a capped height so Save stays reachable on small phones.
- **Progress** (`(tabs)/progress.tsx`): the **Fitness Intelligence dashboard** — restructured into
  labelled sections (Hero → Momentum → Consistency → Coaching → Trends → Records → Journey) that lead
  with a *decision*, not a raw number. **All prior cards are kept** (consistency ring, streak, next
  milestone, completion rate, Pro-gated volume chart, weight trend, PRs, share cards, empty/error/
  loading). Added on top (from `lib/fitnessInsights` + `components/ProgressCards`): a **Tempo Score
  hero** with "why" bars, **Readiness** (history-based, works with no health hardware), **Momentum**,
  a weekly **consistency predictor**, a GitHub-style **consistency heatmap**, a **Weekly Review** card
  (opens the full `weekly-report`), **Tempo Insights** (optimal-window + behavioural patterns +
  muscle-balance nudge), a **training-frequency** graph (1M–1Y range), a **muscle-balance** radar
  (`react-native-svg`), a **strength-progress** top-movers list (→ `exercise-progress`), and a
  **journey timeline**. Data comes from `useProgressStats` (extended additively to also expose
  `logTimes` + `muscleSets` + `strengthSets` + `muscleTimeline` from its existing set-log query — no
  new fetches). Profile no longer duplicates any of the performance cards (see below).
  **Removed (2026-07-17, founder: "completely useless"):** the 3-day workout forecast
  (`workoutForecast()`/`ForecastStrip` — a fatigue-risk outlook that, ironically, flagged the exact
  "3+ days straight" pattern as risk the same way the old rest-day nag did) — deleted the function,
  component, and its dedicated test, not just the render call. **Body Intelligence is now shown
  INLINE** (founder: "actually show the body intelligence, don't have to click on a button to open
  it") — the Coaching section's card now renders a live, real `<MuscleMap>` preview (status-colored,
  reusing `muscleIntelligence(muscleTimeline, …)` — the SAME `muscleTimeline` field, zero new
  queries) directly on the card instead of a button-only teaser; a "Full view" chevron still links to
  `/muscle-map` for the interactive experience (view toggle, heatmap/rank modes, tap-to-select
  detail), which stays a dedicated screen rather than being fully duplicated inline. **Bug fixed
(2026-08-09, founder: "preview is different than what it actually is"):** this preview only ever
passed `statusByGroup` to `<MuscleMap>`, never `statusBySlug` — `MuscleMap`'s own `fine` flag
(`mode === 'status' && !!statusBySlug`) is what selects per-INDIVIDUAL-muscle shading vs. a single
flat colour per coarse group, so the preview silently rendered the coarse fallback (one blended
colour across all of "arms," say) while `/muscle-map` itself always passes `statusBySlug` and shows
each muscle shaded individually (biceps vs. triceps, quads vs. hamstrings) — a visibly different
figure for identical underlying data. Fixed by computing `bodyIntelStatusBySlug` the same way
`/muscle-map` does (`fineMuscleIntelligence(muscleFineTimeline, ...)`, off the same
`muscleFineTimeline` field `useProgressStats` already returns — zero new queries) and passing it
through, so the preview and the full screen now render identically for the same data. **Locked-state
polish, same session (founder: "looks sloppy, like a square over the body"):** the free-tier preview
only ever relied on `MuscleMap`'s own internal blur/scrim (a hard-edged translucent rectangle sized
to the figure, `size × size*2`) with nothing on top — exactly the "broken panel" look `/muscle-map`'s
own full-card lock treatment already fixed once for the big screen (see that file's `mapLockScrim`
comment). Rather than duplicate that screen's full title+body+CTA panel in a 150pt-wide card, added a
single centered rounded lock badge over just the figure (`bodyIntelLockBadge`) — the inner blur/scrim
stays as defense in depth, the card's own title row and "Sample shown..." caption stay legible and
still invite the tap-through. Deliberately no colour legend added — a locked teaser shouldn't teach a
free user how to read one they can't act on yet.
- **Profile** (`(tabs)/profile.tsx`): identity + history surface — **trimmed to just that in the
  2026-07-16/17 Settings split** (below). The **level/XP hero** shows a **Pro badge** (gold, when
  `useProAccess().isPro`), a **streak chip**, and **member-since**, plus a new **header gear icon**
  (`router.push('/settings')`). Below it (`components/ProfileCards.tsx`): a **Fitness Identity card**
  (goal · frequency · session length · equipment · active split, as chips — from `profile` +
  `fetchActiveSplit`) and a **Tempo Insights grid** (WHOOP/Oura-style stat tiles: workouts, streak,
  consistency, PRs, volume, readiness — from `useProgressStats` + `readinessFromHistory`; no new
  fetches beyond the split). Hero uses `Elevation.e2`, cards `e1`. This surfaces stats *on Profile as
  identity*, distinct from Progress's analytics dashboard. Profile keeps **Body Stats** (weight +
  body-fat + waist trends, progress-photo capture — the only place to *log* a measurement; "View
  trend" links to Progress), saved exercise swaps, a **"Right Now"** section (temporary/personal
  adjustments — **travel mode** (now Pro-gated-but-teased, see §10 above) **+ injuries**), **Training**
  (workouts/splits/history/library + equipment/Change Plan; **Primary Goal and Experience are now
  independently editable** — see below), and the Social section (Friends, gated on activation). Sign
  out, account deletion, calendar/notifications/appearance/units/tester-tools all **moved to the new
  `app/settings.tsx`** (route registered in `_layout.tsx` as a `slide_from_bottom` modal), reached via
  the header gear icon: Calendar & Scheduling (availability, calendar connect/disconnect,
  auto-scheduling toggle, add-to-calendar toggle, remove-all-Tempo-events), Subscription (Pro
  upgrade/manage, tester-gated), Tester Tools, App (notifications master + 7 sub-switches, appearance,
  units, Replay App Tour), Account (Privacy/Terms), Sign Out, Delete Account. This is a pure
  relocation — every row kept its exact existing handler/behavior, just moved files.
  **Goal/Experience independent edits (2026-07-16/17):** both rows were previously read-only display
  text, forcing the full "Change Plan" re-onboarding wizard (`/onboarding/goal`) for even a
  single-field change. Now tappable → a small `OptionSheet` → `saveTrainingField(field, value)`:
  `UPDATE user_profiles`, then calls `restampFuturePlanForExperience(supabase, userId)` (the same
  function `lib/experienceProgression.ts` already uses for automatic level-up promotions — it
  re-selects every upcoming session's exercises against whatever's currently in `user_profiles` and
  silently skips any focus it can't map to the new template set, so it can never corrupt the
  schedule), then `invalidateTrainingData(queryClient)`. **Days Per Week — fixed 2026-07-17:** used to
  be read-only, forcing "Change Plan" (a full regen) for even this one number — which, for a user
  running their OWN custom split, meant a harmless-looking tweak silently discarded their split for a
  freshly Tempo-generated plan (`generatePlan`'s `clearActivePlans` deactivates any active split and
  retires its future rows — correct when the user really means to switch, wrong as a side effect of
  one field edit). Now `saveDaysPerWeek(value)` — same `OptionSheet` pattern as Goal/Experience — just
  saves the field. Deliberately **no restamp, no split/plan touch at all**: this number is descriptive
  metadata for stats/badges/heuristics elsewhere, not the source of truth for a custom split's day
  count. Reshaping a Tempo-generated plan's actual schedule still requires the explicit "Change Plan"
  action (which already warns "This will replace your current plan" before proceeding). **The same
  fix extended to Home's d30 "Review Plan" reactivation nudge** (`(tabs)/index.tsx`) — it used to push
  straight into `/onboarding/goal` with zero warning, unlike Profile's Change Plan; it now shows the
  same confirm sheet first (`reviewPlanConfirm`).
- **Quick Workout** (`quick-workout.tsx`): pick minutes + focus → generated session, one tap to start.
  **The session actually fits the window now (2026-07-22).** Two independent estimators disagreed:
  `quickWorkout.exerciseCostSeconds` budgeted with a local `SETUP = 30` and rest only *between* sets
  (`sets - 1`), while `durationEstimate.estimateSessionSec` — the one the **runner displays the
  moment the session opens** — uses `SETUP_SEC = 90` and counts a rest *per set*. On a 5-exercise
  build that is ~5 min of unbudgeted setup plus 4 uncounted rests, so a "15-Minute Muscle Builder"
  opened reading **"EST. 21 MINS"** (observed in the running app). `exerciseCostSeconds` now imports
  `SETUP_SEC` and uses the estimator's own per-set accounting, so the budget and the displayed number
  are the same maths. Because honest accounting made a 15-minute window fit only *two* full-rest
  exercises, the "short sessions get denser" tuning gained a **≤20-minute tier** (sets capped at 2,
  rest capped at 50s, straight sets) — the fix for a short window is spending less of it resting, not
  fewer movements. Every duration now lands *under* its budget (10→~8, 15→~13, 20→~17, 30→~27,
  45→~41, 60→~55 min): a session that ends early beats one that overruns. Covered by
  `__tests__/quickWorkoutDuration.test.ts`, which asserts the property rather than any exercise count
  — *whatever* the builder emits, the runner's estimate must fit the requested window — so the two
  estimators cannot silently drift apart again (verified failing 5/8 against the old logic).
  **Redesigned (2026-07-21):** replaced 8 duration chips with one `Slider` (5–60, snaps to
  `QUICK_DURATIONS` via `snapToQuickMinutes` on release); "Target Area" chips are now real body parts
  (Arms/Chest/Back/Shoulders/Legs/Core/Cardio — `quickWorkout.ts`'s `TARGET_AREA_OPTIONS`) instead of
  training-taxonomy jargon (Push/Pull) — Cardio still reuses the pattern-priority mechanism
  (`targetPattern`), everything else is a genuine muscle-group hard-filter (`targetMuscles`, new
  `QuickContext` field) applied to the candidate pool before `selectExercises` runs, falling back to
  the unfiltered pool if a muscle group + current equipment/experience yields nothing. Training
  style (Purpose) and Equipment are collapsed behind a single "More options" disclosure (auto-opened
  if a route param already picked a purpose), not always-visible. **The generated-workout preview
  card (title, "why," full exercise list, "why it counts") is gone entirely** — Start goes straight
  into the runner, which has full swap/skip/remove tools the read-only preview never had; only a
  genuine "no matching exercises" error still shows a message. `buildWhy`/`buildContribution` and
  `QuickWorkout.why`/`.contribution` are unchanged in the engine (still computed, just unused by this
  screen now) — left alone rather than removed, in case another surface wants them later. The
  route-driven `targetPattern` (a missed "leg day" suggestion, `lib/quickSuggestion.ts`) still works
  exactly as before and is independent of the new muscle-based chips; picking a Target Area chip
  clears whichever mechanism (pattern or muscles) the previous selection used, since only one target
  makes sense at a time. **GO tab button re-scoped (2026-07-17), then simplified further
  (2026-07-21):** `TempoTabBar`'s `GoButton` checks today's schedule first (`go_today_workouts`
  query) via `GoChooserSheet`. **As of 2026-07-21 the chooser always opens** — it used to skip
  straight to an instant, sensibly-defaulted Quick Workout (no picker at all) whenever nothing was
  due; now "TODAY'S PLAN" just greys out with why ("Complete — nice work" / "No session scheduled
  today") and "Quick Workout instead" is always the second option, so GO never silently guesses on
  the user's behalf. A due session's "Continue" option still jumps straight into the runner
  (`/(tabs)/plan?workoutId=`), unchanged. The full Quick Workout picker screen is reachable from here
  and from Home's contextual quick-suggestion banner (which passes specific minutes/purpose/pattern).
  **Multi-select Target Area + curation fixes (2026-08-02, founder-reported):** Target Area chips
  are now genuinely multi-select — tapping several (e.g. Legs + Cardio) unions their muscle lists
  into one hard filter, composing with Cardio's own `targetPattern` mechanism as a priority nudge
  WITHIN that filter rather than a competing one. `computeTargetFromKeys` (quick-workout.tsx) derives
  `targetPattern`/`targetMuscles`/a human-readable `targetAreaLabel` ("Legs" / "Chest & Back") from
  the active key `Set`, so the route-driven "missed leg day" suggestion is now just the initial value
  of `routeTargetPattern`, cleared on the user's first explicit chip tap exactly as the old
  single-select build cleared it. **Real curation bug fixed the same session:** picking "Legs" for a
  muscle-growth/strength session recommended Jump Rope, purely because Jump Rope's `primary_muscles`
  include `calves` (a real leg muscle) — `forcePatterns` (the mechanism that guarantees a muscle-
  targeted request never comes back empty) used to force EVERY movement pattern present in the
  muscle-filtered pool, cardio and mobility included, regardless of whether the active purpose wanted
  them. Now only real resistance patterns (`push`/`pull`/`squat`/`hinge`/`core`/`carry`) are always
  forced; `cardio`/`mobility` are only forced when the active purpose's own `patternPriority` already
  wants them (conditioning/athletic want cardio; recovery/mobility want mobility) — so a
  muscle_growth-purpose Legs workout no longer pulls in Jump Rope, but a conditioning-purpose one
  still can. Also fixed live in the `exercises` table: Jump Rope listed `shoulders` as a PRIMARY
  muscle (a jump rope's shoulder/forearm involvement is a stabilizer role, not primary) — moved to
  secondary, migration `fix_jump_rope_muscle_data.sql`. **Renamed generated titles** from the old
  purpose-only mapping ("15-Minute Muscle Builder") to `{Target Area} {Purpose label}` ("15-Minute
  Legs Strength", "20-Minute Chest & Back Muscle"), falling back to "Full Body" when no Target Area
  is selected — `buildTitle` now takes the new `targetAreaLabel` context field. 2 new tests
  (`quickWorkoutTargetArea.test.ts`) lock the cardio-leak fix both ways (excluded when the purpose
  doesn't want it, included when it does).
  **Race condition fixed (2026-08-13), founder-reported ("weird" behavior — Start sometimes
  unclickable, sometimes generated an all-Core workout despite Chest/Arms/Shoulders selected):**
  `regenerate()` had zero request sequencing — every duration change or Target Area chip tap (multi-
  select means picking 3 areas is 3 separate taps, each its own `regenerate()` call) fired a new
  Supabase round trip without waiting for or cancelling any earlier one still in flight. Whichever call
  happened to RESOLVE last won the screen, regardless of which was CALLED last — a stale result for a
  duration/target the user had already moved past could silently overwrite the current one. Fixed with
  a request-ID ref: each call captures the counter, increments it, and only applies its `setWorkout`/
  `setEmpty`/`setGenerating` calls if it's still the latest request when it resolves.
- **Availability / Travel** modals: set work/school/sleep/unavailable windows, and a temporary
  travel-equipment override.
- **Scheduling mode:** a `scheduling_mode` profile pref (`auto` default / `manual`) decides whether
  Tempo places & re-slots workout *times* on its own. **Connecting a calendar does not force auto** —
  it's chosen in onboarding (schedule step) and toggled in Profile → Settings → **Automatic
  Scheduling**. In `manual` mode `autoScheduleUpcoming`/`resolveCalendarConflicts` self-guard and
  no-op (the calendar is still read for busy times / event sync); the user owns the times.
- **Calendar sync:** in auto mode scheduling is automatic (placed around the calendar at plan/split
  creation + conflict auto-resolve on app open). Connecting a calendar (Profile → Calendar →
  **`calendar-setup`** — a dedicated screen now, replacing the old `Alert.alert` checklist for
  connect + a second `Alert.alert` for disconnect; Google inline OAuth or device) is for reading
  busy times / scheduling around real life — it does **not**
  start writing to the calendar. **"Add workouts to my calendar" is opt-IN (default OFF)**, a separate
  Settings toggle independent of scheduling mode: `lib/calendarAutoSync.autoSyncEnabled` treats only an
  explicit `true` as on. Turning it **on** (with a calendar connected) runs `syncUpcomingWorkouts`
  (adds upcoming, not-yet-synced workouts on app open + after scheduling); turning it **off** runs
  `purgeSyncedWorkouts`, which deletes every Tempo-added event so the calendar returns exactly to how
  it was. **Fixed 2026-08-02:** this was fire-and-forget with no failure feedback — a calendar-API
  failure mid-purge left the toggle flipped off (correctly reflecting the user's intent going forward)
  while stale events silently stayed on their calendar, contradicting the toggle's own promise.
  `purgeSyncedWorkouts` now returns `{ removed, total }` (it never rejects — each row is its own
  best-effort try/catch, so a partial failure only shows up as `removed < total`) and `settings.tsx`
  awaits it, alerting the user to clean up manually via "Delete Tempo events from calendar" if some
  didn't clear. (The old manual "Smart Schedule My Week" screen was removed.) A **"Remove all Tempo events"**
  Settings action (`calendarAutoSync.removeAllTempoEvents`) goes further — beyond the events Tempo still
  tracks, it sweeps each connected calendar by Tempo's title (`Tempo · …`/`Tempo: …`) and color across
  ±18 months (`deleteTempoGoogleEvents` / `deleteTempoDeviceEvents`) to clear **orphans** left by
  reinstalls or manual edits, then clears any lingering DB pointers. Non-Google accounts (Apple/email)
  attach Google Calendar via `linkIdentity`, which needs **Supabase "manual linking" enabled**; when it
  isn't, connect fails cleanly as `link_unavailable` (→ "use the device calendar") instead of leaking
  the raw backend error. When the Google identity is already ANOTHER Tempo account's login (user
  signed in with Google once, now on an Apple/guest account), the redirect carries
  `identity_already_exists` — surfaced as **`identity_taken`** with copy telling them to sign back
  in with Google or use the Device Calendar (calendar-setup.tsx — the post-onboarding connect
  surface; calendar connection is no longer part of the onboarding `schedule` step).
  **Fixed bug:** when Google's refresh token is revoked/expired, the token edge function correctly
  deletes the stored row and returns `409 reconnect_required` — but `getGoogleAccessToken()` used to
  discard that signal and every caller (`calendarSync.getCalendarEventsForRange` in particular)
  swallows fetch failures to `[]` so the feed never breaks — net effect, Google events silently
  vanished forever with zero indication why ("used to work, now nothing shows" — likely because the
  OAuth consent screen is still in Google's "Testing" publish status, which auto-expires refresh
  tokens after 7 days; that's a Google Cloud Console setting, not something fixable from the repo).
  `CalendarAuthService` now exposes `googleCalendarNeedsReconnect()`, set whenever that specific
  reason is detected; Home shows a "Google Calendar needs reconnecting" banner (tap → calendar-setup)
  and calendar-setup shows the same banner inline. **Read-failure diagnostics
  (`CalendarApiService.describeReadError` + `getLastCalendarReadError()`):** when the token mints fine
  but the Calendar *Data API* rejects the read (valid token, but the **Calendar API isn't enabled on
  the Google project** or the token lacks the **`calendar.events` scope** — the classic break after
  flipping the OAuth app to "In production" without registering the scope), the read paths
  (`fetchUserEvents`/`fetchUserBusySlots`) no longer swallow it blindly: they parse Google's error
  `reason`, attach a fix hint, and report it via `captureApiError('gcal_read', …)` to Sentry — so a
  silently-empty timeline is diagnosable instead of a mystery (`getCalendarEventsForRange` still
  degrades to `[]` for the UI so the feed never blanks). The adjacent "Google returned events but
  none survived the timed/primary filter" diagnostic (all-day-only days) reports via
  **`captureDiagnostic`** instead (`lib/crashReporting.ts`, added 2026-08-10) — Sentry's info level,
  not Error: nothing failed there (200 from Google, filter did its job), and filing it as an Error
  was drowning genuine `gcal_read` bugs in expected noise (47 events/2 users in 3 days for one
  family's all-day-heavy calendars). `captureApiError`/`captureException` stay Error-level for
  actual failures; `captureDiagnostic` is for "worth seeing, not actually broken."
- **Multi-calendar (B1.5, 2026-07-17), built dormant:** `user_profiles.selected_google_calendar_ids`
  (jsonb array, migration `add_selected_calendars.sql`, **applied**) holds Google calendar ids
  BEYOND primary that Tempo also reads busy-time/events from. `CalendarApiService.fetchCalendarList()`
  enumerates the account's calendars (needs the `calendar.calendarlist.readonly` scope — see below);
  `fetchUserBusySlots`/`fetchUserEvents` now take an optional `calendarIds` array (default
  `['primary']`, so every existing zero-arg caller is unchanged) and fetch each calendar independently
  — only the primary failing throws (matches old behavior), an additional calendar failing degrades to
  `[]` rather than blanking the whole read. `lib/autoSchedule.ts` and `lib/reschedule.ts`'s internal
  `gatherBusy()` helpers and `calendarSync.getCalendarEventsForRange()` all thread the profile's
  `selected_google_calendar_ids` through (primary is always re-added even though the column stores only
  the "beyond primary" ids). UI: `app/calendar-picker.tsx` (new modal, registered in `_layout.tsx`),
  reached from `calendar-setup.tsx`'s Google card via a "Choose calendars" row (shown only once Google
  is connected), gated by a new `multi_calendar` entry in `lib/proFeatures.ts`
  (`<ProGate feature="multi_calendar" compact>`) — still OUT of `PAYWALL_POINTS` until it's device-
  confirmed. **Scope enabled 2026-07-18:** the founder added `calendar.calendarlist.readonly` in
  Google Cloud Console and `GOOGLE_CALENDAR_SCOPES` in `services/googleCalendar/config.ts` now
  includes it, so `fetchCalendarList()` + the picker work (OTA — the scope is a JS-config string, no
  rebuild). Two caveats live in the config comment: (1) already-connected Google users must reconnect
  once (a refresh-token exchange can't retroactively broaden granted scopes); (2) until Google finishes
  verifying the scope, users may hit an "unverified app" consent screen. `describeReadError`'s
  scope-diagnostic path still handles the pre-reconnect insufficient-scope case gracefully.
  **2026-08-04:** confirmed live in prod that caveat (1) bites literally every user — 0 of 3 connected
  Google tokens carry the new scope, since nobody had reconnected since 2026-07-18. `calendar-picker.tsx`
  no longer just displays that as a dead-end message: it now detects the scope-insufficient reason
  specifically and renders a "Reconnect Google Calendar" button that calls
  `CalendarAuthService.connectGoogleCalendar()` (the same one `calendar-setup.tsx` uses — forces
  `prompt=consent` so Google re-grants the full current scope list) and retries `fetchCalendarList()`
  automatically on success. Still needs one real on-device tap to prove the grant actually round-trips;
  if that surfaces Google's "unverified app" screen, verification in Cloud Console is the remaining
  founder-only blocker.
- **workout-complete**: streak/consistency spike, difficulty check-in (feeds adaptation), Wrapped
  share cards.

### 3.3 Components (`src/components/`, ~27)
**`TempoSheet`** — the shared bottom sheet every other sheet in this list is built on. Built on
React Native's own **`<Modal>`** (`animationType="slide"`, transparent, bottom-anchored), NOT a
third-party sheet lib. Takes `visible`/`onClose`/`scroll`/`snapPoints`/`style`; `snapPoints[0]` sets
a fixed sheet HEIGHT (e.g. `['92%']`), omit it and the sheet sizes to content capped at 90%.
`scroll` wraps children in a `ScrollView` (flex-fill when a fixed height is given, else `flexShrink`
so it hugs short content but scrolls when tall). Backdrop tap and the handle both dismiss.
`KeyboardAvoidingView` keeps inputs above the keyboard (the old body-measurement keyboard-covers-Save
bug).
  - **Why RN `<Modal>`, not `@gorhom/bottom-sheet` (do not regress):** it *was* briefly gorhom, but
    on this stack (RN 0.85 / React 19 / new architecture) gorhom's imperative `present()` rendered
    **nothing** in release builds — no sheet, no backdrop — so every sheet-opening button (Edit
    Profile, Log Weight, Sign Out, every OptionSheet, the pickers) appeared dead while handlers,
    state, scrolling and navigation all worked. RN `<Modal>` presents in its own native window: it
    can't silently no-op, needs no provider/reanimated/gesture-handler, and renders **above**
    `presentation:'modal'` screens (so sheets opened from workout-builder/edit-session/etc. work too).
    Pure-JS → ships via `eas update`, no native rebuild. The only gorhom left is an unused
    `BottomSheetModalProvider` at the app root (harmless; can be removed later).
  - **No `Alert.alert` confirmations from inside a sheet (do not regress):** a system `Alert`
    (`UIAlertController`) cannot present over an open `TempoSheet` `<Modal>` on iOS — it silently
    no-ops, so a confirm dialog fired from within a sheet appears to "do nothing". `EditWorkoutSheet`'s
    "Remove from schedule" hit exactly this (tap Remove → nothing happened); it now uses an **in-sheet
    inline confirm** (Keep it / Remove) plus **inline error text** for the save/remove failure paths
    (those `Alert`s were silent for the same reason). Rule: confirmations and error feedback that live
    inside a sheet must render as in-sheet UI (an inline row, or a nested `TempoSheet`/`OptionSheet` —
    nested Modals DO present), never `Alert.alert`. Single-button post-action toasts elsewhere share
    the flaw but fire after the action and rarely need to be seen, so they're low-priority.
  - **A presented `presentation:'modal'` screen doesn't auto-dismiss when a screen BEHIND it
    changes (do not regress):** `app/settings.tsx` is pushed as a modal on top of `(tabs)`; signing
    out or deleting the account swaps the stack underneath to `/sign-in`, but the modal itself stayed
    visibly on screen until the user manually tapped the back arrow (2026-07-17 bug). Fixed by having
    both handlers explicitly call `router.dismissAll()` on success. Rule: any modal screen whose
    action causes an auth-state change (sign-out, delete-account, and similarly session-ending
    actions) must explicitly dismiss itself — never assume a redirect elsewhere in the tree closes it.
`EditWorkoutSheet`, `ExerciseFormSheet`, `ExerciseMedia`, `RecoveryCheckIn`, `ShareCardSheet`,
**`SaveProgressSheet`** (the single guest → permanent-account upgrade surface, §1.1 — Apple/Google
buttons over `lib/accountLinking`, shared by the Profile card and the post-3rd-workout modal;
account-protection wording, never a hard gate),
`WrappedCard`, `TimePickerSheet`, `LoadingCard` (shimmer skeleton), `ErrorBanner`,
**`PRCard`** (personal-record celebration card, themed via `C.gold`/`C.onPrimary` — `variant="hero"`
animated w/ icon rows for `workout-complete`, `variant="compact"` static for `session-detail`;
replaces the two files' formerly-duplicated, hardcoded-`#B8860B` inline blocks — MASTER_FIX_PLAN.md
C2),
**`CustomExerciseSheet`** (create/edit a custom exercise), **`ExercisePickerSheet`** (search library +
custom, add to a workout — the fast in-context picker used by `split-editor`/`edit-session`; the
main workout-builder flow now opens `exercise-library` directly instead, for its richer equipment
filter), **`AddWorkoutSheet`** (calendar "add a workout": build new / saved
workout / starter template → builder), **`OptionSheet`** (the branded bottom-sheet option picker —
replaces every multi-option `Alert.alert` menu, which Android caps at 3 buttons; items take a
`destructive` flag that renders red — the affordance Alert's `style:'destructive'` gave Delete
rows; used for starter
workout/split presets, "use a saved workout", template actions in My Workouts, split actions in
My Splits, and the runner's rest-length picker; the remaining confirm/picker stragglers were
migrated onto it too — Profile's Change-Plan + "remove all Tempo events", Home's remove-from-calendar,
and the runner's skip-exercise + swap-exercise picker, the last of which had silently dropped its
4th+ substitute past Android's 3-button alert cap), **`Avatar`** (the shared profile picture — chosen
icon+colour, or now a real uploaded photo, read from the auth store; used in every header so none
fall back to a default icon — `lib/avatar.uploadAvatar()` picks + uploads to the new public
`avatars` Storage bucket, `supabase/add_avatar_storage.sql`, RLS-scoped to `<user_id>/…`, and writes
the resulting public URL straight into the existing `user_profiles.avatar_url` column, which
`parseAvatar()` already rendered as an image for any `http(s)` value — no schema change needed),
themed primitives, plus a `ui/` set. **Brand & delight set (all dependency-free, Reduce-Motion
aware):**
- **`motion`** — `PressableScale`, `FadeInView`, `PopIn`, `Shimmer`, `ScreenTransition`,
  `useReducedMotion`, `useScreenFocused`. Entrances run on plain JS `Animated` and follow one hard
  rule: **content can never get stuck invisible** — components render at rest (visible), dip to
  the hidden pose only in the tick the animation starts, and play on first screen *focus* (screens
  mount unfocused under `lazy: false`). Reanimated `entering` animations were removed — they could
  silently skip on new-arch mid-transition mounts, which was the root cause of the "blank until
  revisit" bug. Even started native-driver animations proved able to die silently (clipped list
  rows on a cold start froze the Home week feed's event rows invisible/half-faded), so every
  entrance also arms a **JS failsafe deadline** that force-snaps values to rest just after the
  animation should have ended — a dead animation now costs the animation, never the content. `PressableScale` is a full TouchableOpacity drop-in (the Pressable itself is the
  animated, styled element, so flex/absolute layout applies to the real touch target; all
  Pressable props pass through) and is used on every primary button, option card, day cell,
  segment, chip, and RPE/set control across Home, Train, Progress, workout-complete, and
  onboarding. `ScreenTransition` wraps each tab screen's content and plays a soft rise+fade every
  time the tab regains focus — the cross-tab transition, owned by the screen instead of the
  navigator so an interrupted switch can never strand a scene hidden.
- **`brand`** — `TempoWordmark` (the runner/clock **glyph mark** — `assets/images/tempo-glyph.png`
  tinted with the primary — then the lowercase wordmark + a metronome dot that double-beats on focus;
  pass `mark={false}` to drop the glyph, e.g. under the sign-in hero logo). `TempoPulse` (the 4-bar
  rhythm mark; loading + celebration accents), `PulseLoader`, `ScreenHeader` (masthead + primary
  tick/hairline rule). The glyph now rides in every masthead (all tabs + onboarding steps) and a
  brand footer on Profile, so the actual logo — not just the wordmark text — carries the brand.
  **`ScreenHeader` is now the one shared masthead across every screen** — the 4 root tabs, the live
  workout runner, and all ~21 secondary/modal screens. Props: `title` (omit → wordmark leads),
  `subtitle`, `right` (trailing action(s)), `leading` (dismiss/back affordance — presence flips the
  header to a balanced, centered layout with the title/wordmark between the two sides; when the sides
  differ in width, e.g. the runner's Pause vs avatar, the masthead is optically- not pixel-centered),
  `rule` (the amber tick + hairline, default `true`), and `size` (`'md'` = 24px root tabs, `'sm'` =
  18px + no pulse for the runner and modals). Two siblings ride alongside it: **`DismissButton`**
  (`kind` `'chevron'` | `'x'` | `'back'` — the single source for every modal/pushed-screen dismiss
  affordance, replacing the ~21 hand-rolled copies) and **`HeaderActions`** (a gap'd row wrapper so
  `right` can hold several actions, e.g. Home's readiness ring + avatar). Avatars stay per-screen
  (Home renders a photo via `parseAvatar`/`expo-image`; the runner a glyph) rather than being pulled
  into the primitives file.
- **`AnimatedRing`** — SVG-free circular progress that animates every value change (two clipped
  half-circle fills on one Animated value). Used by Home's weekly target and workout-complete's
  weekly ring. **`SvgProgressRing`** is the real-SVG sibling (gradient stroke-dashoffset, on
  `react-native-svg`) used specifically by Progress's Consistency Score, where a gradient stroke
  reads closer to the Apple-Fitness/WHOOP reference than a flat fill — additive, not a replacement,
  so Home/workout-complete are untouched. **`SvgLineChart`** — small line+area chart (fixed viewBox +
  `preserveAspectRatio="none"` so it fills its container without measuring), first used for
  Progress's weight trend. **`SvgGrowBar`** — the volume chart's gradient-filled, animated bar
  (same viewBox trick, normalized 0–100 width so it fills whatever a flex column gives it); also
  now backs **Exercise Progress's** per-session est-1RM bars, so that recap screen's chart matches
  the Progress tab instead of using a one-off flat-color bar.
- **`celebration`** — `ConfettiBurst` (one-shot, tasteful, auto-unmounts) + `CountUp` (stats tick
  up to their value; lands on the final number even if interrupted).
- **`ProgressCards`** — the Fitness Intelligence dashboard cards (`TempoScoreHero`, `ReadinessCard`,
  `MomentumCard`, `PredictorCard`, `ConsistencyHeatmap`, `InsightsCard`,
  `JourneyTimeline`, `SectionLabel`). Pure presentational — fed pre-computed `lib/fitnessInsights`
  outputs by the Progress screen; reuse `SvgProgressRing`/`CountUp`/`FadeInView`/`PressableScale` and
  the new `glass`/`Elevation`/`metricHero` tokens so they match the rest of the app.
- **`HeroGlow`** — a reusable soft accent blob (a large low-opacity `*Glow`-colored circle) placed
  behind a single hero ring/metric per screen for premium depth without a native blur module. Static,
  Reduce-Motion-safe. Used by the Progress Readiness ring; reusable on Today/Profile heroes.
- **`EmptyState`** — illustrated empty states (geometric View-built art: calendar/barbell/chart/
  moon/flash + floating brand sparks) with title/body/CTA. Used app-wide — the three tabs **plus**
  Workout History, Weekly Report, Plan Explainer, Exercise Progress, and My Splits — so every
  full-screen empty moment is illustrated + on-brand rather than a line of grey text. (Tight
  *section* empties inside a populated screen, e.g. My Workouts' per-section lists, stay as text —
  a full illustration per section would overwhelm.)
- **`TempoTabBar`** — the floating dock (see 3.1). Its GO button reads `stores/sessionActive.ts` and
  hides while a live session is mounted (2026-07-16/17).
- **`FocusMode`** (new, 2026-07-16/17) — the full-screen active-set view described in §3.2's Plan
  section (large `SvgProgressRing`, rest −/+ adjust, form preview, Skip/Done). Purely presentational —
  every prop is read from state the runner (`(tabs)/plan.tsx`) already owns; ADDITIVE, not a
  replacement for the runner's existing exercise-card list.

### 3.3a Motion & celebration pass
Cross-tab feel = the dock (icon pop + primary tick spring on select) + each screen's
`ScreenTransition` focus entrance — scene-level `shift` animation stays removed for reliability.
Root-stack pushes default to a native `slide_from_right` (modals keep their slide-up; sign-in →
tabs fades). Day/Week/Month calendar crossfade (keyed `FadeInView`),
staggered feed/hub entrances, `PressableScale` on primary actions. **Session runner:** progress bar
eases forward per logged set (`AnimatedFill`), set checks `PopIn`, per-exercise "Done" chip, rest
pill pops in with a draining time bar, Complete button flips success-green when every set is banked.
**workout-complete:** confetti burst (bigger with PRs), badge pop, `CountUp` streak/consistency/
duration, weekly-target `AnimatedRing`. **Progress:** ring sweep + count-ups, chart bars grow in
staggered. (The old "Achievement unlocked" confetti toast was removed when achievements merged into
badges — the "new badge" signal is now the unviewed-count on the Profile badges button.)
**Onboarding plan-preview:** staggered reveal + a narrated `TempoPulse` build sequence, **then (B3.3)
the real week ahead** — after generation succeeds, a 7-day strip fetched from the just-created
`scheduled_workouts` (not a mockup) animates in one day at a time (`FadeInView`, staggered ~90ms/day),
each day showing its real workout + time or "Rest day"; a "Continue" tap then does the exact
navigation (`profile-setup` / back into the app) that used to happen immediately. Skips straight to
that navigation, unchanged, if the fetch fails or the week is genuinely empty — never shows a
misleading all-rest-days screen. Tutorial arming for new users happens *before* this fetch, so a
force-close during the reveal still leaves the account correctly armed.
**Branded loading, everywhere:** full-screen and section loads render Tempo's `PulseLoader`/`TempoPulse`
metronome mark (with a contextual caption — "Loading your splits…", "Building your session…") instead
of a generic OS `ActivityIndicator` or a plain muted `<Text>` (fixed in `muscle-map.tsx` — MASTER_FIX_PLAN.md
C3; `PulseLoader` is the standard for a full-screen/section "is this still loading" state, list-item
skeletons are `LoadingCard`/`Shimmer` — don't introduce a third convention) — Home/feed loads use
`LoadingCard` shimmer skeletons, and the feed shows the skeleton (not a rest-day/empty state) whenever
the visible range has no items but a
fetch is in flight — e.g. right after Change Plan clears the old schedule. The stock
spinner is now reserved only for tight in-button saving states. All motion honors OS Reduce Motion.

### 3.2a0 Program / Split layer (the user's overall schedule)
- A **split** (`splits` table) is the user's weekly training schedule — Push Pull Legs,
  Upper/Lower, a custom split. It's a 7-day weekday→workout pattern; each non-rest day carries
  a self-contained workout (`exercise_ids` + per-exercise `config`, snapshotted from a saved
  template or assembled inline) so it survives template edits/deletes. **One split is active
  at a time** (partial-unique index).
- **Every user has a split, even on an auto plan.** Generating a plan mirrors it into a
  `kind='auto'` split (`ensureAutoSplit`) so it shows up in My Splits with a **PROGRAM** badge and
  can be toggled like any custom split. A user who then builds their own has two entries and flips
  between them; **exactly one schedule drives the calendar**. Activating a **custom** split retires
  the plan and materializes the split; activating the **program** mirror (`activateAutoPlan`)
  *regenerates* the periodized plan from the current profile (schedule + equipment + injuries),
  preserving the mesocycle rather than laying down a static copy.
- `lib/splits.ts` — CRUD + active-split management (`setActiveSplit`, `dayToDraftItems`, day
  builders, `ensureAutoSplit`). `lib/splitSchedule.ts` — **`activateSplit`** (retires the generated
  plan's + other splits' today-forward scheduled sessions through `retireWorkouts.
  sweepScheduledPlanRows`, the same FK-safe sweep the plan generator uses — synced calendar events
  and reminders are cleaned up, log-referenced rows are marked instead of deleted; then marks
  active, materializes, and in auto mode calls `autoScheduleUpcoming`. Returns
  `'activated' | 'activated_pending' | 'failed'`: once the split is active, a materialize failure
  (offline mid-chain) is **'activated_pending'** — the callers say "sessions appear next time
  you open the app online" instead of a false "try again", and `refreshActiveSplit` lays them
  down on the next app open), **`activateAutoPlan`** (regenerate the program mirror), and
  **`materializeSplit`/`refreshActiveSplit`** — the split analogue of `generatePlan`'s insert loop:
  lays the weekly pattern onto the calendar as ordinary `scheduled_workouts` rows (`source='split'`,
  `split_id` set) over a rolling 28-day horizon, idempotent so app-open can extend the window.
  **Bug fix (2026-07-16/17):** the existing-dates "already taken" check used to have no status
  filter, so a soft-deleted (`status:'skipped'`) day read as permanently occupied and was never
  refilled — now excludes `status = 'skipped'` (reads as open again; `'rescheduled'` still correctly
  stays excluded, since that's a genuine supersession, not a single-day removal). `lib/reschedule.ts`'s
  `rescheduleWholeWeek` now calls this same fill logic for any missing split day before re-slotting
  the week, so "reschedule my week" can restore a deleted day instead of only re-slotting what already
  exists. Everything downstream (feed, runner, auto-scheduling, calendar sync, missed sweep) works
  unchanged — split workouts are commitments, so the missed sweep includes them.
- Entry points: **Profile → My Plan → My Splits** and **My Workouts → My Splits** → `my-splits`
  (list/activate) → `split-editor` (author). Generating a plan (Change Plan) deactivates any
  active custom split so the two never compete.
- **Split creation made the recommended path, not a buried one (2026-07-22):** investigation found
  split-editor itself was already low-friction (a "Start from a template" shortcut visible
  immediately on open, `applySplitPreset` auto-fills all 7 days + saves each workout to the
  library in one action) — the real problem was discovery: the persistent Home "+" FAB and every
  empty-state CTA pushed one-off `AddWorkoutSheet` adds with zero mention that a Split exists, and
  there was no graduation path off an auto-generated Plan short of a buried Profile → My Splits row.
  Fixed three surfaces: (1) Profile's "Change Plan" sheet now offers **"Build my own split"** as an
  equal-weight second option alongside regenerating the Plan, routing straight to `/split-editor`
  rather than back through onboarding — safe because `activateSplit()` (`splitSchedule.ts`) already
  retires the current active plan's future sessions before materializing the new split, verified
  before adding this (the "no double-booked calendar" concern noted in `onboarding/goal.tsx`'s
  build-mode-card comment is about a *different* code path — the re-plan onboarding flow re-running
  goal/experience/equipment — this bypasses that entirely). (2) `AddWorkoutSheet`'s one-off-add flow
  gained one quiet, de-emphasized hint line ("Doing this every week? Build a Split once — it
  repeats automatically") rather than a nagging banner, since this sheet's whole job is a single
  day and shouldn't compete with that. (3) Onboarding's existing build-mode card (`goal.tsx`,
  new-user-only, `buildMode: 'guided' | 'custom'`) had its "I'll build my own" copy rewritten to
  name the ready-made templates (Push/Pull/Legs, Upper/Lower) up front, so it reads as a real
  guided option instead of "you're on your own from here."
- **Split editor reliability + UX (July 2026 overhaul):** the "Use a saved workout" picker is
  rendered **inside** the day-editor `Modal` (as a sibling Modal it silently never presented on
  iOS and could strand an invisible touch-eating backdrop — the "editor freezes" bug); saved
  workouts are **prefetched on mount + refreshed on focus** so a just-saved workout is instantly
  assignable; whole-week hydration is **one batched exercises query** (`daysToDraftItems`)
  instead of 7 sequential round-trips; day cards show exercise count + estimated duration +
  rest/assigned badges with LayoutAnimation. **Create-workout round-trip:** an empty day offers
  "Saved workout" / "New workout"; the latter hops to `workout-builder?forSplit=1`, which hands
  the saved template id back through **`lib/handoff.ts`** (single-slot, consumed-on-read mailbox);
  the split editor's focus effect assigns it to the pending day and reopens the day editor — the
  user never hunts for the workout they just built.

### 3.2a User-created workouts & custom exercises
- **Custom exercises** live in the shared `exercises` table (`user_id` + `is_custom`), so they work
  everywhere built-ins do — building, scheduling, logging, PRs, progress. RLS: built-ins
  (`user_id IS NULL`) public; custom rows owner-only. `lib/customExercises.ts` (CRUD + unified search
  + `metricsFor`). **`metricsFor`** picks the logged columns: cardio → duration+distance, mobility →
  duration, **pure-bodyweight strength moves → reps only (no pounds — bodyweight has no external
  load), isometric holds (plank/wall-sit/hang/lever) → seconds**, everything else → weight+reps.
- **Workout builder** (`lib/workoutBuilder.ts`): assemble exercises with per-exercise
  sets/reps/weight/duration/distance → save a reusable **`workout_templates`** row and/or schedule it
  as a `scheduled_workouts` row (`source='custom'`, prescription in `exercise_config`). Custom
  scheduled workouts render in the calendar feed; the runner honors their config and shows
  metric-aware set columns (incl. duration/distance, logged into `set_logs.duration_sec/distance_m`).
- Entry points: Home "Build a workout" row + Profile → "My Workouts".

### 3.4 Hooks / services / constants / store
- **Hooks:** `useProgressStats` (aggregates stats/PRs), **`useRefreshOnFocus`** (invalidate a
  screen's query roots on every tab re-focus — skips the first focus; reads keys through a ref so
  fresh literals don't re-arm the effect), color-scheme/theme hooks.
- **Services:** `calendarService` (device calendar), `calendarSync` (write workouts to a calendar),
  `googleCalendar/` (OAuth + Calendar API + config).
- **Constants:** `theme.ts` — **one design language, two modes** (the old Classic/Craft fork is
  gone). `inkDark` (default: cool near-black ink surfaces, the **electric-blue** brand primary
  `#4E8BFF`, ember secondary accent for attention/heat, **`gold`/`goldSoft`** for records) and
  `paperLight` (warm near-white + deep electric blue `#0058BC`), exported as `Palettes` + the
  `Palette` type. Identity lives in the components/motion, not a paint swap.
  Every palette carries `fontDisplay`/`fontDisplayBold`/`fontNumeric` tokens (**Inter
  ExtraBold/Bold** display + **JetBrains Mono** numerals). Display and body are deliberately the
  *same* family: hierarchy comes from weight + size + negative tracking, not a second typeface —
  one fewer font to load at cold start and no mismatch between a headline and the copy under it.
  **JetBrains Mono is now reserved for the live
  runner instrument** (countdown timer + set/weight/reps columns, where tabular alignment matters);
  every stat card, tile, ring and duration (profile, progress, home, quick-workout, reports,
  celebration) uses the Inter display face, so numbers read as one consistent, premium voice
  rather than a "code-y" mono. A shared **`Motion`** export (fast/base/slow durations + spring)
  keeps the whole app on one clock. `BottomTabInset` reflects the floating dock (96).
  **Redesign foundation (additive — no existing token changed):** every palette also carries
  `glass`/`glassBorder`/`glassHighlight`/`scrim` (premium depth), `chartGrid`/`chartAxis`/`chartLabel`
  (Progress charts), and `warning`/`readyHigh`/`readyMed`/`readyLow` (forecast/readiness good·caution·
  risk). `Typography.metricHero` (64px) for the single biggest number; `Radius` gains semantic
  `chip`/`card`/`sheet`/`pill`; `Motion` gains `micro`/`celebrate`/`stagger`; a new `Elevation` ramp
  (e0–e3) sits alongside the kept `CardShadow`; and soft `primaryGlow`/`emberGlow`/`goldGlow` for the
  new `HeroGlow` component. **Confirmed visual direction = "Enriched-Calm"** — calm calendar-first
  base + disciplined functional accents (blue dominant, ember=energy/streaks, gold=records/milestones)
  + depth + one soft glow per screen; no wall-to-wall gradients, stock photos, or tactical copy. The
  design strategy + direction review live in `DESIGN.md` §4; execution plan in `~/.claude/plans/`.
- **Theme engine:** `src/theme/` — a Zustand store (`useThemeStore`, persisted to the SQLite-backed
  `localStorage`, **default dark**) drives live dark/light switching. Screens read colors via
  `useTheme()` and build styles with `useThemedStyles(makeStyles)` so a mode change re-renders the
  whole app; `ThemeTransitionOverlay` (mounted in the root layout) crossfades the switch. The
  toggle lives in **Profile → Settings → Appearance**; the root layout's nav theme + status bar
  follow the active mode. (`useDesignMode`/`DesignPalettes` were removed with the design fork;
  the brand signature — lowercase `tempo` wordmark with pulsing dot, primary tick + hairline rule —
  now ships unconditionally via `components/brand`.)
- **Store:** `stores/auth.ts` (session, profile, sign-out; on auth change it identifies the user to
  analytics/crash, registers the push token, sweeps missed workouts, and refreshes adaptation).
  **Profile fetches distinguish "no row" from "couldn't ask"**: a failed fetch (offline blip,
  token refresh race) keeps the current in-memory profile instead of nulling it — nulling used to
  bounce an onboarded user back into onboarding mid-session — and the last-known-good profile is
  cached per user in localStorage (`tempo.profile.<uid>`), so an **offline cold start** still
  renders the tabs (the layout gate needs `onboarding_complete`) with the persisted query cache.
  `TOKEN_REFRESHED` events (fired on every app foreground by the AppState-driven autoRefresh)
  **skip the profile re-fetch** when a profile is already held; the `user_signup` vs `login`
  analytics split keys on a *confirmed* missing row (`res.ok && !profile`), never on a failed
  fetch — a returning user on a fresh install with a network blip is a login, not a signup.
- **`stores/sessionActive.ts`** (new, 2026-07-16/17) — a one-boolean store (`active`/`setActive`), the
  only shared signal between the Plan tab's runner and its sibling `TempoTabBar` (siblings can't share
  React state directly). Set true while a live session is mounted, false on unmount/pause/finish;
  `TempoTabBar`'s GO button hides while it's true, so Quick Workout never competes with an in-progress
  session.
- **`stores/entitlements.ts`** (Tempo Pro, §10) — two facts: `proEnabled` (the dormant remote flag)
  and `isPro` (the RevenueCat entitlement). A feature is `locked` only when `proEnabled && !isPro`,
  so while dormant nothing is gated. `useProAccess()` exposes the state; `useProGate()` wraps a
  paid feature *action* — `requirePro(context)` returns true (proceed) when unlocked, else routes to
  the custom paywall (`/paywall?context=…`) and returns false. Loaded/synced in `_layout.tsx` on
  each session change; a live RevenueCat listener fires `trial_started` / `trial_converted` /
  `subscription_cancelled` on entitlement transitions. The declarative layer is
  **`components/ProGate`** — `<ProGate feature>` renders children when unlocked (or dormant) and a
  branded `ProLockCard` (icon + benefit + "Unlock with Pro" → paywall) when locked, plus `ProBadge`.
  **B2.1 re-fenced the gate** (audit finding: analytics doesn't convert, scheduling does — "monetized
  on its weakest feature"). Progress's Advanced Analytics (volume-trends card, PR-browser, per-lift
  `exercise-progress`) is now **free**, unconditionally — no `ProGate`/`requirePro` left on it.
  **First real gate:** Home's **"Reschedule my whole week"** button (B1.3b) — `handleWeekReschedule`
  calls `requirePro('schedule_optimization')` before opening the confirm sheet. Deliberately scoped
  to just that one-tap action, NOT the free, always-on background auto-scheduler (`autoSchedule.ts`)
  that already silently time-optimizes every user's plan around their calendar — gating the ambient
  engine would break existing free users' current experience overnight, which is a live regression,
  not a re-fence (see `proFeatures.ts`'s `schedule_optimization` comment, which spells out this
  distinction so a future call site doesn't accidentally gate the ambient engine by reusing the same
  feature id). Muscle Intelligence (`muscle-map.tsx`, plan.tsx's readiness tab, the post-workout
  teaser) is unchanged — still gated, out of this batch's scope. **Muscle Map — per-individual-muscle
  upgrade (2026-07-18):** the full `/muscle-map` screen's **status** mode now shades and lets you tap
  each INDIVIDUAL muscle (biceps vs triceps, quads vs hamstrings, glutes, calves…) instead of the six
  coarse groups. New `fitnessInsights.fineMuscleIntelligence(sets, now)` maps the exercise's stored
  fine `primary_muscles` onto the body figure's regions via `MUSCLE_TO_BODY` (alias-resolving:
  lats→upper-back, quads→quadriceps, glutes→gluteal; `full_body`/`legs` ignored as too coarse) and
  computes each muscle's own recovery %/status — powered by a new `muscleFineTimeline`
  (`primary_muscles` + `completed_at`) added to `useProgressStats` (additive; coarse `muscleTimeline`
  untouched). `MuscleMap` gained `statusBySlug`/`selectedSlug`/`onSelectSlug`; when `statusBySlug` is
  present in status mode it colours per slug, else it falls back to the coarse group path — so the
  **Progress-tab inline preview (which passes only `statusByGroup`) is unchanged**, and heatmap/rank
  modes stay coarse. The old floating recovery-% **bubbles (which overlapped on the torso) are removed**
  and replaced by a clean **"Recovery by muscle" readout** (each muscle's % next to its name, tap →
  per-muscle detail card). Coarse `muscleIntelligence` (balance/insights cards, Progress inline) is
  fully untouched. **Travel Mode is a new gate
  (2026-07-16/17):** a new `travel_mode` id in `proFeatures.ts`; Profile's "Right Now" → Travel Mode
  row is wrapped in `<ProGate feature="travel_mode" compact>`, and `travel-mode.tsx` itself also
  checks `useProGate().locked` and renders a `ProLockCard` in place of the equipment/duration form
  when locked — belt-and-suspenders so a locked user can't reach the form via a deep link either,
  matching `muscle-map.tsx`'s own screen-level gating pattern. Dormant-safe like every other gate:
  byte-identical while `proEnabled` is false. **Free-tier creation caps (2026-07-18) —
  `lib/proLimits.ts`:** the capped side of the Free/Pro line (founder decision — keep current price,
  cap created content instead). `FREE_LIMITS` = **1 custom plan, 5 custom exercises, 5 saved custom
  workouts**; the core training loop (unlimited logging, the adaptive plan, the full library, quick
  workouts, history) is **never** capped. `useCreateLimit().canCreate(key, count)` returns true when
  creation may proceed (Pro dormant, user is Pro, or under the limit) and otherwise routes to the
  paywall (`context = the limit key`). Enforced at the three creation **choke points**, only when
  creating NEW (editing is never gated): `CustomExerciseSheet.handleSave` (via
  `countCustomExercises`), `workout-builder.handleSaveTemplate` when `!templateId` (via
  `countTemplates`), and `split-editor.handleSave` when `!splitId` (via `countCustomSplits`, which
  excludes the auto "By Tempo" mirror). Dormant-safe: `canCreate` always returns true while
  `proEnabled` is false, so free users are uncapped until Pro is live. `PAYWALL_POINTS` leads with
  "Unlimited Everything" and the paywall's Free-vs-Pro table shows the real caps (1 / 5-each → ∞).
  **Permanent exercise exclusion (2026-07-21) — `lib/exerciseExclusions.ts` +
  `add_excluded_exercises.sql`:** `user_profiles.excluded_exercise_ids uuid[]`, the "never program
  this for me again" list a live session can add to (the runner's per-exercise menu → "Remove
  permanently", distinct from "Skip for today" which only affects the current session). Checked by
  every exercise-selection path that produces `scheduled_workouts.exercise_ids`:
  `generatePlan.ts`'s `buildBlockContext` candidate-pool filter, `quickWorkout.ts`'s candidate-pool
  filter, and `splitSchedule.ts`'s `materializeSplit` (filters a split day's already-chosen
  `exercise_ids`/`config` before insert — the split's own saved JSON is never found and rewritten).
  One shared `fetchExcludedExerciseIds`/`excludeExercisePermanently` pair enforces it uniformly
  regardless of which system generated the session.
  **Form-guide instructions lazy backfill (2026-07-21) — `save_exercise_instructions` RPC
  (`add_exercise_instructions_backfill_rpc.sql`):** 1285 of 1297 imported exercises ship with no
  local `instructions` (by design — keeps the seed small; see `lib/exerciseDb.ts`'s header). The
  form guide already fell back to a live ExerciseDB fetch, but the result only ever lived in an
  in-memory `Map`, re-hitting RapidAPI's rate-limited monthly quota every session. A narrowly-scoped
  `SECURITY DEFINER` RPC (only touches `instructions`, only on a built-in row, only when still empty)
  lets a successful fetch persist straight into the row, so it compounds automatically from real
  usage alongside (not instead of) the founder's manual monthly batch script.
  **Plate Calculator (2026-07-21) — `lib/plateCalc.ts` + `components/PlateCalcSheet.tsx`:** a new
  `plate_calculator` gate. Pure greedy-largest-first math (`calculatePlates(target, barWeight, unit)`)
  over standard lb/kg plate sets — no persistence. Reached from the runner's per-exercise "…" menu
  ("Plate Calculator"), pre-filled with that exercise's `suggestedWeight` (progression.ts) converted
  to the display unit; `useProGate().requirePro('plate_calculator')` gates the menu action itself
  (dormant-safe, same pattern as every other gate). In `PAYWALL_POINTS` since it's fully functional
  today (no external dependency, unlike multi-calendar).
  **The custom paywall**
  (`app/paywall.tsx`) reads the live offering (dynamic prices, auto-computed annual savings %,
  free-trial CTA when configured), Restore, and Terms/Privacy (→ `/legal`); dormant-safe and
  StoreKit-compliant.
  **Swipeable feature deck (2026-07-22, §26):** the vertical benefit stack is now a horizontal
  **paged carousel** — one `PAYWALL_POINTS` entry per slide, each with its own drawn visual
  (`SlideVisual` dispatches on the point's `icon`: `WeekStrip` for calendar-fit, `ConflictMoveVisual`,
  `ReplanVisual`, `TravelVisual`, `MuscleVisual`, `UnlimitedVisual` — all plain Views + Ionicons, no
  image assets or SVG), tappable page dots, and a 4.5s auto-advance that **stops permanently on first
  touch**. Slides are generated FROM `PAYWALL_POINTS`, so the "only advertise what ships today"
  invariant (an App Store rejection risk) is structural rather than a convention. The personalized
  `schedulingImpact` number survives as **slide 0's headline** rather than a separate hero, so it's
  still the first thing read. Page width is measured via `onLayout` (not window-width-minus-padding)
  so paging can't drift if padding changes; `pageW`/`pageRef` back the timer. New typed event
  `paywall_slide_viewed { slide, index }` records which value prop people actually swipe to.
  Plans render as **side-by-side cards** (`PlanCard`, `flex: 1` — a third package like lifetime needs
  no layout change) with the badge floating above the annual card; the radio a11y contract, dynamic
  pricing, intro-offer strike price, and savings % are unchanged from the row layout it replaced.
  **Intro-price eligibility gate (2026-08-05):** a founder report — paywall showed the $24.99 founding
  intro price, StoreKit's purchase sheet charged the $34.99 list price. Root cause: `product.introPrice`
  (iOS) describes the OFFER's terms, not whether the current user still qualifies (already had a trial or
  subscription = ineligible), and the paywall was displaying it unconditionally. Fixed via
  `lib/purchases.checkIntroEligibility()` (wraps RevenueCat's `checkTrialOrIntroductoryPriceEligibility`,
  iOS only — Android's Play Billing already filters ineligible offers before they reach the SDK, so it
  always resolves 'eligible' there) called once alongside the offering fetch and held behind the same
  `loading` gate so the price can't flash $24.99→$35. `annualIntro`/`selectedIntro` are now derived via
  `introOfferIfEligible()`, which nulls out the intro entirely (falls back to list price/no-trial-timeline)
  for an ineligible product — every downstream consumer (`ctaLabel`, `savingsPct`, `PlanCard`, the trial/
  what-you-pay timeline) already branched on those two values, so no other render logic changed. An
  UNKNOWN eligibility status (RevenueCat's own guidance) fails to 'ineligible', same as an error — showing
  the honest list price is the only outcome that's never misleading.
  **Earlier redesign (§25):** value-prop hero (glow) → `PAYWALL_POINTS` feature cards → a
  **Free-vs-Pro comparison table** (kept honest to the real gating in `proFeatures.ts`) → a **"how
  your N-day free trial works" timeline** (2026-07-18 — Today unlock / Day N-2 reminder / Day N billing
  begins; `trialDaysOf()` normalizes the store's WEEK/DAY intro period, and the whole block only
  renders when the selected plan actually carries a $0 intro offer) → the live
  plan cards + trial note → a "less than a coffee a week" value line → **trust indicators** (Secure ·
  Private · No ads · Cancel anytime). No fake testimonials (deliberately — real ones can be dropped
  in later). All purchase/restore/offering logic unchanged. Everything ships DORMANT — flip
  `app_config.pro_enabled` (or allow-list a uid) to go live with no rebuild. The Pro upgrade/manage
  rows live in a **Subscription** section on the new `app/settings.tsx` screen (moved off Profile in
  the 2026-07-16/17 Settings split below; shown only while Pro is live).
  **Tester Tools (Pro on/off switch):** the store also holds `tester` (may this account use the
  switch) + `devProOverride` (`null` real · `true` force-Pro · `false` force-free, persisted via the
  `localStorage` idiom, survives the RevenueCat listener). `useProAccess()` honors the override
  **only while `tester` is true**, forcing `proEnabled` on so a tester previews BOTH the free/paywall
  and unlocked experiences without a purchase — and so any lingering override goes inert the moment
  tester access is revoked (no ex-tester stuck paywalled-after-paying, or comped forever). `tester`
  is remote-gated by `proConfig` — `app_config.pro_enabled.tester_tools: true` (beta), or membership
  in `test_user_ids`/`pro_user_ids` — and is **not** tied to the global `enabled` flag, so turning
  Pro live for the public at launch never exposes the switch. UI: a **Tester Tools** section on
  Profile (only when `tester`) with the Pro switch + a "use real subscription state" reset. Ships
  OTA — no rebuild — but appears only once the founder flips `tester_tools` on.

### 3.5 Domain logic (`src/lib/`, ~36 modules)
- **Exercise familiarity (`lib/exerciseFamiliarity.ts`, added 2026-09-04):** both selection
  engines ranked candidates purely on properties of the EXERCISE — muscles worked, popularity,
  equipment — and never looked at what the person had actually done, so someone six weeks in
  could be handed a movement they had never seen above one they had done twenty times. The
  module answers one question, "how many separate SESSIONS has this user performed this
  exercise in" (sessions, not sets — five sets in one workout is one exposure), read from
  `set_logs` joined through `workout_logs` over the last 180 days, and leaves ranking policy to
  the engines. Wired into **`quickWorkout.pickBest`** and **`generatePlan.sortPool` +
  `selectForSlots`**; loaded once per generation via `PlanConstraints` (the same "every path
  gets it, no caller can forget" pattern availability uses). Three properties, tested
  separately because they pull against each other: *familiar* (known movements rank first),
  *varied* (each engine's existing per-day/per-week rotation is preserved), and *new*
  (`noveltySlotIndex` spends the LAST slot of a session on something unseen, but only above
  `MIN_KNOWN_FOR_NOVELTY` distinct known exercises and `MIN_PICKS_FOR_NOVELTY` slots — a
  beginner meets new work anyway). **The subtle part:** rotation had to be confined to a single
  familiarity tier in both engines. Rotating across the whole sorted pool steps straight past a
  known lift onto an unknown one, so the variety knob silently undoes the familiarity one — the
  first implementation did exactly that and `quickWorkoutFamiliarity.test.ts` caught it. With
  no history every candidate ties, `preferred` is the whole pool, and both engines behave
  byte-for-byte as before; `loadFamiliarity` degrades to `NO_HISTORY` on any error so a
  personalisation read can never break plan generation. Covered by
  `exerciseFamiliarity.test.ts`, `quickWorkoutFamiliarity.test.ts` and `planFamiliarity.test.ts`
  (`selectForSlots` and its template types are exported for that last one).

- **Removing a workout (`lib/workoutRemoval.ts`, added 2026-09-04):** every removal path used
  to do one thing — `status = 'skipped'`. Home's "Skip it" and `EditWorkoutSheet`'s "Remove"
  were the same write under two different words. That is wrong for one-offs: a Quick Workout is
  a session the user invented, it recurs never, so "skipped" records a failure that did not
  happen and leaves a permanent ghost in history (production had 10 such rows, and
  `useProgressStats` already filtered `source === 'quick' && skipped` back out — a workaround
  for this gap). `removalModeFor(source)` now decides: `quick`/`custom` are **deleted** for
  real, `plan`/`split`/unknown are **skipped** and keep the record (skip is the conservative
  default because a delete cannot be undone). `removalCopy()` is shared so Home and the edit
  sheet cannot drift apart in wording. `applyRemoval()` cleans the calendar event and the
  pre-workout reminder either way, and — because `workout_logs.scheduled_workout_id` is
  ON DELETE NO ACTION — **falls back to a skip when a delete hits a 23503 foreign-key
  violation**, so a session someone already logged sets against keeps both its row and its
  logged work instead of erroring at the user. Any other error code is rethrown rather than
  silently downgraded. **Deliberately not offered:** "delete forever" on a plan session — plan
  rows are generated per date, so deleting one occurrence would not stop next week's, and a
  button claiming otherwise would be lying. Covered by `lib/__tests__/workoutRemoval.test.ts`.

- **Session timer pauses with the session (`workout_logs.active_seconds`, 2026-09-07):** the
  timer is wall-clock based on purpose, so locking the phone between sets does not stop the
  clock. That is right while training and wrong the moment you pause: resuming an open log
  recomputed elapsed as `now - started_at`, counting every paused minute as training. Pause a
  workout, return two hours later, and it read two hours — and because the completion path
  writes `actual_duration_min` from the same number, it inflated recorded training time, making
  it a data problem rather than a display one. The runner now banks active time whenever the
  timer stops (pause, tab switch, unmount) into a new nullable `active_seconds` column, and
  resumes from it. `durationEstimate.resumeElapsedSeconds()` is the pure rule: use
  `active_seconds` when present (including 0, which is a real value, not "missing"), else fall
  back to the old wall-clock derivation for logs predating the column rather than inventing a
  number. Covered by `lib/__tests__/resumeElapsed.test.ts`.

- **Quick Workout: "Pick for me" is backed by the plan (2026-09-07):** with no Target Area
  selected, a Quick Workout now serves a **trimmed version of the session already scheduled**
  (today's, else the next within 2 days) instead of generating something unrelated. The plan
  orders a session primary → secondary → accessory → isolation → core, so taking the prefix that
  fits the time budget keeps the work that matters and drops the tail. An explicit Target Area
  or a route-driven pattern is a specific request and is still answered literally. Falls back to
  the pattern-based generator when nothing is scheduled or none of the planned exercises are
  performable with the user's current equipment. Maps against a **gear-only pool** (equipment +
  experience + exclusions) rather than `matchesConstraints`, because the latter also applies the
  avoid-what-is-scheduled preference and filtering the scheduled session out by its own schedule
  would be self-defeating. `tuneScheme()` is shared by both builders so a 15-minute session is
  dense the same way whichever produced it.
- **The bug that prompted it — `getScheduleRestrictions` had no floor:** it avoids the movement
  patterns of every session scheduled from yesterday to +2 days ("don't pre-empt tomorrow's leg
  day"). Someone training 5-6 days a week on Push/Pull/Legs has all three inside that window, so
  it avoided `push`, `pull`, `squat` AND `hinge` — every resistance pattern — and the candidate
  pool collapsed to core. Real users got 60-minute "Full Body" sessions that were four ab
  exercises. Avoiding a scheduled muscle is a **preference**; producing a usable workout is the
  **requirement**, so when the preference would leave no resistance pattern at all it is now
  dropped entirely. Covered by `lib/__tests__/quickWorkoutPlanBacked.test.ts` (2 of its 6 fail
  with the fix reverted).

- **Quick Workout target areas (`lib/quickWorkout.ts`, corrected 2026-09-04):** a Target Area
  ("Legs", "Arms", "Upper Body"…) filters the candidate pool by muscle. Two defects made that
  filter return the wrong body part entirely, both found from the founder's real
  `scheduled_workouts` rows. (1) **Group membership** — `hip_flexors` was listed under
  `LEG_MUSCLES`, and every exercise in this catalogue with it as a primary muscle is an ab
  exercise (Hollow Body Hold and Hanging Leg Raise are both `['abs','hip_flexors']`), so a
  "40-Minute Legs" request returned ab holds; `lower_back`/`erectors` sat inside `BACK_MUSCLES`,
  which `upper_body` was composed from, so Conventional Deadlift and Hyperextension counted as
  UPPER body. `BACK_MUSCLES` is now `UPPER_BACK_MUSCLES` + `LOWER_BACK_MUSCLES`, and `upper_body`
  uses only the upper half. (2) **Loose matching** — the filter accepted an exercise if ANY of
  its primary muscles matched, so Barbell Bench Press (`['chest','triceps']`) satisfied an ARMS
  request. Matching now requires the **dominant** muscle, `primary_muscles[0]`, which this
  catalogue orders most-worked-first. It has to be a filter rather than a sort preference
  because `pickBest` ranks by how many muscles an exercise works, so a compound would always
  outrank a true isolation for the target. The loose rule survives only as a last resort, when
  nothing in the catalogue dominantly trains the requested area, so a target never yields an
  empty pool. Covered by `lib/__tests__/quickWorkoutTargetAreaFidelity.test.ts`, which is built
  from the real production muscle arrays and fails 5/7 without the fix. The same `hip_flexors`
  mis-grouping was corrected in `trainingLoad.ts` (ab work was adding leg fatigue to the
  recovery map) and `fitnessInsights.ts` (ab work counted as quadriceps volume);
  `exerciseSearch.ts` already matched on the dominant muscle and needed no change.

- **OTA update delivery (`lib/otaUpdates.ts`, added 2026-09-03):** the app never called
  `expo-updates` at all, leaving delivery to the library's passive default — check on cold
  start, download in the background, apply on the NEXT cold start. On iOS an app stays warm
  for days, so that second cold start often never comes. Measured 2026-09-04: three days of
  published fixes (the tutorial cut, the scheduling fixes, the push/pull fix) had reached
  **nobody** — every `tutorial_step_completed` in the prior 48 hours carried a step id from the
  old 14-card tour, on a build whose channel, branch and runtime all verified correct.
  `startUpdateWatcher()` (called once from `_layout.tsx`) checks and downloads at cold start,
  then applies on the next foreground that follows at least 30s in the background. Two hard
  safety rules: it never reloads while `useSessionActiveStore.active` is true (a live workout
  holds unsaved sets in memory), and never more than once per app process (so a bad update
  cannot cause a reload loop). Every path is best-effort and swallowed — an update check must
  never break startup. `updateProperties()` also feeds `js_update_id` / `js_update_created_at`
  / `js_is_embedded` into `analytics.superProperties()`, because the pre-existing `app_version`
  reports the NATIVE version and is identical whether or not a user took an OTA — which is
  exactly why this failure was invisible for three days.

- **Planning & progression:** `generatePlan` (4-week periodized plan from goal/experience/equipment;
  **respects hard constraints** — never-train weekdays from unavailable blocks + `training_days`,
  and **injuries** via the same restriction mapping Quick Workouts use; supports **2–6 days/week
  including weekend-only** via constraint-aware day-slot selection). It programs **only from the
  curated `is_core` pool** (the ~160 staple movements) so a 1,300-exercise search library can't
  degrade generated plans. **Engine v2 — coach-quality selection (`lib/exerciseProgramming.ts`):**
  the old engine built sessions from the 8 coarse `movement_pattern` buckets, which miscategorise
  for programming (biceps curls are `pull`, cleans are `hinge`, and calf raises / leg curls / leg
  extensions collapse into `squat`/`hinge`) — so leg days read as random lists with bad order +
  duplicate deadlifts. A pure, shared **classifier** now derives a fine **slot**
  (squat/hinge/lunge/knee_flexion/quad_iso/calf/h_push/v_push/chest_iso/triceps/h_pull/v_pull/
  rear_delt/lat_raise/biceps/core/cardio/carry), a **role** (power/compound/isolation/core/cardio),
  and a lift **family** from `primary_muscles` + name keywords + pattern (no DB migration — those
  columns already exist). The same module also exports **`formatMuscleName()`** (added
  2026-08-24) — the display transform for snake_case muscle keys, used by Plan's exercise rows,
  the active-session header, and the form sheet's "Muscles worked" chips. It is deliberately
  lossless (`upper_chest` → `upper chest`) and does NOT reuse `sessionRationale.ts`'s
  `MUSCLE_LABEL`, which maps `lats` → the prose word "back"; routing the chips through that map
  would silently change what muscle they name. Regression-tested in
  `lib/__tests__/formatMuscleName.test.ts` — the raw enum shipped visibly as
  "UPPER_CHEST · TRICEPS" in App Store screenshot 2. **Slot sides (`slotSide` / `sideAllows`, added 2026-09-03):** every slot also carries a
  **side** — `push` / `pull` / `lower` / `neutral` — derived from the existing
  `PUSH_*`/`PULL_*`/`LOWER_*` slot groupings. `selectForSlots` computes the session's own
  emphasis from its template (`templateSide`, in `generatePlan.ts`) and refuses any affinity
  fallback that crosses it. Fixes a production bug: barbell-only users have an empty
  `lat_raise` pool (every lateral raise needs cables or dumbbells), so a Push day walked the
  `lat_raise → rear_delt` affinity edge, found `rear_delt` empty too, dropped to the full
  library and programmed "Barbell Rear Delt Row" onto a Push day. A template's OWN slots are
  never side-filtered, so a Press Day that deliberately asks for `h_pull` keeps it and a mixed
  day (Upper, Full Body) may still use both sides. Covered by
  `lib/__tests__/sessionSlotSides.test.ts`. Session templates are **ordered `SlotSpec` lists** (power → primary →
  secondary → accessory → isolation → finisher) per goal × split; `selectForSlots` fills them
  enforcing **role fit** (a compound slot rejects isolation work), **anti-redundancy by family**
  (never two deadlift variants), **per-focus rotation** (the FIRST Legs day opens with the canonical
  back squat, later ones vary), **affinity fallback** for thin equipment, and the time budget. Pools
  group **by slot** (mobility excluded). `extendActivePlan` + `restampFuturePlanForExperience` share
  the path. Validated against the real 163-row core pool (full-gym Legs = Squat → Good Morning →
  Bulgarian → Leg Curl → Leg Extension → Calf; dumbbells-only adapts to Goblet Squat + DB variants).
  Prescriptions are **role-aware** (`buildPrescription` takes the classified role: primary compounds
  heavier/lower-rep + full rest, isolations higher-rep + short rest — within the goal, so
  autoregulation + periodization stay live), and the runner hub shows a **"Why this workout?"**
  sheet (`lib/sessionRationale.ts`) explaining the order in plain language. **Adaptation legible in
  the runner (audit §12 Personalization):** the deload/peak-week banner now renders
  `workout.progression.note` — the real, phase-specific coaching line from `periodization.ts`'s
  per-mode tables — instead of one flat hardcoded string for every deload. A *scheduled* deload
  ("Planned recovery — lighter with less volume so you supercompensate") now reads differently from
  a *reactive* one `refreshAdaptation` triggered by missed sessions / "too hard" feedback ("You've
  been grinding — this week is a deliberate step back to recover"), which is exactly the audit's own
  complaint that "personalization you can't perceive doesn't retain." **Volume landmarks (B5.4,
  `lib/volumeLandmarks.ts`, new):** MEV/MRV weekly-set ranges per coarse muscle group (`exercises.
  muscle_group` — chest/back/shoulders/arms/legs/core), MRV scaled by experience (beginners lower,
  advanced higher; MEV holds steady). `buildPrescription` takes an 8th **optional** `weeklyVolume`
  arg — omit it and behavior is byte-for-byte unchanged (tested) — that CAPS (never floors) this
  exercise's sets so the muscle group's real completed volume this week can't exceed its weekly MRV,
  appending an honest note to the prescription's `reason` only when it actually changes something.
  `(tabs)/plan.tsx` feeds it from `muscleTimeline` (already fetched for the readiness card — **zero
  new queries**) filtered to the current week, plus the signed-in profile's `experience`. Deliberately
  a CAP only, not full two-way titration (auto-adding sets under MEV would silently inflate session
  length in ways the duration model doesn't expect) — the scientifically urgent half (protect against
  overtraining) without the cross-workout live-aggregation complexity the floor direction would need.
  **Duration is goal-accurate**: `progression.estimateSessionMinutes` computes real
  wall-clock time = warm-up + Σ sets×(work + rest) using the goal's actual inter-set rest (strength
  a full 3 min, athletic ~2.5, hypertrophy ~90 s), and `exerciseCountForDuration` inverts it to pick
  how many lifts fit the user's preferred length for that goal — so a 45-min strength day is a few
  heavy lifts with full rest, a 45-min fat-loss day is a longer circuit. Replacing a plan also
  **cleans up the retired sessions' synced calendar events + reminders**, and **mirrors the program
  into My Splits** (`ensureAutoSplit`). **Replacing is FK-safe and self-healing**
  (`lib/retireWorkouts.ts`): `workout_logs.scheduled_workout_id` has no cascade, so one
  ever-started session used to make the old block's bulk DELETE fail silently (one atomic
  statement) while the plan was still marked abandoned — stranding 'scheduled' rows that the
  partial unique index `scheduled_workouts_one_plan_per_day` then used to reject **every** future
  plan insert ("Something went wrong" on every Change Plan, permanently). `clearActivePlans` now
  sweeps **all today-forward** still-scheduled plan-linked/split rows (not just the active
  plan's — this heals already-poisoned accounts; past rows are left for the missed-workout sweep
  so a not-yet-judged session still becomes 'missed'), releases their calendar events + reminders,
  hard-deletes the never-started rows, marks log-referenced ones `'rescheduled'` (already hidden
  app-wide), and **throws on any write failure** so the UI reports a real error before a
  duplicate schedule can be inserted — all via the shared `retireWorkouts.sweepScheduledPlanRows`. Its **`extendActivePlan` rollover** runs on app open: when
  <7 days of plan remain it materializes the next 4-week block — `week_index` keeps counting, the
  mesocycle wave cycles via `weekProgression`, and the new block reflects the *current* profile +
  `adaptation_mode` — **so the plan never just ends at week 4**. The runway/week-count *decision*
  (the exact logic the "4-week cliff" bug lived in) is factored into the pure, unit-tested
  **`planRollover`** module (`PLAN_RUNWAY_DAYS` / `planNeedsExtension` / `planExtensionWeeks` +
  the shared `formatLocalDate` that `generatePlan.formatDate` delegates to); `extendActivePlan`
  now orchestrates the DB reads/writes around it. See the test suite in §8.
  **`week_offset` (added `add_week_offset.sql`, applied 2026-07-19 — MASTER_FIX_PLAN.md F1):**
  `week_index` was overloaded to mean both a mesocycle-phase index (`periodization.weekProgression`)
  AND a pure date-offset from the plan's `start_date` (`extendActivePlan`'s rollover math) —
  `adaptation.applyAdaptationMode` re-anchoring `week_index` on a recovery/deload transition (correct
  for the phase meaning) silently corrupted the date-offset meaning, so a later rollover could compute
  an entirely-past block and insert zero rows — an empty schedule for a paying user. `week_offset` is
  the pure date-offset meaning, written once at insert (`buildBlockRows`) and never rewritten by
  adaptation; `extendActivePlan` now reads/orders by it instead of `week_index`. Also hardened:
  `extendActivePlan`'s insert is now per-row (not one bulk `.insert(rows)`), so a single stale row
  blocking one date can't void the rest of the ~4-week block, with failures reported via
  `captureApiError` instead of a silent `catch{return 0}`.
  `periodization` (mesocycle: overload weeks + scheduled deload; modes normal/recovery/deload/
  maintenance), `progression` (autoregulated per-exercise load via RPE + rep targets + the
  session-duration model), `adaptation` (workout-feel feedback + the engine that flips
  `adaptation_mode` from real signals and re-stamps future weeks).
- **Experience auto-progression (`experienceProgression`):** the plan *grows with the user*. The
  onboarding experience level (beginner/intermediate/advanced) shapes exercise difficulty and how
  aggressive periodization is — but it's a starting point, not a permanent label. `adaptation` is
  the reactive DOWN direction (overreached → recovery/deload); this is the earned UP direction.
  `maybePromoteExperience` runs after each completed session and graduates the user one tier when
  they've earned it — driven by **completed-session count** (movement competency), pulled forward by
  repeated **"too easy"** feedback, and **gated** so a user the reactive layer is backing off
  (recovery/deload, or recent "too hard") is never promoted. Beginner → intermediate comes quickly
  (~10 sessions, or 6 with a sustained "too easy" signal); intermediate → advanced is earned
  (~36 sessions). On promotion it persists the new level, audits it in `adaptation_events`, and calls
  **`generatePlan.restampFuturePlanForExperience`** — which re-selects level-appropriate exercises and
  re-computes the periodization directive for *every upcoming plan session in place* (not just the
  next rollover block), so the level-up changes tomorrow's workout, not next month's. It surfaces as
  a branded **"LEVEL UP" celebration** on `workout-complete` (gold card + a second confetti fall);
  onboarding's experience step tells users up front that Tempo advances them automatically, so
  picking "Beginner" carries no penalty.
- **Scheduling:** `quickWorkout` (time-boxed session engine — sizes a purposeful session to a
  free-time window from the curated pool, matched to equipment/experience/injuries; **schedule-aware
  as of 2026-07-18**: `getScheduleRestrictions` avoids patterns scheduled in the next ~2 days or just
  trained, so a Quick Workout picks the next *ready* thing instead of pre-empting tomorrow's leg day),
  `quickSuggestion` (feeds Home's contextual Quick Workout row — the calendar-gap branch only fires
  when a real event bounds the window via `FreeWindow.endIsEvent`, so an empty calendar no longer
  claims "N free minutes before your next event"), `smartSchedule` /
  `autoSchedule` (place workouts around calendar free time; `autoSchedulingEnabled` gates this by
  `scheduling_mode`), **`moveWorkout`** (`resyncMovedWorkout` — the single re-sync path every
  reschedule flows through: re-points the synced calendar event *and* the local reminder at a
  moved workout's new time; used by both auto-movers and Home's one-tap reschedule, so the
  calendar never disagrees with the app), `reschedule` (slot suggestion for moves +
  `suggestTimeOnDate` — a calendar-aware time on a specific day, powering the builder's smart
  pre-fill; also **`rescheduleWholeWeek`** — the one-call "reschedule my whole week" wedge action:
  re-lays every upcoming session across the best DAYS+times at once, resyncing each moved event,
  running even in `manual` mode since it's an explicit request), **`weekReschedule`** (the pure,
  unit-tested planner behind it — `planWeekReschedule` composes `scoreDay`+`findVariedSlot` to
  assign one recovery-spaced workout per day, never dropping a session. **Preserves split order
  (bug fix, 2026-07-16):** workouts are processed in original chronological order and a `minDay`
  floor prevents a LATER workout from ever landing BEFORE an EARLIER one — without this, two
  workouts with different muscle regions could leapfrog each other purely because one scored
  marginally better for an earlier day (reported: Pull grabbed today's slot while Push, actually due
  today, got pushed to Saturday) — recovery scoring still picks the best day among what's left, it
  just can't reorder which specific workout gets which day anymore), `dedupeSchedule`,
  `unavailability`, `ignoredEvents`. **UI (B1.3b):** a header icon button on Home
  (`(tabs)/index.tsx`, next to the readiness ring) opens a 2-tap `OptionSheet` confirm, then calls
  `rescheduleWholeWeek` behind a single-flight guard; success/empty/error all resolve to a plain
  `Alert` (moved-of-total count, "nothing to reschedule", or `describeSaveError`'s offline/auth/
  server copy on failure) and invalidates the `scheduled_workouts`/`missed_workouts` queries so the
  calendar reflects the new slots immediately. Fires `week_reschedule_used` (moved, total) — the
  payable-moment event B2.2 will hang the paywall trigger on.
- **Program / Split layer:** `splits` (split CRUD + active-split management + day hydration +
  **`ensureAutoSplit`** — mirrors the auto-generated program into My Splits as a `kind='auto'`
  split so every user, even on an auto plan, has an activatable split; its `days` are a read-only
  preview built from the plan's upcoming sessions), `splitSchedule` (`activateSplit` /
  `materializeSplit` / `refreshActiveSplit` — lay a custom weekly split onto the calendar as
  `source='split'` workouts; **`activateAutoPlan`** — activating the program mirror *regenerates*
  the periodized plan from the current profile rather than materializing a static copy, so the
  mesocycle/deload logic is preserved. Exactly one schedule drives the calendar: activating a custom
  split retires the plan, activating the program retires custom splits). **The auto mirror is a
  read-only projection of the plan and is NEVER materialized** — `materializeSplit`/`refreshActiveSplit`
  hard-skip `kind='auto'`, and `ensureAutoSplit` self-heals by deleting any future `source='split'`
  rows an older build wrongly laid under the mirror, so a plan day can never render twice (once as
  `plan`, once as `split`). Exactly one schedule drives the calendar.
  **`propagateSplitDayEdit` — N2, "this day, going forward" (2026-08-02, founder-requested).**
  Before this, the runner's "permanent" add/swap/remove only ever rewrote the split TEMPLATE
  (`splits.days`) — but `materializeSplit` only ever *inserts* a row for a date that doesn't have one
  yet; it never re-syncs an already-materialized row after the template changes. So a "permanent" edit
  made today had ZERO effect on any of the next ~4 weeks' worth of already-scheduled instances of that
  same weekday (the whole rolling `HORIZON_DAYS` window) — only on whatever gets freshly materialized
  *past* it, which read to a user as "I added it permanently and none of my upcoming Fridays show it."
  `propagateSplitDayEdit(client, userId, splitId, weekday, op)` is the real fix: it updates the
  template (far future) AND every already-scheduled, not-yet-done instance of `weekday` from today
  onward (near future), so "going forward" means every upcoming day, not just ones months out.
  Operation-based (`{type:'add'|'remove'|'swap', ...}`, applied to each row's OWN current
  `exercise_ids`) rather than "copy this session's full list everywhere" — two days sharing a weekday
  can already carry independent customizations (Friday's Pull day swapped differently from Monday's),
  and a blind copy would silently clobber one day's edits the moment another day's edit went "going
  forward." Wired into `(tabs)/plan.tsx`'s three session-composition actions — `addExerciseToSession`,
  `replaceExercise` (swap), `doSkipExercise` (skip/remove) — each now asks "this session only" vs.
  "every `{focus}` on your split" **only when the workout is split-sourced** (`source==='split' &&
  split_id`); a plan day (periodization already varies it week to week — no fixed template to add
  "forever" to) or a Quick Workout (a one-off with nothing to recur into) skip the question entirely
  and persist to just this session, immediately. **A real, separate bug found and fixed in the same
  pass:** "add for this session only" used to NOT persist `exercise_ids` to the scheduled row at all
  (only in-memory React state) — a pause/resume or app restart re-runs `loadWorkout`, which rebuilds
  `exercises` straight from that same column, silently losing the addition. Every add now always
  persists to the session's own row regardless of scope choice; only the split-propagation step is
  conditional. **`edit-session.tsx`** (the bulk sets/reps/name editor) gained an explicit scope banner
  + a direct link to `split-editor` when editing a split-sourced day — it always edited one dated
  instance only and never said so, which was the founder's other named complaint ("nothing telling the
  user which they're in"); a full per-field scope choice wasn't added there (that screen saves as one
  bulk update, not per-exercise like the runner), the banner+link is the proportionate fix. 3 new
  tests (`splitSchedule.test.ts`) lock weekday isolation, past/completed-row exclusion, and the
  non-clobbering guarantee for a sibling day's own customization.
- **Starter templates:** `starterTemplates` — app-provided workout presets (Push/Pull/Legs/Upper/
  Lower/Full Body/Bodyweight) and split presets (PPL, PPL-3day, Upper/Lower, Full Body) that
  correspond: `applySplitPreset` fills a split's week **and** saves each of its workouts into the
  user's `workout_templates` library. Surfaced as "Start from a template" in the workout-builder
  (`?presetId`) and split-editor, and as Templates in `AddWorkoutSheet`.
- **Rotation shift (`lib/rotationShift.ts`, 2026-09-14):** the founder's six-day-split problem —
  "if I miss push I want to do it next", and "sometimes I will just cancel push and schedule legs
  because I'm on a different track". Both are one operation: name the rotation position that
  happens next, and everything after follows in cycle order. `planRotationShift(slots, cycleLength,
  anchorIndex)` re-stamps which cycle position each UPCOMING session holds; `shiftChangesAnything`
  lets a caller skip the sheet/writes for a no-op (missing the last slot of a cycle already
  continues correctly). Pure and I/O-free — the caller maps a cycle position back to real exercises
  (split day config / plan template) and writes the rows.
  **Deliberately rotates CONTENT, not dates.** The first design was a date cascade (push the miss to
  tomorrow, absorb the overflow into a rest day); it was rejected because moving dates drags in
  availability + free-slot search, calendar event teardown/rebuild, reminder re-pointing, the
  one-session-per-day partial unique index, and `materializeSplit`'s day coverage — six load-bearing
  systems, to express something the user described purely as content. Rotating content leaves every
  date, time, calendar event and reminder untouched, and the rest day stays put because a rest day
  is the ABSENCE of a row and so is never an input. Tradeoff, stated honestly: the missed session is
  not "made up" — you still train the days you train, you just stop SKIPPING a muscle group.
  13 tests (`rotationShift.test.ts`) lock the PPLPPLR miss-1 and miss-2 cases, rest-day invariance,
  week wrap, re-anchoring to an arbitrary position, idempotency, and the no-cycle/negative-anchor
  guards. **Not yet wired to any screen** — the engine and the `split_origin_date` prerequisite
  landed first.
- **`scheduled_workouts.split_origin_date` (migration `add_split_origin_date.sql`, 2026-09-14):**
  the day a split row was materialized FOR, written once at insert and never rewritten by any mover.
  Fixes a live duplication bug: `materializeSplit` keyed its idempotency on `planned_date` ("does a
  row sit on this date"), so ANY mover that changes `planned_date` — missed-workout reschedule,
  reschedule/delay my week, the hourly server-side `retime-sessions`, a manual edit — left the origin
  day looking empty and the next app open re-inserted the session that had just been moved. Move
  Monday's Push to Tuesday, reopen, and Monday has a Push again. Coverage is now keyed on origin, the
  read window is padded ±14 days (a moved row can sit outside its origin's window), and rows
  predating the migration fall back to `planned_date` (exactly what the backfill set). Verified by
  reverting the key and confirming the regression test fails.
- **Recovery & context:** `recovery` (readiness check-ins), `trainingLoad` (rest-day advice),
  `missedWorkouts`, `substitutions` (saved exercise swaps, ranked by curated match → muscle overlap
  → popularity), `travelMode` (the equipment-override record + summaries), **`travelSchedule`**
  (`syncTravelSchedule` — while travel mode is on, rewrites every upcoming plan/split session to
  exercises the current gear supports, stashing the original in `scheduled_workouts.travel_restore`
  and restoring it exactly when travel ends; runs on app open and after save/clear).
- **Body & progress:** `bodyMeasurements` (history + weight/body-fat/waist trend math),
  `progressPhotos` (image pick + private upload; **`progressPhotoUrls` batch-resolves signed URLs
  for N photos in one Storage call**, backing the new **`app/progress-photos.tsx`** gallery —
  2026-07-17, founder: "have a way to view the weight progress with pictures in order, so those
  pictures don't just disappear." Every `body_measurements` row with a `photo_url` is fetched via the
  existing `fetchMeasurements`, batch-signed, and shown as a tap-to-enlarge grid, newest first;
  reachable from Profile → Body Stats' new "Photos" link. Previously there was capture-only, no way
  to browse past photos — they were saved but effectively invisible after the fact), `wrapped`
  (share cards: weekly/streak/PR/goal/monthVolume/topLifts/weightTrend), `achievements`, `avatar`.
- **Insights & motivation:** `weeklyReport` (the Sunday recap engine — workouts/volume/strength/
  weight/consistency), `prs` (per-session weight/e1rm/rep PR detection), `goalProjection`
  (goal-countdown ETA from weight trend + strength max — `GoalProjection` carries a `hasEta` flag,
  2026-07-17, false only for the "log your weight to see your ETA" no-signal fallback, so callers can
  tell a real countdown from a data-logging prompt), **`streak`** (`sessionStreak` — the one
  streak definition, shared by stats/wrapped/achievements: **completed sessions across consecutive
  training days**. It's **day-aware and source-aware**: rest days never break it; a day you completed
  ANY session counts even if another session that day was missed/skipped (e.g. the plan slot you
  replaced); and **opportunistic `source:'quick'` workouts you added but didn't finish are ignored
  entirely** — a skipped/missed quick workout never breaks the streak (it was never a commitment).
  Only a missed/skipped *committed* session with no completion that day breaks it. `StreakRow` carries
  an optional `source`; `useProgressStats` selects it and applies the same rule to `consistency_pct`.
  The server `streak_at_risk` push follows the same philosophy.
- **Scheduling impact (`schedulingImpact.ts`, new — quantifies the wedge):**
  `summarizeSchedulingImpact` (pure, unit-tested) + `fetchSchedulingImpact` count completed
  **Tempo-authored** sessions (source `plan`/`quick`/`smart`, deliberately **excluding** the user's
  own `custom`/`split` workouts, so the number only ever credits Tempo's contribution) — making the
  scheduling wedge visible and honest ("Tempo planned & scheduled N of your workouts around your
  week"), with no fabricated "workouts you'd have skipped" guesses. Surfaced as a **Weekly Report**
  card (this-week count, hidden at zero), a personalized **paywall** proof line (all-time count,
  hidden below 1), a **Progress** stat card (all-time + this-week, hidden at zero) right after
  Completion Rate, and — **`LAUNCH_SCORE_PLAN.md` T1.1, 2026-07-23, the version that actually
  changes a new user's first impression** — the **Home-tab hero itself**: a subtitle line under the
  hero headline ("Tempo has scheduled N workouts around your real life") in both the pending-today
  and day-complete states, above the fold, on the one screen every user opens the app to. Same
  `['scheduling_impact', userId]` React Query key as Progress, so the two tabs share one cache
  entry; added to `queryInvalidation.TRAINING_KEYS` so completing a workout moves the number live
  instead of waiting out a 5-minute staleTime — the whole point of putting it in the hero is that a
  user watches it change. `TEMPO_SCHEDULED_SOURCES` is the single source of truth for "by Tempo".
- **Fitness Intelligence (`fitnessInsights.ts`, new — powers the Progress-dashboard redesign):**
  pure derivations over the data Tempo already has (scheduled_workouts status, workout_logs
  `started_at`, set_logs) that turn Progress from a stats page into a coach that explains behaviour.
  **Composes** the existing engines rather than duplicating them — `computeMomentum` (habit-
  sustainability score off `tempoScore`+`streak`), `readinessFromHistory` (a check-in-free readiness
  from recovery gap + `trainingLoad.consecutiveTrainingDays`, complementing `recovery.ts`),
  `optimalWindow` / `successPatterns` (real time-of-day + weekday patterns from log timestamps),
  `consistencyPredictor` (weekly-goal projection),
  `consistencyHeatmap` (GitHub-style adherence grid), `frequencySeries`, `muscleBalance`,
  `strengthTrends` (per-lift start→now top movers), `journeyTimeline`, `intensityFromReadiness` +
  `muscleRecovery` (also feeds Plan's session-card readiness chip — see §3.2), and
  **`muscleIntelligence`** (Body Map: per-group status/recovery/volume-trend + an overall balance
  score, over the coarse `muscle_group` only — no fabricated per-fine-muscle stats). Every output
  ships a human message and honest empty states; no invented numbers. 19 unit tests
  (`__tests__/fitnessInsights.test.ts`). **B5.1:** Progress's
  `ReadinessCard` carries an honest disclosure ("Recovery is estimated from your recent sessions...")
  — "Estimated from your recent training and rest time — not a wearable measurement." The WHOOP-style ring UI otherwise implies a physiological signal
  (sleep/HRV/resting HR) this heuristic doesn't have; the caption makes the actual input honest
  without needing HealthKit (B5.2) to say something true today.
- **Body Intelligence / Muscle Map** (`app/muscle-map.tsx` + `components/MuscleMap.tsx`): a signature,
  **Pro-gated** feature reached from a card in Progress → Coaching. An **anatomically-real** muscular
  figure rendered from `react-native-body-highlighter` (MIT, SVG-only, on top of the already-installed
  `react-native-svg` — JS-only, no rebuild) with tappable, status-coloured muscle zones (green optimal ·
  amber attention · red recovering · purple growing), a **muscle-balance
  score** with per-group bars, per-muscle detail (frequency, weekly sets, recovery %, last trained,
  volume trend + Train/See-progress actions), and auto insights. New Pro id `muscle_intelligence` in
  `proFeatures.ts` (+ a paywall point). **Gating is dormant-safe**: `useProGate().locked` is only true
  once Pro is LIVE and the user isn't subscribed — then free users get a premium *preview*
  + locked detail + a feature-specific "Unlock Muscle Intelligence" upsell; while Pro is dormant
  everyone sees it in full. **The locked preview substitutes rather than obscures (2026-07-22):**
  `MuscleMap` takes a `locked` prop which swaps every shading input for the exported
  `SAMPLE_STATUS_BY_GROUP` / `SAMPLE_STATUS_BY_SLUG` / `SAMPLE_HEAT_BY_GROUP` /
  `SAMPLE_RANK_BY_GROUP` constants *before* a single colour is computed, drops selection and the
  tap handler, and covers the figure with a `BlurView` (iOS) over a `C.scrimHeavy` fill (the
  Android path, where BlurView is unreliable — this must never fail open). The previous treatment
  was `dimmed` (opacity 0.5), which still showed every status colour — i.e. it gave away the exact
  insight Pro is sold on. Because the real data never reaches the figure, nothing leaks even if the
  blur fails to render or the user screenshots it. The `rank` mode's "Most trained: … / Least: …"
  footnote is `locked`-gated for the same reason. Three map modes: **Status** (status colours + recovery-% callout bubbles),
  **Heatmap** (7/30/90-day training-stimulus glow), and **Rank** (per-muscle training tier
  Beginner→World Class from `fitnessInsights.muscleRank` — most→least trained, for the "how developed"
  Progress view). (The old **Train → Readiness** segment also embedded this body map — removed along
  with the rest of the segmented control in the 2026-07-16 Plan redesign; Progress's Body
  Intelligence card is now the only surface for it, still **Pro-gated** the same way — free = the
  sample body under a blur + a lock overlay and a "Sample shown" caption, score/ring stays free.) A
  **post-workout teaser** on `workout-complete` surfaces it at a high-intent moment (only when locked).
  `MuscleMap`'s public API (`view` / `statusByGroup` / `heatByGroup` / `rankByGroup` / `mode` /
  `selected` / `onSelect` / `dimmed` / `locked` / `bubbles` / `size` + the `muscleStatusColor` /
  `muscleTierColor` / `SAMPLE_*` exports) is otherwise unchanged — internally each Tempo group maps to the library's fine muscle slugs per view
  (`GROUP_TO_SLUGS_FRONT/BACK`), colours are computed by the same status/heat/rank engine and passed as
  per-part `color`, and bubble anchors are re-derived from the anatomy path data (centroid per group,
  normalized to the 724×1448 viewBox) so recovery-% / rank callouts still land on the right muscle.
- **User workouts:** `customExercises` (custom-exercise CRUD + `metricsFor` + `EXERCISE_COLUMNS`),
  `workoutBuilder` (drafts, templates, scheduling, duplicate, duration estimate).
- **Origin labelling:** `workoutOrigin(source)` maps a scheduled workout's `source` to a
  "who made this" chip — **Tempo** (sparkles, for `plan`/`quick`/`smart`) vs **Yours** (person, for
  `custom`/`split`) — shown on Home feed cards, the Train hub, and workout history, so a Tempo "Push"
  day is visibly distinct from the user's own "Push" day. My Splits mirrors this: the program split
  reads **BY TEMPO**, custom splits read **YOURS**.
- **Exercise library & search:** **`exerciseSearch`** is the one client-side library search, shared
  by the picker and the Exercise Library screen: `useExerciseLibrary` caches the whole library
  (React Query, 10-min stale); `searchLibrary` does instant, ranked, alias-aware token matching
  ("rdl" → romanian deadlift, "ohp", "pushup") with **AND semantics** (a query for "push" never
  returns pulls) and popularity tie-breaks; `groupFamilies` collapses near-identical variants
  (barbell/dumbbell/cable/machine versions of the same movement) into one representative row that
  expands on demand — so a search for "bench" isn't 40 rows. **`exerciseDb`** derives each imported
  row's ExerciseDB clip id + on-demand how-to steps straight from its UUID (see §5).
- **Exercise matching:** `equipmentMatch` (`expandEquipment` — "Full gym" implies
  barbell/dumbbells/**kettlebell**/bands/**pull-up bar**; ALL equipment matching goes through
  **`canPerform`**: generatePlan, quick workouts, swaps, substitutions, travel adaptation).
  Equipment now distinguishes **`pull_up_bar`** (a bar/dip station/rings) from truly-**`bodyweight`**
  (floor only): `needsApparatus(name)` flags the ~80 library moves tagged `bodyweight` that actually
  need something to hang from/dip on (pull-ups, chin-ups, dips, muscle-ups, hanging raises, inverted
  rows, suspension work), so a "No equipment" user isn't handed dips they can't do — they're gated
  behind selecting the pull-up-bar option (onboarding **equipment** step, Profile equipment editor,
  **travel mode**; the exercise-library browse filter splits the same way — "No equipment" = floor
  only, "Pull-up bar" = the apparatus moves). A thin no-equipment Pull day then degrades via
  `PATTERN_AFFINITY` (below). Plan generation treats experience as a per-pattern
  PREFERENCE (one tier above the user's level kept as backup, never displacing in-level picks),
  and session padding is **focus-aware** (`PATTERN_AFFINITY`: a thin Pull day borrows hinge/core
  work and then stops — a short honest session, never a "Pull day" of planks). Machine/cable
  exercises are seeded `beginner` (migration `fix_machine_exercise_levels.sql`, applied).
- **Infra:** `supabase` / `supabase.native` (clients — the native client ties
  `auth.startAutoRefresh()`/`stopAutoRefresh()` to `AppState`, because RN timers freeze in the
  background: without it the JWT could expire unnoticed and the first save after a long resume
  failed with an opaque "Something went wrong" that succeeded on retry),
  **`retireWorkouts`** (`sweepScheduledPlanRows` — the ONE sweep both plan generation and split
  activation run, so the victim predicate can't drift between them: selects today-forward
  still-'scheduled' plan/split rows (past rows are left for the missed-workout sweep to judge —
  retiring them would erase the 'missed' signal adaptation feeds on), releases calendar
  events/reminders in parallel (`releaseScheduledRows`), then FK-safe-retires
  (`retireScheduledWorkouts`); see Planning),
  **`saveErrors`** (`describeSaveError`/`isAuthError`/`isNetworkError` — maps a failed save to
  actionable copy: offline vs expired-session vs server. The auth branch fires a background
  `refreshSession()` so its "Tempo is refreshing it — tap Try Again" copy is true at every call
  site. Used by onboarding saves, the runner's start/set/complete writes, quick-workout start,
  Home's skip, split-editor template loads, and sign-in), `analytics` (PostHog, typed events),
  **`activation`** (retention instrumentation — fires the one-time `activation_reached` +
  `calendar_connected` events behind durable per-user flags; analytics-only, see §7),
  `crashReporting` (Sentry), `pushTokens` (register/enable device push — **never prompts for
  permission itself**; onboarding's primed ask and the Profile toggle own the OS prompt),
  `notifications` (local pre-workout reminder — now gated at its single choke point by the
  device-local `pre_workout` pref — + **rest-done notification** + `hasReminderPermission`
  probe for no-prompt background paths),
  **`notificationPrefs`** (per-rule opt-outs, §6.1: account-level server rules in
  `user_profiles.notification_prefs` via `loadNotificationPrefs`/`setServerRuleEnabled`, read by
  the retention-push function; the device-local pre-workout reminder via
  `get/setPreWorkoutEnabled`; `DEFAULT_PREFS` all-on to preserve prior behavior),
  **`appleHealth`** *(removed 2026-08-24 — App Review 2.5.1; see the section on it later in this
  file for what it was and what a future rebuild would need)*,
  **`returningUser`** (§5.1: `getReturningState` derives a 3/7/30-day absence tier from the last
  completed session + the next scheduled one — drives Home's returning-user hero),
  **`purchases`** (§10 — the ONLY module touching react-native-purchases / -ui; guarded like
  `haptics` so a pre-rebuild JS reload no-ops instead of crashing, and entitlement reads fail
  *closed*: `configurePurchases`/`identifyPurchases`/`resetPurchasesUser`, `fetchIsPro` +
  `addProUpdateListener`, `restorePurchases`, and — for the **custom** paywall (`app/paywall.tsx`) —
  `getProOffering` (the dashboard's current offering), `purchaseProPackage` (returns
  `{ok,isPro,cancelled}`, distinguishing a real failure from a user cancel), and
  `packageHasIntroOffer` (free-trial detection). The hosted-UI helpers
  `presentPaywall`/`presentPaywallIfNeeded` remain as fallbacks and `presentCustomerCenter`
  powers Profile's "manage subscription"; `PRO_ENTITLEMENT` + SDK keys from env, **no product IDs
  or prices hardcoded** — the paywall renders whatever the current offering contains),
  **`proFeatures`** (§10 — the typed gated-feature registry: `ProFeatureId` + `PRO_FEATURES` upsell
  copy (title/benefit/icon) so every lock card + the paywall speak one voice from one place, plus
  `PAYWALL_POINTS`, the honest delivered-value bullets the paywall lists — never advertises an
  unbuilt feature),
  **`proConfig`** (§10 — `fetchProEnabled` reads the `app_config` `pro_enabled` row on app open:
  the dormant-launch flag, defaults hard to OFF, with a per-account allow-list for private testing),
  **`units`** (lb/kg display preference — persisted per
  device like the theme; storage is ALWAYS lbs, every training surface converts at the UI edge:
  runner inputs/targets/PREV, progress, profile tiles + body stats + log entry, history,
  session detail, weekly report, PR lines, builder; toggle in Profile → Settings → Units.
  Deliberately still lbs: Wrapped share cards/captions, goal-projection copy, achievement
  milestones, and waist stays inches), `exerciseGif` (RapidAPI media), `account` (delete),
  **`accountLinking`** (guest → permanent account, §1.1: `linkGuestAccount('google'|'apple')`
  attaches the identity onto the existing anonymous user via **`linkIdentity()`** — NEVER
  `signInWithOAuth`/`signInWithIdToken`, which would swap the session and orphan all the guest's
  data — mirroring `CalendarAuthService`'s safe pattern incl. the post-exchange "did the user id
  change?" guard and `identity_already_exists` handling; `link_unavailable` when the project's
  "manual linking" setting is off. Also `countCompletedWorkouts` and the durable, per-user,
  force-close-proof `guestSavePromptSeen`/`markGuestSavePromptSeen` gate for the one-time
  post-workout prompt, `GUEST_SAVE_PROMPT_AFTER = 3`),
  `types` (domain types).
- **Session UX & social (July 2026 overhaul):**
  **`durationEstimate`** (realistic session-length model: per-exercise `SETUP_SEC` transition +
  sets×(work+rest); `adaptiveRemainingSec` blends observed logging pace with the static per-set
  cost — trust ramps to ~85% observed after ~7 sets; `fetchPaceFactor` = clamped median
  actual/planned over the last 12 completed sessions. Used by the runner's hub estimate +
  live "~N min left", `workoutBuilder.estimateDurationMin`, and `splitSchedule`'s materializer),
  **`haptics`** (the app's tactile vocabulary — `tapLight`/`tapMedium`/`success`/`warning` on
  expo-haptics with a guarded require + Vibration fallback, so a dev client built before the
  module exists never crashes), **`restPrefs`** (per-workout rest-length preference keyed by
  workout focus, SQLite-localStorage-persisted; `SUGGESTED_REST_SEC = 120`),
  **`unilateralPrefs`** (new, 2026-07-16/17 — the identical device-local pattern, keyed by
  lowercased/trimmed exercise name instead of workout focus, backing the runner + session-detail's
  "×2 per side" toggle),
  **`handoff`** (single-slot consumed-on-read mailbox for "create X, return, auto-use it" flows —
  currently split-editor ↔ workout-builder), and
  **`social`** (friends/privacy/shares data layer: search + friend CRUD over the RPCs,
  `fetchFriendOverview` incl. client-side streak from settled sessions, `fetchFriendTemplates`
  (RLS-gated), `copyTemplateToLibrary` + `importWorkoutShare` — attributed "Push (Jacob's)"
  copies that drop unreadable custom exercises gracefully, `createWorkoutShare`/`fetchWorkoutShare`
  with 8-char lookalike-free codes and `shareUrl`).

---

## 4. Backend (Supabase — live project `rtoahppnekykgmjukujm`)

### 4.1 Tables (~18; RLS scopes rows to the owner except where the social layer deliberately widens reads)
- **user_profiles** — goal, experience, equipment, days/week, availability (wake/bed/work/school,
  preferred time, flexibility, training days, unavailable blocks), `bodyweight_lbs` cache,
  `injuries`, `travel_mode`, `ignored_events`, calendar prefs, **`scheduling_mode`** (`auto`/`manual`),
  **`timezone`** (IANA string, e.g. `America/Los_Angeles` — `add_user_timezone.sql`, applied
  2026-07-19; set client-side via `Intl.DateTimeFormat().resolvedOptions().timeZone` at onboarding's
  first `user_profiles` write in `onboarding/train-time.tsx`, re-set defensively in
  `onboarding/plan-preview.tsx`'s later upsert; nullable — existing accounts fall back to the
  server's UTC hour in `retention-push` until they re-onboard or the column is backfilled).
- **programs** / **exercises** — program templates + the exercise library: **~1,360 built-in
  movements** (imported from the ExerciseDB catalog by `mobile/scripts/build-exercise-library.mjs`,
  seed `supabase/seed_exercise_library_v2.sql`) across push/pull/squat/hinge/core/cardio/carry/
  **mobility** patterns. Columns **`is_core`** (the ~160 staples the plan/quick engines program
  from), **`popularity`** (0–100 search-rank signal), and **`muscle_group`** (chest/back/shoulders/
  arms/core/legs/glutes/cardio/mobility filter bucket) were added by `add_exercise_library_v2.sql`.
  Imported rows carry EMPTY instructions (the app fetches how-to steps + the form GIF from
  ExerciseDB on demand, keyed off the row's UUID — see §5); the original hand-written seed + 12
  hand-authored staples keep inline instructions. `exercises` also holds **custom** user exercises
  (`user_id`, `is_custom`, `category`, `notes`, `tracking_metrics`); RLS keeps built-ins public and
  custom rows owner-only.
- **workout_templates** — reusable user-built workouts (`exercise_ids` + per-exercise `config`).
- **splits** — the Program/Split layer: a named weekly weekday→workout pattern (`days` jsonb,
  `is_active`; one active per user). **`kind`** is `custom` (user-built) or `auto` (the mirror of
  the generated program — one per user, surfaced in My Splits; see §3.5). Activating one materializes
  `scheduled_workouts` (custom) or regenerates the plan (auto).
- **user_plans** — the active plan: program, dates, `current_week`, `adaptation_mode`, status.
- **scheduled_workouts** — every planned/quick/smart/**custom**/**split** session: date/time, focus,
  `exercise_ids`, status, calendar link, `source`, **`week_index` + `progression`**,
  **`exercise_config`** (per-exercise prescription for user-built workouts), **`split_id`**
  (links split-sourced sessions back to their split), and **`travel_restore`** (jsonb stash of the
  pre-travel exercises so travel-mode swaps revert exactly — see §3.5).
- **workout_logs** / **set_logs** — actual sessions and per-set reps/weight/RPE/**duration/distance**;
  `set_logs.is_warmup` flags warm-up sets (excluded from PREV/progression/volume/PRs everywhere).
- **adaptation_events** — audit of feedback + auto-periodization decisions.
- **exercise_substitutions** — saved per-user swaps.
- **google_calendar_tokens** — Google Calendar linkage (refresh token, service-role-only RLS). The
  legacy **calendar_connections** table (plaintext token columns, superseded by this one) was dropped
  2026-07-19 (`drop_legacy_calendar_connections.sql`) after confirming zero code references and 0 live
  rows — dead weight plus a plaintext-secret liability, not just an unused column.
- **body_measurements** — time-series weight / body-fat % / waist / progress-photo path.
- **device_tokens** — Expo push tokens per device (`enabled` flag). RLS split per-command
  (`fix_device_tokens_reassign_policy.sql`, applied 2026-08-10): SELECT/INSERT/DELETE stay
  strictly own-rows, but UPDATE's `USING` is `true` (its `WITH CHECK` still requires
  `auth.uid() = user_id`) — a token can be *reclaimed* by a new user, but never made to point at
  someone else. Fixes a real Postgres 42501 found in Sentry: `registerPushToken`
  (`lib/pushTokens.ts`) upserts on `onConflict: 'token'`, and an Expo push token is scoped to a
  (device, app install), not an account — the old strict-both-sides policy blocked the upsert's
  implicit UPDATE outright whenever a second account signed into the same physical device without a
  clean sign-out clearing the first account's row first (plausible on a shared/test device). Was
  already caught by the function's own try/catch — no crash, just a silently-missing push
  registration for that device until this fix.
- **notification_log** — every retention push attempt (status/error/ticket) for debugging + analytics.
- **coach_messages** *(`add_tempo_coach.sql`, applied 2026-07-22)* — the Tempo Coach thread. One
  table backs three things deliberately: the rendered history, the prompt's conversation window
  (last N rows replayed to the model), and the **free-tier quota** (a count over `role='user'` rows
  since the start of the week — no separate counter, and because it lives in Postgres it survives a
  reinstall, unlike every device-local flag). `action` holds the model's proposed tool call verbatim
  (`{name, input}`); `action_state` (`proposed`/`applied`/`dismissed`/`failed`) is what makes the
  feature measurable — **apply-rate is the metric Coach must move**, and a Coach whose proposals are
  never applied is a chatbot. RLS: strictly own-rows; the `tempo-coach` function inserts with the
  caller's JWT, so the policy is the real enforcement rather than a formality.
- **waitlist** — marketing capture.
- **friendships** — the social graph: one row per pair (`requester_id`/`addressee_id`,
  `status` pending→accepted, unordered-pair unique index). RLS: parties only; requester inserts
  pending; addressee accepts; either deletes (decline/cancel/unfriend).
- **workout_shares** — snapshot sharing: an 8-char `code`, owner + `owner_name`, `name`,
  **`kind`** (`workout` | `split`), `exercises` jsonb ([{id,name}] so previews render even when the
  viewer can't read a custom exercise), `config`, **`days`** (jsonb split snapshot when kind='split'),
  **`equipment`** (distinct required gear for preview chips), `est_duration_min`. RLS is owner-only
  for direct table reads (`fix_workout_shares_rls.sql`, applied 2026-07-19 — the previous "any
  signed-in user can read" policy let anyone enumerate every user's shares directly via PostgREST,
  not just look one up by its code); a share-by-code lookup goes through the SECURITY DEFINER RPC
  `get_workout_share_by_code(p_code)` instead (called from `lib/social.ts`'s `fetchWorkoutShare`),
  which is the correct place to express "if you have the code, you're meant to see it." Owner still
  inserts/deletes directly.
- **user_profiles identity columns** — **`username`** (unique, `^[a-z0-9_]{3,20}$`) + **`friend_code`**
  (unique 6-char, no lookalikes), backfilled for existing rows and auto-set on insert by the
  `user_profiles_identity` trigger. The friend code is the out-of-band "add me" handle; the
  username disambiguates duplicate display names.
- **user_profiles privacy columns** — `privacy_workouts` / `privacy_stats` / `privacy_activity`
  (`public|friends|private`, default `friends`). Enforced by the `Friends can view templates`
  RLS policy on `workout_templates` and inside the `friend_overview` RPC.
- **Social RPCs (SECURITY DEFINER, authenticated-only):** `search_profiles(q)` (name / @username /
  exact friend-code, code matches first) + `get_public_profiles(ids)` (name/avatar/username
  discovery without opening `user_profiles` RLS), `are_friends(a,b)`, `friend_overview(target)`
  (privacy-gated totals — workouts / sets / **volume** (warm-ups excluded) / **favorite muscle** /
  goal / member-since — + settled sessions for client-side streak math + recent activity),
  **`friend_feed()`** (accepted friends' completed sessions, last 14 days, activity-privacy-gated;
  each row now also carries `workout_id` + a `reaction_count` / `i_reacted` summary),
  **`friends_leaderboard()`** (workouts-this-week for you + accepted friends, stats-privacy-gated),
  and — social upgrade Stage 1 — **`friends_leaderboard_v2()`** + **`current_session_streak(uid)`**
  (`add_social_leaderboards.sql`, **applied**). v2 returns every rank input per member in one call
  (this-week scheduled/completed/active-days, current streak, and 28-day Tempo Score components:
  due/completed/weeks-met-goal/goal-per-week); `current_session_streak` mirrors `lib/streak.ts` in SQL.
  The **Tempo Score itself is computed client-side** in `lib/tempoScore.ts` (0–1000, consistency-only,
  no strength inputs; frequency counts only *completed* sessions so it can't be gamed — 8 unit tests
  assert a consistent beginner out-scores a flaky advanced lifter) so the formula is OTA-tunable.
  `social.tsx` renders the trio as a 3-tab board (Weekly Consistency / Streak / Tempo Score) with
  client-side sort (`fetchLeaderboardV2` + `sortLeaderboard`). Full design doc retired (all 4 stages
  shipped, see `EXECUTION_STATUS.md` session log); the Tempo Score v1 weights it defined, live in
  `lib/tempoScore.ts`, are: **Completion 0.35 · Goal adherence 0.25 · Consistency 0.15 · Streak 0.15 ·
  Frequency 0.10**, each a rolling-28-day component — weighted toward *finishing what's scheduled*
  over raw volume so a beginner who completes everything out-scores a flaky advanced lifter.
  **Social upgrade Stage 2 — badges + richer feed** (`add_social_badges.sql`, **applied**;
  `lib/badges.ts`): the **single** achievement system (the old `lib/achievements.ts` grid was merged
  in and removed from Progress; `computeLevel` stays for the player level). 12 badges — consistency,
  milestone (First Workout / 30 · 100 Sessions / Ton · 100K Club, from all-time totals), competitive,
  social — Ionicons + bronze/silver/gold tiers, rendered in the Achievements tile language by
  **`BadgeShelf`**. Progress's "Next Milestone" card now points at the closest locked badge. Reached
  via a **badges button on the Profile header** (next to Friends, with an **unviewed** count that
  clears when you open the **`badges` modal screen** — the trophy case: all badges, earned lit /
  locked dimmed with progress). Friend profiles show their earned badges inline.
  Derived ones (Perfect Week, Consistency Champion, 30-Day Streak) light up from
  session history; competitive (Weekly Winner, Top 3 Monthly) live in **`user_badges`**, awarded by
  the idempotent **`claim_competitive_badges()`** RPC run on app open (`syncSocialOnOpen` in the auth
  store, which also publishes the user's streak-milestone rows). **`activity_events`** (streak/
  perfect-week/badge, RLS + dedupe) feeds **`friend_events()`**; the Friends screen merges it with
  completions chronologically. `friend_overview()` now also returns `stored_badges` + `days_per_week`
  and computes a friend's `earned_badges` in `fetchFriendOverview`. 15 unit tests (tempoScore+badges).
  **Social upgrade Stage 3 — private groups** (`add_social_groups.sql`, **applied**; `lib/groups.ts`):
  `groups` + `group_members` (RLS via SECURITY-DEFINER `is_group_member()` to avoid policy recursion);
  RPCs `create_group` / `join_group` (by invite code) / `leave_group` (owner-leave deletes the group) /
  `list_my_groups` / **`group_leaderboard(gid)`** (the `friends_leaderboard_v2` shape scoped to a
  group's members, members-only). UI: a **Groups** section on the Friends screen (list · create · join
  by code) + a **`group-detail`** modal (shareable code, member-scoped board, leave/delete). The
  three-tab board is now the shared **`LeaderboardBoard`** component used by both friends and groups
  (`mapLeaderboardV2Rows` maps either RPC's rows). End-to-end verified on the live DB.
  **Social upgrade Stage 4 — social scheduling** (`add_social_scheduling.sql`, **applied**;
  `lib/availability.ts` + `lib/scheduling.ts`): the differentiator — coordinate workouts around real
  schedules. `privacy_availability` knob (default friends); `friend_availability(target)` returns a
  mutual friend's coarse availability (sleep/work/school/training-days/blocks + busy workout slots,
  no titles), privacy-gated. The pure `availability` engine (`freeWindows` → `overlapWindows` →
  `suggestSharedSlots`, 9 tests) turns two people's schedules into shared free times. Friend profile →
  **"Schedule together"** (`ScheduleTogetherSheet`) suggests slots and sends a `workout_invite`;
  `respond_workout_invite('accept')` schedules the session for **both** users (`partner_id` links the
  pair) — surfaced in a **WORKOUT INVITES** section on the Friends screen (accept/decline). Completing
  a `partner_id` workout earns the **Workout Partner** badge (via `claim_competitive_badges`).
  End-to-end verified on the live DB (send → accept → both scheduled). **Accountability push nudges**
  extend the `retention-push` edge function (no schema change — `notification_log.type` is free text,
  prefs are generic jsonb): **partner_reminder** (a workout with a friend is tomorrow → "don't leave
  them hanging", evening) and **friend_competition** (Thursday evening, one workout from passing a
  friend). Both respect the per-rule opt-out (new toggles in `notificationPrefs.ts` + Profile) and the
  one-push-per-run cap; taps deep-link via `data.screen` (`social` route added). *Still deferred:
  automatic social reschedule when a slot breaks.*
  **Activity reactions** — a single "nice work" (🔥) on a friend's feed row: table
  `activity_reactions` (reactor_id, workout_id → scheduled_workouts, unique per pair; RLS owner-only)
  toggled through the SECURITY DEFINER `toggle_activity_reaction(target_workout)` RPC, which validates
  `are_friends` + completed-session visibility and returns the fresh count/state; the client
  (`lib/social.toggleActivityReaction`) updates the feed row optimistically and reconciles. The
  reaction control only renders when a row has a `workout_id`, so the feed still works if the
  migration isn't applied yet. Migrations: `add_social.sql` + **`add_social_v2.sql`** (identity, feed,
  leaderboard, split shares, warm-up column — both **applied**) + **`add_activity_reactions.sql`**
  (table + RLS + feed/toggle RPCs — **applied**).

### 4.2 Edge Functions (Deno)
- **delete-account** — App-Store-required full account + data wipe (service role, JWT-scoped to caller).
  DB rows cascade via `ON DELETE CASCADE`, but Storage doesn't (no FK) — **fixed 2026-08-02**: before
  deleting the auth user, it now lists+removes every object under `<user_id>/` in both the private
  `progress-photos` bucket and the public `avatars` bucket (`removeUserFolder()`), so a deleted
  user's avatar photo no longer stays reachable at its stable public URL forever. Best-effort —
  a storage failure is logged, never blocks the account deletion itself.
- **google-calendar-token** — securely stores/uses the user's Google refresh token server-side.
- **exercise-media (edge function, added 2026-09-06):** proxies the three ExerciseDB/RapidAPI
  endpoints the app still calls live, so the RapidAPI key lives server-side as a Supabase secret
  instead of being inlined into every shipped bundle. `EXPO_PUBLIC_*` values are compiled into
  the app and readable out of any IPA/APK; that is fine for the Supabase publishable key,
  RevenueCat SDK key, PostHog project key and Sentry DSN, which are all designed to be
  client-visible, and **not** fine for a RapidAPI key, which is billable per request. It was also
  committed to a public GitHub repo. The quota had already been exhausted once this way, which is
  why images moved to our own `exercise-gifs` Storage bucket (see `data/exerciseMedia.ts`). Three
  kinds: `search` (name → ExerciseDB id), `instructions` (id → step text), `image` (id → the
  clip, streamed through). All three are **fallbacks** behind the Storage bucket or curated
  media, and every caller already degrades to a placeholder, which is what made this safe to
  switch without device verification. Deployed with JWT verification ON so it is not an open
  proxy onto the quota; the client authenticates with the same publishable key it uses for
  everything else. `EXPO_PUBLIC_RAPIDAPI_KEY` is now removed from `eas.json` and from
  `lib/exerciseDb.ts` / `lib/exerciseGif.ts`. **Still outstanding: the old key must be rotated in
  the RapidAPI dashboard** — it is in git history and in every already-shipped binary, so
  removing it from HEAD reduces future exposure but does not un-leak it.

- **retime-sessions (edge function + `retime-sessions-hourly` cron, added 2026-09-05):**
  server-side enforcement of "never schedule a session at a time the user cannot make".
  `lib/retimeUnmakeable.ts` already does this on the client, on app open, and that is not
  sufficient for one reason that took an incident to make obvious: **it can only run inside a JS
  bundle the user has actually received.** On 2026-09-05, 162 future sessions (44% of all of
  them) sat at impossible times while both the engine fix and the client repair existed and had
  reached nobody. Those rows were repaired out of band — and hours later a user on an old bundle
  generated a fresh plan containing a session starting at 07:30, the exact minute their workday
  begins. A one-time data repair does not hold while any client can still write bad times.
  The function re-times only genuinely unmakeable sessions (whole session must fit one free
  window; never before wake + buffer; a day with no free window is left alone), guards each
  write on the previous time so a user's own change is never clobbered, refuses to write a time
  that is not itself makeable, and supports `?dry=1` to report without writing. It runs at :20
  past the hour, offset from `retention-push-hourly` (:00), so a session is corrected before any
  notification could announce it at the wrong time. **`availability.ts` is a verbatim copy** of
  `src/lib/availability.ts` (which has zero imports precisely so it can be shared, since Deno
  cannot import from `src/`); `lib/__tests__/availabilityVendorCopy.test.ts` fails the suite if
  the two differ by a byte, so the client and server can never disagree about what a free window
  is.

- **retention-push** — the server-driven retention engine: evaluates per-user rules (**weekly_report**
  on Sunday evenings; **missed_workout** as the daytime "session still open" nudge; **streak_at_risk**
  only when *today's scheduled session* is still open in the evening — **never on a planned rest
  day**, matching the session-based streak; free-time gap; reactivation), sends via the Expo
  Push API in batches, logs every send, and disables dead tokens. **Per-rule opt-out (§6.1):**
  reads each user's `user_profiles.notification_prefs` and skips any rule the user turned off
  (`reactivation` is always-on and not user-exposed; every other rule defaults on). A missing
  column/row falls back to all-on, so the filter is a safe no-op until the migration is applied.
  **Volume + honesty pass, 2026-09-03** (founder: notifications were "useless spam"): two hard
  limits now sit above every rule. (1) **Quiet hours** — nothing sends before 08:00 or from 21:00
  in the user's OWN local time. Rules previously gated only on their own window, and several had
  no upper bound (`hour >= EVENING_HOUR` is still true at 23:00; `hour < EVENING_HOUR` is still
  true at 03:00), so a weekly report could land near midnight and a missed-workout nudge before
  dawn. (2) **`MAX_PUSHES_PER_DAY = 1`** across ALL rules — the per-type de-dup only ever stopped
  the same rule repeating, so a user could collect missed_workout + streak_at_risk +
  partner_reminder in one day. Counted by distinct *type*, not by `notification_log` row, because
  the log holds one row per device token and a two-device user would otherwise be capped twice as
  hard. Three accuracy fixes shipped with it: **missed_workout** now requires the session's own
  `planned_start_time` to have passed (it read `planned_start_time` but never used it, so a 7pm
  session was announced as "waiting" at 9am); **free_time_gap** now also requires no upcoming
  scheduled session, so a planned REST day is no longer read as a gap to fill and nudged; and
  every rule's copy states a fact the function can verify about that user — the session's real
  time and focus, this week's real completed count, the real number of days lapsed — replacing
  slogans and the unverifiable "your streak stays alive" claim.
  **`notification_log` is now read by the client (2026-07-22)** — see §3.2's Feed entry (Home
  screen); until then the table was write-only from the app's perspective despite its own RLS
  already granting users SELECT on their own rows.
  **Auth hole closed 2026-08-02:** the function is deployed with `verify_jwt=false` (the pg_cron
  caller has no user JWT), which meant any unauthenticated POST previously ran with full
  service-role DB access — reading every user's data and burning Expo push quota. Fixed with a
  Supabase Vault shared secret (`retention_push_shared_secret`, `add_retention_push_auth.sql`):
  the cron job (`retention-push-hourly`) now sends it as an `x-retention-push-secret` header,
  and the function fetches the same value via a new `get_retention_push_secret()` SECURITY
  DEFINER RPC (Vault's own tables aren't exposed through PostgREST) and rejects any request
  whose header doesn't match with a 401. Confirmed live: unauthenticated POST → 401, the real
  cron-style call (secret header) → 200.
- **tempo-coach** ▶ **UNPARKED 2026-07-23 (founder) — still NOT DEPLOYED.** Coach is being built
  again; batch C3 (the screen) has landed, so `lib/coach.ts` is no longer dead code. **The function
  itself still does not exist in the Supabase project and there is no `ANTHROPIC_API_KEY`** — it
  returns 503 without one, so until it is deployed the screen opens, loads (empty) history and
  shows "Coach isn't available right now" on send. Two things gate a working Coach: deploying it
  (`npx supabase functions deploy tempo-coach`) and setting the secret. The provider decision
  (Claude vs a cheaper model for free-tier turns) is still open, and the RevenueCat-invisible-to-
  server gap below is still unresolved. — the server half of **Tempo Coach**, the Pro tentpole.
  A thin, authenticated, metered proxy to the Anthropic Messages API (**`claude-sonnet-5`** since
  2026-07-23, down from `claude-opus-4-8`: ~40% cheaper per message, identical request body, so it
  is a one-line swap back if apply-rate ever shows the model fumbling tool choice) — it is
  deliberately **not** an agent: it never writes to a training table and never executes a tool.
  It takes the user's message plus a context pack the app assembled, and returns
  `{ text, action }` where `action` is a **proposed** tool call the app renders as a confirm card;
  the actual write happens client-side through the same lib functions a button press already uses,
  only after the user taps Apply. Rationale in `STRATEGY_PLANS.md` §B.1 — this avoids a second copy
  of the scheduling engine living in Deno, means nothing mutates without a tap, and costs one API
  round-trip per message instead of three or four.
  **Five tools** (`reschedule_week`, `move_workout`, `swap_exercise`, `start_travel_mode`,
  `explain`) declared with `strict: true` + closed schemas so the args always parse; each maps to a
  lib function that already exists (`weekReschedule`, `moveWorkout`, `substitutions`, `travelMode`).
  **`verify_jwt` is ON** (unlike `retention-push`) — an unauthenticated LLM endpoint is a free API
  for the internet. Every query runs as the *caller*, so `coach_messages` RLS is the real access
  control and no service-role client is created. **Quota is server-side** and counted from Postgres,
  never from a client-sent flag: free (`proEnabled && !isPro`) = **3 messages per calendar month**
  (founder call 2026-07-23, tightened from 3/week — both tiers now share one month window),
  Pro/dormant = 200/month soft cap; `402` signals the paywall moment. The tighter cap is a product
  lever, not a cost one (a free user costs ~$0.13/month on Opus, ~$0.08 on Sonnet 5) — see
  `STRATEGY_PLANS.md` §B.6 for the recorded tradeoff: fewer wall-hits means fewer high-intent
  paywall moments, so `paywall_shown{context:'tempo_coach'}` conversion is the number that decides
  whether 3/month was too tight. Rows are written only *after*
  a successful reply, so a failed request never burns an allowance. Every call logs input/output
  token counts — that log, not the plan's estimate, is how real per-message cost gets known.
  **`ANTHROPIC_API_KEY` lives only in Supabase secrets** (`npx supabase secrets set`); it must never
  become an `EXPO_PUBLIC_*` var, which would inline it into the shipped binary.
  **Known v1 limitation:** the server can only see *comped* Pro grants (`app_config.pro_user_ids`),
  not real RevenueCat subscriptions, so a genuine subscriber would be metered as free — must be
  resolved (receipt verification or a RevenueCat-webhook-maintained table) **before** flipping
  `pro_enabled` globally. Not user-visible while Pro is dormant. See the function's README.
  **Client half — `lib/coach.ts`** *(Batch C2)*: `buildCoachContext()` is **pure** (rows in, pack
  out — same design rule as `fitnessInsights`, so it stays unit-testable), `fetchCoachContext()` is
  the only place that knows which tables to read (every sub-query independently best-effort: a
  coach that can't see your weight is still useful, one that won't open isn't),
  `sendCoachMessage()` / `fetchCoachHistory()` / `setActionState()` are the wire, and
  `describeAction()` / `actionCta()` render the confirm card — `describeAction` doubles as the
  **fallback copy** when the model returns a tool call with no text block. The context pack is
  deliberately small (it's the biggest input line on every request): short keys, sorted arrays,
  **absent data omitted rather than sent as null** (a null invites the model to comment on missing
  data), a 14-day schedule horizon, and hard caps on PRs/feedback so it can't grow unbounded.
  Errors are typed (`quota` / `offline` / `unavailable` / `failed`) so the screen can tell a
  paywall moment apart from a network blip. 17 unit tests cover determinism, omission, horizon
  edges, and that `describeAction` never returns an empty string for any tool.
  **Screen — `app/coach.tsx`** *(Batch C3, 2026-07-23)*: the thread itself, registered as a modal
  route in `_layout.tsx`. Inverted `FlatList` (new messages at the bottom, keyboard pushes the
  thread up for free), user bubbles right / coach bubbles left, a `KeyboardAvoidingView` composer
  capped at 2000 chars, a `TempoPulse` "Thinking…" indicator, and a four-starter empty state
  (a blank composer is the biggest reason a chat surface never gets a first message).
  **Text only in this batch by design** — a reply carrying a proposed action renders its text (or
  `describeAction()` as the fallback sentence when the model returns a tool call with no text), but
  **no Apply affordance**; the confirm card + executor switch are C4, kept in their own session so
  the scheduling-engine writes get an isolated diff review. The context pack is fetched **once per
  screen open** and reused for every turn (the plan isn't changing while the user types). A failed
  send leaves the user's bubble on screen with **Tap to retry** and excludes it from the history
  replayed to the model — the server only counts rows it persisted, so a failure never burns an
  allowance. Typed `CoachError`s drive the inline banner (offline / quota / unavailable / failed).
  **No entry points yet** (they're C5): the route is reachable directly, which is exactly the
  "use it yourself for a day before building the action layer" state the plan asks for. Analytics:
  `coach_opened`, `coach_message_sent`, `coach_action_proposed` fire here.
  **Action layer — `lib/coachActions.ts` + the confirm card** *(Batch C4, 2026-07-23)*: the half
  that makes Coach a product rather than a chatbot. Two safety layers doing different jobs.
  (1) **`validateAction()` — pure, runs before the card renders.** `strict: true` on the tool
  schema guarantees the model's args are well-*typed*; it guarantees nothing about whether they're
  *real*. So a `move_workout` whose `workout_id` was not in the context pack we sent, a date in the
  past, a well-formed-but-nonexistent date (`2026-02-31`), equipment outside the `Equipment` union,
  or an unknown tool name are all **refused — the reply renders as text only and the rejection goes
  to Sentry**. A card offering to move a session that doesn't exist is worse than no card.
  (2) **A re-read inside every executor, at Apply time.** Between "here's what I'd change" and the
  tap, the target can move, complete, or vanish (another device, the missed-workout sweep, an auto
  re-slot) — each executor re-reads its row and returns `stale` rather than blind-writing. A
  truncated reply (`stop_reason: max_tokens`) never renders an action at all, since the args may
  have been cut mid-object. Executors are **thin routers over code that already exists**:
  `rescheduleWholeWeek`, `rescheduleWorkout` + `resyncMovedWorkout`, `getAlternatives` +
  `saveSubstitution`, `saveTravelMode` — all **dynamically imported**, both so the pure validation
  half stays unit-testable without a native-module shim and so the Coach screen doesn't pull
  expo-calendar / expo-notifications into its module-eval graph. `reschedule_week` carries the
  **same `schedule_optimization` Pro gate the Plan tab enforces** — the Coach must not become a free
  side door around a paywall. `explain` is read-only and navigates instead of writing.
  The card settles into a past-tense line on apply/dismiss/stale and writes `action_state` back via
  the assistant row id (the Edge Function now **returns `message_id`** — without it there is no way
  to record apply-rate). Double-tap is guarded by a single `applying` row id. 15 unit tests in
  `coachActions.test.ts` cover the validation layer; the executors are not re-tested here because
  they are the same already-covered lib functions.
  **Dev stub — `lib/coachStub.ts`** *(temporary)*: canned keyword-routed replies, one per tool, so
  the whole apply flow can be device-tested **before an `ANTHROPIC_API_KEY` exists**. Double-gated
  (`__DEV__` **and** `EXPO_PUBLIC_COACH_STUB=1`, which no EAS profile sets), dynamically imported so
  a release build never loads it, and every stub reply carries `messageId: null` so it cannot write
  `action_state` and pollute apply-rate. **Delete it once the function is deployed.**

### 4.3 Scheduling & storage
- **pg_cron** job `retention-push-hourly` invokes `retention-push` every hour (via `pg_net`).
- **Storage:** private **`progress-photos`** bucket with per-user-folder RLS, and a **public
  `avatars`** bucket (`add_avatar_storage.sql`) — public because avatars are shown to friends
  elsewhere in the app and need no signed-URL refresh cycle; write access is still RLS-scoped to
  each user's own `<user_id>/…` folder.
- **Migrations:** SQL files in `mobile/supabase/` (`schema.sql`, `seed_*`, and incremental `add_*`
  migrations) — all applied to the live project. Recent: `add_exercise_library_v2` (is_core/
  popularity/muscle_group + backfill) & `seed_exercise_library_v2` (the ~1,300-row import),
  `add_travel_schedule` (`scheduled_workouts.travel_restore`), `add_split_kind` (`splits.kind` +
  one-auto-per-user index), `fix_days_per_week_allow_six` (user_profiles check widened 2–5 → 2–6;
  the UI has offered 6 days since the constraint-aware generatePlan work, so picking 6 failed every
  profile save with "Something went wrong"), and **`add_social`** (friendships, privacy columns,
  social RPCs, friend-template policy, workout_shares — see §4.1). The library import is regenerated by
  `mobile/scripts/build-exercise-library.mjs` (reads the ExerciseDB catalog, emits the seed SQL).

---

## 5. Integrations
- **Google Calendar** (OAuth via `expo-auth-session` + the token edge function) and **device
  calendar** (`expo-calendar`, offered on iOS **and Android**) — Tempo reads busy times to
  schedule around real life. **Connecting Google never swaps the Supabase user**: Google-auth
  users re-consent via OAuth (with a post-exchange identity check), while guest/Apple users go
  through `linkIdentity()` (requires "manual linking" enabled on the Supabase project; fails safe
  with a clear error when it isn't — previously this flow could silently replace a guest/Apple
  session and strand all their data). **Disconnecting is first-class**: Profile → **Disconnect
  Calendar** drops the server-side Google refresh token (`disconnectGoogleCalendar`) and clears the
  app's synced-event references (calendar events already created stay in Google); the device "stop
  using" path turns off auto-add, clears the chosen calendar + event references, and points to system
  Settings for the OS-owned permission Tempo can't revoke itself.
- **Auth:** Apple (`expo-apple-authentication`), Google, guest (Supabase anonymous). Guests can
  upgrade to a permanent account without losing history via `lib/accountLinking` (§1.1) — the same
  `linkIdentity()` path the calendar connect uses, surfaced through `SaveProgressSheet` from a
  guest-only Profile card and a one-time modal after the 3rd completed workout. (Apple linking uses
  Apple's *web* OAuth, so it needs an Apple **Services ID** + return URL configured in Supabase
  Auth — unlike the native Apple sign-in button; Google is the fully-proven path. Both fail soft.)
- **Push:** Expo Push API (server-driven) + local `expo-notifications` for the 30-min pre-workout
  reminder.
- **Media:** exercise GIFs are self-hosted, not fetched live. They used to be requested straight
  from the ExerciseDB image endpoint (RapidAPI) on every device on every view — that's a *shared*
  quota (RapidAPI BASIC = 690 req/month total across **all** installs), so it exhausted almost
  immediately and most exercises silently stopped showing a clip. Fixed by caching each GIF exactly
  once: `mobile/scripts/backfill-exercise-media.mjs` downloads each exercise's GIF from RapidAPI
  (throttled, resumable, stops cleanly on the monthly quota) and uploads it to the public Supabase
  Storage bucket `exercise-gifs` (`add_exercise_gif_storage.sql`); the same run also backfills
  `exercises.instructions` for imported rows still empty, straight from the ExerciseDB detail
  endpoint, using the same free quota. `src/data/exerciseMedia.ts` resolves an exercise's form GIF
  from three sources in priority order: **(1)** bundled local GIFs (`mobile/assets/exercise-gifs/`)
  for the 8 the remote library lacked; **(2)** a curated UUID→clip map for the original
  hand-written seed (with optional "close variant" notes); **(3) derivation** — the ~1,300 imported
  rows EMBED their ExerciseDB clip id in their UUID (`edb00000-0000-4000-8000-<id>`), so
  `lib/exerciseDb.exdbIdForExercise` recovers the id. Either way the app now builds a Supabase
  Storage URL (`${EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/exercise-gifs/<id>.gif`) and
  never calls RapidAPI live for images — an exercise not yet backfilled just 404s like a genuine
  gap. `EXPO_PUBLIC_RAPIDAPI_KEY` is now build/backfill-time only for the image path; `exerciseGif`
  still does a live RapidAPI name-search as a last resort for custom user exercises with no
  embedded id (low volume, can't be pre-cached). Since the 690/month cap covers ~1,300 exercises
  ×2 calls (GIF + instructions), a full backfill takes a few monthly re-runs of
  `npm run backfill:media` (needs a `SUPABASE_SERVICE_ROLE_KEY` env var, never committed) —
  already-cached/backfilled exercises are always skipped, so re-running is safe. **Fixed bug:** the
  curated/derived clip's `<Image>` in `ExerciseFormSheet` had **no `onError` handler at all** —
  since almost every one of the ~1,300 imported rows takes this path, a single failed request
  rendered nothing with no fallback. Now retries the same request once, then falls back to the
  "form video coming soon" illustration only after both attempts fail. **List-row thumbnails
  (2026-07-17):** `src/components/ExerciseThumb.tsx` is a small shared preview (resolves via the
  same `getExerciseGifSource`, falls back to the generic barbell/custom-tool icon on no-source
  OR a real `onError` — unlike the runner thumbnail below, this one does treat a 404 as a
  fallback trigger) — used in `exercise-library.tsx` (family + variant rows, replacing the old
  flat icon), `ExercisePickerSheet` (the "Add exercises" sheet — had no icon at all before), and
  `workout-builder.tsx`'s staged-exercise cards (same). **Follow-up (2026-07-17):** the workout
  runner's own thumbnail (`(tabs)/plan.tsx`) and Focus Mode's form preview had the same
  source-presence-only gap — fixed without adopting `ExerciseThumb` itself (both have a second
  fallback chain worth preserving: a legacy live RapidAPI lookup via `gifIds`/`gifSource` for
  custom exercises with no embedded id, which `ExerciseThumb` doesn't need). `plan.tsx` now tracks
  a `thumbFailed: Record<exerciseId, boolean>` map — the primary Supabase Storage source gets an
  `onError` that flips it, gating both the runner card's `<Image>` and the `formImage` passed into
  Focus Mode, so a 404'd exercise falls through to the `gifIds` tier (or the barbell icon) instead
  of a blank image, and Focus Mode is never handed a known-bad source in the first place. Focus
  Mode also gained its own independent guard (`failedImageKey`, keyed on `formImage`'s
  `uri`/asset-number rather than object identity, since `getExerciseGifSource` returns a fresh
  object every call) for whenever it does receive a source that fails to load.
- **Analytics/crash:** PostHog + Sentry.

---

## 6. Key flows
1. **Onboarding → plan:** capture goal/experience/equipment/calendar/availability (+ optional
   starting weight) → `generatePlan` builds a periodized 4-week plan around the user's hard
   constraints (never-train days, injuries) → auto-scheduled around the calendar → primed
   notification ask → reminders set + push token registered.
1a. **Plan rollover:** on app open, when <7 days of plan remain, `extendActivePlan` materializes
   the next 4-week block (mesocycle repeats, honoring the current profile + adaptation mode) —
   the plan never ends.
2. **Daily home:** unified schedule + readiness + block-phase + Quick Workout wedge.
3. **Run a workout:** prescriptions blend reactive autoregulation with the week's periodization; RPE
   logged per set; completion updates streak/consistency and re-evaluates `adaptation_mode`.
4. **Quick Workout:** minutes + focus → highest-impact session that fits, persisted as today's session.
5. **Adapt (both directions):** missed sessions / "too hard" feedback flip the plan into
   recovery/deload and re-stamp future weeks; conversely, consistent completed sessions (pulled
   forward by "too easy" feedback) graduate the user's experience level beginner → intermediate →
   advanced, immediately re-stamping upcoming sessions with harder variations + a real overload
   wave and celebrating the level-up.
6. **Retention loop:** hourly cron → `retention-push` → targeted nudges → deep-link back into the app.
7. **Body tracking:** log weight/body-fat/waist (+ optional photo) → trend feedback on Profile.
8. **Weekly recap:** Sunday-evening push + Home card → Weekly Report (improvement scorecard) → share.
9. **Motivation surfaces:** momentum celebration + PR highlights after each session; goal countdown
   and rich next-workout empty state on Home; tap the phase banner for the plan explanation.

---

## 7. Telemetry, privacy, store-readiness
- **Analytics events:** `app_open`, signup/login, `onboarding_complete`, `session_start/end`,
  quick-workout generated, workout feedback, share-card opened — with platform + app-version props.
  **Retention/activation instrumentation (`lib/activation.ts`):** `activation_reached` (fired **once**
  per user when the core loop is proven — a returning 2nd completed session; from `workout-complete`)
  and `calendar_connected` (fired **once** per user+provider the first time a calendar is connected —
  the wedge-adoption signal; from `calendar-setup` for Google + device and Home's device-add path).
  Both are de-duped by durable, per-user, force-close-proof localStorage flags (the same idiom as the
  tutorial + guest-save prompts), so PostHog can build the onboarding→activation funnel and split
  retention by calendar-adopters vs not. Analytics-only — no behavior change; no-ops without a key.
  **Critical gap found + fixed 2026-07-17: `EXPO_PUBLIC_POSTHOG_KEY` had never actually been set
  anywhere** — not `eas.json`'s `preview`/`production` env blocks, not `.env.local`. Every `track()`
  call across the whole app (all of the above) had been a silent no-op in every build ever shipped,
  dev or production — B0.1's "data already flows" was never actually true. Fixed: the project's real
  key (`phc_tvY9sRfvjiqvTzFgJMorP29zJMxZoT7aLKJPs54CP2pm`, org Tempo, project "Default project" id
  514051) plus `EXPO_PUBLIC_POSTHOG_HOST` are now wired into both EAS profiles and `.env.local`. A new
  PostHog dashboard **"Tempo — Activation & Retention"** was built ahead of any real data: a 2-step
  funnel (`onboarding_complete` → `activation_reached`) and a D-by-D retention curve anchored on
  `activation_reached` returning via `app_open` — both currently empty (0 events ever ingested into
  this project), ready to populate the moment a build with the new key actually ships.
- **Progressive disclosure (B3.2, real behavior — unlike the analytics-only item above):** Social
  (Profile's header Friends icon + its "Social" section, which is also the only entry point to
  Groups) and Muscle Intelligence (Progress's "Body Intelligence" card + `workout-complete`'s
  post-workout teaser) are hidden until a user has **completed** `ACTIVATION_SESSIONS` (2) sessions
  — no network exists yet, so showing empty social surfaces to a day-1 user is overwhelm, not value
  (audit finding). Gated on `stats.totalWorkouts >= ACTIVATION_SESSIONS` — the same live number
  `useProgressStats` already fetches for the level/badges on the same screens — deliberately **not**
  the fire-once `tempo.activated.*` flag in `lib/activation.ts`, which only gets set the moment a
  user crosses the threshold and would read "not activated" (and wrongly hide the feature) for an
  already-engaged existing user whose flag was never retroactively set. The Friends icon has one
  exception: it still shows if there's a real pending friend request or invite, regardless of
  activation — hiding an actual notification would be a regression, not disclosure. Deep links (a
  notification tap routing to `/social`, a group-invite link) are untouched — only the discoverable
  entry points are gated, never the routes themselves.
  **Two more residuals closed (2026-07-17):** badges were still visible from session one — Profile's
  header ribbon icon now gates on `activated || newBadges > 0` (same pattern as Friends: anyone who's
  already earned a badge keeps seeing the icon even pre-activation). Progress's full Fitness
  Intelligence dashboard (Tempo Score, momentum, heatmap, muscle balance, journey timeline) also hit a
  user with a single logged session — `(tabs)/progress.tsx` now has a third branch (between the
  zero-session `EmptyState` and the full dashboard) for `!activated`: consistency ring, streak card,
  and the volume trend chart only, plus one quiet teaser row ("More unlocks as you train...") — no
  lock icons, no upsell voice, pure pacing. The full dashboard branch is untouched, byte-for-byte.
  **Adaptation made visible outside the runner (missing-feature #15, previously "partial"):** the
  adaptation engine (`lib/adaptation.ts`) already re-stamps future plan weeks on a mode change, but
  nothing outside the runner ever announced it. A new Home context item (`adaptation`, between
  `report` and `quick` in priority) reads the most recent `adaptation_events` row where
  `trigger='auto_periodization'` (`['adaptation_recent', userId]`, 5-min staleTime, in
  `useRefreshOnFocus`) and shows "Recovery week" / "Deload week" / "Back to full intensity" for events
  ≤7 days old. Suppressed whenever `blockPhase.mode` is `'recovery'`/`'deload'` — that chip already
  appends "· auto-adjusted" for the current week, so the new chip's real value is specifically the
  "we're back to normal" transition, which nothing else surfaces.
- **Accessibility + inset-consistency pass (2026-07-17, pre-launch per audit §06):** RPE rating chips
  (`(tabs)/plan.tsx`) previously read as bare numbers ("1".."10") to a screen reader — now
  `accessibilityLabel="Rate this set RPE {n}"`. Onboarding's day/minute/off-day/time-of-day chips
  (`schedule.tsx`, `train-time.tsx`) gained labels + `accessibilityState={{selected}}`. Focus Mode's
  rest ring (`FocusMode.tsx`) had no accessible label at all (its only info lived inside an SVG
  overlay) — the ring wrapper now carries a live `accessibilityLabel` ("Resting, M:SS remaining" /
  the target-reps label). Fixed-size ring text (Focus Mode, Progress's consistency ring) got
  `maxFontSizeMultiplier` caps so Dynamic Type can't visually overflow a circle — everything else
  stays uncapped by design. All four tabs' hardcoded scroll `paddingBottom` (120/140/150) now
  reference the shared `BottomTabInset` constant (`+44`/`+54`/`+24`/`+24` respectively) — identical
  rendered values, now drift-proof against a future dock height change. **Contrast checked, not
  changed:** `outline` (#6E7480 dark / #8A8089 light) on `surface` computes to ~4.06:1 / ~3.6:1 —
  passes WCAG AA for large/bold text (3:1) but fails strict body-text AA (4.5:1). Left the token
  alone — it's load-bearing for the whole visual identity across 60+ files, and nudging a global
  color with no way to eyeball the result on a real device is exactly the kind of change this
  session's "verify, don't guess" discipline argues against. Documented for the founder instead.
- **Privacy/compliance:** in-app Privacy Policy + Terms (`legal.tsx`, opened from the sign-in footer
  **and** Profile → Privacy & Terms — the sign-in links were previously dead text, now wired),
  in-app **account deletion** (App Store Guideline 5.1.1(v)), per-user RLS everywhere, Google token
  kept server-side only. Publicly mirrored on the marketing site (`web/`): `privacy.html`,
  `terms.html`, `delete-account.html` (hosted at `fittempo.app/...`). The **privacy policy carries the
  Google API Services "Limited Use" disclosure** required to pass OAuth verification for the sensitive
  `calendar.events` scope. Filled-in submission answers (OAuth verification steps, App Store **App
  Privacy** + Play **Data safety**) live in `LAUNCH.md` §4; console-upload logos in `brand-assets/`.
- **Store assets:** the app icon is a **full-bleed white** 1024² (`icon.png`, alpha stripped →
  Apple-safe), rebuilt from the runner/clock glyph so there is **no black frame**; the Android
  adaptive icon is a white `backgroundColor` + isolated-glyph `foregroundImage` (the accidental
  guide-template `backgroundImage` and the dangling `monochromeImage` reference are removed);
  `notification-icon.png` is a **white glyph silhouette** (Android tints notification icons to a
  monochrome mask, so the old full-colour icon showed as a white square); `splash-icon.png` is the
  white rounded badge shown on the dark splash on both platforms. In-app brand assets:
  `tempo-logo.png` (white-tile badge), `tempo-mark.png` (transparent two-tone glyph), `tempo-glyph.png`
  (white silhouette for `tintColor`). `app.json` carries permission strings + export-compliance flag;
  `eas.json` has build env + submit scaffold; launch steps in `LAUNCH.md`. **2026-08-30:**
  `submit.production.android` corrected from `track: "alpha"` to `track: "production"` +
  `releaseStatus: "completed"` — the app had been live on Play production since 2026-08-09 while the
  profile still pointed at closed testing, so any non-interactive `eas submit` would have published a
  production build to the alpha track and reported success. Android versionCode 12 (v1.0.0) shipped to
  Play production at 100% through the corrected profile. **2026-08-06:**
  `submit.production.ios.ascAppId` added (`6785075737`, the App Store Connect numeric app ID —
  required for `eas submit -p ios --non-interactive` to resolve the app without an interactive
  prompt); the actual first production submissions to both stores happened this session — see
  `EXECUTION_STATUS.md`'s Session Log for the full App Store Connect / Play Console setup detail
  (category, age rating, App Privacy answers, price tier, subscriptions, and the Play listing's
  stale "Tempo" branding caught and corrected).
- **Sign in with Apple:** `ios.usesAppleSignIn: true` in `app.json` (the entitlement native Apple
  auth needs — its absence was why it failed on real builds). Still requires the "Sign in with Apple"
  capability enabled on the Apple Developer App ID + the Apple provider configured in Supabase Auth.
  The sign-in screen renders Apple's **official** `AppleAuthentication.AppleAuthenticationButton`
  (black in light mode / white in dark, so it's always compliant + on-brand) and a custom Google
  button carrying the real Google mark (`Ionicons logo-google`) — the old literal "G" / blank Apple
  glyph are gone.
  Offering Apple also satisfies Apple's rule that a third-party login (Google) obliges an Apple option.
  **Fixed 2026-08-02:** Apple's native sheet can resolve without an `identityToken` (a documented edge
  case) — this used to fall through silently, leaving the user staring at a vanished spinner with no
  explanation; now alerts explicitly. **Still open, needs founder Apple Developer credentials (queued
  as N3 in `EXECUTION_STATUS.md`):** `delete-account` never revokes Apple's own authorization, so a
  "deleted" account still shows Tempo as an authorized app in the user's Apple ID settings — closing
  this needs a Sign in with Apple Service ID + private key from the Apple Developer portal (new infra,
  not just a code change), which only the founder can obtain.
- **iOS 17 calendar permissions:** `NSCalendarsFullAccessUsageDescription` +
  `NSCalendarsWriteOnlyAccessUsageDescription` are declared alongside the legacy
  `NSCalendarsUsageDescription`, so calendar access prompts correctly on iOS 17+.
- **Bundle identifiers:** iOS `com.fittempo.app`, Android `com.fittempo.app` (the original
  `com.tempo.app` was unavailable on Apple).
- **OTA updates (EAS Update):** `expo-updates` configured — `app.json` has `updates.url`
  (`https://u.expo.dev/<projectId>`) + `runtimeVersion.policy: fingerprint`; each `eas.json` build
  profile declares a matching `channel` (`development` / `preview` / `production`). JS/asset-only
  changes ship with `npx eas update --branch <channel> --message "…"` (no rebuild). Native/config
  changes (new modules, plugins, permissions, SDK bumps) still require a full `eas build` + submit.
  - **Why `fingerprint`, not `appVersion` (changed 2026-07-15 after an Android beta crash):** with
    the old `appVersion` policy, runtimeVersion was frozen at `1.0.0`, so an `eas update` that used a
    **native module added after a build** was still delivered to that older binary → it referenced a
    native module that wasn't linked and **crashed on launch** (this is exactly what took down the
    Android closed-test build while iOS — built more recently — was fine). `fingerprint` derives the
    runtimeVersion from a hash of the native project, so an OTA update **only reaches binaries whose
    native layer actually matches** — a native drift now simply means "no update delivered" instead of
    a crash. Trade-off: existing `1.0.0` binaries won't receive fingerprint-targeted updates, so the
    fix is to rebuild + redistribute (which also carries the crash fix). Takes effect on the **next**
    build; in-flight builds are unaffected.
  - **Windows gotcha (`mobile/.gitattributes`, added 2026-07-15):** `@expo/fingerprint` hashes **raw
    file bytes**, so with Git `core.autocrlf=true` on Windows the local working tree (CRLF) hashes
    differently from the committed LF blobs the Linux EAS builder checks out. The two tracked files
    that feed the fingerprint — `.gitignore` and `eas.json` — must stay LF, or `eas build` fails the
    "Configure expo-updates" phase with *"Runtime version calculated on local machine not equal to
    runtime version calculated during build."* `mobile/.gitattributes` pins `eol=lf` on them (and on
    itself) so the hash is identical on both sides. If a **new** tracked file ever starts feeding the
    fingerprint, add it there too.

---

### Launch-queue closeout: analytics, universal-links prep, accessibility (2026-07-22, §16/§26/§27 L12/L16/L27)
Founder asked to close out everything in the audit that's Sonnet-buildable, not just the Critical rows.
- **L16 — analytics gaps.** The conflict card (L2, above) had no funnel visibility at all — this
  document's own audit called "what % of free users ever see a conflict" the monetization forecast,
  and it wasn't tracked. Added `conflict_detected` (fires once per distinct set of conflicts, not on
  every re-render — deduped via a ref of the sorted workout-id set), `conflict_resolved_manual`, and
  `conflict_dismissed`. Also added `plan_generated` (`onboarding/plan-preview.tsx`, right after a
  successful `generatePlan()` call) — the funnel step between "connected a calendar" and "started a
  session" that was missing entirely.
- **L27 — universal-links scaffolding (the deferred half).** Web-side files don't need a rebuild;
  app-side association does — split accordingly. Added `web/.well-known/apple-app-site-association`
  and `assetlinks.json` as templates (Apple Team ID and the Android signing-cert SHA-256 fingerprint
  are founder-only values neither exists in this repo nor is guessable — left as clearly marked
  placeholders) plus `web/.nojekyll` (harmless insurance; this repo's Pages workflow has no Jekyll
  step, but `.well-known` is a dotfile path Jekyll excludes by default if that ever changes). Added
  `ios.associatedDomains` (`applinks:fittempo.app`) and `android.intentFilters` (autoVerify on
  `https://fittempo.app/w/*`) to `app.json` — inert until the founder fills in the two placeholder
  values and does the native rebuild already planned for next month; `app/w/[code].tsx`'s existing
  deep-link handler needs no changes, since expo-router routes a verified universal link through the
  same handler as the `tempo://` custom scheme.
- **L12 — accessibility, continued.** Spot-checked the remaining highest-traffic file not yet reviewed
  this session (`(tabs)/plan.tsx`, the workout runner — 49 touchables, the largest raw count in the
  app) by reading every touchable, not re-running a static count. Confirms the pattern found earlier
  in Home and Profile: the overwhelming majority already have either an explicit
  `accessibilityLabel` or a visible `Text` child a screen reader reads automatically. Found and fixed
  the two genuine gaps: the week/month range's prev/next chevrons (icon-only, no label at all —
  labeled `Previous {week|month}` / `Next {week|month}`, dynamic to the active view mode).

### Paywall rebuild + founding-price plumbing (2026-07-22, PRODUCT_AUDIT.html §24/§25 L3-L8)
Founder-approved, built alongside the L1/L2 re-gating above so the paywall could sell what actually
changed. Two classes of work: a real purchase-layer bug fix, and a full visual rebuild.
- **L3 — `lib/purchases.ts`.** `packageHasIntroOffer` assumed every introductory offer is a FREE
  trial (`price === 0`) — silently wrong the instant a PAID intro exists (the founding $19.99 first
  year), which would have rendered the paywall's price as the $34.99 list price while the store
  actually charged $19.99. Redefined `packageHasIntroOffer` to mean "has any intro offer"; added
  `introIsFree()` and `introOffer()` (a typed, normalized `IntroOffer`) as the real API. The old
  function had exactly one import site (`paywall.tsx`) and wasn't actually called there either — the
  screen had its own duplicate local `trialLabel`/`trialDaysOf` doing the same wrong assumption, now
  replaced by the shared helpers.
- **L4/L5 — price display + savings math.** The annual plan option now shows the live intro price
  (when one exists and isn't free) as the primary number with the list price struck through beside it
  and a "first year · then $X/yr" subline — never a hardcoded number, always `product.priceString` /
  `introPrice.priceString` off the live RevenueCat package. `savingsPct` now compares the *effective
  first-year cost* against 12× monthly when a paid intro exists (67% off at $19.99 vs $4.99/mo), not
  list-vs-list. The trial timeline card is now offer-aware: a free trial gets the existing "how your
  trial works" steps; a paid intro gets a new two-row "what you pay" card instead — the two never
  render together.
- **L6 — founding-offer banner.** `lib/proConfig.ts` gained `fetchFoundingOfferEndsAt()`, reading a
  new `app_config` row (`key='founding_offer'`, `value={"ends_at":"YYYY-MM-DD"}`) with the exact same
  fail-closed, config-driven discipline as `fetchProState` — absent row or a past date → no banner,
  so the app can never claim an offer the store has already expired. One SQL update extends it; no
  build required.
- **L7 — `lib/paywallFrequency.ts`.** A device-local 48h cooldown wired into the two genuinely
  *automatic* paywall redirects (onboarding completion, first-workout completion) — a motivated new
  user could otherwise complete both in one sitting and see the paywall twice. Deliberately NOT
  applied to user-initiated opens (Settings, the Home conflict card's tap-through, any `ProGate`) —
  those are deliberate actions, not nags, and a hard limit gate must always still explain why an
  action was blocked regardless of this cooldown.
- **L8 — onboarding placement, verified not rebuilt.** `onboarding/profile-setup.tsx` already calls
  `router.replace('/(tabs)')` (landing on the populated Home day-timeline) BEFORE conditionally
  pushing the paywall on top — the plan-preview demonstration already precedes the sell. No code
  change needed; this was a real gap in an earlier build that had since been fixed independently.
- **§25 — the visual rebuild (`app/paywall.tsx`).** Restructured top-to-bottom: (1) the hero now reads
  the user's own `schedulingImpact` data ("Tempo has scheduled 14 workouts around your real life"),
  shown from their first real workout instead of held back for a ≥3 threshold; (2) a new `WeekStrip`
  component — seven day columns, grey blocks for "real life," a tinted block for where a workout fit
  the gap — is the one thing on the screen that *shows* the product instead of describing it, built
  from plain Views with one entrance animation (no new dependency); (3) the old 6-row icon list is now
  3 outcome-framed benefit cards (still sourced from the single `PAYWALL_POINTS` registry — App
  Review's "every paywall claim must map to a real feature" discipline is unchanged) plus a quiet
  one-line summary of the rest; (4) the 9-row compare table is now a closed-by-default disclosure, and
  the "Advanced analytics — Free ✓" row is gone entirely (a row where Free already has a checkmark is
  an argument against paying, printed on the purchase screen); (5) **the screen is now always dark**
  regardless of the app's own theme setting — done by importing `Palettes.dark` directly as a plain
  constant (`@/constants/theme`) instead of the reactive `useTheme()` hook, so it touches zero global
  theme state and can't affect any other screen. Every item on the §25.2 no-regressions checklist
  (live pricing, the offline/no-plans fallback, Restore/Terms/Privacy, every `track()` call, dormant-
  safety, dismissibility) was preserved verbatim from the original file.

### Pro re-gated onto the weekly repetition (2026-07-22, PRODUCT_AUDIT.html §24/§30 L1/L2)
**Founder-approved change to what's free vs. Pro.** Every existing Pro gate (plate calculator, muscle
map, travel mode, themes, creation caps) was an accessory nobody hits weekly — which is why founder
instinct said nobody would buy it, correctly. Fix: gate the thing a real user hits every week, because
a calendar changes every week.
- **L1 — rolling auto-schedule horizon.** `lib/autoSchedule.ts`'s `autoScheduleUpcoming` now clamps
  a locked (free, Pro-live) user's ambient time-placement to the end of the CURRENT week
  (`endOfWeek()`, Monday-Sunday — matches the week boundary `useProgressStats`/the leaderboard already
  use). Generation itself is never touched — every future week's plan always exists and is fully
  usable; only the automatic calendar-fitting of weeks beyond this one is gated. `freeWindowEnd` is
  `null` (full horizon, byte-identical to before) whenever `!isProLockedNow()` — dormant or Pro. This
  is the one instance the audit's own acceptance criteria named explicitly: **while `pro_enabled` is
  off, behavior must be byte-identical to before** — verified via the full existing test suite plus
  the fact the clamp is a single `if (freeWindowEnd && day > freeWindowEnd) continue` that only
  activates when `freeWindowEnd` is non-null.
- **L2 — auto-reschedule on conflict.** `resolveCalendarConflicts` (the silent auto-move) is now
  self-gated — `if (isProLockedNow()) return 0` at its very top — so every caller, present or future,
  is automatically correct with no per-call-site branching to get wrong. A locked user instead gets
  the new **`findCalendarConflicts`**, a read-only sibling that detects the identical "a real event
  now overlaps this workout" condition (via `getCalendarEventsForRange`'s titled `DayEvent`s, not
  `gatherBusy`'s untitled `BusySlot`s, specifically so the copy can name the actual clash) but never
  writes anything. Home queries it only when `locked`, renders it as a new highest-non-returning-
  priority context item — "Thursday's session now clashes with Design review" — with **Move it
  myself** (fetches the full row, hands off to the exact same `handleReschedule` the missed-workout
  card already uses) and **Let Tempo handle this →** (paywall, `context:'conflict'`, per this
  document's own claim that this is the single highest-intent entry point in the app). Dismissal is
  device-local and per-workout-id (`lib/conflictDismissal.ts`), added to `queryInvalidation.ts`'s
  shared `TRAINING_KEYS` so a resolved conflict's stale card can't outlive the conflict.
- **`stores/entitlements.ts` gained `isProLockedNow()`** — the same `locked` derivation
  `useProAccess()` computes, exposed as a plain function (`useEntitlementStore.getState()`, Zustand's
  documented non-hook escape hatch) for background sweeps that run outside any component and can't
  call a hook.
- **A real regression, caught by the full test suite, not shipped**: adding that one import broke
  `splitSchedule.test.ts` — `stores/entitlements.ts` had `useRouter` (expo-router) and `track`
  (lib/analytics, which itself pulls in `react-native` + PostHog) as static top-level imports, used
  only inside `useProGate()`. Any file importing *anything* from this module — including just the new
  `isProLockedNow` — pulled that whole native-dependent chain into Jest's plain-Node test environment,
  where it doesn't exist. Fixed by lazy-`require()`-ing both inside `useProGate()` itself (the same
  pattern `components/ShareCardSheet.tsx`'s `loadNativeShare()` already uses for native-module
  safety) — `isProLockedNow`/`useProAccess`/the store itself now have zero RN-dependent imports.
- `proFeatures.ts` gained `rolling_schedule` + `auto_reschedule`; `PAYWALL_POINTS` now leads with
  these two instead of the old accessory-first ordering (kept, just demoted).

### Public share preview (2026-07-22, PRODUCT_AUDIT.html §26 L27)
A shared workout link used to be a dead end for anyone without a Tempo account: `app/shared-workout.tsx`
bails out (`if (!code || !userId) return`) before it ever fetches anything, so the app's only organic
growth loop — "try my workout" — showed nothing to exactly the people it exists to convert. Two real
bugs found and fixed alongside the new page, not just the missing page itself:
- **`lib/social.ts`'s `shareUrl()` pointed at `tempo.app`** — a domain Tempo doesn't own. The real
  domain (repo-root `CNAME`, `web/`) is `fittempo.app`. Every share message sent from My Workouts/My
  Splits has been linking nowhere; fixed to `fittempo.app/w/<code>`.
- **`get_workout_share_by_code`** (the SECURITY DEFINER capability-URL lookup from
  `fix_workout_shares_rls.sql`) was only granted to `authenticated` — `add_public_share_preview.sql`
  extends the exact same grant to `anon`, since a logged-out web visitor presenting the code is the
  same trust model the function already documents ("if you have the code, you're meant to see it"),
  just one more caller of it.
- **`web/share.html`** — a new, dependency-free static page. Calls the RPC directly via `fetch` (no
  Supabase SDK, matching the site's existing no-bundler approach) with the public/publishable key —
  safe to embed, that's what it's for. Renders the workout or full weekly split breakdown, equipment,
  duration, and an "Open in the app" button (`tempo://w/<code>`, the existing custom scheme) alongside
  a "Get early access" CTA to the waitlist (the site is still pre-launch). `possessive()` and
  `equipmentSummaryLabel()`'s exact logic is duplicated in JS so the page reads identically to the
  in-app share screen — verified against a live share row via a direct `curl` to the RPC before
  shipping. Untrusted text (exercise names, split-day labels — both user-editable) is escaped before
  being written into `innerHTML`; this is a logged-out, unauthenticated page, so that's not optional.
- **GitHub Pages routing**: `.github/workflows/{deploy,static}.yml` confirm `web/` ships to GitHub
  Pages, which serves static files only — `web/server.js`'s matching Express route only helps local
  dev, since GH Pages never executes it in production. Added `web/404.html`, the standard GH-Pages
  SPA-routing trick: any unmatched `/w/<code>` path lands on the built-in 404, whose only job is to
  detect that shape and redirect to `/share.html?code=<code>`, which `share.html` already reads as a
  fallback to the pretty-path parse.
- **Known limitation, not hidden**: OG tags (`<meta property="og:title">` etc.) are static/generic —
  a link pasted into iMessage/Slack/Twitter shows "A shared workout — Tempo," not the actual workout
  name, because those unfurlers read tags via a HEAD request without executing JavaScript, and GitHub
  Pages has no server-side rendering to inject per-request tags. Dynamic OG previews would need an
  edge function (Vercel/Cloudflare Worker) — a real fast-follow, out of scope for a static site.
  Universal links (native `apple-app-site-association` + Android asset links, so tapping a share link
  opens the app directly with no browser hop) are the other deliberately deferred half of L27 — they
  need a native rebuild, so they're their own session, not bundled into this OTA-safe change.

### Progress-photo compare (2026-07-22, PRODUCT_AUDIT.html §26 L25)
`app/progress-photos.tsx` had a timeline grid + single-photo viewer but no way to see two photos
together — the single most shareable artifact a fitness app can produce, and the app could take
photos in but never hand anything back out. Added a drag-to-reveal before/after:
- `components/PhotoCompareView.tsx` — a dependency-free compare slider built on RN's own
  `PanResponder`, copying `components/Slider.tsx`'s exact capture-phase gesture claim (`onStart/
  MoveShouldSetPanResponderCapture` + refusing every termination request) so a drag started on the
  handle can't be stolen by the screen's own ScrollView mid-gesture. No new native module.
- Progress Photos gained a "Compare" mode: tap two tiles (badge-numbered as you pick), and it opens
  the compare view with the earlier date always on the left, sorted by `measured_at` regardless of
  tap order — never by which one you tapped first.
- **Share as image**: `react-native-view-shot` + `expo-sharing` were already dependencies (used by
  `ShareCardSheet.tsx` for Wrapped cards) — reused the identical lazy-require + `captureRef` +
  `Sharing.shareAsync` pattern rather than adding anything new, so this ships via `eas update` with
  no rebuild.
- `analytics.ts` gained `progress_photo_compared`.

### Achievement-unlock celebration (2026-07-22, PRODUCT_AUDIT.html §26 L24)
`lib/badges.ts`'s 12 badges were purely passive — earned/unearned status only ever appeared if you
opened the trophy case (`/badges`) yourself; nothing celebrated the moment a badge was actually
earned. Extended the existing system rather than building a second one: `workout-complete.tsx` now
computes `earnedBadges` the exact same way Profile does (`badgeStatsFromSessions` +
`computeEarnedBadges`), diffs it against `getSeenBadges` (the same device-local "seen" set the
trophy case's NEW-indicator already used), and gives the highest-tier newly-unlocked badge the same
full-card `PopIn` treatment the existing "First Tempo Session" card already had — generalizing the
screen's `'achievement'` tier (previously hardcoded to only ever mean first-session) to also carry a
real `BadgeDef`. `first_workout` is excluded everywhere here since `isFirstSession` already owns
that exact moment with richer, dedicated copy.
- **Bootstrap safety (the one real risk):** an existing user's already-earned badges must never all
  appear to unlock at once the first time this code runs for them. Added `hasSeenRecord()` to
  `lib/badges.ts` (distinguishes "never recorded anything" from "recorded, currently empty" — plain
  `getSeenBadges` collapses both to an empty Set) — on a user's first encounter, the baseline is
  seeded silently (marked seen, nothing celebrated); only unlocks after that ever fire the card.
  Every earned badge is marked seen immediately after checking, celebrated or not, so the trophy
  case never redundantly shows a "NEW" badge for something just celebrated here.
- Deliberately scoped to the 6 derived milestone/consistency badges (streaks, session counts, volume
  totals) — competitive/social badges (Weekly Winner, Top 3 Monthly, Workout Partner) are awarded via
  a separate server RPC and still surface through the trophy case's own existing NEW indicator.
- `analytics.ts` gained `achievement_unlocked: { key, tier }`.

### Pause / vacation mode (2026-07-22, PRODUCT_AUDIT.html §26 L21)
"I'm away for 10 days" used to mean a broken streak and a wall of "missed" sessions — nothing told
the plan the user was gone. `user_profiles.paused_until` (nullable date, `add_pause_mode.sql`) is
the only new state. `lib/pauseMode.ts`:
- `pausePlan(days)` shifts every future `status='scheduled'` row forward by `days` — one row at a
  time, each routed through the existing `resyncMovedWorkout` (the same helper the auto-scheduler
  uses for single-row moves) so its synced calendar event + reminder move with it. Sets
  `paused_until = today + days`.
- `resumePlan(pausedUntil)` (early resume) shifts the still-unrealized remainder (`paused_until -
  today`) back, then clears the flag.
- `checkPauseExpiry()` — time simply passing needs no shift (dates already landed correctly); called
  once in Home's app-open sweep, it just clears a now-stale flag.
- `week_index`/periodization are never touched, so the mesocycle resumes exactly where it left off.
- **Streak protection needed zero special-casing**: `streak.ts`'s day map only contains dates that
  have a `scheduled_workouts` row; since paused dates never get one (they're all shifted past the
  window), the streak calculation silently skips the gap.
- `checkMissedWorkouts` (`lib/missedWorkouts.ts`) gained a belt-and-suspenders guard — fetches
  `paused_until` and no-ops while `today < paused_until` — even though pausePlan's shift already
  means there's structurally nothing in range to mark missed.
- UI: `app/pause-mode.tsx` (a `Slider` from 1–60 days, plus 4/7/10/14/30-day quick-pick chips, or
  Resume Now — any exact day count is selectable, not just the presets), a Settings row
  (Calendar & Scheduling section), and a Home context-item banner (priority 1, right after the
  returning-user banner) with an inline "Resume now" action. Free, uncapped — this is core-loop
  reliability, not a Pro feature.

### Fixed blank-screen-on-first-launch (2026-07-21)
Root cause: four Zustand stores (`theme/index.tsx`'s `useThemeStore`, `stores/entitlements.ts`'s
`useEntitlementStore`, `lib/units.ts`'s `useUnitStore`, `lib/focusModePref.ts`'s
`useFocusModePrefStore`) read the SQLite-backed `localStorage` **synchronously inside their
`create()` initializer** — code that runs at *module evaluation time*, before React mounts and
before `TempoErrorBoundary` exists. `expo-sqlite`'s sync API (`getItemSync`/`setItemSync`) opens
and migrates the on-disk database the first time any key is read or written
(`getDbSync()`/`maybeMigrateDbSync()` in `expo-sqlite/build/Storage.js`); on a genuinely fresh
install that first synchronous native call can stall, and a stalled JS thread can't run the root
layout's existing 5s font-load timeout either — timers can't fire while the thread itself is
blocked. Matches the reported symptom exactly ("blank screen on first launch, works after force-
quitting and reopening").

Fix: every store now defaults synchronously to a safe constant (`theme` → `'dark'`, `units` →
`'lb'`, `focusModePref` → `false`/off, `entitlements.devProOverride` → `null`) with **no storage
access in the initializer**, and each exports an async loader (`loadStoredThemeMode`,
`loadStoredWeightUnit`, `loadStoredFocusMode`, `loadStoredDevProOverride`) that corrects the value
*after first mount* using `expo-sqlite/kv-store`'s async `AsyncStorage.getItem()` — confirmed to
read/write the same underlying database as the sync API, so nothing is lost, it just resolves a
tick later.

**Centralized into `lib/prefStorage.ts` (2026-07-22).** That fix left all four stores *writing*
through `globalThis.localStorage` while *reading* through `expo-sqlite/kv-store`. On native those
are the same SQLite database so it worked — but nothing in the code said so and nothing enforced
it, and anywhere they are not the same store (web) **every one of these preferences silently failed
to persist**: set kg, reload, back to lbs. Silent data loss with no error and no crash. `prefStorage`
now owns the contract — `writePref`/`removePref` write *both* ways, `readPref` tries kv-store then
falls back to localStorage — so persistence no longer depends on an undocumented coincidence about
how Expo polyfills `localStorage`. Verified end-to-end in the running app: KG survives a full reload
and the profile Volume tile reads 599 kg where it read 1,320 lbs. **The initializers are deliberately
untouched** — they still default synchronously to a constant with no storage access, because that is
the actual fix for the blank-screen bug and `readPref` must never be called from one.

All four loaders are called from the root layout's existing startup `useEffect`
(`app/_layout.tsx`, alongside `initialize()`/`track('app_open')`/`endStaleRestActivities()`). A
plain `globalThis.localStorage` property *reference* (e.g. the query-cache persister at the top of
`_layout.tsx`) is unaffected — the sync-DB-open only happens on the first actual `getItem`/
`setItem` call, not on accessing the polyfilled object itself.

Same pass fixed a real bug in `lib/focusModePref.ts`: Focus Mode used to default **on**
(`v === null ? true : ...`) for anyone who'd never touched the setting; it now defaults off and
stays off until the user opts in in Settings — the runner's gating logic (`plan.tsx`, `if
(focusModeEnabled) setFocusOpen(true)`) already respected the preference correctly, only the
default was wrong.

**Fourth instance found (2026-08-03), in `stores/auth.ts`'s `initialize()`.** Reported again after
both this fix and the `_layout.tsx`/`crashReporting.ts` fix above — `(tabs)/_layout.tsx` and
`onboarding/_layout.tsx` both render a blank view for as long as `useAuthStore().loading` is true,
and the *only* thing that ever flipped it was `supabase.auth.getSession().then(...)`, with no
`.catch` and no timeout. On a fresh install this can race with the other first-ever SQLite-backed
`localStorage` opens (the react-query persister, the profile cache) the same way the four stores
above used to, and if it never settles the gate stays shut forever — force-quitting works because
the next process finds the SQLite file already created and opens fast. Fixed the same way as the
font-load gate already does in `_layout.tsx`: a 5s timeout forces `loading: false` if the real
result hasn't landed, plus a `.catch` so an outright rejection can't wedge it either. A late
resolution still applies normally (`set({ session, profile, loading: false })`), same as the font
timeout pattern — this is a safety net, not a replacement for the real result.

**Fifth instance found (2026-08-09), same file, the `onAuthStateChange` listener.** Reported as
"sign in with Google on Android does nothing, but force-quitting and reopening shows logged in."
This listener's `SIGNED_IN` branch `await`s `fetchProfile()` before ever calling `set({ session,
... })` — unlike `initialize()` above, it had no timeout guard at all. Right after an OAuth
token exchange is exactly the moment network contention peaks, so a slow `fetchProfile` left
`session` null indefinitely; `sign-in.tsx`'s `if (session) return <Redirect href="/" />` never
fired, and the spinner had already cleared (`sign-in.tsx`'s own `handleGoogleSignIn` `finally`
runs once `exchangeCodeForSession` itself resolves, independent of this listener) — so the screen
looked completely inert. A subsequent cold start hits `initialize()`'s own timeout-guarded path
fresh and succeeds normally. Fixed the same way as the fourth instance: a 5s timeout now lets
`session` (and a best-effort profile, from the in-memory store or the cached-profile fallback
`initialize()` already uses) apply even if `fetchProfile` hasn't returned, while the real fetch is
still awaited afterward and applied when it lands rather than discarded.

**Codebase-wide sweep (2026-08-09), founder-requested after the fifth instance.** Checked every
Zustand store's init path, both root-layout blank-render gates, and every screen/sheet in
`app/`/`components/` with a `loading`-style state (~30 files) for the same shape: an async chain
gating a render with no guaranteed completion on the error path. Two more real instances found and
fixed, same pattern each time — a missing `.catch()`/`finally` left `loading` true forever on a
genuine failure (a hard network drop; Postgrest's `.single()` throws on 0 rows, unlike
`.maybeSingle()`):
- `muscle-history.tsx` — the `set_logs` fetch had no `.catch()` at all; wrapped in `Promise.resolve()`
  (needed because the Postgrest builder's own `.then()` isn't a real `Promise` and doesn't expose
  `.catch()` directly) and falls through to the empty state on failure.
- `plan-explainer.tsx` — its `Promise.all([...])` had no enclosing `try`; wrapped, `finally` guarantees
  `setLoading(false)`.
- **`(tabs)/plan.tsx`'s `loadWorkout()` — the highest-impact of the three.** This is the single
  most-used screen in the app (the workout hub, ~270 lines), and had no enclosing try/catch of its
  own — only two early-return branches called `setLoading(false)` manually, not a catch-all. Rather
  than restructure a 270-line function, extended its existing wrapper (`runLoad`, which already
  exists specifically to guard every call site) with a `catch` that reports via `captureApiError` and
  clears `loading` — covers both the explicit-workoutId and default hub-load paths in one place.

Screens using TanStack Query (`useQuery`) were not in scope — react-query has its own retry/error
state built in and isn't vulnerable to this class of bug. Everything else checked (paywall.tsx's two
async calls, coach.tsx, feed.tsx, social.tsx, workout-history.tsx, session-detail.tsx, my-workouts.tsx,
my-splits.tsx, friend-profile.tsx, exercise-progress.tsx, split-editor.tsx, workout-builder.tsx,
shared-workout.tsx, progress-photos.tsx, calendar-picker.tsx, `AddWorkoutSheet`,
`ScheduleTogetherSheet`, `SaveProgressSheet`, quick-workout.tsx) already had a `try/finally` or
`.catch()`/`.finally()` wrapping the full async chain — confirmed safe on inspection, not just
absence-of-evidence. **Six real instances of this pattern in three weeks, all fixed on discovery, is
now a large enough sample to treat as a systemic risk in this codebase's async-gating convention**,
not five (now six) unrelated bugs — worth a linting rule or a shared `useAsyncGate`-style hook next
time this surfaces again, rather than another one-off sweep.

### Apple Health export — REMOVED 2026-08-24 (App Review 2.5.1)
Shipped 2026-07-22 as a one-way, write-only, opt-in HealthKit export (`lib/appleHealth.ts`,
`@kingstinct/react-native-healthkit` + its config plugin, a Settings toggle, and a best-effort call
from `workout-complete.tsx`). **Removed in full** after App Review rejected 1.0 (29) under Guideline
2.5.1: "the app uses the HealthKit or CareKit APIs but does not clearly identify the HealthKit and
CareKit functionality in the app's user interface." The functionality was real and the toggle was
plainly labelled, but the whole surface was a single row in Settings — arguing its prominence would
have cost a review round (plus a device screen recording the founder can't easily produce), against
a feature that was default-off with no users. Apple's own message names removing HealthKit from the
binary as a resolution, so that is what was done: plugin, dependency, module, Settings row, and call
site all deleted.

Worth recording for whenever this is rebuilt: the config also declared
`NSHealthShareUsageDescription` — a **read** permission the app never requested (authorization only
ever asked `toShare: ['HKWorkoutTypeIdentifier']`) — whose text read "Arclo does not read any Health
data." A binary that declares read access while stating it does not read is exactly the kind of
signal this guideline exists to catch. If Health support returns, it needs its own visible surface
(a Health section or an in-flow prompt, not one settings row) and only the usage descriptions for
permissions actually requested.

### "Replay app tour" now dismisses Settings first; why-tempo.tsx made scrollable (2026-07-21)
Two small onboarding/tutorial polish fixes:
- Settings' "Replay app tour" row used to `router.push('/(tabs)')` after resetting the tour, but
  Settings is a **modal** pushed on top of the tabs — the push landed underneath the still-open
  modal, so the tour was invisible until the user manually swiped/backed out of Settings
  themselves. Now dismisses the modal stack first (`router.dismissAll()`, the same pattern already
  used for sign-out and account-deletion) before `router.replace('/(tabs)')`.
- `onboarding/why-tempo.tsx` (the "most apps just log workouts" differentiator screen) wrapped its
  entire content column — title, subtitle, the schedule animation, and a card with two connect
  buttons — in a plain fixed `View`, not a `ScrollView`. On a smaller phone or with larger Dynamic
  Type that content could run past the bottom of the screen with no way to reach it or Continue —
  the same bug class as an already-fixed instance in `MASTER_FIX_PLAN.md` (a workout-summary card
  that had no ScrollView). Now wrapped in `ScrollView`, matching every sibling onboarding step
  (`goal.tsx` etc.).

### Swept the app for the same "content clips off-screen" bug class (2026-07-21)
Following the why-tempo.tsx fix, an audit of every screen/sheet found two more confirmed
instances of the same bug (a stacked content column with no `ScrollView`, so it can run off the
bottom of the screen on a smaller phone or with larger Dynamic Type):
- **`calendar-setup.tsx`** — the subtitle, optional reconnect banner, both calendar cards (Google
  + Device, one with a Pro-gated "choose calendars" sub-row), and the hint text were all in a
  plain `View` styled `styles.scroll` — named for scrolling but never actually a `ScrollView`.
- **`components/RecoveryCheckIn.tsx`** — the largest instance found: 4 metric rows (label + 5-way
  scale + hints) plus the readiness preview and Save button, inside a `TempoSheet` capped at 90%
  height with no `scroll` prop — the save button itself could be unreachable.

Both fixed (real `ScrollView` / `TempoSheet scroll` prop). Also added the `scroll` prop
defensively to four shorter sheets flagged as lower-risk by the same audit
(`PlateCalcSheet`, `ShareCardSheet`, `GoChooserSheet`, `SaveProgressSheet`) — free safety net,
no visual change for content that already fits.

### Notification settings: fixed master-toggle revert, collapsed the per-type list (2026-07-21)
The master push switch (`app/settings.tsx`'s `togglePush`) used to unconditionally re-fetch
`getMasterPushEnabled` after every toggle and trust whatever it read — so a failed/dropped write
(silently swallowed by `.catch(() => {})`) surfaced as the switch mysteriously "sliding back" to
its old value with no explanation. Fixed at the source: `notificationPrefs.setMasterPushEnabled`
and `pushTokens.setPushEnabled` now both report whether their write actually succeeded, and
`togglePush` trusts the optimistic value on success (no re-fetch) or explicitly reverts **with an
`Alert`** on a genuine failure — no more silent, unexplained reverts. Turning the switch ON when
OS notification permission was already denied is its own case: iOS never re-shows its own prompt
once denied (`requestPermissionsAsync` just resolves `'denied'` again instantly), so an in-app
toggle literally cannot fix that — `setPushEnabled` now returns `'permission_denied'` for this
case specifically, and the switch reverts with an `Alert` offering **"Open Settings"**
(`Linking.openSettings()`), the only place that can actually grant it.

Also: the 7-row per-type notification list (pre-workout, missed workout, streak-at-risk, weekly
report, free-time, partner reminder, friend competition) used to render unconditionally beneath
the master switch, which read as clutter for anyone who just wanted the one on/off toggle. It's
now collapsed behind a **"Customize notification types"** disclosure row (`showNotifDetails`
state) that only expands the list when tapped.

### PR strength trend: bars → line (2026-07-21)
`exercise-progress.tsx`'s per-session est-1RM chart now reuses **`SvgLineChart`** (the same
line+area primitive as the Progress tab's weight trend) instead of a per-session `SvgGrowBar`
column — a rising/falling line reads "am I getting stronger" faster than a bar row. The date-label
strip beneath the chart and the latest-session value callout above it are unchanged; only the
chart primitive changed. `SvgGrowBar` stays in use elsewhere (Progress tab's volume chart).

---

## 8. Known gaps / roadmap
- ~~No monetization anywhere (no paywall / subscriptions / billing)~~ **Built, shipped DORMANT
  (§10)**: RevenueCat via `react-native-purchases` + `-ui` (`lib/purchases`), the entitlement store,
  Profile Upgrade + Customer Center rows, and a post-first-workout paywall trigger — the ENTIRE
  system is gated behind the `app_config.pro_enabled` remote flag (`lib/proConfig`), defaulted OFF,
  so the public v1 is free-only and Pro turns on later with one SQL update (no rebuild/resubmit).
  While dormant every gate is unlocked, so the free app is unchanged. **Native module → needs an
  `eas build`.** **Now delivered (Depth & horizon model):** a **custom on-brand paywall**
  (`app/paywall.tsx`, dynamic pricing from the current offering — monthly/annual, auto-computed
  savings, trial CTA, Restore, Terms/Privacy), the `proFeatures` registry + `ProGate`/`ProLockCard`/
  `ProBadge` gating primitives. **B2.1 re-fenced the gate** (analytics doesn't convert; scheduling
  does): Advanced Analytics (volume trends + strength-trend deep-dive on Progress) is now **free**;
  the **first real gate is "Reschedule my whole week"** (`schedule_optimization`, Home's one-tap
  full-week re-plan — B1.3b) plus the pre-existing Muscle Intelligence gate. The free, always-on
  background auto-scheduler stays free — only the on-demand full re-plan is Pro. The engine stays
  FREE (plan generation, adaptation, quick workouts, logging, ambient scheduling, basic progress) so
  free is fully functional. Dashboard prerequisites: the entitlement
  (`EXPO_PUBLIC_PRO_ENTITLEMENT`, currently `Tempo: Fitness Planner Pro` — must match exactly) +
  monthly ($4.99) / annual ($34.99) products in a **current offering** + Customer Center config; real
  `appl_` key is in `eas.json`. **Fast-follow Pro surfaces** (registry entries already stubbed, each a
  `<ProGate>` wrap away): muscle-group analysis + PR forecasting, long-horizon/goal-date planning,
  premium themes + app icons, and **Tempo Coach** (the tentpole). Migration `add_app_config.sql`.
- ~~Guests had no discoverable way to save their history off-device (data loss on reinstall/new
  phone)~~ **Done (§1.1)**: `lib/accountLinking` + `SaveProgressSheet` — a guest-only "Save your
  progress" card on Profile plus a one-time modal after the 3rd completed workout, both linking an
  Apple/Google identity onto the anonymous account via `linkIdentity()`. (Server-side prerequisite:
  "manual linking" enabled on the Supabase project — the calendar guest-link already relies on it;
  Apple *web* OAuth needs a Services ID in Supabase Auth for the Apple button specifically.)
- ~~Notification controls were all-or-nothing~~ **Done (§6.1)**: per-rule switches in Profile →
  App (`lib/notificationPrefs` + the retention-push filter) — mute one nag without silencing the
  rest. Server rules persist to `user_profiles.notification_prefs` (**migration
  `add_notification_prefs.sql` must be applied + the function redeployed**); the pre-workout
  reminder is device-local. All default on to preserve prior behavior.
- ~~A lapsing user's return was treated like any other day~~ **Done (§5.1)**: `lib/returningUser`
  drives a top-priority Home banner with 3/7/30-day states — resume the next session, one-tap into
  recovery mode (`applyAdaptationMode`), or a plan re-check (Change Plan) — all from existing data.
- Free-time-gap push uses a daytime heuristic (true calendar free/busy needs backend calendar sync).
- Progress-photo gallery / before-after compare (capture + storage exist; no timeline UI yet).
- HealthKit / Google Fit import; Apple Watch.
- ~~No automated test suite yet~~ **Started (§4.2/§11.2), extended into integration coverage (B5.5,
  2026-07-16, extended same day)**: Jest + ts-jest, 184 tests across 17 suites. `src/lib/__tests__/`
  covers the deterministic core (periodization — one deload/4 weeks; progression autoregulation +
  duration math + the B5.4 volume-landmark cap; the exercise classifier; streak continuity;
  goal-projection ETAs) and the **`planRollover`** cliff regression (horizon never < 7 days, no
  duplicated/dropped `week_index` — the "4-week plan cliff," one of the audit's three named recurring
  bug classes). `npm test`. Config: `jest.config.js` + `tsconfig.jest.json` (transpile-only via
  ts-jest; the app's own `tsconfig.json` excludes `src/**/__tests__`). **B5.5 added integration-style
  coverage for the other two named bug classes**, via a small purpose-built in-memory fake Supabase
  client (`lib/__tests__/fakeSupabase.ts` — eq/gte/lte/lt/in/or filters + delete/update/insert/
  maybeSingle, NOT a general Postgrest mock) plus `jest.mock()` on any native-module import
  (`expo-notifications`, `expo-web-browser`/`expo-auth-session`, Sentry) so these files can load under
  plain Node: **`retireWorkouts.test.ts`** + **`missedWorkouts.test.ts`** lock the "poisoned Change
  Plan" bug (a stranded `scheduled` row blocking the next plan's insert — the delete-fails-fall-back-
  to-mark path, the FK-safe log-referenced partition, and the ONE shared commitment predicate both
  plan-generation and split-activation must never drift apart on) and
  **`services/googleCalendar/__tests__/CalendarApiService.test.ts`** locks "silent Google vanish"
  (every read-failure reason correctly maps to its fix hint via `describeReadError`, the 401-retry-
  once-then-give-up flow, and the no-token `not_connected` short-circuit). **Same-day extension:**
  **`lib/__tests__/splitSchedule.test.ts`** locks the OTHER caller of the shared sweep —
  `activateSplit` retiring a stranded plan/split row on the SAME date the new split needs before
  materializing it (the exact collision that poisoned Change Plan for the split-activation path, not
  just plan generation), plus `materializeSplit`'s idempotent insert-into-horizon and its refusal to
  ever materialize the auto-plan mirror. Still no real network/DB — these are fakes/mocks, not live
  integration tests — but they exercise the actual Supabase-glue
  code paths the pure-logic suite above deliberately excluded, which is exactly where the named bugs
  actually lived.
- ~~Progress tab rings/bars are hand-rolled `Animated.View`s, not real SVG~~ **Done**: `SvgProgressRing`
  (gradient stroke-dashoffset ring), `SvgLineChart` (the weight-trend math in `bodyMeasurements.ts`
  now actually has a chart, not just text numbers on Profile), and `SvgGrowBar` (gradient volume
  bars) all ship on `react-native-svg`. A small data-driven insight line ("+12% volume vs last
  week") sits under the volume chart — real deltas only, no generated copy.
- ~~Profile is not yet regrouped into clear sections~~ **Done**: split into Training / Social /
  Calendar & Scheduling / App / Account cards (was two mega-cards, "My Plan" + "Settings"). Username
  shows under the display name; avatar is tappable → real photo upload; Body Stats links out to the
  new Progress trend chart instead of duplicating it.
- ~~The same stats (streak / workouts / volume / badges), the achievements grid, and PRs render on
  both Profile and Progress~~ **Done**: Profile's stat grid, achievements grid, and PR card were
  removed. Progress is now the sole stats/achievements/PR home; Profile is identity + config, with
  the level/XP hero as its one glanceable stat. Body Stats (logging) and Exercise Swaps (config)
  intentionally stay on Profile.
- Exercise-library "too many hyper-specific variants" complaint: partially addressed (family
  collapse is now the default view + shortest-name tie-break for the representative); no further
  data-level curation/pruning has been done.

---

### Store screenshot frames — `brand-assets/make-store-frames.py` (2026-08-30)
Generates the marketing-framed store screenshots for both listings. **The rule the script exists to
enforce: the phone screen is always a real device capture, composited in — nothing inside the device
frame is drawn, regenerated or invented.** It replaced a set of AI-generated frames that had redrawn
the UI and invented a "Recovery by muscle" grid (Chest 92%, Back 78%…) that does not exist in the app,
duplicated a `W4` label in the volume chart, and re-typeset the Plan exercise list.

- **Layout** follows what the category actually does, checked against the live App Store listings for
  Fitbod, Hevy, Alpha Progression, Boostcamp, Ladder and Caliber via Apple's lookup API: short
  headline on top, large legible device below. No left-text/right-phone split, no icon bullet rail.
- **Rendered as one continuous strip** (`W × n` wide) and then sliced into panels. Each device sits
  right of its panel centre so roughly its last fifth crosses the seam and reappears at the left edge
  of the next frame, and a single blue sweep spans the whole set. Positioning six separate canvases by
  hand would drift and the seams would read as broken. **Frame order is therefore load-bearing** —
  reordering in either store breaks the crossings and needs a re-render.
- **Device auto-fit:** the panel's text block is measured first, then the device is shrunk until its
  bottom edge sits inside the canvas (so the app's tab bar is visible) *and* its top clears the
  headline. The blue sweep is alpha-ramped between 0.38H and 0.56H so it never runs behind type.
- Output 1284×2778, valid for the App Store `APP_IPHONE_65` set and for Play. Inter is vendored at
  `brand-assets/fonts/` (fetched from Google Fonts) so the frames match the app and the site. Copy
  lives in one `FRAMES` list at the bottom; `_carousel.png` is emitted alongside so the crossings can
  be judged before upload. Canonical output is committed at `brand-assets/store-frames/`.
- **App Store limitation, found by trying it:** `POST /v1/appScreenshots` returns **409** against a
  `READY_FOR_SALE` version — Apple locks screenshots once a version is live, and a new version needs a
  new build, so replacing them is a full review round. The Play listing carries the new set; the App
  Store keeps the plain captures until the next iOS version ships.

### Marketing site — `web/index.html` (built 2026-07-28 as `launch.html`, restyled + tightened 2026-07-29, **promoted to the live site 2026-08-30**)
**This is now the public page at `fittempo.app`.** It was built as `web/launch.html` alongside the old
pre-launch waitlist page, whose hero said "Coming soon to iOS & Android," whose every CTA was an email
capture, and which had no pricing, no store links, and no comparison against the category — a page that
asks a ready-to-download visitor for their email address, which on a launched app costs installs. With
Arclo live on both stores (App Store `READY_FOR_SALE`, Play production versionCode 12), the swap was
made: the waitlist page was deleted and `launch.html` renamed to `index.html`. The old page is
recoverable from git history if it is ever wanted back.

- **2026-08-30, the swap + real store URLs.** `STORE.ios` / `STORE.android` (top of the page's single
  `<script>` block) were the last two placeholders; both are now real and were verified to resolve
  before being committed: `https://apps.apple.com/app/id6785075737` and
  `https://play.google.com/store/apps/details?id=com.fittempo.app`. The iOS one is deliberately the
  locale-free `/app/id<id>` form — Apple redirects it to the visitor's own storefront, where a
  hardcoded `/us/` link would not. Six `[data-store]` anchors across the page (hero, final CTA, footer)
  all read from that one constant, and the existing guard still stands: a non-`http` value makes every
  button fall back to `#get` rather than shipping a dead link. Verified in a browser, not just by
  reading the diff — all six hrefs rewritten, `target="_blank"`, no horizontal overflow at 1920px,
  no `REPLACE_WITH` left in the DOM. **Still open on this page:** the ratings strip and testimonial
  rail stay commented out until there are real numbers and real quotes.
- **2026-08-30 (b), the seven phone frames filled with real captures.** `web/img/shots/*.webp` — the
  live Play listing's own screenshots, pulled at full resolution through the Publishing API and
  downsized to 560px wide (WebP q82, 224KB for all seven, from ~2.4MB of source PNG). Not mockups and
  not built HTML, per the standing rule against fabricated app screens. The frames render at 274×596
  CSS px and the captures are 1179×2556 / 1284×2778, so `object-fit: cover` with `object-position:
  top` crops almost nothing; the `.notch` pill sits over the empty middle of each capture's real
  status bar, which is why the status bar was deliberately *not* cropped out. Mapping: hero centre
  `home`, hero left `adapt`, hero right `quick`, The schedule `plan`, The session `session`, The
  adaptation `body`, The proof `progress`. Three of the original wish-list screens (Streaks & badges,
  Exercise library, the post-workout RPE prompt) are not in the store set and were re-cast rather than
  invented; The adaptation row deliberately got the muscle-recovery map, since "it reads the week you
  actually had" is what that screen shows, and the reschedule prompt moved to the hero cluster where
  the wedge belongs. The hero's three images are `loading="eager"`; the four feature-row ones are
  `loading="lazy"`. **The two side-panel images stay eager on purpose** — they are `display:none`
  below the tablet breakpoint, so lazy would save a little mobile bandwidth, but a test showed a
  browser can defer them and leave the hero's side panels blank on first paint, which is a worse
  trade than ~56KB. The `.shot-placeholder` / `.side-placeholder` CSS is left in place, unused, as the
  documented fallback. Verified in a browser: all seven load (`naturalWidth` 560, no errors) and every
  frame paints.
- **Deployment:** `.github/workflows/` has **two identical workflows** (`static.yml` and `deploy.yml`),
  both named "Deploy to GitHub Pages", both triggered on push to `main`, both uploading `./web`. One is
  redundant and they race on every push. Left alone rather than fixed drive-by; worth deleting one.

- **2026-07-29, fifth pass: two sections cut for reading as generic and defensive.** The founder's own
  read of `#pricing`'s two upstream neighbors: the "Six more things that shipped with it" numbered list
  (Quick Workouts, splits, muscle intelligence, Travel Mode, friends/groups, PR forecast) was "basic UI,
  unnecessary" — a completionist feature-dump the 4 main rows and the Pro pricing list already cover
  (the 3 Pro items in that list are also in the pricing card's own bullet list, so nothing is actually
  lost by cutting it). The "Where Tempo sits" comparison table (trackers vs. coached apps vs. Tempo,
  7 rows) was "trying to prove something" — a textbook generic SaaS us-vs-them grid, and one that
  restated the exact argument the earlier problem/compare section (`#how`'s two-card layout) already
  made, just in table form. Making the same differentiation case twice, once as a confident statement
  and once as a defensive grid, undercuts the first, more natural version. Both removed outright: HTML,
  CSS (`.more-list`/`.more-row`/`.more-n`/`.more-ic`/`.more-body`, `.table-scroll`/`.cmp-table`/`.cell`),
  and their one 640px responsive override. `#features` now flows directly into `#pricing` with nothing
  between them, confirmed via `nextElementSibling` walk, not just visually assumed.
- **2026-07-29, fourth pass: feature rows loop-fade, no divider between them, category labels off mono.**
  Three small requests against `#features` (the "Inside Tempo" schedule/session/adaptation/progress
  rows). First, `.frow + .frow`'s `border-top` divider is gone; Fitbod's reference keeps its feature
  blocks flowing together on whitespace alone, no hairlines between them (row padding trimmed slightly,
  `clamp(48px,6vw,76px)` → `clamp(32px,5vw,56px)`, since the divider isn't doing the separation anymore).
  Second, the small category labels ("The schedule," "The session," "The adaptation," "The proof") move
  off `--font-mono` onto `--font-body` (Inter) at 12.5px/700 weight with lighter letter-spacing and no
  pill background, a scoped `.frow .tag` override so the `.tag`/`.tag-blue` etc. classes used elsewhere
  (Pro badges, the compare-card pills) are untouched. Third, and the bigger change: those same 9
  `[data-sr]` elements inside `#features` (the section heading plus all 4 `.fr-copy`/`.device-wrap`
  pairs) now use a second `IntersectionObserver` that toggles `.in` both ways
  (`e.target.classList.toggle('in', e.isIntersecting)`, no `unobserve`) instead of the site-wide
  reveal-once-and-stay behavior every other `[data-sr]` element still uses — they fade out again on the
  way past and fade back in if you scroll back up, matching Fitbod's felt interaction where the section
  content is alive to your scroll position rather than a one-shot entrance. **Honestly only partially
  verified:** the CSS/markup changes (font, no divider, correct element partitioning: 9 elements scoped
  to `#features` vs 19 elsewhere) were confirmed directly; the live fade-out-then-back-in couldn't be
  watched end-to-end in-browser this session because the automation tab reported
  `document.visibilityState: "hidden"` throughout (even after a click brought `document.hasFocus()` to
  `true`), which throttles `IntersectionObserver` callbacks independent of the page's own code. Manually
  removing/re-adding the `.in` class confirmed the CSS opacity transition itself is wired correctly;
  the observer logic is the standard toggle idiom and should behave normally in a real, foregrounded
  browser tab. Worth a real on-device or foregrounded-tab check before calling this fully proven.
- **2026-07-29, third pass: treated as the live launch page, not a "coming soon" teaser.** The founder's
  own read: the store-link "soon" ribbon (`.store.is-pending`) and the notify-form waitlist fallback
  (`#notify-wrap`, the `formgrid.dev` POST) don't belong on the launch site itself, only on `index.html`.
  Both removed entirely, HTML/CSS/JS. `STORE.ios`/`STORE.android` still need real URLs before publish
  (unchanged requirement); until then the store buttons simply link to `#get`, no visible badge or
  fallback form. Also removed the calendar-privacy section (`.privacy-panel`) outright: the founder's
  view is that calendar privacy isn't a headline feature people are choosing the app for, so a dedicated
  section forced it. The hero's three-line trust checklist dropped its "reads free/busy only" line for
  the same reason (now 2 lines, not 3); the privacy FAQ answer stayed, tightened, since a direct question
  still deserves a direct answer, it just isn't sold as a feature anymore. FAQ's own heading ("Straight
  answers.") was cut too, called out by name as an unnecessary flourish; the section is now just labeled
  "Questions." A full copy pass removed every em dash from the visible copy (commas, colons, or a second
  sentence instead) and trimmed several paragraphs for length without losing the specific claims.
  Scroll-reveal softened for a smoother settle (`translateY(14px) scale(0.987)`, 0.9s, up from a flatter
  0.75s slide), and the hero copy now fades in on load via its own staggered CSS keyframe (`.hero-copy`)
  since it's above the fold and never scrolled into view for the existing IntersectionObserver reveal.
- **2026-07-29, second pass: rebuilt toward the reference look of fitbod.me.** The founder liked
  fitbod.me's look and feel specifically and asked for it: flatter dark navy (`--bg:#15161F` up through
  `--raised:#2E3140`) replacing the old near-black "Ink Instrument" ramp (`#0B0C0F`); one accent color
  used sparingly, **kept Tempo's own `#4E8BFF` blue rather than switching to Fitbod's coral**, a
  deliberate call so the site still matches what the actual app looks like, not a literal clone of the
  reference; no ambient radial-gradient glows behind the hero or final CTA; no floating availability
  pill above the hero headline; hero headline bold/uppercase (`text-transform:uppercase` on `.hero h1`,
  still Bricolage Grotesque, no new font added) in Fitbod's short two-line benefit-statement rhythm
  ("LESS SCHEDULING. MORE TRAINING." replacing the more whimsical "Your week just changed...").
- **Every phone-mockup screen is an honest blank placeholder, not built fake UI.** The hero's animated
  live day-timeline (the four-state "gap found, session placed, conflict, moved" story, HTML+CSS+JS)
  and all four feature-row phone screens (fabricated exercise names/weights/stats) were removed
  entirely, the founder's own read was that invented data presented as screenshots is dishonest in
  exactly the way the ratings/testimonial blocks were already disciplined about. Replaced with a shared
  `.shot-placeholder` component: the real device-frame chrome (`.device`/`.device-screen`/`.notch`)
  stays, filled with a calendar-icon glyph and "App screenshot" label. **Fill these in with real device
  screenshots before publishing**, same discipline as the store badges and the ratings block.
- **"Everything else" section is a numbered editorial list, not a card grid.** The six supplementary
  features (Quick Workouts, splits, muscle intelligence, Travel Mode, friends & groups, PR forecast)
  render as a divided list with a mono index number (01 to 06, blue for Pro rows) instead of the
  identical rounded-card 3-column grid every AI-generated landing page defaults to, same content, no
  card-repetition or 3-col-grid template feel.
- **2026-07-29, first pass: three template-feeling sections removed.** Also gone, same day, earliest
  pass: the auto-scrolling capability marquee right below the hero; **`#plan-it`**, the interactive
  goal/days/lifestyle/session-length week planner (engine-faithful, mirrored `lib/generatePlan.ts`'s
  split templates and `chooseDaySlots()`'s stride spread, but the founder judged it unnecessary next to
  the hero's own demo); and the "Your first four weeks" dotted-timeline onboarding section. Nav, drawer,
  and footer links to `#plan-it` removed with it. The page now reads Hero → problem/compare → four
  feature rows (screenshot placeholders) → pricing → FAQ → CTA, after the fifth pass below also cut
  the supplementary-features list and the comparison table that used to sit between features and pricing.
- **Claims are sourced, not invented.** Free-tier limits and the Pro list come from `lib/proFeatures.ts`
  (`PAYWALL_POINTS`) and `paywall.tsx`'s `COMPARE`, so the site cannot advertise something the app
  doesn't ship, the same App-Store-rejection rule that governs the in-app paywall. Pricing is
  $4.99/mo · $34.99/yr with the flat $24.99 founding first year (`STRATEGY_PLANS.md` §A, 2026-07-27),
  described as a **paid intro offer, never a "free trial"**, because that's what it is.
- **No fabricated social proof.** Star ratings and testimonials are the two things a launch site
  normally invents. Both ship as clearly-marked commented-out blocks (`RATINGS BLOCK` /
  `TESTIMONIAL BLOCK`) to be filled with real numbers and permissioned quotes.
- **Store links are a single config.** `STORE.ios` / `STORE.android` at the top of the script. Until
  they're real URLs the buttons just link to `#get`, no dead link ships and no fallback form is needed.
  The badges themselves are hand-drawn approximations (the file stays dependency-free); **swap for
  Apple's and Google's official artwork before launch**, both stores require their own assets.
- **Same constraints as the rest of `web/`:** one self-contained file, no bundler, no framework, served
  as a static asset by GitHub Pages. Verified in-browser after every removal: no horizontal page scroll,
  mobile drawer, FAQ accordion, and every remaining `data-sr` scroll-reveal element all working, zero
  console errors on load. `--cal-work`/`--cal-personal`/`--cal-school`, `--glow`, `.pill`/`ping`-keyframe
  CSS, the privacy-panel/notify-form CSS/HTML/JS, and (fifth pass) the everything-else-list and
  comparison-table CSS/HTML were all removed as dead code, not left behind unused.

### Startup speed + Quick Workout curation fixes (2026-08-11/12, founder-reported)

**Home's app-open sweep, parallelized where safe.** The sweep (`(tabs)/index.tsx`'s single mount
`useEffect`) runs ~13 steps on every sign-in; most have real, documented read-after-write
dependencies (dedupe → missed → adaptation → extend → autoschedule, the exact chain behind the old
F1/F5 plan-cliff bug) and stayed sequential on purpose — untouched here. Two tail pairs turned out to
write disjoint columns with no dependency between them and now run via `Promise.all`, each still
fully finished before anything downstream reads the schedule:
- `syncTravelSchedule` (writes `exercise_ids`/`exercise_config`/`travel_restore` only) +
  `resolveCalendarConflicts` (writes `planned_date`/`planned_start_time` only) — verified disjoint by
  reading both implementations.
- `syncUpcomingWorkouts` (calendar `calendar_event_id`/provider only, remote) + reminder
  reconciliation (local notifications only, keyed off focus/time/duration/status) — neither reads a
  field the other writes.
Cuts several sequential network round-trips off every cold sign-in without touching the sensitive
sequential core. `(tabs)/_layout.tsx`'s `lazy: false` (all 4 tabs mount + fetch together) and the
font-load gate in `_layout.tsx` are the other two contributors to a slow first entry, both identified
but left alone this pass — no safe, scoped fix for either without more founder input on the tradeoff
(instant tab-switching vs. cold-start fetch count; app-wide font gate vs. a flash of system font).

**Quick Workout: "always gives Core no matter what I select" (`lib/quickWorkout.ts`).** Root cause:
the curated `is_core` staple pool (~60 hand-picked exercises, deliberately small per its own
in-schema comment: "the plan/quick-workout engines only program from this pool") has **zero**
genuinely no-apparatus "pull" exercise at all — every curated pull movement needs a bar, dumbbells,
barbell, or cable. A no-equipment "Back" or "Arms" Target Area request filtered the curated pool down
to empty, and the code silently fell through to the *unfiltered* pool (dropping the muscle target
entirely) — which for a bodyweight-only candidate set skews heavily toward Plank/Dead Bug-type Core
moves, since Core is the pattern with the most curated no-equipment options. Same starvation
independently produced "not enough exercises for a long workout" for any thin target+equipment
combo (e.g. a 1-exercise Arms session). Equipment matching itself (`lib/equipmentMatch.ts`'s
`expandEquipment`/`canPerform`/`needsApparatus`) was already correct — bodyweight is always implicitly
available and apparatus moves (pull-ups, dips, hangs) are already gated behind `pull_up_bar` — the bug
was pool depth, not equipment logic. Fix: `generateQuickWorkout` now widens to the full ~1300-exercise
imported library — muscle-filtered the exact same way — whenever the curated, muscle-filtered pool
alone can't fill the requested length (`maxExercisesFor(minutes)`, extracted and shared with
`selectExercises`). This only ever *adds* candidates, and only when a real Target Area is active, so a
well-equipped user whose curated pool is already sufficient sees no behavior change (still prefers the
higher-quality staples). Only if literally nothing anywhere matches the muscle target does it fall
back to a full-body pick, same as before. Covered by 2 new tests
(`__tests__/quickWorkoutPoolWidening.test.ts`): a no-equipment Back request now returns real back
exercises pulled from the wider library instead of leaking Core, and a well-stocked curated pool is
left untouched (no widening) for a short session.

**Missing foreign-key indexes added (`supabase/add_missing_fk_indexes.sql`), applied live, same sweep
as the RLS fix below.** The advisor's 11 `unindexed_foreign_keys` findings, closed — standout was
`user_plans.user_id`, which had NO index at all despite `(tabs)/index.tsx`'s `block_phase` query
filtering on it directly on every cold start. Verified via a fresh advisor re-run: all 11 gone (now
`unused_index`, expected — real traffic is still ramping up pre-launch). Deliberately NOT touched:
`multiple_permissive_policies` (10 warnings, `groups`/`workout_templates` each have an `ALL`-scoped
owner policy overlapping a `SELECT`-scoped member policy — fixing cleanly means splitting the `ALL`
policy into separate INSERT/UPDATE/DELETE policies, since Postgres RLS has no "every command except
SELECT" shorthand; more surface for a minor win, skipped this pass) and the two client-side speed
levers named below this same session (`lazy: false`, the font-load gate) — both real, but touching
`lazy: false` risks reintroducing this exact codebase's own repeatedly-proven "blank until you
revisit" bug class, so it stays a founder decision, not a blind fix.

**RLS performance: `auth.uid()` wrapped as `(select auth.uid())` across every policy that used it
(`supabase/optimize_rls_auth_uid_initplan.sql`), applied live.** Found via Supabase's own advisor, not
a founder report — 41 policies across ~20 tables (including the highest-row-count ones:
`scheduled_workouts`, `set_logs`, `workout_logs`, `user_plans`) called `auth.uid()` bare inside
USING/WITH CHECK, which Postgres can't prove is stable for a statement when written that way, so it
re-evaluates the function PER ROW scanned instead of once per query. Wrapping the identical call as
`(select auth.uid())` lets the planner cache it as an InitPlan — same access-control outcome, cheaper
plan, no behavior change. Applied via `ALTER POLICY` (touches only the clause given, so a policy with
no `WITH CHECK` before still has none — never widens what a policy checks), verified by re-running the
advisor: all 41 `auth_rls_initplan` warnings gone, nothing new introduced. Two related, smaller findings
from the same advisor sweep were deliberately left alone this pass (flagged, not fixed): 10
`multiple_permissive_policies` warnings (`groups` and `workout_templates` each have two overlapping
SELECT policies that could be consolidated) and 11 `unindexed_foreign_keys` (INFO-level, already
tracked under this doc's Engineering Architecture note on `schema.sql` having zero indexes).

**Cold-start "asks to sign in, then bounces back to Home" (`stores/auth.ts`), founder-reported live — fixed,
then the fix itself caused a worse regression, then REVERTED same day.** Original report: a slow network's
token-refresh round trip (`getSession()`) can genuinely take longer than the cold-start safety net's flat 5s
timeout — the timeout fired first with `session` still `null`, `(tabs)/_layout.tsx` redirected to `/sign-in`,
and the real result landed moments later and bounced the user straight back to Home. First fix: a
`tempo.hadSession` localStorage flag extended the timeout to 20s for any device that had signed in before,
leaving the fast 5s path unchanged for a genuinely fresh device. **That broke something worse, same day**: both
cold-start gate views (`(tabs)/_layout.tsx`, `onboarding/_layout.tsx`) render a bare, indicator-less rectangle
for as long as `loading` is true — so the founder's OWN device (permanently `hadSession=true` after their
first sign-in) could now show up to 20s of seemingly frozen blank screen on every cold start instead of 5,
reported the same day as "doesn't load when I first get on, but killing it and reopening works" — the exact
symptom this safety net exists to prevent, made MORE likely by widening it. **Reverted**: the timeout is back
to a flat 5s always (the `hadSession` mechanism removed entirely — dead code once nothing read it, not left
"for later"). The original flash-then-bounce complaint is accepted as the lesser problem; recovering fast
from a genuine wedge matters more. Addressed the flash-then-bounce case differently instead: both gate views
now show a real `PulseLoader` spinner (they never had one, even before any of this) rather than a bare
rectangle, so even the worst-case 5s wait reads as "loading," not "broken" — fixing the actual perception
problem rather than trading timeout durations against each other.

**GIF thumbnails re-fetching on every visit (`components/ExerciseThumb.tsx`, `ExerciseFormSheet.tsx`),
founder-reported ("GIFs take so long to load").** Unlike `ExerciseMedia` (the Home/session-runner form-guide
clip), `ExerciseThumb` (every list row in the exercise library/picker/builder) and both `<Image>`s in
`ExerciseFormSheet` (the manual-builder search preview) never set an expo-image `cachePolicy` — so the
decoded GIF was never persisted to disk, and re-opening the same screen re-fetched the same handful of
exercises from Supabase Storage every time. All three now set `cachePolicy="memory-disk"`, matching
`ExerciseMedia`'s existing policy. **Not the full fix**: the underlying GIFs themselves are un-resized
ExerciseDB originals (`scripts/backfill-exercise-media.mjs` uploads them as-is, no compression/resizing) —
a genuinely first-time fetch of a large GIF is still slow on a bad connection. Re-encoding/resizing the
~700 already-uploaded files is a real follow-up (needs the RapidAPI-backed backfill pipeline + image
tooling + confirming whether Supabase Storage image transforms are enabled on this project), deliberately
not attempted blind this session — a wrong guess there risks silently breaking media (e.g. an unsupported
animated-GIF transform flattening to a static frame) rather than just being slow.

**Quick Workout duration slider — thumb no longer jumps (`components/Slider.tsx`).** The thumb's
rendered position was driven entirely by the committed `value` prop, which `onChange` only ever
updates to a `step`-snapped number (5-minute increments on a 5–60 range = 12 possible positions) — so
dragging looked like the thumb hopping between stops instead of gliding with the finger. Fixed by
tracking the raw, continuous finger position in local state (`dragRaw`) purely for rendering
(thumb/fill/bubble left%) while a drag is active; the committed `value` (and therefore `onChange`/
`onSlidingComplete`) still only ever changes in `step` increments, unchanged from before — this was a
render-smoothness fix only, not a change to what gets selected. **Second bug fixed (2026-08-13),
founder-reported ("can't scroll through the whole thing without it stopping"):** every
`onPanResponderMove` re-read `e.nativeEvent.locationX`, a known-unreliable signal on a fast/wide
drag (RN re-derives it per event rather than tracking it continuously, and it can desync from the
actual finger position). Fixed by reading `locationX` only once, at grab time, into a ref, then using
the gesture's own `dx` (cumulative delta from grant — tracked independently and reliably by
PanResponder) for every subsequent move. Standard, minimal-diff pattern for a PanResponder-based drag;
same capture-phase gesture claiming from the 07-19 fix is untouched.

**Transient-failure tolerance: `lib/fetchWithRetry.ts` (2026-08-14), wired into both Supabase clients.**
Added after App Review rejected the app under Guideline 2.1(a) ("error message displayed when we
completed onboarding"). Root cause, from the reviewer's own edge log: a ~1-minute Supabase **API
gateway** outage — every request from their device returned 503, including onboarding's
`POST /rest/v1/user_profiles`, leaving their account with no profile row. Postgres was healthy
throughout (cron + checkpoints normal, zero errors), so this was the gateway, not the database, and it
self-recovered. The app's defect was having zero tolerance for it: one 503 → `describeSaveError`'s
`'server'` branch → a dead-end alert mid-onboarding. `fetchWithRetry` is passed as `global.fetch` to
`createClient` in both `supabase.native.ts` and `supabase.ts`, with deliberately asymmetric rules
because a retry that re-sends a landed write is worse than the error it fixes: **502/503** retried for
any method (the gateway provably never reached Postgres, so the request had no effect); **504 and
network-level throws** retried for **GET/HEAD only** (ambiguous — the write may have succeeded with
only the response lost); **4xx and 500** never retried (a real answer, and a 500 may have partially
executed). Up to 3 attempts, 400ms/1200ms backoff. Covered by `__tests__/fetchWithRetry.test.ts`,
which pins the non-retry cases as hard as the retry ones.

**App-open performance: four measured bottlenecks fixed (2026-08-14).** Diagnosed from the live
Supabase request log for the founder's account (~26s between the first request on open and Home's data
actually loading), not from reading code:
- **`lib/travelSchedule.ts` — the big one.** With travel mode on, every upcoming plan/split session was
  rewritten on *every* app open: ~25 single-row PATCHes `await`ed sequentially (~140ms each), storing
  values identical to what the row already held, because nothing checked whether a row was already
  adapted. Added `sameIds()` no-op detection (a steady-state open now writes zero rows), batched the
  remaining writes with `Promise.all` instead of awaiting each, and reordered so the cheap
  `getActiveTravelMode` check runs *before* the upcoming-workout fetch — when not travelling and no row
  carries a `travel_restore`, the whole path (including the ~1300-row exercise-pool download) is
  skipped. Locked by `__tests__/travelScheduleNoop.test.ts`.
- **`(tabs)/index.tsx` — unconditional invalidation.** The sweep called `invalidateTrainingData()` every
  run, marking ~14 query roots stale and making Home refetch nearly everything a second time on every
  open. Now each step reports whether it wrote and invalidation is guarded on that. This required
  `lib/adaptation.ts`'s `refreshAdaptation()` to return `{ mode, wrote }` instead of a bare mode — its
  restamp previously had "no tracked count", which was the stated reason the invalidation was
  unconditional. Both other callers ignore the return value, so the shape change is safe.
- **`(tabs)/index.tsx` — sweep timing.** The sweep started immediately on mount, racing the queries that
  render the screen. Now deferred behind `InteractionManager.runAfterInteractions` (with a `cancelled`
  guard + `handle.cancel()` on unmount). Nothing in the sweep is needed for first paint.
- **`stores/auth.ts` — the sign-in flash, root-caused.** `getSession()` refreshes an expired access
  token *before resolving*, and the entire UI was gated on it — so on a cold start the app waited on a
  network round trip, the 5s safety-net timeout fired first with `session` still null, `(tabs)/_layout`
  redirected to `/sign-in`, and the refresh landing bounced the user to Home. Since
  `lib/supabase.native.ts` passes `storage: localStorage` (the **synchronous** SQLite-backed shim),
  the persisted session at `sb-<project-ref>-auth-token` is readable with no network and no await —
  `readPersistedSession()` seeds the store so the app renders instantly, while `getSession()` still runs
  and remains the authority. Deliberately only applied when a cached `onboarding_complete` profile also
  exists, since the tabs gate routes on that field; without both it falls through to exactly the old
  behavior.

**Two migrations found never-applied to production (2026-08-14), causing real 400/404s on every
session — `add_notification_prefs.sql` and `add_recovery_checkins.sql`.** Founder-reported "none of the
features load"; checked live Supabase edge logs filtered to the app's own traffic and found
`user_profiles?select=notification_prefs` returning 400 (column doesn't exist) and `recovery_checkins`
returning 404 (table doesn't exist) on every app session. Both migrations existed correctly in the repo
and simply had never been run against the live project — confirmed via `list_migrations` (neither
appears in the applied list) and direct `information_schema` checks. Same failure class as the
previously-caught PostHog-key/Sentry-token gaps: a file existing in the repo says nothing about
whether it ever reached production. Applied both live (no code changes — the files were already
correct), verified the column and table now exist. Side effect also fixed: the hourly `retention-push`
cron function's own per-user profile query used the same non-existent `notification_prefs` column, so
every rule-level notification opt-out has been silently ignored (defaults still applied, not a crash)
since whenever this gap opened — now reads real per-user prefs. Pure database fix, no app update
required. **Not done**: a full systematic audit of the other ~55 `.sql` files against what's actually
live — filename-matching against `list_migrations`' recorded names produces false positives (e.g.
`add_exercise_substitutions` doesn't literally appear in the applied list by that name, yet the table
demonstrably exists), so a real audit needs per-file schema-existence verification, not name-diffing.
Flagged as a real follow-up, not attempted rushed.

**Monetization: the paywall could no longer be a dead end (2026-08-19).** Founder report: the paywall
showed "Subscriptions aren't available right now" with a greyed-out CTA — minutes after PostHog shows a
purchase sheet opening fine on the same device (`purchase_started` at 17:36:12 on the annual package,
so packages had demonstrably resolved). The app could not say why, because the old loader read exactly
two fields (`offerings.current`, then `.annual` / `.monthly`) and turned everything else into a single
`null`. Three separate defects, all now fixed:
- **No retry.** `lib/fetchWithRetry.ts` hardened every *Supabase* call, but RevenueCat uses its own
  network stack and was never covered — one blip on `getOfferings()` permanently disabled purchasing on
  that screen. `lib/purchases.ts` now retries the offerings fetch up to 3 attempts (400ms/1200ms), the
  same shape as the Supabase policy; the call is a pure read, so a retry has no write hazard.
- **No fallbacks for two silent dashboard misconfigurations.** New pure module **`lib/proPlans.ts`**
  (`resolveProPlans`) falls back from `offerings.current` to any offering in `offerings.all` that has
  packages, and from the `.annual`/`.monthly` typed accessors — which are populated **only** for
  packages using RevenueCat's predefined `$rc_annual` / `$rc_monthly` identifiers — to `packageType`,
  then to the product's ISO-8601 `subscriptionPeriod`. Without that second ladder, an offering whose
  packages use CUSTOM identifiers returns a fully-populated `availablePackages` with both accessors
  null: products load and the paywall still shows nothing to buy. Split into its own module purely so
  it is testable — `lib/purchases.ts` `require`s the native SDK at import, which the deterministic-core
  Jest suite can't load. 10 tests in `__tests__/proPlans.test.ts`.
- **No recovery and no diagnosis.** The unavailable state now carries a **Try again** button and
  re-fetches automatically when the app returns to the foreground (guarded so a *resolved* paywall never
  re-fetches behind the user — a foreground event also fires when the native purchase sheet closes).
  Every failure reports a specific `PlansUnavailableReason` through the new `paywall_plans_unavailable`
  analytics event: `sdk_unavailable` / `fetch_error` / `no_offering` / `no_packages` (the App Store
  Connect signature — agreement not in effect, product not Ready to Submit, id mismatch) /
  `no_subscriptions`. The five used to be indistinguishable from outside the device.

Two adjacent correctness fixes in the same pass:
- **`restorePurchases()` now returns `{ isPro, failed }`** instead of a bare boolean. A restore that
  *couldn't run* (network failure) previously told the user "We couldn't find an active subscription on
  this Apple ID" — a factual claim the app had no basis for, on the one flow App Review always exercises.
- **A purchase that completes without unlocking** no longer says "you were not charged." `res.ok &&
  !res.isPro` (store transaction succeeded, entitlement not active on the returned customer info) now
  gets its own message pointing at Restore, which is the one thing that can actually fix it.

**F9a (RevenueCat entitlement-identifier mismatch) is closed — disproven, not fixed.** The long-standing
risk was that `EXPO_PUBLIC_PRO_ENTITLEMENT="Tempo: Fitness Planner Pro"` (eas.json) is a display name
rather than the dashboard's entitlement *identifier*, in which case every purchase would succeed and
nothing would ever unlock. It can't be: `purchase_completed` is tracked **only** when `res.isPro` is
true, i.e. only when `info.entitlements.active["Tempo: Fitness Planner Pro"]` resolved — and that event
fired on 2026-08-18T22:22:10Z. The configured string is the real identifier. `reportPossibleEntitlementMismatch`
stays as the standing alarm.

**OTA updates were shipping an app with no RevenueCat, PostHog, Sentry, or RapidAPI key (2026-08-19) —
`mobile/scripts/publish-update.sh`.** This is the actual cause of the "Subscriptions aren't available
right now" paywall, and it was self-inflicted. **`eas.json`'s `build.<profile>.env` is read by
`eas build`. It is NOT read by `eas update`** — an update resolves environment variables from the EAS
*environment variable store* for `--environment <name>`, a completely separate place. This project's
store holds only the Supabase pair, so every OTA published with a bare `eas update` produced a bundle
that was verified (by grepping the exported Hermes bundle against `eas.json`) to contain:

| Var | In OTA bundle | Consequence |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` / `_PUBLISHABLE_KEY` | ✅ present | — (which is exactly why this went unnoticed) |
| `EXPO_PUBLIC_REVENUECAT_KEY` | ❌ missing | `API_KEY` undefined → `configurePurchases()` no-ops → `loadProPlans()` returns `sdk_unavailable` → **nothing can be purchased** |
| `EXPO_PUBLIC_POSTHOG_KEY` | ❌ missing | `initAnalytics()` no-ops → **zero analytics**, so the failure above is invisible |
| `EXPO_PUBLIC_SENTRY_DSN` | ❌ missing | no crash reporting |
| `EXPO_PUBLIC_RAPIDAPI_KEY` | ❌ missing | the ~641 uncached exercises have no media source |
| `EXPO_PUBLIC_PRO_ENTITLEMENT` | ❌ missing | falls back to the code default `'pro'` — wrong for this dashboard |

Every one of those modules is deliberately written to **no-op safely without its key** (see each file's
header), which is correct for local dev and catastrophic here: the app looked fine while missing its
entire monetization and telemetry layer. It also retro-explains three earlier readings that were
wrong: `paywall_intro_offer` "never firing" was read as "the founder is still on the old bundle" when
PostHog was simply disabled; the same for a missing `paywall_shown`; and the founder's "GIFs take so
long to load" had a contributing cause nobody had named.

Fixed mechanically rather than by vigilance — `scripts/publish-update.sh <branch> "<message>"` reads
every `EXPO_PUBLIC_*` from `eas.json`'s matching build profile, exports it into the process so Metro
inlines the same values a native build gets (an already-set variable wins, so a deliberate override
still works), hard-fails if any of the four load-bearing keys is empty, and then runs `eas update`.
**Always publish through it; never call `eas update` directly.** Verified after republishing by
grepping the new bundle: all iOS keys present (the Android RevenueCat key is correctly absent from the
iOS bundle and present in the Android one — Metro resolves the platform ternary per bundle).

**Paywall retry moved onto the sticky CTA (same day).** The inline "Try again" button added earlier
that day was, in the founder's screenshot, pushed below the fold by the sticky footer itself — so the
only control on screen was the disabled "Unlock Arclo Pro", i.e. still a dead end. The footer button
now *becomes* the retry (label, icon, and handler) whenever `hasPlans` is false, and is no longer
disabled in that state; it is the one element on the screen guaranteed to be visible.

**Pre-submission audit: capability drift, legal drift, and one real vulnerability (2026-08-24).** A
full pass over declared capabilities vs. actual usage, both legal surfaces, and the live database,
prompted by the HealthKit rejection being a *class* of problem rather than a one-off. Fixed:

- **A second HealthKit was still in the binary.** `app.json` declared `NSRemindersUsageDescription`
  and passed `remindersPermission` to the expo-calendar plugin, which links EventKit's **Reminders**
  entity. Nothing in the app has ever used it — every "reminder" is an `expo-notifications` local
  notification. Worse than first reported: the plugin adds **two** keys
  (`NSRemindersUsageDescription` + `NSRemindersFullAccessUsageDescription`) from its own defaults, so
  deleting the custom string would only have swapped in Expo's boilerplate text. The plugin's
  `applyPermissions` deletes a key when its value is `false`, so `remindersPermission: false` is the
  actual fix. Verified against `npx expo config --type prebuild`, not the source file — the resolved
  Info.plist now contains only `NSCalendars*`, `NSPhotoLibraryUsageDescription`, and
  `ITSAppUsesNonExemptEncryption`, each mapping to a real feature. Also dropped
  `NSUserNotificationsUsageDescription`, which is not an Apple key at all.
- **The documented account-deletion path was wrong in four places.** Guideline 5.1.1(v) reviewers
  follow the path you publish; all of `legal.tsx`, `web/privacy.html`, `web/terms.html`, and
  `web/launch.html` said "Profile → Delete Account" while the control lives in Settings
  (`settings.tsx:682`), reached via the gear on the Profile tab. Now "Profile → Settings → Delete
  Account" everywhere.
- **Two legal documents for one app** — the hosted pair under `web/` was thorough; the in-app screen
  was a hand-written summary that never mentioned analytics or crash reporting (both live in
  production), had no limitation of liability, and no governing law. New **`src/constants/legalContent.ts`**
  is the canonical text and `app/legal.tsx` now renders it, so the in-app document is complete rather
  than a summary. `{brand}`/`{email}` placeholders are substituted at render time so a rename can't
  strand a stale name in a legal document. Liability and governing-law wording was carried over
  **verbatim** from the hosted terms rather than rewritten — a named venue and a monetary cap are the
  stronger clauses, but both assert facts only the founder can state, so they are flagged for counsel
  instead of invented. The `web/` pages gained the matching subscription + vendor disclosures and a
  pointer back to the module; generating them from it is a logged follow-up, not done.
- **The injury disclaimer moved to where the claim is made.** Profile's Injuries sheet promises to
  steer programming around what you report — an implicit safety claim whose only disclaimer sat in
  Terms. One line now sits directly above the Save button.
- **`save_exercise_instructions` was executable by `anon`** — see
  `supabase/harden_definer_functions.sql`. Applied live.

**Corrected from the audit's own first pass:** `set_profile_identity` was reported as an anon-reachable
definer function. It returns `trigger`, and PostgREST does not expose trigger functions, so there is no
endpoint — revoking EXECUTE on something that fires on every profile insert would have been real
regression risk for zero gain. Left alone deliberately, and the reasoning recorded in the migration.

---

*See also `LAUNCH.md` (iOS/Android launch guide) and `CLAUDE.md` (build/run + project conventions).*
