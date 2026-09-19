# Tempo — Design Reference & Strategy

> This is the single design doc for Tempo, merging what used to be two files:
> `DESIGN_HANDOFF.md` (a screen-by-screen inventory of the live app) and
> `DESIGN_STRATEGY.md` (the "Ink Instrument" redesign brief). Both are folded in
> here; treat this file as canonical going forward.
>
> **Structure:**
> 1. Product identity & positioning (evergreen)
> 2. Current design system reference (colors/type/spacing/components, corrected to live tokens)
> 3. Screen inventory (dense reference map of every screen)
> 4. Redesign strategy ("Ink Instrument" — partially shipped, partially still open)

---

## 1. Product identity & positioning

Tempo is **precision fitness scheduling**: it builds a training plan around your real
calendar (work, school, sleep, off-days) and adapts week to week. The plan + calendar
integration *are* the product; logging, progress, and social are supporting acts. Every
pixel should answer one question:

> **"Does this help a busy person stay consistent with fitness?"**

**Design personality:** *Intelligent · Athletic · Calm-Premium.* Tempo is the **quiet
coach with a clipboard**, not a hype machine. It is confident and precise (mono numerals,
electric blue, near-black ink) but never shouty. This deliberately **rejects**
"Aggressive Performance / Command Center / tactical MISSION-LOG-DEPLOY" energy — that
serves hardcore lifters chasing 1RMs, which is the *opposite* of Tempo's busy-generalist
user who needs reassurance and low friction. Tempo's edge is *composure under a packed
calendar,* not adrenaline.

**Emotional goals (the feeling map):**

| Moment | Feel |
|---|---|
| Opening Tempo | *"It already handled it."* Instant clarity: here's today, here's when, one tap to start. |
| Planning / scheduling | *"Smart and effortless."* The calendar did the thinking; I approve. |
| Completing a workout | *"Earned."* A crisp, premium celebration — not a slot machine. |
| Maintaining a streak | *"Momentum I don't want to break."* Gentle stakes, gold accents, never anxiety. |
| Hitting a goal / PR | *"Proof I'm progressing."* Data that feels like a trophy. |

**Brand positioning (vs the field):**
- **Strong / Hevy** = manual logbooks for lifters. Tempo = *plans and schedules for you.*
- **Fitbod** = generates a workout. Tempo = generates a workout **and puts it in your week.**
- **MyFitnessPal** = food. Not our lane.
- **Apple Fitness / Google Fit** = activity mirrors. Tempo = *forward-looking planner.*
- **WHOOP / Garmin** = recovery/performance instruments for the obsessed. Tempo *borrows
  their legibility* (rings, readiness) but stays **calendar-first and low-effort**, not
  data-for-its-own-sake.

> **One-line position:** *The only fitness app that schedules your training around your
> real life — and makes staying consistent feel effortless and premium.*

**Signature identity moves** (from the live component/token system — this is what makes
Tempo *ownable*, not generic, and should survive any future redesign):
- **The pulse** — Tempo's metronome motif (wordmark dot, loaders, celebrations).
- **Electric blue** — the single, ownable primary accent; never diluted across the UI.
- **Mono numerals** — metrics read like a dial, not body text (JetBrains Mono in the
  live-session instrument specifically; see §2).
- The **calendar-native schedule feed**, the **"why this" coaching voice** (target
  reasons, plan explainer, quick-workout rationale), the **readiness ring**, and the
  **Wrapped share cards** are the functional differentiators worth protecting in any
  redesign.

---

## 2. Current design system reference

**Vibe:** dark, sports-performance (Whoop / Strava energy) by default, with a full light
("Paper") mode also implemented. Near-black backgrounds, near-white text, a single
electric-blue accent, ember as a secondary "energy/now" accent, gold for records. Flat
cards with hairline borders and soft shadows.

### Color tokens — corrected to live values

> **Correction note:** the original `DESIGN_HANDOFF.md` color table below was **stale**
> (it quoted primary `#3D82F7` / surface `#0C0D10`, an earlier palette). It has been
> verified against and replaced with the actual live tokens in
> `mobile/src/constants/theme.ts` (read directly, not just copied from the strategy doc's
> summary table). **Use the table below as authoritative — do not reintroduce the old
> `#3D82F7` / `#0C0D10` values.**

Source: `mobile/src/constants/theme.ts`, exported as `Palettes.dark` ("Ink", default) and
`Palettes.light` ("Paper"). Both palettes implement the exact same key set (`Palette`
type), so no component can read an undefined color switching themes.

**Ink (dark, default):**

| Token | Hex / value | Use |
|---|---|---|
| `surface` | `#0F1014` | screen background (darkest) — **E0 base** |
| `background` | `#181A20` | cards / elevated surfaces |
| `surfaceContainerLow` | `#14161B` | chips, inputs, secondary cards |
| `surfaceContainer` | `#1F232B` | **E1 card** fill |
| `surfaceContainerHigh` | `#262A33` | **E2 hero/sheet** fill, progress tracks, skeletons |
| `text` | `#F3F4F7` | primary text |
| `textSecondary` | `#AFB5C1` | secondary text |
| `outline` | `#6E7480` | tertiary text / muted icons |
| `outlineVariant` | `#272B34` | hairline borders / dividers |
| `primary` | `#4E8BFF` | the one accent (electric blue) — structure & schedule |
| `primaryContainer` | `#1E4FD0` | pressed/hover state |
| `primaryBright` | `#6BA0FF` | on-dark emphasis |
| `primaryLine` | `rgba(78,139,255,0.32)` | outline emphasis |
| `onPrimary` | `#FFFFFF` | text/icons on blue |
| `primarySoft` | `rgba(78,139,255,0.14)` | blue tint fills |
| `ember` (secondary accent) | `#FF6A45` | energy / "now" / overdue / heat — never body text |
| `emberSoft` / `emberLine` | `rgba(255,106,69,0.16)` / `rgba(255,106,69,0.32)` | tint fills / outlines |
| `secondary` / `secondaryContainer` / `onSecondary` | `#9BA3AF` / `#232830` / `#0B0B0D` | neutral secondary role |
| `success` / `successSoft` | `#22C55E` / `rgba(34,197,94,0.16)` | done / positive / on-track |
| `error` / `errorContainer` | `#FF6B6B` / `#3A1414` | destructive / negative |
| `dangerSoft` | `rgba(255,107,107,0.16)` | soft danger fill |
| `gold` / `goldSoft` | `#D9A13B` / `rgba(217,161,59,0.18)` | records, achievements, streak milestones |
| `warning` / `warningSoft` | `#F2B84B` / `rgba(242,184,75,0.16)` | caution states (reuses ember family for "streak at risk" rather than a new hue elsewhere) |
| `readyHigh` / `readyMed` / `readyLow` | `#22C55E` / `#F2B84B` / `#FF6A45` | readiness/forecast semantic states |
| Calendar-event accents | work `#EA4335` · personal `#A855F7` · school `#F59E0B` | so a slotted Tempo workout reads distinct from real calendar events |
| `glass` / `glassBorder` / `glassHighlight` | `rgba(255,255,255,0.045)` / `rgba(255,255,255,0.09)` / `rgba(255,255,255,0.14)` | E2 glass fill + edge highlight — sparing use (hero cards, sheets), never wall-to-wall |
| `scrim` / `scrimHeavy` | `rgba(0,0,0,0.55)` / `rgba(15,16,20,0.82)` | modal backdrop dim / opaque Pro-teaser blackout |
| `chartGrid` / `chartAxis` / `chartLabel` | `rgba(255,255,255,0.06)` / `#333A45` / `#AFB5C1` | Progress dashboard chart system |
| `primaryGlow` / `emberGlow` / `goldGlow` | `rgba(78,139,255,0.22)` / `rgba(255,106,69,0.20)` / `rgba(217,161,59,0.20)` | soft low-opacity glow behind a hero ring/metric, one per screen |
| `controlActive` | `#262A33` | the raised pill inside a segmented control's trough — **has its own token because the dark and light elevation ramps run in opposite directions**; sharing `background` made a selected segment invisible in dark mode (found 2026-07-22 on Availability → Preferred time to train) |
| `backgroundElement` / `backgroundSelected` (legacy aliases) | `#1F232B` / `#232830` | kept for not-yet-migrated components |

