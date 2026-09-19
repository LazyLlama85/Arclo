# Arclo Project (formerly Fitaround, formerly Tempo — renamed 2026-08-05, still provisional; see ARCHITECTURE.md's rebrand note)

## ⚠️ No Regressions — Do Not Break Existing Functionality
This is a recurring, high-priority failure mode: asked to fix/move/restyle one thing, something
unrelated breaks. Treat every edit as if it must pass a "nothing else changed" diff review.

- **Before editing a file**, read enough of it (and its callers/importers) to know what already
  works there. Don't guess at surrounding behavior from a snippet.
- **When moving or refactoring UI**, preserve every existing prop, handler, conditional render,
  accessibility attribute, and edge-case branch — even ones that look redundant. If you don't
  understand why a check/branch exists, keep it and ask rather than deleting it.
- **When "improving" logic**, diff your version against the original behavior mentally (or with
  `git diff`) before finishing: every input that worked before must still produce the same output,
  unless the user asked you to change that specific behavior.
- **Never do drive-by cleanup** on code adjacent to your change (renaming, deleting "unused"
  branches, reordering) unless asked — it's exactly how unrelated things break.
- **After the change**, re-check the other screens/components that import or share state with
  the file(s) you touched, not just the one you were asked about.
- If a change is large enough that you can't be sure nothing broke, say so explicitly instead of
  reporting success — call out what you verified and what you didn't.

## Working Method (apply to EVERY feature request)
Act as a senior staff engineer, product designer, QA engineer, and systems architect at once.
Never stop at the first solution: always produce an initial solution → a skeptical critique →
an improved solution, and recommend the improved one. Work through these phases before writing code:

**Phase 1 — Understand:** Restate the feature in your own words. Explain how it interacts with
existing Tempo systems. List assumptions and missing information.

**Phase 2 — Architecture Review:** Analyze the impact on navigation, state management, database,
analytics, onboarding, offline behavior, and upgrade/migration.

**Phase 3 — Edge Cases** (write an explicit "Edge Cases" section): force close; offline; a failed
request; the user skips a step; the user leaves and returns later; upgrading from an older version;
two actions at once; stale cached data; denied permissions; settings changed mid-flow.

**Phase 4 — "Potential Problems With My Design"** (explicit section): argue as a skeptical senior
engineer trying to REJECT the proposal — architecture, UX, performance, maintenance, and future-
scalability risks — then revise the design to address them.

**Phase 5 — Final Recommendation:** only after the self-critique, give implementation recommendations
(the improved solution, not the first).

**Extend before creating.** Before adding a new table, store, hook, service, or provider, first
check whether an existing Tempo system already solves part of the problem and whether it can be
extended safely. Explicitly justify every new architectural component.

(For large multi-part builds, do this analysis up front and proportionally — a short written pass for
small changes, a full plan document for anything touching multiple systems. See `docs/EXECUTION_STATUS.md`'s
Open Backlog and `docs/STRATEGY_PLANS.md` for the depth expected on big features.)

## GitHub Push Protocol
After each logical unit of work (a bug fix, a feature, a self-contained change) — commit it and
push to GitHub automatically, without waiting for explicit instruction each time. Write a clear,
descriptive commit message per the standard commit format. Keep each commit scoped to that one
change; don't sweep in unrelated uncommitted files. Still never force-push, rewrite history, or
push anything that looks like it could contain a secret without stopping to confirm first —
those stay opt-in, not automatic.

## Documentation Protocol
**Update `ARCHITECTURE.md` (repo root) every time a change is made** — whenever you add or
change a screen, lib module, table, edge function, or feature, reflect it in `ARCHITECTURE.md`
in the same turn so it stays an accurate map of the system.

## Execution Protocol (how the audit gets built)
The roadmap for turning Tempo into a 10/10 product runs on three repo files — read them in this
order when doing improvement work:
1. **`docs/EXECUTION_STATUS.md`** — the living ledger. **Read it FIRST every session**; its "▶ Current
   Focus" is the resume point. **Update it LAST every session** (status, Current Focus, handoff note).
2. **`docs/EXECUTION.md`** — the plan: milestones, batch build-order, dependency map, risk analysis, the
   20/80, anti-over-engineering guardrails, and the copy-paste **prompt library** (§8).
3. **`docs/PRODUCT_AUDIT.html`** — the diagnosis + scores (kept current via the Audit Artifact Protocol below).

