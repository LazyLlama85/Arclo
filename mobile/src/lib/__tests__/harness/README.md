# Journey harness

A simulated user you can run the real app logic against. No phone, no emulator,
no network. `npx jest` runs it with everything else.

## Why

The unit suite answers "does this function compute the right number". It is
blind to "do these modules still agree with each other", which is where every
serious bug of 2026-09 actually lived:

- `materializeSplit` re-created a session another module had moved, because one
  keyed on the date and the other on the day the row came from.
- A rotation shift renamed sessions while the calendar event and the reminder
  kept the old name.
- A rotation shift during travel mode would have let `travel_restore` write the
  previous focus's exercises onto a renamed session.

None of those are visible from inside one module. They need a user with a
schedule, a few days passing, and two features used in sequence.

## Writing one

```ts
import { createWorld, destroyWorld } from './harness/world'

afterEach(() => destroyWorld())

it('counts a session with logged sets as trained', async () => {
  const world = createWorld()          // 6-day PPLPPL, sessions from tomorrow
  const session = world.upcoming()[0]

  world.advanceDays(1)                 // it is now that session's day
  world.logSets(session.id)            // trained, but never tapped Finish
  world.advanceDays(1)                 // the day ends
  await world.openApp()                // the real maintenance chain

  expect(world.schedule().find(s => s.id === session.id)!.status).toBe('completed')
})
```

The shape that finds bugs is **"and then"**. Use a feature, keep using the app,
and assert the schedule is still coherent. A journey that stops at the first
assertion is just a slower unit test.

Copy the `jest.mock(...)` block from `journeys.test.ts` — it neutralises the
native modules (calendar, notifications, Sentry) that `ts-jest`'s Node
environment cannot transform.

## API

| | |
|---|---|
| `createWorld(opts)` | Seeds profile, active plan, exercises, upcoming sessions. Installs fake timers. |
| `world.today()` | The simulated date, `YYYY-MM-DD`. |
| `world.advanceDays(n)` | Move the clock. |
| `world.openApp()` | Runs dedupe → missed sweep → plan rollover. |
| `world.logSets(id, n?)` | Log real sets without completing the session. |
| `world.complete(id)` | Finish a session the way the runner does. |
| `world.schedule()` / `.upcoming()` / `.on(date)` | Readable session views. |
| `world.tables` | The raw in-memory tables, for seeding anything unusual. |

`createWorld` takes `today`, `goal`, `experience`, `daysPerWeek`, `equipment`,
and `upcoming` (the focus labels to seed).

## What it does NOT prove

It does not render React. It cannot tell you whether a button appears, whether a
screen crashes on mount, or whether a confirm dialog fires. It proves the DATA
the app produces stays coherent. Screen-level coverage would need
`@testing-library/react-native`, which is a separate piece of work.

## Two traps, both already paid for

**Use real exercise names.** The slot classifier keys off the name, so a pool of
`ex1/ex2/ex3` produces empty sessions and green tests that prove nothing. Use
`exercisePool()`.

**Keep the seed internally consistent.** The plan's `start_date` must agree with
its sessions' `week_offset`, or `extendActivePlan` generates a block overlapping
dates that already have sessions. Real Postgres rejects that on the partial
unique index; the fake accepts it, and the resulting two-sessions-per-day
schedule makes every downstream assertion meaningless.

Both cost an afternoon the first time. Building the harness also exposed two
holes in `fakeSupabase` itself — inserted rows had no `id` (so `.eq('id',
undefined)` matched *every* generated row and one delete wiped the schedule),
and chained `.order()` overwrote instead of accumulating (so
`.order('date').order('time')` sorted by time alone). Both are fixed. If a
journey fails in a way that makes no sense, suspect the fake before the product:
that is twice now.