**Paper (light mode)** — same key set, warm near-white + a deeper blue for AA contrast on
white: `surface #FCF8F9`, `background #FFFFFF`, `text #1B1B1C`, `textSecondary #414755`,
`primary #0058BC`, `ember #FB5733`, `gold #A87A1C`, `success #16A34A`, `error #BA1A1A`.
Calendar-event accents are unchanged across modes. Full table lives in `theme.ts`.

> **Color law:** Blue = the plan/schedule. Ember = now/urgency. Gold = achievement. Green
> = on-track. If a screen uses all four with equal weight, it's wrong — pick the one the
> moment is about.

> **Badge tiers:** `mobile/src/lib/badges.ts` defines a `BadgeTier = 'bronze' | 'silver' |
> 'gold'` concept used across ~13 badges, but the actual tier hex values (originally
> documented in `DESIGN_HANDOFF.md` as `#B45309` / `#64748B` / `#B8860B`) are **not**
> central tokens in `theme.ts` — they're rendered locally (see `BadgeShelf.tsx` /
> `PRCard.tsx`). Treat those specific hex values as unverified/component-local, not
> confirmed design-system tokens.

### Typography

> **Correction note:** `DESIGN_STRATEGY.md`'s typography table claimed a "Display / Hero"
> face of **Bricolage Grotesque 800**, describing it as "✅ Identical — keep" versus the
> Stitch concepts. That is **not what's live**. `theme.ts` explicitly sets
> `fontDisplay: 'Inter_800ExtraBold'` and its own inline comment states the choice was
> deliberate: *"display — Inter ExtraBold set tight (negative tracking)... Deliberately
> the same family as body copy: hierarchy comes from weight + size + tracking, not a
> second typeface. One font file family = faster cold start, no mismatch."* A repo-wide
> search found zero references to "Bricolage" anywhere in `mobile/src`. So: **Tempo is
> Inter-only for display/body today**, with JetBrains Mono reserved for the live-session
> numeric instrument. Any future work should treat "add Bricolage Grotesque as a display
> face" as a genuinely new (unshipped, unverified-as-approved) proposal, not a confirmed
> current-state fact.

| Role | Face | Use |
|---|---|---|
| Display / Hero | `Inter_800ExtraBold` | Screen titles, hero headlines, big stat numbers on cards |
| Section header | `Inter_700Bold` | Card titles, section labels |
| Metric (instrument) | `JetBrainsMono_700Bold` (weight `_500Medium` also defined) | **Only** the live-session set/rep/weight table + timer, and dial-style readouts — tabular alignment matters there |
| Body / UI | `Inter_400Regular` / `_500Medium` / `_700Bold` | Everything else |
| Caption / label-caps | Inter 700, 12px, `letterSpacing 0.6`, uppercase | Eyebrow labels ("TODAY'S SESSION") |

Headlines are ExtraBold with tight negative letter-spacing (`-0.3` to `-1`). The "TEMPO"
wordmark appears at more than one size/letter-spacing across the app (ExtraBold 26px on
Schedule; ExtraBold 15–16px with `letterSpacing 2` elsewhere) — flagged as an
inconsistency worth a single defined lockup (see §4 opportunities).

**Type scale** (`Typography` in `theme.ts`): `display 40 / headlineLg 32 /
headlineLgMobile 28 / headlineMd 24 / bodyLg 18 / bodyMd 16 / bodySm 14 / labelCaps 12 /
metricXl 48 / metricHero 64` (the last is an additive role for the single biggest number
on a screen — Consistency Index, Readiness).

### Spacing, radius, shadow, motion

**Spacing** — 4px grid (`Spacing` in `theme.ts`): `xs 8 / sm 12 / md 16 / lg 24 / xl 32 /
2xl 48 / 3xl 64`, `containerPadding 20`, `cardGutter 16`. `BottomTabInset` = 96
(iOS/Android) — every scroll view must clear the floating tab dock.

**Radius** (`Radius`): `sm 8` inputs/chips · `md 12` inner elements · `lg 16` default card
· `xl 24` sheets & hero cards · `full 9999` pills/rings/FAB. Semantic aliases also exist:
`chip 10 / card 20 / sheet 28 / pill 9999`.

**Shadow** — legacy `CardShadow` (one soft shadow, kept for existing callers) plus an
additive `Elevation` ramp: `e0` flat, `e1` resting card, `e2` hero/sheet, `e3`
popover/celebration — each a heavier shadow than the last, `e2`/`e3` meant to pair with
the `glass*` tokens.

**Motion** (`Motion`): `fast 160 / base 240 / slow 360` plus additive semantic durations
`micro 120 / celebrate 600 / stagger 45`, spring `{friction 6, tension 120}`. One shared
clock for the whole app.

### Recurring components / patterns (reused on almost every screen)
- **Screen header** — left back/close icon, centered "TEMPO" wordmark (or a screen
  title), right avatar or action icon.
- **Eyebrow + Title** — tiny uppercase label above an ExtraBold headline.
- **Card** — `background`/`surfaceContainer` fill, 1px `outlineVariant` border, `xl`
  radius, soft shadow.
- **Pill chip** — rounded-full, blue when active, outline when not. Used for filters,
  durations, days.
- **Segmented control** — `surfaceContainerLow` track, the selected segment lifts to
  `controlActive`.
- **Primary button** — full-width, height 52–56, blue, white bold label. Disabled = grey fill.
- **Bottom-sheet modal** — dark sheet (RN `<Modal>`, **not** `@gorhom/bottom-sheet` —
  that library silently renders nothing on this RN0.85/React19/new-arch stack), top drag
  handle, slide-up, dimmed backdrop; used for all pickers/editors.
- **Progress bar** — 3px track, blue fill (onboarding steps + in-workout).
- **Icons** — Ionicons throughout (outline when inactive, filled when active).

---

## 3. Screen inventory

Dense, complete reference map of every screen in the live app — colors, type, and
component-level detail. This is a map, not a plan; nothing here constrains future
redesign work (see §4 for that).

### Navigation map

```
sign-in  →  onboarding (goal→experience→equipment→schedule→availability→plan-preview→profile-setup)  →  (tabs)
(tabs): Schedule | Workouts | Progress | Profile
Modals (slide-up): quick-workout, smart-scheduler, availability, travel-mode, legal,
                   weekly-report, plan-explainer
Full-screen: workout-complete (fade, no gesture dismiss)
```
Tab bar: 4 tabs, blue active / grey inactive, Ionicons (calendar, barbell, trending-up,
person), labels "Schedule / Workouts / Progress / Profile".