**The loop (never skip a step):** orient (read the ledger) → confirm the batch + its completion
criteria → build additively (No-Regressions) touching only that batch's files → verify
(`tsc` + tests + `/verify`) → set the row's status + Current Focus + handoff note → update
`docs/PRODUCT_AUDIT.html` → scoped commit + push. **One batch per session.** Every batch names the metric
it moves; if it names none, it's not a batch — cut it. Respect the §2 Reject/Postpone lists and the
§5 dependency edges (e.g. don't build the Home calendar timeline before OAuth is on Production). Do
NOT start new feature surfaces before milestone M4 (retention proof) — depth, not breadth.

## Audit Artifact Protocol
`docs/PRODUCT_AUDIT.html` is the **canonical source** for the brutal product-audit
artifact, published at
`https://claude.ai/code/artifact/6d53765f-21fe-4fff-bc04-ca9eaac67928`. It is written in the
original brief's voice — *a panel of ruthless experts; criticize everything; no compliments;
hard truths only; current-score vs potential-score with honest gaps.*

**Every time you change the app in a session, update `docs/PRODUCT_AUDIT.html` in the same turn**,
then re-publish it with the Artifact tool passing
`url=https://claude.ai/code/artifact/6d53765f-21fe-4fff-bc04-ca9eaac67928` so it keeps the same
link. Rules:
- Add a dated entry to the **Update Log** section at the top: what changed and its honest audit
  impact, in the same brutal voice. Newest first.
- **Reassess and update the scorecard** — scores are not frozen. Move a **Current** score
  (up or down) whenever the change genuinely alters the current-state quality a fair, skeptical
  reviewer would assign *today*: a real UX / reliability / craft / feature improvement can raise
  it; a regression or newly-found weakness can lower it. Adjust **Potential** and the **Gap** to
  match, refresh the row's note, and keep the headline "Overall App Score" and averages in sync.
  The discipline is honesty, not stinginess: **do not inflate for vanity** (merely writing code,
  or shipping a feature nobody has used), and for any score defined by a *proven outcome*
  (Retention, Conversion, PMF), still wait for the real measurement — instrumentation or a build
  earns an "addressed / gap-narrowed" note and unblocks the eventual re-score, but the number
  only moves once a cohort / conversion figure proves it. Everything else (design, IA, feature
  completeness, reliability once verified) is fair to re-score on delivered quality. Stay
  skeptical about what's still weak, and say so in the Update Log entry.
- Keep it fully self-contained (inline CSS/JS, no external hosts) — the Artifact CSP blocks them.

**Honest limitation to tell the user:** an artifact cannot auto-refresh "when opened" — there is
no such trigger, and a CLAUDE.md rule only runs while a session is active. The document stays
current because it is updated here on every change, so it is already accurate by the time it is
opened. This protocol is what keeps that true.

## Stack
- Expo ~56 (React Native) in `mobile/` — **SDK changes fast; read the versioned docs
  at https://docs.expo.dev/versions/v56.0.0/ before writing native/config code.**
- Web in `web/`
- Backend: Supabase (project ref `rtoahppnekykgmjukujm`, name "Tempo")

## Running the App
- Mobile: `cd mobile && npx expo start --ios`
- Requires `mobile/.env.local` (see `mobile/.env.example` for the full list).
- **Mac-only CocoaPods gotcha:** `npx expo run:ios` can fail at `pod install` with a Ruby
  `UnicodeNormalize` error if `LANG`/`LC_ALL` aren't set to a UTF-8 locale (`echo $LANG` empty or
  `C`). Fix: `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` before running CocoaPods/Expo build
  commands. Not applicable on Windows.

### ⚠️ Native modules — Expo Go no longer works
The app now depends on native modules that aren't in the Expo Go runtime:
`@sentry/react-native`, `posthog-react-native`, and push via `expo-notifications`.
**You must run a dev client / EAS build, not Expo Go.** After any dependency or
`app.json` plugin change, rebuild the native project:
```
cd mobile
npx expo run:ios      # or run:android  (local dev client)
# or a cloud build:
npx eas build --profile development --platform ios
```
A plain `expo start` JS reload will NOT pick up new native modules.

## Environment variables
All client keys are `EXPO_PUBLIC_*` so they're inlined at build time. Local dev
reads `mobile/.env.local`. **EAS Build does NOT read `.env.local`** — build-time
vars live in `eas.json` → `build.<profile>.env`. The Supabase + RapidAPI config is
**already wired into the `preview` and `production` profiles**, so builds connect to
the backend with no extra setup. Add telemetry keys to those same `env` blocks if/when
you obtain them.

| Var | Purpose | Status |
|-----|---------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Backend | ✅ In `eas.json` |
| ~~`EXPO_PUBLIC_RAPIDAPI_KEY`~~ | Exercise media | ❌ **Removed 2026-09-06** — the key is billable and was shipping in every bundle + a public repo. Exercise media now goes through the `exercise-media` edge function, which holds it as a Supabase secret. Do NOT re-add it to `eas.json`. |
| `EXPO_PUBLIC_POSTHOG_KEY` (+ `_HOST`) | Analytics | Optional — no-ops if unset |
| `EXPO_PUBLIC_SENTRY_DSN` | Crash reporting | ✅ In `eas.json` + `.env.local` (org `tempo-0u`, project `react-native`) |

## Telemetry (analytics + crash reporting)
- `src/lib/analytics.ts` — PostHog wrapper; typed events via `EventProperties`;
  `track()` / `identifyUser()` / `resetUser()`. No-ops without `EXPO_PUBLIC_POSTHOG_KEY`.
- `src/lib/crashReporting.ts` — Sentry wrapper; `captureException` / `captureApiError`.
  Disabled in `__DEV__` by design, so test crash capture in a release/preview build.
