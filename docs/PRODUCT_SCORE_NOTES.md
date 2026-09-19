# Tempo — Product Score Notes (Activation + Launch Sequencing + Audit)

> Merged from `ACTIVATION_DEFINITION.md`, `LAUNCH_SCORE_PLAN.md` (written 2026-07-23), and
> `AUDIT.md` (2026-07-09, `expansion/audit-round-2`), cross-checked against `EXECUTION_STATUS.md`
> and `ARCHITECTURE.md` for real current status. `PRODUCT_AUDIT.html` (repo root) remains the
> canonical, continuously-updated scorecard — this file is supporting detail, not a replacement.

---

# §1 — Activation metric definition

*(Draft for founder sign-off, not a decree — a product judgment call, not something to unilaterally
decide.)* `PRODUCT_AUDIT.html`'s own "critical — do before any marketing spend" tier names this as
the #1 remaining gap: a written, agreed definition of "activated" so B0.3's funnel and every
retention decision downstream has a real target instead of a vibe.

## What's already built (code, today)

- `activation_reached` (`lib/activation.ts`) fires **exactly once per user**, the moment they
  complete their **2nd session** (`ACTIVATION_SESSIONS = 2`). Reasoning in the code: a single
  first-run workout proves nothing about the habit; a second completion means the user returned and
  the plan → train → log loop is actually working for them. **No time window** — fires whenever the
  2nd session happens, even 60 days after signup. Real gap if the intent is "activated within the
  trial-relevant window" (see open decision below).
- `calendar_connected` fires once per user per provider, the first time Google or device calendar is
  connected. Completely independent — never gates or blocks `activation_reached`.
- Both are de-duplicated by durable, force-close-proof localStorage flags — safe to build
  funnels/cohorts on without double-counting.

## Proposed definition

> **A user is "activated" when they complete their 2nd session** (already built, already firing).
> **Calendar-connected is tracked as a separate cohort split, not folded into the activation event.**