> Note: `DESIGN_STRATEGY.md` (§4) refers to these same four tabs by different working
> names — **Today / Train / Progress / You** — when discussing the redesign. Both label
> sets refer to the identical four tabs/routes (`(tabs)/index.tsx`, `(tabs)/plan.tsx`,
> `(tabs)/progress.tsx`, `(tabs)/profile.tsx`); "Today/Train/You" is redesign-strategy
> vocabulary, not a second navigation structure. See §4's explicit rejection of any tab
> *relabeling*.

### Auth & onboarding

**Sign-in (`sign-in.tsx`)**
- **Logo area:** the Tempo tile logo (88×88, rounded, blue glow shadow).
- **Hero:** "Tempo" wordmark + tagline "Precision fitness scheduling for your peak performance."
- **Actions (stacked buttons):**
  - **Sign in with Apple** (iOS only) — black Apple button with icon.
  - **Sign in with Google** — light button, "G  SIGN IN WITH GOOGLE".
  - **Continue as guest** — text link (anonymous auth).
  - **Legal line:** "By continuing you agree to Tempo's Terms of Service and Privacy Policy."
- Each button shows an inline spinner while its provider authenticates.

**Onboarding (6 visible steps + a final "make it yours")**
Shared chrome on every step: header (back, "TEMPO", spacer), a **3px progress bar** that
fills 20→40→60→66→83→100%, an eyebrow "STEP n OF 6", an ExtraBold question title, a grey
subtitle, and a blue **Continue** CTA pinned at the bottom (disabled grey until valid).

1. **Goal** (`goal.tsx`) — 5 selectable rows, each = icon tile + label + description:
   Build Muscle, Lose Fat, Gain Strength, Athletic Performance, General Fitness. Selected
   row gets a blue border + blue icon tile.
2. **Experience** (`experience.tsx`) — a 3-way **segmented control** (Beginner /
   Intermediate / Advanced) + a preview card with a barbell glyph and an italic
   descriptive quote that changes per level.
3. **Equipment** (`equipment.tsx`) — multi-select rows (Full gym, Dumbbells only,
   Barbell & plates, Resistance bands, No equipment), each with a check circle that
   fills blue.
4. **Schedule** (`schedule.tsx`) — "Choose your calendar." **Days per week** selector
   (2/3/4/5 as round chips) + **Connect Google Calendar** / **Connect Device Calendar**
   buttons (real OAuth / OS permission; shows a green "connected" badge), a "WHY
   CONNECT?" checklist, and a faux **calendar preview** showing a meeting + a
   dashed-outline "IDEAL TRAINING WINDOW" workout block. Footer also has a "Maybe later" skip.
5. **Availability** (`availability.tsx`) — "When does life happen?" Sleep (wake/bedtime
   time rows), Work hours (toggle + start/end), School hours (toggle + start/end),
   Preferred time to train (Morning/Afternoon/Evening segmented), and **Days I never
   train** (Mon–Sun chips, e.g. Shabbat). Time rows open the custom **TimePickerSheet**.
   Has a top "Skip".
6. **Plan preview** (`plan-preview.tsx`) — "Your plan is ready." A program card (PROGRAM
   eyebrow + generated name like "Beginner Full Body (3x/week)") with a details list
   (Goal, Experience, Days, Duration ~45 min, Length 4 weeks then repeats), plus a blue
   "adapt note" reinforcing that the plan reshapes around real life. CTA **"Let's Go →"**
   builds the plan (shows "Building your plan…").
- **Profile setup** (`profile-setup.tsx`) — final "Make it yours." Live avatar preview,
  display-name input, a grid of colored avatar presets (icon on colored circle, blue
  check when selected). CTA **"Enter Tempo →"**. Has a "Skip".

### Tab 1 — Schedule (`(tabs)/index.tsx`)
The home screen and the most complex. Dark, scrollable, pull-to-refresh.

- **Header:** "Tempo" wordmark + today's date; a **readiness ring** (tappable — opens the
  recovery check-in; shows a 0–100 number colored green/blue/red, or a pulse icon if not
  checked in); a **profile avatar** (tappable).
- **Day / Week / Month** segmented control.
- **Travel-mode banner** (if active) — airplane icon + "Travel mode · <equipment> ·
  <until>", taps into Travel Mode.
- **Range row** — current range label ("Oct 21 – 27" / "October 2026" / weekday), a
  "Today" chip when off-range, and ‹ › arrows.
- **Calendar** — a 7-day **week strip** (S M T W T F S, day pills; today outlined,
  selected filled blue; a dot under days with workouts — green if all done) OR a
  **month grid** (6×7 cells).
- **Block-phase banner** — "Week n · <Base/Build/Peak/Deload>", note text, leaf/▲/barbell
  icon; taps into the Plan Explainer. Deload variant tinted green.
- **Goal countdown card** — projected ETA toward the goal (headline + sub + thin progress bar).
- **Weekly report row** (Sun/Mon only) — blue card "Your weekly progress report → ".
- **Quick Workout row** — the wedge feature: icon + dynamic headline/sub (a smart
  suggestion) + arrow.
- **Missed-workout banner** — "Missed <focus> +N more / No worries — let's find a new
  slot" + **Reschedule** button.
