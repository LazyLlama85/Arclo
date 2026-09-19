# Tempo — Strategy Plans (Monetization + Tempo Coach)

> Merged from `MONETIZATION_PLAN.md` (drafted 2026-07-18) and `TEMPO_COACH_PLAN.md` (written
> 2026-07-22), compressed to cut superseded/historical narrative and keep every open decision and
> spec. Companion files: `PRODUCT_AUDIT.html` (the diagnosis/scorecard), `ARCHITECTURE.md` (system
> map), `EXECUTION_STATUS.md` (the living ledger), `LAUNCH_SCORE_PLAN.md` / `PRODUCT_SCORE_NOTES.md`
> (the pre-launch sequencing this feeds).

---

# §A — Monetization (Free vs Pro)

**Status: strategy document. Pro is dormant** behind the remote `pro_enabled` flag
(`lib/proConfig.ts` / `stores/entitlements.ts`) — no paying cohort exists yet. This section is the
what/why; flipping it on is a mechanical checklist (see §A.7).

## A.0 — The one sentence

**Free proves the wedge on autopilot: "Tempo plans my week and it just works." Pro turns Tempo into
the coach that *runs* your training** — command it, see months ahead, go deep, reprogram anything.
The core training loop is free forever (unlimited logging, adaptive plan, full library); Pro
unlocks *depth, foresight, and unlimited creation* on top.

## A.1 — Pricing (current state)

**Live now: $4.99/mo · $34.99/yr**, in both App Store Connect and Play Console since **2026-07-27**
(`LAUNCH_SCORE_PLAN.md` T1.3, done). The yearly plan's intro offer is a **paid first-year price of
$24.99** (not a free trial — founder-confirmed 2026-07-22 live configuration), flat on both stores;
against the new $34.99 base that's ~29% off (was ~50% off the old $49.99 base) — not worth
re-deriving a cleaner percentage since $49.99 is no longer the reference point. Monthly has no
introductory offer.

**One line of history:** price was briefly **$7.99/mo · $49.99/yr** (2026-07-22 → 2026-07-27),
priced for a Coach-tier the launch build didn't actually contain (Tempo Coach was built through C1–
C4 but undeployed) — a self-contradiction a reviewer or churned free user would notice. Reverted to
$4.99/$34.99 to match what actually ships (a real Strong/Hevy-class utility tier). **Raise back
toward ~$7.99–$12.99/mo the moment Coach deploys and apply-rate proves it out** — clean to do since
there's still no paying cohort to grandfather.

Prices live in the RevenueCat dashboard; the paywall code reads them live — a future price change
is a dashboard change, not a code change.

| Plan | Price | Notes |
|---|---|---|
| Annual (lead offer, default-selected) | $34.99/yr | ~$2.92/mo framing; paywall anchor. Intro: $24.99 first year. |
| Monthly | $4.99/mo | Makes annual read as ~7 months' price for a year. |
| Lifetime (optional) | ~$79.99–$99.99 proposed | Strong/Hevy band. **Founder's call whether to offer at all.** |

**The honest tradeoff:** at this price the business is a volume game ($34.99/yr × 2–5% conversion
needs real install volume), and a low price signals "utility" not "premium coach." Counter-argument:
a cheap, clearly-capped free tier converts more of the people who hit the wall, and price is easy to
raise later on new cohorts once Coach + foresight thicken the value story. Revisit the price the
same day Coach ships.

## A.2 — The theory: where the free/Pro line is drawn

The hard question: Tempo's wedge (auto-scheduling your week around real life) is the thing worth
money, and it's free today — do we gate it?

**Answer: no — gate its power expression, not its existence.** The wedge must stay free to hook, but
there's a clean line between **"Tempo does this for me automatically for my one plan"** (free) and
**"I command Tempo, and it sees/does far more"** (Pro):

- **Free = the wedge on autopilot.** Silently fits your one adaptive plan around your primary
  calendar. The whole hook, fully functional, forever.
- **Pro = the wedge under your control, with foresight and intelligence.** One-tap re-plan the whole
  week on demand; read every calendar; rewrite for travel; see/shape months ahead; go deep on the
  why; (fast-follow) a coach that reprograms on command.

This preserves "no hard caps on the core loop" (plan/log/train/adapt stay free forever) while making
Pro a genuine transformation — "an app that plans my week" → "a coach that runs my training" — by
*adding* power, not crippling free.