**Why a cohort split instead of requiring calendar connection:** `activated = calendar_connected AND
2 completed sessions` sounds more aligned with "the core loop that makes Tempo different," but
calendar connection is **optional by design** (removed from onboarding's required path specifically
to cut OAuth friction — see `ARCHITECTURE.md`'s Calendar section). Gating activation on an optional
action means a perfectly-engaged user who never got around to connecting a calendar shows up as
"never activated" in every dashboard — understates real retention and could push toward the wrong
fix (nagging people to connect a calendar instead of asking whether the core habit loop is working).

**Recommendation:** keep `activation_reached` exactly as it fires today (2 sessions, no calendar
requirement); answer the real question — "does the calendar wedge actually help retention?" — as a
**breakdown, not a gate**: segment the activation funnel and every retention curve by
`calendar_connected` (fired vs. not). Gives the more interesting number (do calendar-adopters retain
better) without corrupting the headline activation rate.

## Open decision the founder still owes

**Should `activation_reached` gain a time window** (e.g. "2 sessions within 14 days of signup") so a
technically-activated-eventually user who took 3 months doesn't count the same as someone who
activated in week one?

- **Leave it uncapped (today's behavior)** — simpler; "did they ever activate" is still meaningful
  on its own.
- **Add a window** — requires a small code change (`lib/activation.ts` needs the user's signup date
  threaded through, not currently there) — genuinely more informative for measuring onboarding/
  trial-window effectiveness specifically, but is new code, not just documentation — a decision +
  follow-up task, not bundled into the draft.

## PostHog insights to build once real data exists

*(The funnel/retention dashboard is already live and waiting — id **1865254**, "Tempo — Activation &
Retention.")*

1. **Activation funnel, split by calendar-connected** — `onboarding_complete` → `activation_reached`,
   breakdown = whether `calendar_connected` fired for that user. Answers "does connecting a calendar
   actually predict activation."
2. **D7/D30 retention, split by calendar-connected** — same breakdown on the existing activation-
   anchored retention insight. Answers the audit's own claim: "the scheduling wedge genuinely
   removes a real weekly decision" — this is the number that proves or disproves it.
3. **Time-to-activation distribution** (once/if the time-window decision above ships) — a trends
   query on `activation_reached`'s implicit delay from `onboarding_complete`, to see whether most
   activation happens in week one or trails off.

**Why this matters more than any remaining feature work:** every Conversion Potential / Retention /
Subscription Value score in `PRODUCT_AUDIT.html` is explicitly held at "structural cap removed, not
yet proven" — this definition, once approved and shipped with the (already-fixed) PostHog key, is
what turns those from projections into real, defensible numbers.

---

# §2 — Launch score sequencing (real current status)

The audit splits into two scores on purpose: **Product Score** (currently reassessed higher than the
plan's original 5.9 baseline via the sessions below — see `PRODUCT_AUDIT.html` for the live number),
40 rows of *delivered quality*, movable pre-launch; and **Market Proof Score**, 8 rows of *proven
outcomes* (Retention, Conversion Potential, Product-Market Fit, Virality, Referral, Community
Features, App Store Potential, part of Trustworthiness) — **frozen until a real cohort exists**, not
worth chasing pre-launch.

**Real status as of this consolidation (verified against `EXECUTION_STATUS.md` + git log, not the
plan's own stale checkboxes):**

## Tier 1 — conversion engine + de-risk

| Item | Plan status | **Real status** |
|---|---|---|
| **T1.1** — Proof-number as the Home hero | partially done at write time | **✅ Done** (`9b29741`) — `schedulingImpact` now leads Home, not buried on a stat card. |
| **T1.2** — On-device verification pass | not done | **🔲 Still open — the only Tier-1 item not done.** Needs a physical device/AVD walkthrough (fresh onboarding, log a session, reschedule, every modal, paywall in tester mode); founder said they'll test at the end. A real amount of recent work (Coach C3/C4, Apple Health export, pause mode, notification fixes) is `tsc`-clean/test-green but **never run on hardware** — this is what turns that from code-verified into proven. |
| **T1.3** — Realign price to launch tier | open at write time | **✅ Done** (`4f78249`, 2026-07-27) — $4.99/mo · $34.99/yr live on both stores. |

**Tier 1's launch-critical minimum is fully clear except T1.2.**

## Tier 2 — make Pro feel like a real tier on day one

| Item | Plan status | **Real status** |
|---|---|---|
| **T2.1** — Ship one foresight surface (PR forecast or goal-date) | neither built | **✅ Done** (`a260e5b`) — PR forecast shipped as the real second Pro pillar; goal-date/long-horizon UI remains the other registered-but-unbuilt surface. |
| **T2.2** — Deploy Coach + device-test it | undeployed, no key, never on device | **🔲 Still not started**, and deliberately sequenced as a **post-launch, retention-proven fast-follow**, not a launch blocker (see `STRATEGY_PLANS.md` §B). Biggest single available Product-row lever (AI Features 4→7) once it happens. |

## Tier 3 — craft & table-stakes

| Item | Plan status | **Real status** |
|---|---|---|
| **T3.1** — Accessibility batch (C4) | not started | **✅ Done** (`2281cad`). |
| **T3.2** — Fitness Science fixes (muscle-classification bug) | flagged as a bug | **✅ Turned out already fixed** — corrected as an audit-accuracy issue, not a code fix (`3f1bc6e`). |
| **T3.3** — Remaining P1 craft (split `plan.tsx`, typed routes, list virtualization) | not started | **🔲 Still not started.** No commit or ledger entry found closing this; lowest-priority item, explicitly sequenced after Tier 1–2. |

## The sequence, with real status folded in

```
T1.1  Proof-number Home hero        ✅ done
T1.2  On-device verification pass   🔲 OPEN — needs hardware, founder to test at the end
T1.3  Price realignment             ✅ done (live both stores, 2026-07-27)
──────────────  launch-critical minimum: blocked only on T1.2  ──────────────
T2.1  One foresight surface (PR forecast) ✅ done
T3.1  Accessibility (C4)            ✅ done
T3.2  Fitness Science fix           ✅ done (was already fixed)
T3.3  P1 craft (C5–C10)             🔲 open, low priority
──────────────  fast-follow, after launch + retention proof (M4)  ──────────────
T2.2  Deploy + ship Coach           🔲 open — founder-blocked (deploy fn + API key), see STRATEGY_PLANS.md §B
```

**Bottom line: the only thing standing between "launch-critical minimum" and done is T1.2 (hardware,
founder-owned). T3.3 and T2.2 remain open but are explicitly lower-priority/post-launch by the plan's
own sequencing, not oversights.**

---

# §3 — Open system-audit items (from `AUDIT.md`, 2026-07-09)

`AUDIT.md` is largely superseded by the canonical, continuously-updated `PRODUCT_AUDIT.html`. Below:
shipped items compressed to one line each; legitimate ongoing **[WATCH]** engineering notes kept;
the original "priority queue after this round" re-verified against `ARCHITECTURE.md`/git log rather
than carried forward blindly.

## Shipped this round or since (one line each — do not re-litigate)

Identity: unique `@username` + per-user friend code, disambiguates duplicate display names. Friend
profiles: richer stats (streak/volume/goal/account age) inside existing privacy gates. Activity feed
on Friends screen. Friends-only weekly leaderboard. Split/program sharing with metadata chips.
Machine-occupied workout-runner menu (swap/move-to-end/reorder/skip). Warm-up sets excluded from all
volume/PR math. Session notes. First-session coach overlay. Active-split edit now restamps future
materialized weeks. Unbounded-PREV-query perf fix. **Since this audit round, also confirmed shipped**
(cross-checked against `ARCHITECTURE.md` / git log): **pause/vacation mode** (`cd97d70`), **progress-
photo timeline/compare** (`282c665`), **web share preview + universal links** (`1a88ce8`,
`ceb7c94`), **goal-step expectation copy** (`3dd5f4b`), **returning-user Home heroes**
(`lib/returningUser.getReturningState`, drives Home's hero on 3/7/30-day absence tiers — per
`ARCHITECTURE.md` §5.1), **Apple Health export** (`0f04a6e` — one-way write, opt-in; code ships but
is native-inert until the next `eas build`, same on-device-confirmation gap as T1.2 above),
**activity_events + reactions/likes** (Social Upgrade Stage 2, `add_social_badges.sql` +
`add_activity_reactions.sql`, both applied — per memory this repo's 4-stage social upgrade is fully
live).

## [WATCH] — legitimate ongoing engineering notes, kept

- **No block/report; declined requesters can re-request forever.** Friends-only surface (no DMs/
  comments) keeps abuse potential low today. Trigger to revisit: any user report, or before public
  profiles. Schema is ready (`status='blocked'` value + policy filter).
- **Share rows accumulate forever.** Snapshot rows are tiny; add a 1-year TTL sweep if volume ever
  matters.
- **Multiple active schedules (school/summer/travel split).** Architecture already supports N saved
  splits with 1 active. A "scheduled activation" (activate X on date D) would be a small future
  feature (`splits.activate_on date` + app-open check).
- **Timezone changes mid-plan.** Dates are device-local strings; a flight across midnight can
  double/skip a day edge case. Known, rare, self-heals next day.
- **Per-exercise notes.** Session note + exercise-swap memory covers most cases today; add
  `exercise_notes (user_id, exercise_id, note)` if requested.
- **Two devices logging the same session.** Both adopt the same open log (fine); `set_number`
  collisions possible; single-user product, acceptable risk.
- **Milestones exist but unlockables are passive.** `lib/achievements` levels exist; surfacing them
  as celebration moments is still just a nice-to-have, not done.
- **Friend-request / request-accepted push.** Worth adding to `retention-push`'s rule set once
  social usage justifies it (needs a `friendships` trigger or poll in the hourly run). No evidence
  this shipped — still open.
- **Workout-history pagination** and the **500-friend / `get_public_profiles` 100-row cap** — both
  flagged "verify before scale," currently fine at beta size.
- **Illustrated empty states** and **achievement-unlock celebration moments** — current empty
  states are good text+icon; real illustration is an asset task, not urgent.

## Still-open / unconfirmed items from the original "priority queue after this round"

Re-checked against `ARCHITECTURE.md` and git log — most of the original 9-item queue turned out to
already be done (see "Shipped" above). What's genuinely **not** found shipped:

1. **QR code add.** Deferred by design in the source audit (friend code already covers the "add
   someone standing next to you" case); no `react-native-qrcode-svg`/`expo-camera` work found in
   `ARCHITECTURE.md` — still not built. Low priority; build if/when social usage justifies two new
   native modules for a flow the friend code already covers.
2. **Weekly friend challenges** (on top of `activity_events`). No `challenges` table or UI found —
   still not built. Designed architecture from the source audit: `challenges` table (metric:
   sessions/volume/minutes, week window) + auto-enrolled friends, friends-only by design (no global
   boards). Depends on `activity_events`, which is now shipped, so this is unblocked whenever
   prioritized.
3. **Friend-request / request-accepted push notifications.** Listed above under [WATCH] — confirmed
   still open, not found in `retention-push`'s rule set.

Everything else on the original 9-item list (pause mode, photo timeline/compare, returning-user Home
heroes, goal-step copy, web share preview/universal links, Apple Health export) has shipped — see
the "Shipped" section above.