- **Rest-day banner** — bed icon + advice when recovery is overdue (green).
- **Unified feed** — a timeline grouped by day (Today/Tomorrow/weekday headers, a live
  dot on today). Each item is rendered on a **time rail** (left = time):
  - **Workout card** — badge ("TODAY'S WORKOUT" hero / "WORKOUT" / "DONE"), barbell tile,
    focus title, meta chips (time, duration), a blue **Start Session** button, and card
    actions **Add to Calendar / In Calendar** and **Edit**. The hero (today's next) gets
    a soft blue glow wash.
  - **Calendar event** (muted) — inferred icon (school/work/meal/etc.), title, time, and
    an **Ignore / Undo** action (lets Tempo schedule over it; shows struck-through when
    ignored).
  - **Rest day** — moon icon "Rest day — recovery is part of the plan."
  - **Rich empty state** — when the range is empty but a future workout exists: a "YOUR
    PLAN" card (goal, phase chip, streak chip, next workout + Start) so the screen is
    never dead.
- **FAB** — floating blue lightning button (bottom-right) → Quick Workout.
- **Sheets mounted here:** Recovery check-in, Edit-workout.

### Tab 2 — Workouts / active session (`(tabs)/plan.tsx`)
The live workout-logging screen.

- **Header:** back arrow, "TEMPO" wordmark, avatar.
- **Session bar:** "ACTIVE SESSION" eyebrow + focus title (left); "EST. N MINS" + a live
  **MM:SS timer** (right).
- **Progress bar** — fills as sets are completed.
- **Banners** (contextual): travel-mode (adapted to your gear), deload week (green,
  "lighter on purpose"), or peak week ("extra set per lift").
- **Exercise cards (accordion)** — each row: **GIF thumbnail** (animated form clip),
  exercise name, primary muscles (uppercase), a `done/total` count, chevron. Expanded:
  - **Today's Target card** (blue) — "TODAY'S TARGET: 135 lbs · 8–10 reps × 3" + a
    direction badge (GO UP / HOLD / BACK OFF) + a one-line reason (autoregulated from
    last session).
  - **Form guide** + **Swap** pill buttons (Form opens the Exercise Form sheet; Swap
    offers equipment-aware substitutes via an alert list).
  - **Set table** — columns SET / PREV / LBS / REPS / ✓. Each row has numeric inputs and
    a check circle; tapping ✓ reveals an inline **RPE bar** (6–10 + skip), then the row
    locks as done and auto-starts a rest timer. "+ Add Set".
- **Complete Workout** — full-width blue button → workout-complete.
- **Floating tools** (bottom-right stack): **rest timer** button (preset 60/90/120s) and
  an **exercise list** button. An active **rest pill** (dark, "Rest · MM:SS", Skip)
  floats at the bottom.
- **Form sheet** mounted here.

### Tab 3 — Progress (`(tabs)/progress.tsx`)
Performance dashboard. Header: "TEMPO", a **Share** icon (opens Wrapped share cards), a
bell (placeholder alert), avatar.

- Title block "YOUR PERFORMANCE / Progress Overview".
- **Consistency ring** — a custom-drawn circular ring showing completion %, center label
  "X% / TARGET MET|KEEP GOING", caption "X% completion in last 30 days".
- **Streak card** (solid blue) — flame + "CURRENT STREAK" + big number + "days" + caption.
- **Next milestone** card — the closest locked achievement with a progress bar + "N to go".
- **Completion rate** card — % + delta vs last month + bar.
- **Volume lifted** card — big lbs number + **W / M / 6M** period toggle + a mini bar
  chart (current bar highlighted blue).
- **Personal records** — rows of barbell icon + lift name + date + max weight.
- **Achievements** — a 3-wide badge grid; unlocked badges are tier-colored
  (bronze/silver/gold), locked ones are dimmed with a lock dot and progress text. "N of M".
- **Share sheet** mounted here.

> **Status:** per `ARCHITECTURE.md` (~lines 1026, 1313, 1813) and confirmed commit
> history, this tab has since been **restructured into a "Fitness Intelligence
> dashboard"** per the redesign strategy's Step 9 recommendation (§4) — that work is
> **shipped on `main`**, so the description above (consistency ring + streak card +
> single volume chart) reflects the screen's state *before* that redesign shipped, not
> necessarily its exact current layout. Re-audit this screen directly before relying on
> the element list above for pixel-level work.

### Tab 4 — Profile (`(tabs)/profile.tsx`)
Gaming-flavored profile + all settings. Header: "TEMPO" + edit (pencil) icon.

- **Hero banner** (colored by avatar) — a "LVL n · TITLE" chip, large avatar, display
  name, goal·experience subline, a **level progress bar**, and "N more workouts to Level n+1".
- **Stat grid** (2×2 tiles, each taps to Progress): Workouts, Day streak, Lbs lifted,
  Badges (N/M).
- **Achievements** badge grid (same as Progress).
- **Body Stats** — weight trend card: current 7-day avg, weekly trend (lb/wk), total
  change, plus optional body-fat % and waist chips. "Log entry" opens the **measurement
  modal** (weight, body fat %, waist, **progress photo** attach). Empty state explains
  the trend feature.
- **Personal Records** — top 4, "View all".
- **Exercise Swaps** — saved substitution preferences (original → substitute rows); tap
  opens the **swap editor modal** (pick a different alternative or revert to original).
  Empty state explains how swaps are remembered.
- **My Plan** card — setting rows: Primary goal, Experience, Days per week, **Equipment**
  (opens equipment modal), **Injuries & limitations** (opens injury modal —
  knees/back/shoulders/etc.), **Travel mode** (opens Travel Mode), and a **Change Plan**
  link (re-runs onboarding).
- **Settings** card — **Availability & schedule** (→ Availability), **Calendar** (choose
  Google/Device, shows connection status), **Notifications** (a Switch — server push
  on/off for this device), **Privacy & Terms** (→ legal).
- **Sign Out** (red) and **Delete Account** (red, double-confirm, App-Store-required) + hint.
- **Modals mounted here:** Edit profile (name + avatar grid), Equipment, Injuries, Log
  measurement, Swap editor. All are dark bottom sheets with a drag handle, title, hint,
  options, and a blue Save.

> Per §4, the strategy doc flags this screen's **Settings section as a long
> undifferentiated list**, with Calendar & Scheduling (the product's core differentiator)
> demoted to a single settings row — this is called out as the biggest opportunity on
> this screen and is **still open** (not yet built).

### Standalone feature screens

**Quick Workout (`quick-workout.tsx`) — modal**
The flagship "build a session for the time you have" flow.
- Header: close (×), "Quick Workout".
- "How much time do you have?" + **duration chips grid** (e.g. 5/10/15/20/30/45 min squares).
- "FOCUS" — a horizontal scroll of **purpose chips** (Strength / Muscle / Conditioning /
  Athletic / Recovery / Mobility), default inferred from the user's goal.
- **Generated preview card** — purpose badge + "~N min", title, a blue **"Why this" box**
  (sparkles + reasoning — never a random list), the **exercise list** (index, name,
  muscles, sets×reps dose), and a "WHY IT COUNTS" long-term-contribution box. Loading +
  empty states.
- Sticky footer: **"Start N-Minute Workout"** (blue, play icon).

**Workout Complete (`workout-complete.tsx`) — full-screen**
- Big blue **checkmark badge**, "Nice work.", and a motivational **lead line** (chooses
  the most motivating true stat — streak, volume vs last week, etc.).
- **PR card** (gold) if any personal records were hit this session.
- **Streak card** (blue), two **stat tiles** (Consistency, This Week n/target), **Weekly
  target** progress bar.
- **"How did that feel?"** — Too easy / Just right / Too hard (feeds adaptation); shows a
  confirming sentence after choosing.
- Quick-workout note (if applicable). Footer: **Share a card** + **Done**.

**Weekly Report (`weekly-report.tsx`) — modal**
"Your Week" recap: workouts + consistency tiles, **Volume lifted** card (with up/down
delta pill), **Estimated strength** ("Up in N lifts" + per-lift +est. 1RM gains), Weight
trend + New PRs tiles, and **"Share my week"**. Empty state when no sessions yet.

**Smart Scheduler (`smart-scheduler.tsx`) — modal**
Google-Calendar-driven weekly auto-scheduler.
- Disconnected state: connect icon + "Connect Google Calendar" + explanation + connect button.
- Connected: a **plan summary** (duration / ×per week / goal chips) + **preferred-time**
  segmented; a **"YOUR WEEK"** list (7 days; each shows a workout pill in tomato-red or
  "Open"/"N events"); primary **"Smart Schedule My Week"** (sparkles); on success a green
  summary card listing the built sessions; "Disconnect Google Calendar" secondary link.

**Travel Mode (`travel-mode.tsx`) — modal**
Airplane hero + explanation. "WHAT DO YOU HAVE RIGHT NOW?" equipment multi-select; "HOW
LONG?" duration chips (Just today / This weekend / 1 week / 2 weeks / Until I turn it
off); optional label input. Active badge when on. Footer: **"I'm back home"** (clear) +
**Turn on / Update travel mode**.

**Availability (`availability.tsx`) — modal (settings version)**
Full version of the onboarding availability step + extras: Sleep, Work, School,
Preferred time, **Days I can train** chips, **Times I'm completely unavailable**
(add-block form: days, all-day toggle or from/until times, label), **Schedule
flexibility** (Strict / Balanced / Flexible radio cards), and **Sync workouts to**
(Google / Device segmented). Blue **Save**. Uses TimePickerSheet.

**Plan Explainer (`plan-explainer.tsx`) — modal**
"Why this week." A phase card (Base/Build/Peak/Deload/Maintain with plain-language
explanation), a **"THIS WEEK'S DIALS"** card (Volume / Intensity / Recovery rows), an
adaptation-mode note, and the next-deload timing. Deload styled green.

**Legal (`legal.tsx`) — modal**
In-app Privacy Policy + Terms of Use (plain-language sections). Support email
`fittempo.app@gmail.com`.

### Shared sheet components
- **TimePickerSheet** — custom dependency-free 12-hour time list in 15-min steps (rows
  with a blue check on the selected); optional "Clear". Used by all time fields.
- **RecoveryCheckIn** — daily check-in sheet: 4 metrics (Sleep, Energy, Soreness, Stress)
  each a 1–5 scale of buttons with low/high hints, a live **READINESS /100** preview,
  blue **Save check-in**.
- **EditWorkoutSheet** — move a workout: horizontal **next-14-days** chips + a time
  button (TimePickerSheet) + **Save changes** + **Remove from schedule** (red). Keeps
  the calendar in sync.
- **ExerciseFormSheet** — form guide: uppercase "<pattern> · FORM GUIDE" eyebrow,
  exercise name, a **GIF hero** (animated demo, loading skeleton, fallback, optional
  "Watch video" pill), **Muscles worked** chips (primary blue / secondary grey), numbered
  **How to do it** steps, **Equipment** chips, blue **Done**.
- **ShareCardSheet + WrappedCard** — "Share your card": card-type chips (Weekly /
  Streak / PR / Goal / Month / Top Lifts / Weight), a rendered **WrappedCard** preview,
  an auto-caption box with **Copy caption**, and **Share image** (snapshots the card to
  PNG → OS share sheet).

### What's strong (should survive any redesign)
The **calendar-native schedule feed**, the **"why this" coaching voice** (target reasons,
plan explainer, quick-workout rationale), the **readiness ring**, and the **Wrapped share
cards**. These are the differentiators.

### What read as generic (the original opportunity list)
- **One-accent dark theme** — competent but not distinct on its own (the strategy in §4
  addresses this via elevation/glass/ember/gold layering rather than a repaint).
- **Repetitive card-on-dark layout** — nearly every screen is the same stacked rounded cards.
- **Wordmark inconsistency** — "Tempo" appears at several sizes/letter-spacings; a single
  defined logo lockup would tighten it.
- **Typography is Inter-only** (confirmed still true, see §2's correction note on the
  Bricolage Grotesque claim) — a characterful display treatment for headlines/numbers
  (this app is very number-heavy: timers, weights, streaks, %) could carry personality.
- **Iconography is stock Ionicons** — a custom icon set or a consistent weight/treatment
  would de-genericize it.
- **Empty/loading states** are functional but plain — prime spots for brand personality.

---

## 4. Redesign strategy — "Ink Instrument"

> **Status (as of 2026-07-30):**
> - The **Progress → "Fitness Intelligence dashboard"** recommendation from Step 9 below
>   is **SHIPPED** — confirmed via `ARCHITECTURE.md` (~lines 1026, 1313, 1813) and real
>   commits on `main` (not just planned). Treat the Progress-tab redesign content below
>   as **historical rationale for shipped work**, and re-check the live Progress screen
>   directly rather than assuming the pre-redesign element list in §3 still applies.
>   Tokens (elevation/glass/chart-palette/`metricHero`, all confirmed present in
>   `theme.ts` — see §2) were added additively to support this.
>   Todo before implementation.
> - The **Today / Train / Profile screen-by-screen plan** (Step 7, the bulk of Step 5's
>   hierarchy work, and the onboarding/session-runner re-skin) is **STILL OPEN** — it has
>   not shipped. This is live, current strategy, not a historical record, and it is
>   **pending founder approval before implementation**, per this section's own Step 2
>   framing ("the design brief to be approved before any implementation").
> - The original header on this content ("Status: PLANNING ONLY — no code, no
>   components, no screen changes") is **corrected** by the above: it is no longer
>   accurate as a blanket statement now that Progress has shipped from it. Treat status
>   per-recommendation, not as one uniform flag.

This strategy is grounded in three sources: (1) the **live Tempo app** (device
screenshots), (2) the **real codebase** (routes in `mobile/src/app`, tokens in
`mobile/src/constants/theme.ts`, `ARCHITECTURE.md`), and (3) **16+ Stitch design
concepts** for a "Tempo Fitness OS" project (8 distinct "Today" directions plus Train /
Progress / Profile variants).

### The single most important finding

**Tempo already has a mature, ownable design system.** The Stitch concepts were
generated *from* Tempo's existing brand ("Brand Refined" variants), so they are not a
rebrand proposal — they are a **refinement** of a language that already ships. (The
token-parity table that originally lived here has been superseded by §2's corrected,
complete live-token table — see §2's correction notes for exactly where the original
comparison was accurate, namely colors, and where it wasn't, namely the Bricolage
Grotesque display-face claim.)

**Strategic consequence:** the redesign's job is **not** "pick a new look." It is:
1. **Raise the ceiling** on layout quality, hierarchy, and motion using the best ideas
   from the concepts, *inside the existing token system* (so it's a re-skin of screens,
   not a theme rewrite — dramatically lower risk).
2. **Make the calendar-first promise legible** on every screen. The live app buries its
   single best differentiator (scheduling workouts around your real calendar) inside
   Settings. That is the biggest miss, and the redesign's biggest opportunity.
3. **Choose one Today direction** and kill the rest, so the app has a spine.

The final recommendation (Step 9) is a **synthesis**, not a copy of any single
screenshot.

### Phase 1 — Understand (restated)

Tempo is a **calendar-first fitness planner**: it looks at a busy person's real schedule
and automatically drops the right workout into the right gap, then coaches them through
it and keeps them consistent.

**Assumptions:**
- The 4-tab IA (Today / Train / Progress / You) + floating **GO** dock stays. It's
  correct and users know it. **Not** proposing a 5th tab or a bottom-bar rename to
  Home/Plan/Stats (the Stitch base concepts renamed tabs — rejected; see Step 5).
- "Calendar" is not its own tab today and shouldn't necessarily become one — but the
  *scheduled-around-your-day* view must graduate from Settings to a hero surface on Today.
- Keep dark ("Ink") as default with the existing light ("Paper") mode intact.
- New metrics (Readiness, Consistency Score, Training Load) are **enhancements layered
  on existing data**, not new sources of truth that gate the core flow.

**Missing info (non-blocking):** real usage analytics on which entry points (Splits vs
Templates vs Quick vs Calendar) are actually used, and whether Readiness has a real
physiological input (HRV/sleep) or is a heuristic. Designed to degrade gracefully either way.

### Phase 2 — Architecture Review (impact map)

| System | Impact of this redesign | Risk |
|---|---|---|
| **Navigation** (`(tabs)/_layout.tsx`, `TempoTabBar`, ~30 stack routes) | Keep IA & routes 1:1. Re-skin screens only. No route renames. | **Low** — no router changes |
| **State** (zustand stores: auth, tutorial, etc.) | No new stores required. Readiness/Consistency/Load are **derived selectors** over existing workout/measurement data. | Low |
| **Design tokens** (`constants/theme.ts`) | Additive only: formalize elevation/glass tokens, chart palette, a couple of semantic aliases. Do **not** change existing hex values. | **Low** — additive |
| **Database / Supabase** | No new tables needed for the visual layer. If Readiness gets a real input later, that's a *separate* feature, not this redesign. | None for redesign |
| **Analytics** (`lib/analytics.ts`) | Add view/interaction events for new hero surfaces (calendar timeline, readiness). Typed via `EventProperties`. | Low |
| **Onboarding** | Re-skin only; preserve every step and the welcome/tutorial gate in `(tabs)/_layout.tsx`. | Medium (gating logic is subtle — see Edge Cases) |
| **Offline / cached data** | New hero cards must have real skeleton + stale states (the live app already mounts all tabs eagerly with `lazy:false` — respect that). | Medium |
| **Upgrade / migration** | Because tokens are unchanged and routes are stable, an OTA `eas update` can ship most of this. No native rebuild unless we add a font weight or native blur. | Low |
| **Premium (Tempo Pro gating)** | Redesign must route new "insight" surfaces (advanced analytics, some Readiness depth) through the **existing** gating layer, not invent a new paywall. | Medium |

**Extend-before-create scorecard:** 0 new tables, 0 new stores, 0 new providers, 0 new
routes. All new "features" (Readiness, Consistency Score, Training Load, calendar
timeline) are **presentational compositions of data Tempo already has.** This is the
cheapest possible path to a premium feel.

### Step 1 — Screen audit (every existing screen)

Format: **Purpose · Goals · Problems · Opportunities.**

**Today** (`(tabs)/index.tsx`) — *the home / "what do I do right now" screen*
- **Purpose:** answer "what's my workout today and when does it fit my day."
- **Problems (live app):** the calendar/scheduling story — Tempo's entire reason to
  exist — is not visible here; it's parked in Settings. Readiness/consistency live on
  other tabs. The hero is a workout card, but the *timing/placement* intelligence is invisible.
- **Opportunities:** make Today a **day-timeline**: your calendar gaps + the workout
  Tempo slotted into one, plus Readiness and a "lacking time? swap to 15-min" escape hatch.
- **STILL OPEN.**

**Train** (`(tabs)/plan.tsx`) — *the workout hub: today's session detail, splits, templates, history*
- **Problems (live app):** it's a flat list of exercises + "Start session." Splits and
  Templates are not surfaced as first-class cards; they're implied. Recovery/readiness is
  absent from where you actually decide to train.
- **Opportunities:** promote **Splits** and **Templates/My Workouts** to prominent cards
  near the top, keep the numbered exercise list, add a Recovery/Readiness chip at the
  point of decision.
- **STILL OPEN.**

**Progress** (`(tabs)/progress.tsx`) — *consistency, streaks, PRs, body trend, weekly report*
- **Problems (live app, pre-redesign):** clean but thin — a single consistency ring +
  streak card. Under-uses the rich data Tempo already computes.
- **Opportunities:** the **one screen where "Data Overdrive" density is correct** — a
  Consistency Index number, streak, PR dashboard, volume/training-load chart, body-weight
  trend — a real "performance report."
- **SHIPPED** (as the Fitness Intelligence dashboard).

**You / Profile** (`(tabs)/profile.tsx`) — *identity, level/XP, badges, body stats, plan, settings entry*
- **Problems (live app):** Settings is a long undifferentiated list; **Calendar &
  Scheduling** — the crown jewel — is a settings row, not a celebrated feature. Body
  stats are cramped behind the GO dock.
- **Opportunities:** an identity hero (level/XP progress), a badges peek, and a **"Your
  Plan"** block that treats Availability + Calendar Sync + Automatic Scheduling as a
  proud, legible system.
- **STILL OPEN.**

**Key stack screens (must all survive — re-skin only, all still open):**
- **Active session runner** (session-detail / `edit-session`): sets × reps × lbs table,
  rest timer, Form guide, Swap, "Today's target," Add Set / Warm-up. **The most
  functionally dense screen; treat it with extreme care.** Opportunity: tighten
  typography (JetBrains Mono already used for the set table — good), make the rest timer
  more of an "instrument," keep every control.
- **my-splits / split-editor** — splits browse + edit. Promote discoverability from Train.
- **my-workouts / workout-builder** — templates + custom builder. Same.
- **exercise-library / exercise-progress / pr-browser** — reference + per-lift progress.
  Feed the Progress dashboard.
- **quick-workout** — the 15-min escape hatch. Surface it on Today for busy users (but
  secondary to the planned session).
- **workout-complete** — celebration + LEVEL UP + adaptation. Keep the moment; elevate
  the motion (Step 4).
- **workout-history** — log archive.
- **availability / calendar-setup / travel-mode** — the scheduling engine's controls.
  **Graduate these from "settings rows" to a legible "Scheduling" system surface.**
- **social / friend-profile / group-detail / badges / weekly-report / shared-workout /
  `w/[code]`** — social + retention. Re-skin to the system; don't touch logic.
- **onboarding/** (goal, profile-setup, availability, schedule, plan-preview) +
  **welcome** — first-run. Re-skin; preserve the gate.
- **paywall / plan-explainer / how-tempo-works** — premium + education. Re-skin.
- **sign-in** — Apple + Google auth. Re-skin; do not touch the OAuth/session logic.
- **legal** — required (App Store). Keep.

**Nothing in this audit proposes removing a screen, route, or feature.** *Tempo
functionality always wins.*

### Step 2 — Tempo product identity

*(Folded into §1 above — see Product identity & positioning.)*

### Step 3 — Design system architecture

*(Token values, typography, spacing, radius, elevation, and motion have been folded into
§2 above with corrections applied. Reference that section as authoritative — this
strategy's original token/typography tables are superseded there.)*

**Elevation system** (this is where the concepts add value — additive, confirmed present
in `theme.ts`'s `Elevation` export):
- **E0 base** — `surface`, no shadow.
- **E1 card** — `surfaceContainer`, hairline `outlineVariant` border, soft shadow (`CardShadow`).
- **E2 hero / sheet** — `surfaceContainerHigh` + **glass**: `glass` fill, `glassBorder`
  top-edge highlight, optional native blur behind sheets. This is the "Glass Flow"
  premium feel — used **sparingly** (hero workout card, sheets), never wall-to-wall
  (which is why "Glass Flow Edition" full-glass reads busy).

### Step 4 — Motion system

Target feel: **Apple Fitness precision + Linear smoothness + one restrained Duolingo
moment (completion only).** Every animation earns its place; nothing loops for
decoration. All motion honors **Reduce Motion** (the app already does this in
`ThemeTransitionOverlay` — extend that discipline).

| Interaction | Motion |
|---|---|
| **Tab switch** | No scene shift (`lazy:false` — keep that). Motion lives in the **dock**: active pill slides `fast`, GO button gets a subtle pulse. |
| **Card press** | Scale to 0.98 + shadow lift, `fast`. Springs back. |
| **Card entrance** | Stagger fade+rise 8px, `base`, 40ms cadence down the screen on first focus. |
| **Workout completion** | The signature moment: ring closes `slow`, number counts up (mono), gold confetti-pulse *once*, LEVEL UP badge springs in. Premium, not a slot machine. |
| **Streak celebration** | Flame/gold pulse on the streak card; count ticks up `base`. |
| **Goal / PR** | Gold sweep across the PR card + trophy spring. |
| **Progress rings/bars** | Animate from 0 on focus, `slow`, ease-out. Consistency Index counts up. |
| **Skeletons** | Shimmer at `base`; **layout-matched** placeholders (never a spinner on a data screen). |
| **Pull-to-refresh** | Tempo "pulse" metronome mark as the indicator. |
| **Modal / sheet present** | Sheet rises `base` with the E2 glass + scrim fade. (RN `<Modal>` per repo standard — **not** gorhom.) |
| **Calendar transitions** | Day↔Week↔Month: shared-element expand of the selected day, `base`. Timeline items settle with a subtle stagger. |
| **Logging** | Set complete = row check springs + haptic; rest timer starts with a ring wipe. |

**Reject:** ambient looping glows / animated shaders as backgrounds. Motion should point
attention, then get out of the way.

### Step 5 — Information hierarchy (per screen, with reasoning)

**Global rule:** visual weight ∝ how often the action is used and how core it is to
*consistency*. Core = the planned session + when it fits.

**Today** (top to bottom): 1) Day context strip. 2) The one thing: today's scheduled
session as the hero — big, photo-backed, with the *time it's slotted* and a one-tap
**Start**. 3) Readiness ring + Target (x/y sessions this week) two-up. 4) Scheduled-today
timeline (calendar gaps + the Tempo workout in place — the differentiator, finally
visible). 5) "Lacking time?" quick-swap to a 15-min flow. 6) FAB **+** for ad-hoc add,
dock **GO** for jump-into-session.

**Train**: 1) Today's session card → **Start Session**. 2) Quick-nav row: My Splits · My
Workouts (Templates) · Schedule, as prominent cards. 3) Numbered exercise list. 4)
Secondary: Exercise Library, History.

**Progress**: 1) Consistency Index (hero number) + current streak + global rank. 2)
Personal Records dashboard. 3) Training-load / volume chart (weekly). 4) Body-weight
trend sparkline. 5) Weekly report entry + all achievements. *Density is welcome here and
only here.*

**Profile / You**: 1) Identity hero (avatar, level, XP-to-next, title). 2) Badges peek.
3) **"Your Plan"** system block: Availability · Calendar Sync · Automatic Scheduling ·
Travel Mode. 4) Body stats (breathing room above the dock). 5) Settings groups:
Notifications, Appearance, Premium/Upgrade, Legal, Sign out, Delete account.

**Reject the tab rename.** The Stitch base concepts relabel the bar to *Home / Plan /
GO / Stats / Profile* and even *Command / Timeline / Analytics / User*. The live labels
**Today / Train / Progress / You** are warmer, clearer for a general audience, and
already learned by users. Keep them. (Cosmetic re-skin of the dock is fine; **no
relabeling, no reordering, no route changes.**)

### Step 6 — Feature enhancement analysis (add, never replace)

Each is a **presentational composition of data Tempo already has** (or a light
heuristic), placed to reinforce consistency. None removes or hides an existing feature.

| Enhancement | Why it helps Tempo | Where it lives | Integrates with |
|---|---|---|---|
| **Scheduled-Today Timeline** (calendar gaps + slotted workout) | Makes the core differentiator *visible*. #1 priority. | Today (hero-adjacent) | Existing calendar sync / availability / auto-schedule engine |
| **Readiness ring** | One-glance "should I go hard today." Calming, WHOOP-legible. | Today + Train (decision point) | Derive from `adaptation_mode` + recent RPE/missed sessions (`lib/adaptation.ts`); upgrade to HRV later without UI change |
| **Consistency Index** (single score) | Turns scattered stats into one motivating number. | Progress hero, peek on Today | Existing consistency/streak math |
| **Training Load / Volume chart** | Shows the work is accumulating; premium feel. | Progress | Existing session volume data |
| **Weekly Recap** | Retention ritual; "here's your week." | Progress → weekly-report (exists) | `weekly-report.tsx` |
| **Streak system w/ gold milestones** | Gentle stakes; the anti-miss nudge. | Today peek + Progress | Existing streak + retention pushes |
| **PR Dashboard** | Trophy case; proof of progress. | Progress | `pr-browser`, `exercise-progress` |
| **"Lacking time?" 15-min swap** | Directly serves the busy persona; prevents a skipped day. | Today (secondary) | `quick-workout.tsx` |
| **Recovery/Readiness chip at Start** | Decision support exactly when deciding to train. | Train / session start | adaptation engine |

**Deliberately NOT adding:** HRV hardware integrations, calorie/nutrition tracking,
tactical "mission" gamification, social feed noise on Today. Readiness stays a
**heuristic with an honest label** until/unless a real signal exists — designed to
degrade gracefully (hide the sub-metrics, keep the ring).

**Premium routing:** depth views (advanced analytics, full training-load history, some
Readiness detail) route through the **existing Tempo Pro gating layer** — not a new paywall.

### Step 7 — Screen-by-screen redesign plan

For each: *Layout · Hierarchy · Key components · Cards · Nav · Interactions · Empty ·
Error · Loading · Success.* Condensed for non-core screens; expanded for the four tabs +
session runner. **All still open except Progress (shipped).**

**Today** — STILL OPEN
- **Layout:** scroll; day-strip → hero session → readiness/target two-up →
  scheduled-today timeline → "lacking time?" → (peek: streak). Respect `BottomTabInset 96`.
- **Key components:** DayStrip, HeroSessionCard (E2 glass, photo, slotted-time chip,
  Start), ReadinessRing, WeekTargetCard, ScheduledTimeline (event rows w/ calendar-color
  dots + the blue Tempo workout), QuickSwapCard, FAB.
- **States:** *Empty* (no plan yet) → friendly "Let's build your week" → onboarding/plan.
  *Rest day* → "Recovery day — here's why" + optional mobility. *Error* (calendar fetch
  fails) → timeline shows workout only + inline "Reconnect calendar." *Loading* →
  layout-matched skeletons. *Success* (just finished) → hero flips to "Done ✓ — next: <day>."

**Train** — STILL OPEN
- **Layout:** hero today's-session → **Splits/Templates/Schedule quick-nav** → exercise
  list (expandable) → Library/History.
- **Cards:** SessionHero (block, duration, exercises-remaining, Recovery chip, Start),
  three PromoNav cards, numbered ExerciseRows.
- **States:** *Empty* (no session today) → "No session scheduled — start a Quick Workout
  or browse Splits." *Error* → cached session + retry. *Loading* → skeleton rows.
  *Success* → Start routes to the runner.

**Progress** — SHIPPED
- **Layout:** Consistency Index hero → streak/rank → PR dashboard → load chart → body
  trend → weekly report → achievements.
- **Cards:** ConsistencyHero (metricHero), StreakCard (gold), PRGrid, LoadChart,
  TrendSpark, WeeklyReportEntry, BadgesStrip.
- **States:** *Empty* (new user) → "Complete a session to unlock your report" with a
  preview ghost. *Error* → per-card retry, others still render. *Loading* → skeletons per card.

**You / Profile** — STILL OPEN
- **Layout:** identity hero → badges peek → **Your Plan** system → body stats → settings groups.
- **Cards:** IdentityHero (level/XP ring), BadgesStrip, PlanSystem
  (Availability/Calendar/Auto-schedule/Travel), BodyStats, SettingsList, Upgrade,
  DangerZone (sign out / delete).
- **States:** *Empty* badges → "Earn your first badge." *Error* on calendar status →
  inline. Delete-account flow preserved exactly (App Store 5.1.1(v)).

**Active Session Runner (highest-care screen)** — STILL OPEN
- Preserve **every** control from the live app: set/prev/lbs/reps table (JetBrains
  Mono), per-set complete, rest timer (make it an "instrument" ring), Form guide, Swap,
  Today's Target coaching, Add Set, Warm-up, pause, elapsed. **Nothing removed or
  relocated without reason.** Enhancement = tighter type, clearer active-set emphasis,
  better timer motion.
- **States:** *offline* → logs locally, syncs later (must not block logging). *Error on
  save* → optimistic + retry queue. *Success* → routes to workout-complete celebration.

**Onboarding · Welcome · Paywall · Sign-in · Social · Settings sub-screens** — STILL OPEN
- **Re-skin to the system only.** Preserve every step, the welcome/tutorial gate
  (`armed/skipped/completedSteps` logic in `(tabs)/_layout.tsx`), Apple+Google auth, the
  Pro gating, and all social logic. Apply the same card/elevation/motion language for
  cohesion. No behavioral change.

### Step 8 — User persona analysis

| Persona | Needs | How this design serves them |
|---|---|---|
| **Beginner** | Clarity, low confusion, motivation | Today shows *one* obvious next action + Start; Readiness reassures; empty states teach; gentle streaks. |
| **Busy Professional** (primary) | Speed, automation, minimal taps | Scheduled-today timeline proves "it's handled"; "lacking time? 15-min swap"; one-tap Start; no digging. |
| **Student** | Flexibility, changing schedule | Availability + auto-reschedule surfaced; Travel Mode visible in "Your Plan"; easy re-slotting. |
| **Consistent Gym-Goer** | Progress tracking, control | Train hub with Splits/Templates up top; Progress "Data Overdrive"; PR dashboard; full session control preserved. |
| **Premium Subscriber** | Rich insight, premium polish | Glass hero, advanced analytics/training-load depth (Pro-gated), refined motion & celebrations. |

Every layout decision cites a persona/consistency reason — that's the acceptance bar for
any component in implementation.

### Step 9 — Final vision (the recommendation)

**The one visual direction (synthesis, not a copy):** a single system called **"Ink
Instrument"** — the existing Ink identity, elevated:

- **Skeleton:** the **High-Performance-Refresh** Today (cleanest, calmest, most
  calendar-forward of the eight concept directions) as the base layout.
- **+ Glass hero & sheets** from **Glass Flow** (used sparingly for premium depth).
- **+ Readiness ring** from **Command Center / Zen Planner** (calm, legible).
- **+ Scheduled-today timeline with calendar-color chips** from **Glass Flow** — this is
  the non-negotiable differentiator surface.
- **+ Restrained streak/badges peek** from **Kinetic Gamified** (dialed down — no
  wall-to-wall gamification).
- **+ "Data Overdrive" density confined to Progress only** — **this part is shipped.**
- **Reject:** Aggressive Performance / tactical Command-Center language, full-glass
  everything, ambient shaders, and the tab renames.

**What the perfect Tempo feels like:** You open Tempo at 7:12am. Before you think, it's
answered you: **"Upper Body Push, slotted 9:00–9:45 in the gap before your 10am."** A
calm blue schedule, one ember dot marking *now*, a Readiness ring that says you're good
to go. One tap and you're in a crisp instrument — mono numerals, a rest-timer ring, a
form guide a thumb away. You finish; the ring closes, a single gold pulse, LEVEL UP.
Progress shows a Consistency Index climbing like a credit score you actually want to
raise. Nothing shouts. Everything is exactly where a busy person's thumb expects it. It
feels like **the most polished calendar-first fitness planner on the market** — because
it's the only one that plans *around your real life* and makes consistency feel
effortless and premium.

### Edge cases the redesign must handle (explicit)
- **Force-close mid-session** → runner state restores; logging never lost (offline-first).
- **Offline** → Today renders last-cached session + workout; timeline hides live calendar
  gaps with an inline "offline" note; logging works locally, syncs later.
- **Failed calendar/request** → hero still shows the workout; timeline degrades to
  workout-only + "Reconnect" affordance. Never a blank hero.
- **User skips onboarding steps** → preserve the existing gate; hero empty-state guides back.
- **Leaves & returns days later** → missed-workout sweep + adaptation already re-stamps
  the plan; Today reflects the *new* current session, not a stale one; streak-at-risk
  surfaces gently.
- **Upgrade from older version** → tokens unchanged + routes stable ⇒ OTA-safe; no data migration.
- **Two actions at once** (start + edit) → single-flight; disable duplicate Start.
- **Stale cached data** → skeleton→content swap; "as of <time>" on Progress; pull-to-refresh.
- **Denied permissions** (calendar/notifications) → graceful: workout-only timeline;
  in-app reminders fallback; a non-nagging "enable for smarter scheduling" card.
- **Settings changed mid-flow** (availability edited during a session) → applies to
  *future* scheduling only; never mutates the in-progress session.
- **Content vs floating dock** → enforce `BottomTabInset` on every scroll container (a
  concrete bug flagged for the re-skin — verify whether it's already been fixed as part
  of the shipped Progress work).

### Potential problems with this strategy (skeptic's pass — then the fix)

1. **"Readiness is fake."** If it has no real physiological input, a prominent ring risks
   feeling like theater. *Fix:* label it honestly ("Training Readiness" derived from your
   recent sessions & adaptation), keep it a *supporting* glance not a gate, and design it
   to accept a real signal later with zero layout change. If we can't make it honest,
   cut it — the timeline + consistency carry Today alone.
2. **Scope creep vs "no regressions."** Re-skinning ~30 routes is a lot of surface; the
   CLAUDE "no regressions" rule is paramount. *Fix:* phase it. **Phase A:**
   tokens/elevation/motion formalization + Today + Train + the dock. **Phase B:**
   Progress + Profile + session runner. **Phase C:** onboarding/paywall/social/settings
   re-skin. Each phase ships behind a visual diff review; logic untouched. *(Note:
   Progress from "Phase B" appears to have shipped ahead of Today/Train from "Phase A" —
   worth confirming actual build order against this plan before continuing.)*
3. **Glass/blur performance & battery.** Native blur can jank on older devices. *Fix:*
   glass = cheap translucent fills + hairline highlights by default; real native blur
   only behind sheets, gated by a perf/Reduce-Transparency check.
4. **Progress "Data Overdrive" overwhelms beginners.** *Fix:* progressive disclosure — a
   beginner sees Consistency + streak + one chart; depth unlocks with data/Pro.
5. **Timeline needs the calendar to shine, but permissions/empty calendars exist.**
   *Fix:* the timeline is *additive*; with no calendar it still shows the slotted workout
   and a "connect calendar to schedule around your day" invite. It never blocks Today.
6. **Motion cost.** Over-animating a data app annoys. *Fix:* one signature moment
   (completion), everything else is functional micro-motion, all Reduce-Motion aware.
7. **"You're just theming the concepts."** *Fix:* the value isn't the paint (already
   owned) — it's the **hierarchy re-prioritization** (calendar timeline to hero,
   Splits/Templates to top of Train, one Consistency number on Progress) and killing 7 of
   8 directions so the app gains a spine. That's product work, not a skin.

### Recommended next step

1. **Approve the direction** ("Ink Instrument" synthesis) and the **tab-preservation**
   stance, for the still-open Today/Train/Profile work specifically (Progress is already
   built and live).
2. Confirm the additive tokens (elevation/glass, chart palette, `metricHero`) already
   present in `constants/theme.ts` cover what Progress needed, and extend only as
   necessary for Today/Train/Profile — additive only, no existing value changed.
3. Build the remaining phase(s) (Today + Train + dock + shared card/motion primitives,
   then Profile + session runner, then onboarding/paywall/social/settings) behind a
   strict no-regressions diff, verify on a real build, one phase at a time.

*(Optional: a side-by-side visual comparison artifact of the 8 Today directions with
pros/cons could make the direction call easy to sign off.)*