**Grounding research (2026):** people pay for outcomes/personalization, never content or charts —
the audit's own indictment of Tempo's old gate was *"nobody has ever churned onto a fitness app to
see volume charts."* Annual-first/trial-led/priced-with-conviction plans win the category. Health &
Fitness free→paid runs ~2–5% median; trial→paid ~40% median. Value-moment paywalls beat immediate
hard walls ~2.1× on trial starts. Comparable apps: Hevy/Strong prove "free must be genuinely usable
long-term + charge like the outcome, not the rep-logger"; Fitbod proves "don't gate the wedge itself
— it kills the funnel."

## A.3 — Exactly what's Free vs Pro

**🟢 FREE — the core training loop, uncapped forever:** plan generation, periodization/mesocycles,
adaptive deloads, experience promotion (the full adaptive brain) · ambient auto-scheduling around
the **primary** calendar (the wedge) · your one living Tempo plan · Quick Workout · unlimited
logging (every set, RPE, warm-ups, edits, unilateral weights — never capped) · the full 1,300+
exercise library with form GIFs · basic progress (streak, consistency, volume trend, history, PRs,
bodyweight log) · streaks/badges/social (disclosure-gated by activation, not Pro) · pre-workout
reminders + retention nudges · account/calendar sync (primary)/sign-in/export/delete.

**Free tier caps (founder decision, ✅ implemented in code, dormant until Pro flips —
`lib/proLimits.ts` + three creation choke points):**

| Limit | Free | Pro | Notes |
|---|---|---|---|
| Adaptive Tempo plan | 1 | 1 (+ unlimited custom) | You only need one — it adapts. |
| Custom plans (hand-built) | 1 | Unlimited | The Strong "routines" lever, applied to plans. |
| Custom exercises (user-created) | 5 | Unlimited | The 1,300 library stays fully free; only your own additions are capped. |
| Saved custom workouts | 5 | Unlimited | 5 saved custom workout templates, not 5 logged sessions (logging is unlimited). |