- Both initialized in `src/app/_layout.tsx`; failed React Query requests funnel to Sentry.
- **Sentry source maps:** the `@sentry/react-native/expo` plugin needs `SENTRY_ORG`,
  `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` at build time to upload symbols — all three
  are set (`SENTRY_ORG`/`SENTRY_PROJECT` in `eas.json`, `SENTRY_AUTH_TOKEN` as an EAS
  project secret, added 2026-08-03). Without a valid token, iOS builds fail outright at
  the `sentry-cli` upload step (not just skip symbolication).

## Push notifications (server-driven retention)
The backend (already provisioned in Supabase) drives all retention pushes:
- Tables `device_tokens` + `notification_log` (migration `mobile/supabase/add_push_notifications.sql`).
- Edge Function `retention-push` (deployed, `verify_jwt=false`) — see its README. Evaluates
  per-user rules (missed workout, streak-at-risk, free-time gap, reactivation), sends via
  the Expo Push API, logs every attempt, and disables dead tokens.
- A `pg_cron` job `retention-push-hourly` invokes it every hour.
- Client registers tokens in `src/lib/pushTokens.ts` (on login) and routes taps in `_layout.tsx`.

**Before pushes deliver on real builds you must upload provider credentials to Expo:**
- iOS: an APNs key — `cd mobile && npx eas credentials` (Push Notifications) or upload in the Expo dashboard.
- Android: an FCM v1 service-account JSON — upload via `eas credentials` / dashboard.
Local pre-workout reminders (`src/lib/notifications.ts`) still run on-device; only the
retention nudges are server-driven.

## Body measurements (weight/measurement history)
- Table `body_measurements` (migration `mobile/supabase/add_body_measurements_history.sql`,
  applied + backfilled from the old `user_profiles.bodyweight_lbs`, which is now just a
  denormalised "latest weight" cache).
- `src/lib/bodyMeasurements.ts` — `logMeasurement`, `fetchMeasurements`, and trend math
  (`computeWeightTrend` = least-squares lb/week, `rollingAverage`). UI lives in the Profile tab.

## Progression (periodization + adaptive deload)
- Columns `scheduled_workouts.week_index` + `progression` (jsonb) — migration
  `mobile/supabase/add_periodization.sql`, **applied**.
- `src/lib/periodization.ts` — the mesocycle: overload weeks 1–3 + a scheduled
  deload (week 4), with `normal` / `recovery` / `deload` / `maintenance` variants
  selected by the plan's `adaptation_mode`.
- `src/lib/progression.ts` — `buildPrescription` now also takes the week's
  `WeekProgression` (volume wave + deload load cut) on top of reactive load
  autoregulation. The two layers are deliberately separated so load never
  double-counts (planned intensity only deviates from 1.0 on a deload).
- `src/lib/adaptation.ts` — `refreshAdaptation()` evaluates real signals (missed
  sessions, repeated "too hard") and flips `adaptation_mode`, **re-stamping every
  future plan workout** so the coming weeks actually change. Runs on app open
  (after missed-workout sweep) and after each workout/feedback. This is what makes
  `adaptation_mode` a live input rather than an unused column.
- `src/lib/experienceProgression.ts` — the UP direction (adaptation is the DOWN one):
  `maybePromoteExperience()` graduates the user beginner→intermediate→advanced when
  they've earned it (completed-session count, pulled forward by "too easy" feedback;
  gated off in recovery/deload or after recent "too hard"). Runs **only after a
  completed session** (`workout-complete.tsx`), so every promotion is paired with its
  "LEVEL UP" celebration; it persists the new `experience` and calls
  `generatePlan.restampFuturePlanForExperience()` to re-select harder exercises +
  re-stamp periodization on all upcoming plan sessions at once.

## Applying Supabase changes
SQL files in `mobile/supabase/*.sql` are the source of truth. The push-notification and
body-measurement migrations are **already applied** to the live project. For new changes,
add a `.sql` file and apply it (Supabase SQL editor or the MCP `apply_migration`); deploy
function changes with `npx supabase functions deploy <name>`.

## Pre-publish checklist (iOS + Android)
- [ ] All required `EXPO_PUBLIC_*` vars set in the production EAS build profile.
- [ ] APNs key (iOS) + FCM service account (Android) uploaded to Expo for push.
- [x] Sentry `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` set for source maps.
- [ ] `npx tsc --noEmit` passes in `mobile/`.
- [ ] Built with EAS (not Expo Go) and smoke-tested on a physical device — push tokens
      and crash reporting only work on real builds/devices.
- [ ] App Store account-deletion flow intact (Profile → Delete Account; Guideline 5.1.1(v)).
- [ ] **Sign in with Apple**: `app.json` sets `ios.usesAppleSignIn: true` (done). Confirm the
      "Sign in with Apple" capability is enabled on the Apple Developer App ID and the Apple provider
      is configured in Supabase Auth, then test on a real device (native Apple auth can't run in
      Expo Go). Required because the app also offers Google sign-in.
- [ ] Calendar auto-add is **opt-in** (`calendar_autosync` default false — migration
      `add_calendar_autosync_default_off.sql`, applied). Verify toggling it off removes Tempo events.
