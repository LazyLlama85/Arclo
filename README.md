# Arclo

**A fitness app that schedules around your actual week.**

Live on the [App Store](https://apps.apple.com/app/id6785075737) and Google Play.

Most training apps hand you a plan and assume every week looks the same. They
break in week two, when work moves or you get sick, and then blame you for it.
Arclo reads the free time you already have and places each session in a gap that
genuinely exists — then re-places it when the week changes.

---

## The interesting problem

Scheduling is the whole product, and it is harder than it looks.

A session has to land in a window that is free on the user's real calendar,
after they wake, outside work and school, before they sleep, on a weekday they
actually train, spaced so the same muscle group is not hit two days running, and
it has to survive that window disappearing at 9am on a Tuesday.

Some of what that took:

- **Availability solving** (`src/lib/availability.ts`, `smartSchedule.ts`) —
  free-window search across calendar busy blocks, sleep, work, school and
  user-defined unavailable blocks.
- **Recovery-aware day choice** (`trainingLoad.ts`, `weekReschedule.ts`) — picks
  the best day, not the soonest, and can re-lay a whole week in one pass while
  preserving the split's sequence.
- **Server-side enforcement** (`supabase/functions/retime-sessions`) — the same
  judgement runs hourly on the backend, because a client-side repair can only
  ever reach users who have received the update and then opened the app.
- **Rotation integrity** (`rotationShift.ts`) — miss a Push day on a six-day
  split and the rotation slides rather than silently skipping a muscle group.

Where a rule matters, it lives in one module that every caller routes through,
so no call site can reintroduce a bug that was already fixed elsewhere.

## Stack

| | |
|---|---|
| **Mobile** | React Native 0.85 / Expo SDK 56, expo-router, TypeScript |
| **State** | Zustand, TanStack Query |
| **Backend** | Supabase — Postgres 17 with row-level security, Auth, Storage, Deno edge functions, `pg_cron` |
| **Payments** | RevenueCat (auto-renewing subscriptions, iOS + Android) |
| **Telemetry** | PostHog (product analytics), Sentry (crash reporting) |
| **Integrations** | Google Calendar, Apple/Google sign-in, Expo Push / APNs / FCM |

Roughly 64k lines of TypeScript across 300 source files, 66 SQL migrations and
6 edge functions.

## Testing

```bash
cd mobile
npx tsc --noEmit    # typecheck
npx jest            # 657 tests across 64 suites
```

The suite is deliberately weighted toward the logic that silently miscalculates
for every user at once — periodization, progression, the exercise classifier,
plan rollover, scheduling and availability.

Two pieces worth calling out:

- **A journey harness** (`src/lib/__tests__/harness/`) runs the real modules
  against an in-memory Supabase, with a clock you can advance. Unit tests answer
  "does this function return the right number"; the harness answers "do these six
  modules still agree after a week passes", which is where the real bugs were.
- **A vendored-copy guard** — `availability.ts` is duplicated into an edge
  function because Deno cannot import from `src/`, and a test fails the suite if
  the two files differ by a single byte, so client and server can never disagree
  about what a free window is.

## Running it

```bash
cd mobile
npm install
npx expo run:ios      # or run:android
```

Requires `mobile/.env.local` (see `mobile/.env.example`). A dev client is
required rather than Expo Go — the app depends on native modules (Sentry,
PostHog, push notifications) that Expo Go does not ship.

## Repository

```
mobile/         the app — src/lib is where the scheduling logic lives
web/            marketing site, privacy policy, terms
brand-assets/   generated store frames, OG images, content art
docs/           architecture decisions, execution ledger, product audit
ARCHITECTURE.md a running map of every screen, module, table and function
CLAUDE.md       engineering standards this repo is built to
```

`ARCHITECTURE.md` is the best single file to read. It documents not just what
each module does but why, including the bugs that shaped it.

## On AI assistance

This project was built with heavy use of Claude, and the commit history says so
on every commit rather than hiding it. `CLAUDE.md` is the standard the work is
held to: a no-regressions policy, a required understand → critique → revise pass
before writing code, and a documentation protocol that keeps `ARCHITECTURE.md`
accurate in the same commit as the change.

The parts I would point at in a review are the decisions rather than the
keystrokes: choosing to rotate session *content* instead of cascading dates
because the latter would have dragged in six other systems; moving scheduling
enforcement server-side after discovering a client-side repair could not reach
the users who needed it; and measuring a 44% unmakeable-session rate against
production data rather than trusting that the code was correct because it had
tests.