Gentle enough that a casual user rarely hits them; a *committed* user (exactly who'd pay) bumps into
them naturally — converts intent, not access.

**🔵 PRO — "Tempo becomes your coach." Four pillars:**

1. **CONTROL** — Reschedule My Whole Week (built: `lib/reschedule.rescheduleWholeWeek`) · Multi-
   Calendar, read every calendar not just primary (built, dormant behind OAuth scope
   `multi_calendar`) · Travel Mode, rewrite workouts to available gear (built: `travel_mode`) ·
   unlimited creation (removes all four §A.3 caps — the primary conversion driver at this price).
2. **FORESIGHT** — long-horizon/goal-date planning, see/shape training blocks months ahead
   (registered: `long_horizon_planning`) · PR & goal forecasting ("at this rate you'll hit a 2-plate
   bench by October") — predictive, not retrospective; charts are free, *foresight* is the Pro half.
3. **INTELLIGENCE** — Muscle Intelligence interactive body map (built: `muscle_intelligence`) ·
   advanced deep-dives (strength curves, weak-point detection, volume-landmark awareness) ·
   coaching insights & smart notifications (registered: `smart_notifications`).
4. **COACH (tentpole, fast-follow not launch)** — Tempo Coach: reprogram on command in plain
   language with every decision explained (registered: `tempo_coach`). See §B. Ships after the
   wedge + retention are proven; the reason annual price has room to rise later.

**Bonus (flair, never the headline):** premium themes + custom app icons + profile flair (built:
`premium_personalization`).

## A.4 — Where the paywall fires

**Rule: trigger at the moment the user reaches for a Pro superpower — never after a random first
workout** (a device-local-flag anti-pattern that also misfires on reinstalls). Fire at (each a
`requirePro(context)` call site):

1. First tap on **Reschedule My Whole Week**.
2. Connecting a **second calendar**. *(Trigger code exists but the multi-calendar surface itself
   still waits on a device reconnect-and-test pass — B1.5 in `EXECUTION_STATUS.md`.)*
3. Tapping **Travel Mode**.
4. Opening **long-horizon / goal-date planning**.
5. Tapping **Muscle Intelligence** or a **PR forecast**.
6. **Hitting a free cap** (primary trigger at this price point) — 2nd custom plan, 6th custom
   exercise, 6th saved custom workout. Honest, generous copy: *"You've used your free custom
   workouts — go unlimited with Pro,"* never a scolding wall.

**The emotional engine — the proof number:** `schedulingImpact` — *"Tempo fit N workouts into your
real week this month — sessions you'd have skipped."* Free users accumulate it; the paywall leads
with their own number. *(Now built as the Home-tab hero — `LAUNCH_SCORE_PLAN.md` T1.1, done.)*

**Onboarding:** no hard wall — a skippable "Pro exists" card at the honest reveal; real conversion
work happens at the value moments above.

## A.5 — What's built vs. what's still needed to go live

**Already built (dormant, do not rebuild):** the whole entitlement system (`proEnabled × isPro →
locked`, comp grants, tester override) · custom on-brand paywall with live pricing/trial CTA/
restore/legal links · gate registry + copy (`lib/proFeatures.ts`) + `ProGate`/`ProLockCard`/
`ProBadge` · purchase funnel analytics, `/paywall` route, RevenueCat SDK + iOS key in `eas.json` ·
live-buildable gates: reschedule-week, muscle intelligence, travel mode, multi-calendar (multi-
calendar itself waits on the OAuth scope / device test above).

**Still open — founder-side, mostly dashboard (verified still open, no later confirmation found):**
1. RevenueCat dashboard: create the `pro` entitlement (id must match `eas.json`'s exact
   `"Tempo: Fitness Planner Pro"` string or purchases succeed but never unlock), 3 products
   (annual/monthly/lifetime), attach the offering, configure the intro offer.
2. Set the real `appl_`/`goog_` API keys (currently a `test_` store key).
3. Apply `add_app_config.sql` + allow-list the founder's uuid for TestFlight sandbox testing.
4. An **EAS build** — RevenueCat is native; a JS/OTA reload won't pick it up.
5. Wire the remaining `requirePro()` call sites from §A.4 (OTA-shippable once gate screens exist).
6. Finish the two Pro surfaces that are registered but not fully built: PR forecasting UI status —
   **now shipped** (`LAUNCH_SCORE_PLAN.md` T2.1) — and long-horizon/goal-date UI, still open.

**Sequencing:** `[A] finish remaining Pro surfaces (OTA)` → `[B] RevenueCat dashboard + EAS build` →
`[C] flip pro_enabled for founder only, sandbox-buy every SKU on TestFlight` → `[D] soft launch:
flip globally with value-moment triggers` → `[E] fast-follow Tempo Coach once retention holds (M4)`.

## A.6 — Why this design (compressed skeptical pass)

- *"Free is so good nobody upgrades"* — real risk; mitigated by the proof number making value
  visible, Pro pillars being weekly-useful (not nice-to-haves) to a committed trainer, and room to
  tighten later without touching the core loop.
- *"Giving away the crown jewel"* — we give away the *automatic* wedge, sell *control over* it
  (the Strava playbook). Gating the wedge itself (Fitbod's model) kills the funnel instead.
- *"Under-built Pro at launch"* — thin on just reschedule-week + muscle map + travel; addressed by
  not global-flipping Pro until the proof number + one foresight surface are in (both now done).
- *"App Store rejection"* — Apple rejects paywalls advertising unbuilt features; `proFeatures.ts`
  already enforces "only sell what ships today"; multi-calendar stays out of the paywall until its
  OAuth scope + device pass are done.
- *"Price shock"* — no existing paying cohort, so no grandfathering problem; set the price before
  anyone pays.

## A.7 — Decisions

**Settled (founder):**
- **Price (current, 2026-07-27):** $4.99/mo · $34.99/yr, live both stores. Intro offer flat $24.99/
  yr. Raise toward $7.99–$12.99/mo once Coach ships and apply-rate is measured.
- **Free/Pro line:** capped free tier (1 Tempo plan + 1 custom plan, 5 custom exercises, 5 saved
  custom workouts); core training loop uncapped.

**Still open (the founder's call):**
1. **Lifetime — offer it or not?** Recommendation: yes, ~$79.99–$99.99, priced to never undercut
   ~2–3 years of annual. Defensible to skip.
2. **Trial/intro length & type.** Currently a paid $24.99 first-year offer, not a free trial —
   revisit if conversion data suggests a trial would perform better.
3. **Exact cap tuning.** 1/1/5/5 is a sensible start; watch where committed users actually hit the
   wall (e.g. if 5 custom workouts is too tight or too loose to ever bind) and tune.

---

# §B — Tempo Coach

**True current status (contradiction in the source doc resolved):** **C1–C4 are built. C5
(metering UI, entry points, `PAYWALL_POINTS`) has not been started.** C1–C2 built 2026-07-22; C3–C4
built 2026-07-23 (C4 against a dev stub, `lib/coachStub.ts` / `EXPO_PUBLIC_COACH_STUB=1`, not live
model output — deliberate, since C3+C4 landing in one session deviates from the plan's own "one
batch per session" build order, and the stub gave the action layer deterministic inputs/its own
isolated diff instead of a nondeterministic one).

**Blocking on the founder, not on code — verified still open, no later deploy/key-set commit found:**
1. **Deploy the function** — `cd mobile && npx supabase functions deploy tempo-coach`. Never
   deployed; it does not exist in the Supabase project.
2. **Set the key** — `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (billing enabled).
   Without it the function returns 503 and the screen shows "Coach isn't available right now."

**Until both happen, the Coach screen opens and behaves correctly but cannot answer anything.**
`LAUNCH_SCORE_PLAN.md` (T2.2) explicitly sequences deployment as a **post-launch, retention-proven
fast-follow, not a launch blocker** — launch without it, keep it dormant, ship the moment retention
holds (that's also when the price can honestly rise).

**Also still open** (neither blocks C5): (a) provider choice for **free-tier** turns specifically —
Claude vs. a cheaper model, where the deciding axis is strict-schema tool-call reliability, not
price; (b) the **server can't see RevenueCat subscriptions** gap (§B.7) — must close before
`pro_enabled` goes global.

## B.0 — TL;DR

Tempo Coach is a chat surface where the user talks to their own training data and Tempo **proposes
concrete changes it can apply with one tap**. It's the reason to buy Pro.

- Anthropic API key, stored as a **Supabase secret**, called only from a new Edge Function — never
  an `EXPO_PUBLIC_*` var.
- **The Coach never writes to the database on its own** — it returns text + an optional proposed
  action; the app renders a confirm card; existing client lib functions do the actual write on Apply.
  This is the single most important design decision in the feature.
- Free users get **3 coach messages a month**. Running out is the paywall moment.
- One API round-trip per user message. No server-side agent loop, no duplicated business logic.

**Why it's different from every AI fitness chatbot:** Tempo already has the actions implemented as
library functions. ChatGPT can tell you to move your Tuesday workout; Tempo can move it. Every tool
in §B.4 is a thin wrapper over code that already exists and is already tested.

## B.1 — Architecture: propose on the server, apply on the client

```
app (React Native)
  coach.tsx
    buildCoachContext()  ← pure, reuses fitnessInsights/tempoScore/plan rows/calendar conflicts
    POST → Edge Function
    renders: text + ConfirmCard → on tap: executeAction()
                                     └── weekReschedule / substitutions / travelMode / ...

Edge Function: tempo-coach
  1. verify JWT
  2. check quota (coach_messages)
  3. call Claude (tools = intent declarations, NOT executed server-side)
  4. return { text, action | null }
```

**Why this shape, not a server-side agent loop:**
1. **No duplicated business logic** — `planWeekReschedule`, `getAlternatives`, `saveTravelMode` etc.
   live in `mobile/src/lib`; porting them into Deno would mean two copies of the scheduling engine
   drifting apart.
2. **Safe by construction** — the model cannot silently rewrite a training week; every write still
   goes through the same code path a button press uses, with the user's own session.
3. **One API call per message**, not a 2–4 call agent loop.
4. **Better UX** — "Here's what I'd change — Apply?" beats a schedule that mutated while reading.

**Tool-use is for intent selection, not execution.** The function declares the tools, Claude picks
one and fills typed arguments, the function reads the `tool_use` block and returns it as `action`
**without** sending a `tool_result` back (`stop_reason: 'tool_use'` is the terminal state).

**Text + action in one call:** the system prompt forces Claude to write 1–2 sentences before
proposing a change. If text comes back empty and a `tool_use` is present, the client renders a
locally-generated fallback sentence from the action args (e.g. `Move ${name} to ${day}?`) — never
ship an empty bubble.

**Impact on the rest of the app:** one new route `app/coach.tsx` (modal) · React Query for the send
mutation + local `useState` for the thread, **no new global store** (a coach thread is screen-local,
persisted to `coach_messages` for history) · one new table · four new analytics events · offline:
send disabled with an inline note, history reads from cache · purely additive migration.

## B.2 — Model & API

**Provider: Anthropic. Model: `claude-sonnet-5`** (changed 2026-07-23 from `claude-opus-4-8` —
decided, shipped). `$3 / $15` per MTok in/out, 1M context.

API details that matter on this model:
- `temperature`/`top_p`/`top_k` are rejected with a 400 — steer tone via the system prompt instead.
- Thinking is off unless requested — set `thinking: { type: 'adaptive' }` explicitly; the Coach has
  to reason about a real schedule before proposing a change.
- `budget_tokens` is removed (400) — depth is controlled by `output_config.effort` (default `high`;
  a latency-sensitive chat should start at `'medium'`).
- `max_tokens: 1500` is enough for a chat turn and stays under the SDK's HTTP timeout — v1 is
  non-streaming (streaming is a v2 polish item).
- **Strict tools:** `strict: true` at the top level of each tool def, `additionalProperties: false`,
  explicit `required` array — guarantees action args parse cleanly.
- Prompt caching is a no-op at v1 size (Opus/Sonnet's minimum cacheable prefix is 4096 tokens; the
  system prompt + tools are smaller) — revisit if the system prompt grows past ~4k.

## B.3 — Data model

New migration `mobile/supabase/add_tempo_coach.sql`:

```sql
create table if not exists coach_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  action      jsonb,              -- the proposed tool_use, if any
  action_state text check (action_state in ('proposed','applied','dismissed')),
  created_at  timestamptz not null default now()
);

create index if not exists coach_messages_user_created_idx
  on coach_messages (user_id, created_at desc);

alter table coach_messages enable row level security;

create policy "own coach messages" on coach_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- `action_state` is what makes the Coach measurable: **apply-rate is the metric this feature
  moves.** A coach whose proposals are never applied is a chatbot, and the data should say so.
- The weekly/monthly quota is a `count(*)` over `role = 'user'` since the start of the user's
  window — no separate counter table; one source of truth that survives reinstalls.

## B.4 — The tool surface (v1 — five tools)

Each maps to an executor that **already exists**; do not invent new capabilities before apply-rate
is measured.

| Tool | Args | Client executor | Notes |
|---|---|---|---|
| `reschedule_week` | `{ reason, busy_days? }` | `lib/weekReschedule.planWeekReschedule` → apply path in `(tabs)/plan.tsx` | Already Pro-gated as `schedule_optimization`. |
| `move_workout` | `{ workout_id, to_date, to_time? }` | `lib/moveWorkout` + `resyncMovedWorkout` | `to_date` is `YYYY-MM-DD`. |
| `swap_exercise` | `{ exercise_id, reason }` | `lib/substitutions.getAlternatives` → `saveSubstitution` | Reason drives the alternative filter (pain/equipment/preference). |
| `start_travel_mode` | `{ until, equipment[] }` | `lib/travelMode.saveTravelMode` | `equipment` values must match the `Equipment` union in `src/types`. |
| `explain` | `{ topic: plan\|progress\|deload\|session }` | none — read-only | Signals "this is an explanation" so the UI attaches a "See in Progress" deep link. |

Schema rules: `strict: true`, `additionalProperties: false`, explicit `required`, every property
gets a `description` — argument quality depends on it more than the system prompt. Be prescriptive
about *when* to call each tool, not just what it does. Tool list is a frozen, deterministically-
ordered constant (position 0 of the prompt; reordering would invalidate future prompt caching).

## B.5 — Client work

**`src/lib/coach.ts`:** `buildCoachContext()` (pure; composes existing derivations — profile, this
+ next week's `scheduled_workouts`, `adaptation_mode`/`week_index`, last-4-weeks stats, recent PRs,
weight trend, active travel mode, calendar conflicts, last 3 session feedback ratings; serialized
compactly with deterministically-sorted keys to avoid silently invalidating prompt caching) ·
`sendCoachMessage` · `fetchCoachHistory` · `describeAction` (the empty-text fallback sentence).

**`src/app/coach.tsx`:** follows existing screen conventions (`useTheme`, `Spacing`/`Radius`/
`CardShadow`, `ScreenHeader`/`DismissButton`, `PressableScale`, `track()` on every tap). Inverted
`FlatList` thread, `KeyboardAvoidingView` composer, typing indicator, **`ConfirmCard`** (icon +
summary + Apply/Not now; Apply runs the executor → optimistic UI → invalidation → `action_state`
write; failure uses `describeSaveError`, never a raw error string), empty-state starter prompts.
Any sub-sheet uses `TempoSheet` (RN `Modal`) — **not** `@gorhom/bottom-sheet` (renders nothing on
this RN 0.85/React 19/new-arch stack).

**Entry points (ship at least #1 and #2):**
1. Home — an "Ask your coach" row under the day card.
2. Plan tab — on a conflict/missed-session card, "Ask Tempo to fix it" pre-fills the composer.
3. Progress — under an insight, "Why?" opens Coach with `explain` context.

## B.6 — Gating & metering (the conversion mechanism)

```
free  → 3 coach messages per MONTH  (server-enforced)   ← founder call, 2026-07-23
Pro   → unlimited, soft cap 200/month to bound cost
```

**The most important product decision in the feature, and the reasoning is worth keeping:** the
tentpole has to be *tasted* — a user who's never seen the Coach fix their week has no reason to buy
it. Running out mid-conversation, right after it just did something useful, is the highest-intent
paywall moment the app has.

**The 3/month cap and its cost, recorded so the tradeoff isn't forgotten.** The original design was
3/**week**; the founder moved it to 3/month so free users "can't do much." Legitimate call, and it's
what's built — but it weakens the mechanism: at 3/week a free user hits the wall repeatedly, each
time right after the Coach proved useful, which is what makes the wall a *purchase* moment. At
3/month they hit it once, then face four weeks of a dead surface, which is what makes a wall a
*reason to stop opening the app*. **Watch the conversion rate on `paywall_shown{context:
'tempo_coach'}`** — if it's flat while Coach opens keep happening, the cap is too tight and 3/week
(or 5/month) is the fix, not more tools. Cost is not the reason to keep it tight: 3/month costs
roughly $0.08/user/month on `claude-sonnet-5` — a product lever, not a budget one.

**Implementation:** Edge Function counts `role='user'` rows since the start of the user's calendar
month; `>= 3` and not Pro → `402 { error: 'quota', remaining: 0 }`. Client shows remaining count in
the header when locked. `402` → `track('paywall_shown', { context: 'tempo_coach' })` → `/paywall`.
**Server checks entitlement itself** (reads `app_config.pro_enabled` + the user's row the way
`lib/proConfig.fetchProState` does) — never trusts a client-sent `isPro` flag. While Pro is dormant,
`locked` is false and everyone is unlimited (matches every other gate). `tempo_coach` goes into
`PAYWALL_POINTS` only once the screen ships (App Store rejects paywalls advertising unbuilt
features).

## B.7 — Cost model

At `claude-sonnet-5` rates: ≈ **$0.026/message** (≈ $0.017 while intro pricing ran through
2026-08-31). A Pro user at ~20 messages/month ≈ **$0.80/month**. A free user at the 3/month cap ≈
**$0.08/month** — 10,000 monthly-active free users at the full cap ≈ **~$800/month** (at the
original 3/week cap this line was ~$0.55/user, ~$5.5k/month — the cap change did most of the cost
work on its own).

**Model choice — decided, shipped.** `claude-sonnet-5` over `claude-opus-4-8`: near-identical
request shape (adaptive thinking, `output_config.effort`, strict tools), near-Opus on the axis that
matters (picking the right tool, only using ids that exist in context), roughly half the cost.
`claude-haiku-4-5` is ~5× cheaper again but doesn't support adaptive thinking or `effort` (400s on
both) and is the most likely of the three to fumble a five-tool choice.

**Non-Anthropic providers** (Grok, Gemini Flash, GPT-5-mini) are ~10–20× cheaper per token, but the
3/month cap already makes that saving marginal at Tempo's scale, and switching costs a second Deno
SDK, a different tool-calling dialect, and an unproven answer on strict-schema reliability — a
Coach that proposes moving a workout that doesn't exist is worse than no Coach. **Decision: stay on
Anthropic**, revisit only if the `usage` log line shows real spend at real scale.

**Levers if cost bites, in order:** (1) trim the context pack (biggest input line, easiest to
shrink) · (2) drop `effort` to `'low'` for free-tier turns · (3) route free-tier traffic to a
cheaper model — this one is a **product decision**, not an optimization (a visibly worse free Coach
undermines the taste-the-tentpole strategy); ask the founder before pulling it.

## B.8 — Analytics

```ts
coach_opened:          { entry: 'home' | 'plan' | 'progress' | 'tab' }
coach_message_sent:    { has_action: boolean; locked: boolean }
coach_action_proposed: { tool: string }
coach_action_applied:  { tool: string; outcome: 'applied' | 'dismissed' | 'failed' }
```

`coach_action_applied{outcome:'applied'}` is **the** metric — if proposals are made and never
applied, the Coach is decoration and `PRODUCT_AUDIT.html` should say so rather than celebrate
shipping it.

## B.9 — C5 scope (not started)

Server quota + `402` handling · remaining-count UI · paywall routing · the three entry points
(§B.5) · `tempo_coach` added to `PAYWALL_POINTS` · the four analytics events (§B.8) ·
`PRODUCT_AUDIT.html` update. This is the batch that turns the built-but-undeployed feature into a
shippable, paywall-honest one — but per §B (top) it's sequenced *after* the founder deploys the
function + sets the API key, and per `LAUNCH_SCORE_PLAN.md` T2.2, after launch + retention proof.

## B.10 — Edge cases

| Case | Required behavior |
|---|---|
| Offline | Send disabled with an inline note. History renders from cache. Never a hanging spinner. |
| Request fails / times out | Bubble stays with Retry. Do **not** consume quota — increment only on a successful reply. |
| Force close mid-send | User message already persisted, reply wasn't. On reopen show the orphan message with Retry. |
| User leaves and returns | History loads from `coach_messages` (cap last 20 for the prompt; render more). |
| Action proposed, then applied elsewhere | Re-validate on Apply: re-read the target row; if moved/completed, show "that already changed" and refresh — never blind-write. |
| Action proposed on a stale plan | Same guard — `workout_id` must still exist and be `scheduled`. |
| Two Applies at once | Disable button on first press; `action_state` transition is idempotent. |
| Quota exhausted mid-thread | `402` → inline "You've used your free coach messages for this month" + Upgrade. History stays readable. |
| Pro flipped off mid-session | Next send re-checks server-side; client `locked` follows the store. |
| Model returns no tool and no text | Should be impossible; show "I didn't catch that — try rephrasing" and log to Sentry. |
| Model proposes an action for a nonexistent workout | Validate args client-side before rendering the card. Invalid → text only, log to Sentry. |
| Model refuses (`stop_reason: 'refusal'`) | Check `stop_reason` before reading `content` (`content` can be empty). Show a neutral message. |
| Hits `max_tokens` | Show partial text + "…" affordance. Never render a truncated action. |
| Upgrading from an older app version | Purely additive; old builds simply lack the route. |
| Denied notification/calendar permission | Coach still works; can't propose calendar-dependent actions — reflected in the context pack. |

## B.11 — Why this design (compressed skeptical pass)

- *"It's a chatbot with extra steps"* — fair, if actions don't land. The whole defensibility is the
  Apply button; if `coach_action_applied` stays near zero post-launch, say so in the audit rather
  than add more tools.
- *"Free users will burn the API budget"* — quantified in §B.7; mitigated by a server-enforced,
  DB-backed (unbypassable) counter and four cost levers in priority order.
- *"Propose/apply feels less magical than a real agent"* — true, but an agent that silently rewrites
  a training week with no undo is a trust-destroyer the first time it's wrong. Revisit only after
  apply-rate proves people trust the proposals.
- *"Context pack drift"* — `buildCoachContext` composes ~8 existing derivations; if one changes
  shape the Coach silently degrades. Mitigated by a C2 unit test asserting context shape.
- *"Latency"* — adaptive thinking + a 2k-token context isn't instant; start at `effort: 'medium'`,
  real typing indicator, streaming is the first v2 item if it feels slow on device.
- *"App Store review"* — an AI feature needs an accurate third-party-processor privacy disclosure
  and must not give medical advice; the system prompt has an explicit medical-question refusal
  ("I'm not able to diagnose an injury...").

Two things this plan deliberately does **not** do, and shouldn't be talked into doing: execute
writes on the server (keep the confirm tap), and add tools beyond the five in §B.4 before apply-rate
is measured.
