# Arclo — Execution Status (the living ledger)

> **READ THIS FIRST every session. UPDATE IT LAST every session.**
> Plan + workflow + prompts: `EXECUTION.md`. Diagnosis + scores: `PRODUCT_AUDIT.html`.
> Status legend: 🔲 Not Started · 🔄 In Progress · ✅ Completed · 🔍 Needs Review (on-device) · ⏸ Postponed · ❌ Rejected
>
> **Recompacted 2026-07-30**: this file had regrown into ~20 dated Current-Focus narrative entries
> (most documenting already-shipped/verified work). Compacted again — same discipline as the
> 2026-07-17 pass — down to: current state (below) + the ledger (unchanged, still the highest-value
> artifact) + an **Open backlog** section absorbed from `MASTER_FIX_PLAN.md` (that file is being
> retired; its still-open items now live here) + a **Founder-only open items** checklist + a
> one-line-per-session Session Log spanning the project's whole history. Nothing is lost — `git log`
> has every commit message, `ARCHITECTURE.md` has the technical detail, and the retired
> `MASTER_FIX_PLAN.md`/`PLAN.md`/`SOCIAL_UPGRADE_PLAN.md` remain in git history if the full original
> prose is ever needed.

---

## ▶ CURRENT FOCUS *(the resume point)*

**2026-09-14 — rotation shift built (plan path), and a live split duplication bug fixed.**

**What shipped (engine + Home wiring, `tsc` clean, 608 tests):**
- **`lib/rotationShift.ts`** (pure) + **`getPlanRotation` / `shiftPlanRotation`** (`generatePlan.ts`).
  Founder's six-day-split problem: "if I miss push I want to do it next", and "sometimes I just
  cancel push and schedule legs because I'm on a different track". One operation — name the
  position that happens next, everything after follows in cycle order.
- **Rotates CONTENT along fixed dates, never dates.** A date cascade was designed and rejected: it
  drags in availability search, calendar teardown/rebuild, reminder re-pointing, the
  one-session-per-day index and `materializeSplit`. Content rotation touches none of them, and the
  rest day stays put (a rest day is the absence of a row). Honest tradeoff: the missed session is
  **not made up** — you stop skipping a muscle group, you don't train an extra day.
- **`user_plans.rotation_offset`** (`add_plan_rotation_offset.sql`, **APPLIED**). The non-obvious
  half: re-stamping doesn't change the plan's ROW COUNT and generation picks
  `templates[sessionCount % len]`, so without a persisted slide the next `extendActivePlan` seams
  back to the old order at the horizon (two Push days back to back).
- **Home banner** leads with "Do {focus} next", keeps "Find a new slot" as a secondary action, and
  — the bigger fix — **widened its eligibility**. It was gated on `!missedRescheduleTight`, which
  is permanently true on a 6-day split, so **six-day lifters who missed a session saw no banner at
  all.** The cohort with the sharpest version of the problem was the one the feature excluded.

**Bug found and fixed on the way (independent, was live):** `materializeSplit` keyed idempotency on
`planned_date`, so ANY mover that changed a date left the origin day looking empty and the next app
open re-inserted the session that had just been moved. Move Monday's Push to Tuesday, reopen, Monday
has a Push again. Fixed via **`scheduled_workouts.split_origin_date`** (`add_split_origin_date.sql`,
**APPLIED**, 124 rows backfilled, 0 inconsistent). Regression test confirmed non-vacuous by reverting
the fix and watching it fail. Only 2 of 48 active users are on splits, which is why it went unseen.

**Scope decided by evidence, not guesswork:** of users with a schedule in the last 30 days, **46 are
on generated plans and 2 on splits**. The plan path was wired; the split path is deliberately
deferred (it additionally needs the split template's weekday mapping rotated, or future
materialization re-imposes the old order).

**⚠ NOT YET VERIFIED ON A DEVICE, AND NOT YET DELIVERED.** Both migrations are live, but no user has
this until an OTA ships. The untested path is the one tests cannot cover: the Home banner rendering
and the confirm dialog firing. **Do that before publishing.**

**⚠ RapidAPI rotation is HALF DONE — see item 1 below. A new key exists; the old one is still live.**

---

**2026-09-09 — health check clean; day-0 activation now instrumented.**

**Verified, not assumed:**
- **Server-side scheduling holds.** `retime-sessions-hourly`: 24/24 runs in 24h, 0 failures.
  **0 unmakeable sessions** out of 307 future ones. Three days steady.
- **Adoption worked.** iOS users on pre-fix JS: **25 → 3**. 1.0.2 is doing its job; the store
  build was the right call over another OTA.
- **No Quick Workout regressions.** The only all-core sessions in the window are the two the
  founder reported on 09-07, both created BEFORE the schedule-restriction floor shipped. None
  since.

**⚠ PostHog project is shared with a different app.** 57 people in the last 3 days fire
`deck_randomised`, `auction_started`, `auction_finished`, `room_joined`, `card_shared`, plus
`$pageview`/`$web_vitals`. None of it is Arclo. Arclo's own funnel numbers are safe (its event
names don't collide), but **every project-wide PostHog dashboard — DAU, retention, web
analytics — is polluted and should not be trusted.** Either move Arclo to its own project or
always filter by an Arclo-specific event.

**Day-0 activation instrumented** (`day0_cta_shown` / `day0_cta_tapped`). This exists to settle
the funnel's biggest intent-qualified drop — 30 generated a plan, 10 pressed Start — which was
being argued from inference. `shown` without `tapped` = they see the offer and decline it (copy
or motivation). Few `shown` at all = they never reach a state that offers it (a state problem).
Read it in ~a week; the two readings point at completely different fixes, so do not act before
the data arrives.

**▶ NEXT:**
0. **Read the day-0 events** once there is a week of them (query below), then act on whichever
   cause they indicate.
   ```sql
   SELECT event, properties.choice AS choice, properties.days_until AS days_until,
          count(DISTINCT person_id) AS people
   FROM events WHERE event LIKE 'day0_cta%' AND timestamp > now() - INTERVAL 14 DAY
   GROUP BY event, choice, days_until ORDER BY people DESC
   ```
1. **⚠ FOUNDER: finish the RapidAPI rotation — HALF DONE as of 2026-09-13.**
   A second key **"Arclo edge proxy (2026-09)"** now exists in the RapidAPI dashboard alongside the
   old leaked "Application Key". Nothing is broken: the old key is still live and serving.
   **Remaining:** copy the NEW key's value, paste it into Supabase → Edge Functions → Secrets →
   `RAPIDAPI_KEY`, save, verify with the curls below, and only then delete the old row.
   Automation could not finish it: the RapidAPI authorization table is in a cross-origin iframe, so
   the copy button is unreachable, and a clipboard permission prompt froze the tab.

   **Preferred order — no downtime.** If RapidAPI lets you hold two keys at once:
   1. Create a NEW key in the RapidAPI dashboard. Leave the old one live.
   2. `cd mobile && npx supabase secrets set RAPIDAPI_KEY=<new> --project-ref rtoahppnekykgmjukujm`
   3. Verify (see below). Only once it passes:
   4. Delete the OLD key in RapidAPI.

   **If it only offers "regenerate"** (which kills the old key instantly): have step 2 typed and
   ready in a terminal, hit regenerate, then run it immediately. The gap is seconds, and the only
   effect during it is exercise clips showing a placeholder.

   **Verify** (uses the Supabase publishable key, safe to run any time):
   ```bash
   cd mobile
   KEY=$(python -c "import json;print(json.load(open('eas.json'))['build']['production']['env']['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'])")
   B=https://rtoahppnekykgmjukujm.supabase.co/functions/v1/exercise-media
   curl -s -H "Authorization: Bearer $KEY" "$B?kind=search&name=barbell%20squat"     # -> {"id":"0102"}
   curl -s -o /dev/null -w '%{http_code} %{content_type}
' -H "Authorization: Bearer $KEY" "$B?kind=image&id=0043&resolution=180"   # -> 200 image/gif
   ```

   **Expected fallout, and why it's acceptable:** users still on a pre-fix bundle call RapidAPI
   directly with the old key, so their exercise clips stop loading and show the placeholder.
   That was 3 people at last count (down from 25), and they lose a form GIF, not a workout.

   **What rotation does NOT fix:** the old key is in 2 commits of a public repo's history and
   inside every already-shipped binary. Rotation is what actually retires it; scrubbing history
   would need a force-push, which is off-limits without an explicit decision from you.

2. Founder-only, unchanged: EAS Apple credential refresh, Tempo Coach deployment, the Google
   Calendar reconnect tap, the staged Reddit post's Post click.
3. One pre-existing split collision (user `deb0b08e`, two sessions same slot). 1 of 307.

---

**2026-08-30 (d) — New store screenshots: live on Play, BLOCKED on the App Store.**
The founder supplied six AI-generated marketing frames and asked for them on both listings. They
were not used, for reasons worth keeping:

- **The phone screens in them were redrawn, not composited.** The Body Intelligence frame invented a
  "Recovery by muscle" grid (Chest 92%, Back 78%, Shoulders 64%, Legs 90%) that does not exist in the
  app; the Progress frame's volume axis read `W1 W2 W3 W4 W4 W5 W6 W7 W8`; the Plan frame re-typeset
  the exercise list, un-truncating a name the app truncates and renumbering the rows.
- **They were 853×1844.** App Store Connect only accepts its fixed display sizes and would have
  rejected the upload outright.

**Rebuilt instead: `brand-assets/make-store-frames.py`.** Real captures composited into drawn device
frames, output at 1284×2778, Inter vendored under `brand-assets/fonts/`. Copy and layout live in one
`FRAMES` list, so a wording change is an edit and a re-run rather than another round of image
generation. **Researched first**, against the live App Store listings for Fitbod, Hevy, Alpha
Progression, Boostcamp, Ladder and Caliber (pulled through Apple's lookup API): all six put a short
headline on top and give the rest of the frame to a large, legible device: none uses a left-text /
right-phone split, and none uses a rail of icon bullets. The layout follows that.

**The set renders as one continuous 7,704px strip and is then sliced**, which is the only way the
crossings line up — each device sits right of its panel centre so its tail reappears at the left edge
of the next frame, and one blue sweep runs the length of all six. Devices are auto-fitted so the
bottom edge stays inside the canvas and the app's own tab bar is visible, while the top stays clear
of the headline. **Frame order is now load-bearing:** reordering the screenshots in either store
breaks the crossings and needs a re-render.

- **Google Play: DONE and verified** — six new screenshots live, read back at 1284×2778 with byte
  sizes matching the generated files.
- **App Store: cannot be done from here.** `POST /v1/appScreenshots` returns **409, "An attribute
  value is not acceptable for the current resource state"** — version 1.0 is `READY_FOR_SALE` and
  Apple locks screenshots on a released version. Changing them needs a new App Store version, and a
  new version needs a new build (a 1.0.1 version cannot take a build stamped 1.0), so this is a full
  review round. **Deliberately not started:** the app cleared review two days ago after five
  rejections, and spending a review cycle purely on screenshots is a bad trade. **▶ The set is
  committed at `brand-assets/store-frames/` — attach it to the next iOS version whenever one ships.**

---

**2026-08-30 (b) — The marketing site is live, and it is no longer a waitlist.**
`web/launch.html` (built 07-28, refined across five passes on 07-29, and carried as "still
unpublished" in every entry since) is now `web/index.html`. The old pre-launch page — "Coming soon
to iOS & Android," every CTA an email capture, no pricing, no store links — is deleted, recoverable
from git. For part of today, visitors arriving from two *live* store listings were being asked to
join a waitlist for an app they could already download.

- **Real store URLs, verified before committing, not pasted from memory:**
  `https://apps.apple.com/app/id6785075737` (locale-free on purpose — Apple routes each visitor to
  their own storefront; a hardcoded `/us/` link would not) and
  `https://play.google.com/store/apps/details?id=com.fittempo.app`. Both returned 200.
- Six `[data-store]` anchors (hero, final CTA, footer) all read from the single `STORE` constant, so
  one edit lit all of them. The existing guard survives: a non-`http` value makes every button fall
  back to `#get` rather than ship a dead link.
- **Verified in a browser, not by reading the diff** — served `web/` locally, confirmed all six hrefs
  rewritten with `target="_blank"`, no `REPLACE_WITH` left in the DOM, and no horizontal overflow at
  1920px.

~~**▶ Still open on this page:** all seven phone frames are blank placeholders.~~ **Done the same
day.** `web/img/shots/*.webp` now carries the live Play listing's own seven screenshots, pulled at
full resolution through the Publishing API and downsized to 560px wide (224KB for all seven, from
~2.4MB of source PNG). Real captures, not mockups. Three of the seven slots wanted screens the store
set does not contain (Streaks & badges, Exercise library, the post-workout RPE prompt) and were
re-cast rather than invented — The adaptation row took the muscle-recovery map, which is what "it
reads the week you actually had" actually looks like, and the reschedule prompt moved into the hero
cluster. Verified in a browser: all seven load, every frame paints, no horizontal overflow. The
ratings strip and testimonial rail stay commented out, correctly, until there are real numbers and
quotes.

**Also noted, deliberately not fixed:** `.github/workflows/` holds **two identical** GitHub Pages
workflows (`static.yml` and `deploy.yml`) — same name, same trigger, same `./web` upload. They race on
every push. One should be deleted; it wasn't touched here to keep this change scoped.

---

**2026-08-30 — SHIPPED ON BOTH STORES. iOS is `READY_FOR_SALE`; Play production is now
versionCode 12.** Every claim below was read back from the two store APIs, not assumed.

**App Store — approved and live.** Version 1.0 is `READY_FOR_SALE`. `tempo_pro_month` and
`tempo_pro_year` are both `APPROVED`, so the paywall the reviewer was walked to has real products
behind it. The 2026-08-26 draft-submission workaround (subscriptions attached in the web UI, version
added by API) worked — that is the procedure to repeat for 1.1.

**Google Play was three weeks and 53 commits behind, and nobody had noticed.** Production still
served **versionCode 11, built 2026-08-06**, while every fix since had gone to Apple: the Android
Google sign-in hang, the app-open bottleneck work, the "unverifiable session ≠ sign-out" fix, the
paywall recovery pass, report/block, and the Arclo rename. OTA updates had been papering over the JS
half of that gap; the native half never shipped.

Fixed this session, end to end:
- **Build 12** (v1.0.0, versionCode auto-incremented 11 → 12) built on EAS from a clean tree,
  `tsc` clean and 453/453 tests green beforehand.
- Submitted to the **production** track at **100%**, `status: completed`, and read back from the
  Play API as live. Release notes written and verified on the release.
- **`eas.json`'s Android submit profile still said `track: "alpha"`** even though the app has been
  in Play production since 2026-08-09 — a real trap for any future `eas submit`. Now
  `track: "production"` + `releaseStatus: "completed"`.

**Two live-listing defects found by auditing Play's actual assets, not the docs.** Both were the
*same* defects fixed for Apple on 2026-08-24 and never mirrored to Google: screenshot 3 showed the
raw `UPPER_CHEST · TRICEPS` enum, and screenshot 5 read "No setup. **Tempo** builds the
highest-impact session." The app source was already correct (`quick-workout.tsx` uses `BRAND_NAME`)
— the screenshots were stale captures. Replaced both with the corrected captures in one
transactional Play edit, order preserved, and re-downloaded the listing to confirm. The listing
title, description and feature graphic were already correctly Arclo-branded, closing the
2026-08-09 "Feature Graphic still says Tempo" open item by evidence.

**▶ NEXT.** Nothing is blocking a release any more, which makes the next constraint the honest
one: **there is still no on-device verification pass and no retention cohort.** The founder-only
list below is now the critical path — T1.2 (on-device pass), the stale EAS Apple credential,
Tempo Coach deployment, the Google Calendar reconnect tap, and B6.2 (one acquisition channel).
Shipping to two stores is not traction.

---

**2026-08-26 — SUBMITTED: version 1.0 + build 35 + BOTH subscriptions, in one submission.**
Confirmed by reading the API back, not by trusting the write:
- Version 1.0, build **35**: `WAITING_FOR_REVIEW`
- `Arclo Pro (Monthly)` and `Arclo Pro (Yearly)`: `WAITING_FOR_REVIEW`
- Submission `032321f9`: `WAITING_FOR_REVIEW`, **4 items**, submitted 22:29 UTC

**The gotcha that cost a round trip, worth knowing for next time.** `POST
/v1/reviewSubmissionItems` accepts `appStoreVersion` but has **no `subscription`
relationship** — probing every plausible name confirms the only valid item types are
`appStoreVersion`, `appEvent`, `appCustomProductPageVersion` and the two experiment types.
So an API-only submission silently ships the binary *without* its in-app purchases, which
would have walked the reviewer to a paywall with nothing to sell — the 2.1(b) rejection
this app already took twice. **The fix: add the subscriptions to a Draft Submission in the
ASC web UI (Monetization → Subscriptions → "Add for Review"), then add the version to that
same draft by API and submit it.** A version already `WAITING_FOR_REVIEW` must be cancelled
first to free it; it returns as `DEVELOPER_REJECTED`, which is submittable.

~~**Build 35 IS IN REVIEW. The two subscriptions are NOT, and that is the open risk.**~~
Read back from the API, not assumed:
- Version 1.0 + build **35**: `WAITING_FOR_REVIEW` ✅
- Review submission `fbc5cd2d`: `WAITING_FOR_REVIEW`, **1 item — the app version only**
- `tempo_pro_month` / `tempo_pro_year`: still **`READY_TO_SUBMIT`**, outside the submission ❌

**Why they are missing, and it is not fixable from here.** `POST /v1/reviewSubmissionItems`
rejected `subscription` with *"not a relationship on the resource."* Probing every plausible name
showed the only valid item relationships are `appStoreVersion`, `appEvent`,
`appCustomProductPageVersion`, `appStoreVersionExperiment`, `appStoreVersionExperimentV2`.
`appStoreVersion` itself exposes no IAP relationship either. **Attaching subscriptions to a review
submission is a web-UI-only operation in App Store Connect.** The public API cannot do it, so any
future automated submission will hit exactly this wall.

**The risk this creates.** The App Review note explicitly walks the reviewer to the paywall
("You" tab -> gear -> ARCLO PRO). If the subscriptions are not in review, `getOfferings()` returns
no purchasable product and the paywall shows its unavailable state — which is the **2.1(b)
"could not locate the in-app purchase"** rejection this app already took twice.

**▶ NEXT (founder, in the ASC web UI, before review starts):** open the 1.0 version page and add
both Arclo Pro subscriptions to the submission. If ASC refuses while the version is
`WAITING_FOR_REVIEW`, the submission must be cancelled first — say so and it can be cancelled by
API in seconds, then re-submitted with `node submit.js --send` from the local `asc-check` folder
once the subscriptions are attached.

**Everything else is done and verified:** build 35 attached; six screenshots all `COMPLETE`, in
order, with the "Tempo" and `UPPER_CHEST` defects replaced by real captures from the fixed binary;
subscriptions renamed **Arclo Pro** with correct group levels and real review notes; reviewer note
navigation corrected to the "You" tab; App Privacy verified (9 types, no stale Health entry);
Guideline 1.2 report/block shipped and enforced server-side; the rest-timer Live Activity shelved
and bundle-verified absent.

**⚠ EAS Apple credential is stale.** It 401s on Developer Portal operations — it broke
`eas metadata:pull`, then killed a production build outright when that build had to register the
widget extension's bundle id. Every build and submit currently needs
`EXPO_ASC_API_KEY_PATH` / `EXPO_ASC_KEY_ID` / `EXPO_ASC_ISSUER_ID` passed by hand. Fix with
`npx eas credentials`.

**2026-08-25 — App Store Connect audited directly via the API, and the ledger was wrong.**
The 2026-08-24 entry below ends "**▶ NEXT (founder):** when build 30 lands, select it … and submit."
**That never happened, and the entry recorded the intent as though it had.** Read from the live
store with an App Store Connect API key: version 1.0 was `REJECTED` with **build 29 — the HealthKit
build — still attached**; builds 30, 31 and 32 were all `VALID` and none was selected; the review
submission had sat at `UNRESOLVED_ISSUES` since 2026-08-20. Nothing was in review for four days.
**Read the store, don't trust this file, before believing anything is submitted.**

**Fixed on the store this session** (all verified by reading the record back):
- Attached build **32**, which cleared the HealthKit binary and moved the version `REJECTED` →
  `PREPARE_FOR_SUBMISSION`. Later superseded by build 33.
- Cancelled the dead review submission. Required: subscription metadata returns **409 "can not be
  modified"** while a submitted submission holds it, and individual items cannot be removed
  ("Item was already submitted") — cancelling is the only unlock.
- Renamed everything customer-facing from **"Tempo Pro"** to **"Arclo Pro"**: the group display
  name, the group reference name, and both products. StoreKit renders these in the purchase sheet
  and iOS shows them under Settings → Subscriptions; an app called Arclo selling "Tempo Pro
  (Yearly)" is a Guideline 2.3.1 metadata mismatch.
- Yearly `groupLevel` **2 → 1**, matching monthly. They were inverted, so StoreKit treated a
  $4.99/mo purchase as an *upgrade* from $34.99/yr and would have prorated it. Same tier, different
  billing period = same level = crossgrade at renewal.
- Replaced the yearly's review note (it was the single word "Tempo") and wrote a real one on both.
- **Corrected the reviewer note's navigation:** it said "Profile tab → Settings → Arclo Pro". The
  tab is labelled **"You"**, not Profile (`(tabs)/_layout.tsx` line 54). Sending a reviewer to a tab
  that does not exist is how the two earlier 2.1(b) "could not locate the IAP" rejections happen.

**Verified clean and needing nothing:** the annual introductory offer ($24.99 first year vs $34.99
list in the US, pay-up-front, one year, one period, **all 175 territories**, live 2026-07-22,
**ends 2026-12-31**); both subscriptions' App Review screenshots; the age-rating declaration; the
production Info.plist (Calendars + Photo Library only — no Health, Camera, Microphone or
local-network keys).

**Two real bugs were live in the App Store screenshots** and are now fixed in code (`0e889e4`):
screenshot 4 read "No setup. **Tempo** builds the highest-impact session…" and screenshot 2 rendered
"**UPPER_CHEST** · TRICEPS", a raw DB enum. A sweep found four rendered "Tempo" strings total.

**Guideline 1.2 closed** (`1601513`): the age rating declares user-generated content and the app had
no report and no block. Migration `add_moderation_block_report.sql` **applied and verified live**;
enforcement is server-side because all eight discovery RPCs are SECURITY DEFINER. tsc clean, 453/453.

**⚠ App Privacy is the one item that could not be verified.** Apple exposes no `appDataUsages`
endpoint — it is ASC web UI only. The answers were filled 2026-08-06, **18 days before HealthKit was
removed**, so check whether **Health & Fitness → Health** is still declared and drop it; confirm
**Purchases → Purchase History** is present (the merged policy discloses it); and consider dropping
**Diagnostics → Performance Data**, since `crashReporting.ts` sets `tracesSampleRate: 0`.

**▶ NEXT:** build 33 (the first binary containing both the brand-leak fixes and report/block) →
attach to version 1.0 → submit with both subscriptions. **Do not write "submitted" here without
reading the version state back from the API.**

**2026-08-24 — FIFTH App Store rejection (Guideline 2.5.1, build 1.0(29), iPhone 17 Pro Max + iPad
Air M3): HealthKit declared in the binary without the functionality being clearly identified in the
UI. Resolved by removing HealthKit entirely — founder's call, taken after being shown both options.**
**First, the good news buried in the rejection: 2.1(b) is gone.** Review got past in-app purchases
entirely this round, which retires the IAP thread that consumed the last two submissions.
**The finding:** the app really did use HealthKit — `lib/appleHealth.ts` wrote a completed session to
Apple Health as an `HKWorkout` sample — but the entire user-facing surface was **one row in Settings**
("SYNC TO APPLE HEALTH"), opt-in, default off, with no users. Apple's message offered two resolutions:
argue the UI identifies it (reply + a physical-device screen recording), or remove HealthKit from the
binary. Founder chose removal, which closes the guideline with certainty instead of spending a review
round on whether one settings toggle counts as "clearly identified."
**Removed in full:** the `@kingstinct/react-native-healthkit` config plugin, the dependency (lockfile
included), `lib/appleHealth.ts`, the Settings row, and the `workout-complete.tsx` export call. Nothing
else in the completion flow changed — that call was already fire-and-forget and no-opped unless opted
in.
**One thing worth keeping in the record for whenever Health support returns:** the config declared
`NSHealthShareUsageDescription` — a **read** permission the app never requested (`requestAuthorization`
only ever asked `toShare: ['HKWorkoutTypeIdentifier']`) — whose text read *"Arclo does not read any
Health data."* A binary declaring read access while stating it does not read is exactly what this
guideline exists to catch, and it is a plausible contributor to being flagged at all. A future rebuild
needs a real surface (a Health section or an in-flow prompt, not one settings row) and only the usage
descriptions for permissions actually requested.
**Shipped:** OTA `91eb15b8` published FIRST, deliberately — `runtimeVersion` is `appVersion` (1.0.0),
so a new binary downloads whatever sits at the head of the `production` branch; had the old update
stayed there, build 30 would have pulled JS that still renders a Health toggle its binary can no longer
honor. Then build **30** (`85adc087`) with auto-submit. 438/438 tests, tsc clean.
**▶ NEXT (founder):** when build 30 lands in App Store Connect, select it, reply to the 2.5.1 message
saying HealthKit has been removed from the binary, and submit.

**2026-08-19 (later the same day) — THE ACTUAL CAUSE of the dead paywall, and it was self-inflicted:
every OTA update was shipping an app with no RevenueCat, PostHog, Sentry, or RapidAPI key.**
**`eas.json`'s `build.<profile>.env` is read by `eas build`. It is NOT read by `eas update`** — an
update resolves env from the EAS *environment variable store* for `--environment <name>`, an entirely
separate place, and this project's store holds **only the Supabase pair**. Proven, not theorised: grepped
the exported Hermes bundle against `eas.json` — `EXPO_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY` present;
`EXPO_PUBLIC_REVENUECAT_KEY`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_SENTRY_DSN`,
`EXPO_PUBLIC_RAPIDAPI_KEY`, `EXPO_PUBLIC_PRO_ENTITLEMENT` all **missing**. Consequences, in order of
severity: RevenueCat never configures → `loadProPlans()` returns `sdk_unavailable` → **nothing is
purchasable**, which is precisely the founder's screenshot; PostHog no-ops → **zero analytics**, so the
failure reports nothing; Sentry off; and the ~641 uncached exercises lose their media source.
**Supabase kept working, which is exactly why this went unnoticed** — the app looked fine with its whole
monetization + telemetry layer gone. Every one of those modules is written to no-op safely without its
key (correct for local dev, catastrophic here), so nothing complained anywhere.
**Three earlier readings this session were wrong because of it**, and they're corrected in the record:
`paywall_intro_offer` "never firing" was read as "the founder is still on the old bundle" — no, PostHog
was disabled; same for the missing `paywall_shown` after the screenshot; and "GIFs take so long to
load" had a contributing cause nobody had named.
**Fixed mechanically, not by vigilance:** `mobile/scripts/publish-update.sh <branch> "<message>"` exports
every `EXPO_PUBLIC_*` from the matching `eas.json` build profile into the process (so Metro inlines the
same values a native build gets; an already-set var wins so deliberate overrides still work), hard-fails
if any of the four load-bearing keys is empty, then runs `eas update`. **Never call `eas update`
directly again.** Republished and verified by re-grepping the new bundle: all iOS keys present (the
Android RevenueCat key is correctly absent from the iOS bundle and present in the Android one).
Also fixed the dead-end UI the screenshot showed: the inline "Try again" button added earlier that day
was pushed below the fold **by the sticky footer itself**, so the only visible control was the disabled
"Unlock Arclo Pro". The footer button now *becomes* the retry whenever there are no plans.
OTA groups `da592226` (keys restored) then `7942ef4c` (CTA retry). 438/438, tsc clean.
**▶ NEXT:** force-close, reopen, open the paywall. Prices should load. If they don't, `paywall_plans_unavailable`
now actually reaches PostHog and names the cause.

**2026-08-19 — Monetization hardening: the paywall could no longer be a dead end.** Founder screenshot:
"Subscriptions aren't available right now" with a greyed-out CTA. PostHog puts a **working** paywall on
the same device 5 minutes earlier (`app_open` 17:36:04 → `paywall_shown` 17:36:08 → `purchase_started`
on the *annual package* 17:36:12 → `purchase_failed` reason `cancelled` 17:36:16), so packages had
demonstrably resolved and then didn't. The app **could not say why**: the loader read `offerings.current`,
then `.annual`/`.monthly`, and turned every other outcome into one `null` — one dead-end screen for
five unrelated causes, with no retry. Fixed on all three axes:
1. **Retry.** `lib/fetchWithRetry.ts` (the 2026-08-14 rejection fix) covers **Supabase only**; RevenueCat
   uses its own network stack and was never covered, so a single blip on `getOfferings()` permanently
   disabled purchasing on that screen. Now 3 attempts, 400ms/1200ms — a pure read, so no write hazard.
2. **Dashboard fallbacks** (new pure `lib/proPlans.ts`, 10 tests): `current` → any offering in `all` with
   packages; `.annual`/`.monthly` → `packageType` → the product's ISO-8601 `subscriptionPeriod`. The
   accessors are populated **only** for RevenueCat's predefined `$rc_annual`/`$rc_monthly` identifiers, so
   an offering built with CUSTOM identifiers returns a full `availablePackages` with both accessors null:
   products load and nothing is purchasable, with no outward symptom.
3. **Recovery + diagnosis.** A **Try again** button, an automatic re-fetch on app foreground (guarded so a
   *resolved* paywall never re-fetches behind the user), and a new `paywall_plans_unavailable` event
   carrying the specific reason: `sdk_unavailable` / `fetch_error` / `no_offering` / `no_packages` (the
   App Store Connect signature) / `no_subscriptions`.
Two adjacent correctness fixes: `restorePurchases()` now returns `{ isPro, failed }` — a restore that
*couldn't run* used to tell the user "We couldn't find an active subscription on this Apple ID", a claim
the app had no basis for, on the one flow App Review always exercises; and a purchase that completes
without unlocking (`ok && !isPro`) no longer says "you were not charged" and points at Restore instead.
`tsc` clean, **438/438** tests. Shipped OTA (group `6c5b08ef`).
**F9a is CLOSED — disproven, not fixed.** The standing risk that `EXPO_PUBLIC_PRO_ENTITLEMENT=
"Tempo: Fitness Planner Pro"` is a display name rather than the dashboard identifier (in which case every
purchase would succeed and nothing would ever unlock) cannot be true: `purchase_completed` is tracked
**only** when `res.isPro`, i.e. only when `entitlements.active["Tempo: Fitness Planner Pro"]` resolved —
and it fired 2026-08-18T22:22:10Z. The configured string is the real identifier.
**▶ NEXT (needs the founder, one minute):** open the paywall once on the new bundle. If plans load, this
was the transient failure and it's now self-healing. If it still says unavailable, `paywall_plans_unavailable`
now names the cause — `no_packages` points at App Store Connect (Paid Apps Agreement / product state),
`fetch_error` at reachability, `no_offering`/`no_subscriptions` at the RevenueCat dashboard.

**2026-08-14 — THIRD App Store rejection (Guideline 2.1(a), "error message displayed when we completed
onboarding", iPad Air M3 / iPadOS 26.6, build 1.0(27)). Root-caused from the reviewer's own request
log: a ~1-minute Supabase API-gateway outage, not a code bug.** Found the reviewer's account directly
(`4715e3ce-…`, Apple private-relay email, created 2026-08-14 09:14:56 UTC) — they have **no
`user_profiles` row at all**, no plan, no workouts, i.e. the very first write of onboarding failed.
The edge log for that window shows **every single request from their device returning 503**:
`app_config`, `user_profiles` (×6 retries), `scheduled_workouts`, `rpc/claim_competitive_badges` —
09:14:52 through 09:15:52, then silence. A 503 lands in `describeSaveError`'s `'server'` branch →
"Something went wrong… Couldn't save your plan", which is precisely the message Apple photographed.
**Ruled out as causes, with evidence, not assumption:**
- *Not* the two migrations applied earlier that day — `list_migrations` timestamps them at
  **06:22:35 / 06:22:49 UTC**, ~3 hours before the outage, with **324 successful requests** logged in
  the 07:00 hour in between. A PostgREST schema reload takes seconds, not hours.
- *Not* Postgres — `postgres_logs` across the outage window show the 09:00 cron job running normally
  and routine checkpoints, **zero errors**, no connection exhaustion. The database was up; the API
  gateway in front of it was not.
- *Not* working from the GitHub repo / OTA updates instead of a PC. The 503s were server-side HTTP
  responses; no client build can produce them.
- *Not* recurring: the hourly breakdown over 24h shows **22 × 503 confined to the 09:00 hour and zero
  in every other hour**, before and since. It recovered on its own.
**The real, fixable defect it exposed:** the app had *no tolerance whatsoever* for a transient backend
failure — a single 503 became a dead-end error alert and a half-created account. Fixed with a retrying
`fetch` wired into both Supabase clients (`lib/fetchWithRetry.ts`), deliberately conservative:
502/503 retried for any method (the gateway provably never reached the DB, so a retry can't
duplicate); 504 + network-level failures retried for GET/HEAD only (ambiguous — the write may have
landed and only the response been lost); 4xx and 500 never retried. 8 new tests pin both directions.
`tsc` clean, 422/422 tests. Shipped OTA (group `60ca0029`).
**⚠️ Founder action required — the OTA does NOT fix the rejection on its own.** App Review tests the
**binary**, and while build 27 would pull this update at launch, the failure happened *during* the
review session. Do not rely on that. **A new build (28) should be submitted** so the fix is baked in,
and the reply to App Review should state plainly that the failure was a transient backend outage on
our provider, that it's now retried automatically, and offer the reviewer a demo account. Consider
also asking Apple to re-test, since the same build may now pass.

**2026-08-14 — Actually found the app-open slowness, after several sessions of fixing the wrong
things.** Founder escalated: "the app genuinely cannot be used, super slow, some things don't load at
all," still showing a long loading screen → a flash of /sign-in → Home. This time the diagnosis came
from the **live Supabase request log for the founder's own account**, not from reading code and
guessing: the log showed **~26 seconds** between the first request on app open (03:24:18) and Home's
data queries finally running (03:24:43). Four confirmed causes, all fixed and shipped:
1. **`syncTravelSchedule` rewrote every upcoming session on every single launch.** With travel mode
   on, ~25 single-row PATCHes, `await`ed **one at a time** (~140ms each ≈ 3.5–4s of pure sequential
   network), writing values byte-identical to what was already in the row — it had no "already
   adapted correctly" check at all, so a steady-state open did the maximum possible work. Added the
   no-op check (steady-state open now writes **nothing**), batched remaining writes via `Promise.all`,
   and moved the cheap travel-status check ahead of the workout fetch so the whole path is skipped
   when not travelling. 2 new tests lock both directions.
2. **The sweep force-refetched all of Home on every open.** `invalidateTrainingData()` ran
   unconditionally at the end, marking ~14 query roots stale → Home fetched essentially all its data
   **twice** every launch, even when the sweep changed nothing. Every step now reports whether it
   wrote (`refreshAdaptation` gained a `wrote` flag for exactly this — it previously had "no tracked
   count," which is why the unconditional invalidation existed); invalidation only fires on a real
   change.
3. **The sweep raced the queries that paint the screen.** It ran immediately on mount, competing for
   the network on the slowest connection the app ever sees. Deferred behind
   `InteractionManager.runAfterInteractions` so first paint wins. Nothing in the sweep is needed to
   render today's workout.
4. **The entire UI was gated on a network token refresh — the real cause of the sign-in flash.**
   `getSession()` refreshes an expired access token *before it resolves*; the whole app waited on that
   round trip, and the 5s safety-net timeout fired mid-refresh with `session` still null → redirect to
   /sign-in → bounce back to Home when the refresh landed. Supabase persists the session in the
   **synchronous** SQLite-backed localStorage (`sb-<ref>-auth-token`), so the app now seeds from it and
   renders immediately while the refresh happens in the background. Guarded to only apply when a cached
   `onboarding_complete` profile is also present, so tab-gate routing can't regress.
`tsc` clean, 414/414 tests (2 new). Shipped OTA (group `fcd25b5d`). **Awaiting founder confirmation —
this is the first fix in this thread aimed at a measured bottleneck rather than a suspected one.**
**Still deliberately untouched:** `(tabs)/_layout.tsx`'s `lazy: false` (all 4 tabs fetch on cold start,
~31 queries at once). It remains the largest known remaining lever, and is also the documented fix for
this codebase's own "blank until you revisit" bug class (7+ instances). Held back on purpose so this
batch's effect can be attributed before taking that risk — revisit it if the founder reports the app
is meaningfully faster but still not instant.

**2026-08-14 — Found and fixed a real, confirmed-live cause of "none of the features load": two
migrations existed in the repo but were NEVER actually applied to production.** Founder reported the
familiar slow-open/sign-in-flash sequence, then "none of the features load" — that last part turned
out to be concrete, not just a slow-network perception. Checked live traffic via Supabase logs filtered
to the app's own user-agent and found real, recurring errors on the founder's own account: `GET
.../user_profiles?select=notification_prefs` → **400** (column doesn't exist) and `GET
.../recovery_checkins` → **404** (table doesn't exist). Cross-checked `list_migrations` against the
repo's `.sql` files: `add_notification_prefs.sql` and `add_recovery_checkins.sql` both exist, are
correct, and were simply never run against the live project — the exact same failure class as the
PostHog-key-never-set and Sentry-auth-token-never-set gaps this ledger has already caught twice before.
Same fix: ran both (idempotent `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, no code
changes needed — the files were already correct), verified both objects now exist. No app update
needed — pure database, effective immediately on the next request. **Also found, while checking:** the
same `notification_prefs`/`timezone` 400 has been silently failing inside the hourly `retention-push`
cron job too — every per-user profile lookup in that function has been failing since whenever this gap
opened, meaning per-rule notification opt-outs have been silently ignored (defaults still applied,
degrading gracefully, not a crash) the whole time. Fixed by the same migration; no separate deploy
needed since the function reads the column at query time. **Did not attempt a full audit of all ~57
`.sql` files against applied migrations** — a filename-vs-migration-name diff produced false positives
(e.g. `add_exercise_substitutions` isn't in the applied-migrations list by that name, but the table
demonstrably exists — applied under different bookkeeping at some point), so a real audit needs
schema-existence checks per file, not name-matching. Worth doing properly next session, not blindly
rushed here.
**Separately, founder asked directly for the app to load "almost immediate"** — the two remaining real
levers (the eager 4-tab fetch on cold start, the font-load gate) are unchanged from the prior session's
analysis: both real, both still deliberately not touched blind, pending the founder actually testing
today's fix first now that a genuine bug (not just perceived slowness) has been removed from the
picture.

**2026-08-13 — Founder reported Quick Workout acting "weird": picking 30 min + Chest/Arms/Shoulders
sometimes left Start unclickable, sometimes generated fine, and once generated an all-Core workout
despite the Chest/Arms/Shoulders selection — plus the duration slider losing the finger partway
through a long drag.** Both real, both fixed:
- **Race condition in `quick-workout.tsx`'s `regenerate()`** — zero request sequencing. Tapping
  multiple Target Area chips in a row (exactly what "chest arms shoulders" is — 3 separate taps) or
  adjusting the slider fires a new `regenerate()` call before an earlier one's Supabase round trip
  returns; whichever call happened to RESOLVE last won, not whichever was CALLED last. A stale result
  for a duration/target you'd already changed away from could silently overwrite the current one —
  explains all three symptoms as one root cause (empty/unclickable from one stale resolution, wrong
  all-Core content from another). Fixed with a request-ID guard: each call captures the current
  request counter, increments it, and only applies its result if it's still the latest when it
  resolves — standard, minimal-diff pattern, doesn't touch the exercise-selection logic at all.
- **`Slider.tsx` losing the finger on a long/fast drag** — every `onPanResponderMove` re-read
  `e.nativeEvent.locationX`, a known-unreliable signal for a wide drag (RN re-derives it per event
  rather than tracking it continuously). Fixed by reading `locationX` once at grab time into a ref,
  then using the gesture's own `dx` (delta from grant, tracked independently and reliably by
  PanResponder) for every subsequent move — the standard robust pattern.
`tsc` clean, 412/412 tests. Shipping as its own OTA update.

**2026-08-12 (same session, urgent) — Caused and then fixed a real regression on the founder's own
device the same day: "doesn't load when I first get on, but killing it and reopening works."** Traced
to my own earlier fix in this session — extending `stores/auth.ts`'s cold-start safety-net timeout
from a flat 5s to 20s for any device that had signed in before (meant to fix a different, real report:
a slow network flashing `/sign-in` then bouncing back to Home). That made the founder's OWN device
(permanently in the "had signed in before" bucket after their first sign-in) show up to 20s of a
completely blank, indicator-less screen on every cold start instead of 5 — which reads exactly like
"broken," and force-quitting for a fresh process is exactly how that class of bug has always presented
in this codebase. **Reverted the timeout to the original flat 5s** (removed the now-dead `hadSession`
tracking mechanism entirely rather than leave it unused) **and added a real spinner** (`PulseLoader`)
to both cold-start gate views (`(tabs)/_layout.tsx`, `onboarding/_layout.tsx`), which had ALWAYS been a
bare, indicator-less rectangle even before today — so even the worst-case 5s wait now reads as
"loading," not "frozen," addressing the root perception problem instead of just the timeout duration.
`tsc` clean, 412/412 tests. **Shipped immediately as its own OTA update** rather than bundled with
other work, given the founder is actively experiencing this. Lesson for future sessions: a
timeout/wait-duration change on a codebase with this much documented history of "blank screen until
force-quit" bugs needs the SAME scrutiny as touching `lazy: false` — it very nearly was, and wasn't,
and that gap is exactly what broke here.

**2026-08-12 — Founder reported (away from a PC for weeks, working via Claude Code on the web from
phone): app slow to open, Quick Workout always recommending Core, a jumpy duration slider, GIFs slow
to load, and a cold-start bug — 15s blank, briefly asks to sign in, then bounces back to Home.** All
fixed this session — see Session Log + `ARCHITECTURE.md` for full root-cause writeups. `tsc` clean,
412/412 tests. **Shipped live via `eas update`** (branch `production`, runtime `1.0.0`) — first OTA
update group `93fc9eaa` (Quick Workout + slider + sweep parallelization), second group covers the
auth-bounce + GIF-caching fixes below; confirmed landed via `eas update:list`. **Still not confirmed
by the founder actually using it** — they have no device access pattern beyond their own phone right
now, so "shipped" here means "live on the production channel," not "seen working." Flag for a
follow-up check next session. Push protocol is the founder's ONLY path to updates for the next few
weeks (no PC access) — this session and any future one on this branch should keep
auto-committing/pushing AND shipping OTA updates via `eas update` per usual, since there's no one to
hand off to. **Note for future sessions on this branch:** an `EXPO_TOKEN` was supplied in-chat to
authenticate `eas-cli` — if a fresh session needs to ship an update and isn't already authenticated,
ask the founder for a token the same way (ideally via the environment's env-var settings instead of
chat, to avoid it sitting in a transcript) rather than assuming one is still set. Also: this
environment's network policy had to be widened from **Trusted** to **Full** to reach `api.expo.dev`
at all (Trusted's allowlist doesn't include it) — if a future session hits the same
`connect_rejected` proxy error against `api.expo.dev`, that's why, not a token problem.

**Immediate: iOS's second rejection (missing Terms of Use/EULA link) is fixed and resubmitted
(2026-08-09) — founder confirmed both ASC fields set and the app version + both subscriptions
resubmitted together.** Check Apple's review status first when picking this back up.

~~**`registerPushToken` could be RLS-blocked (Postgres 42501) when a device's token row was already
owned by a different user.**~~ **Fixed 2026-08-10** — `device_tokens`'s RLS split per-command
(`fix_device_tokens_reassign_policy.sql`, applied live): UPDATE's `USING` relaxed to `true` (its
`WITH CHECK` still requires `auth.uid() = user_id`), so a device's push token can now be reclaimed
by a new signed-in user without ever letting anyone make a token point at someone else's account.
See `ARCHITECTURE.md`'s `device_tokens` entry for the full reasoning. Also fixed the same session:
the adjacent "calendar returned only all-day events" diagnostic was filing as a Sentry Error
(`captureApiError`) for expected, non-broken behavior — added `captureDiagnostic` (info-level,
`lib/crashReporting.ts`) and moved that one call site to it.

**Open, unresolved — session logout after "a while," reported 2026-08-09, founder about to be
offline with no device to help debug further.** Symptom: signing in and closing the app works fine
on a quick reopen, but after the app's been closed "a while" (exact window not pinned down), it
requires signing in again. Checked and ruled out: (1) not a persistence-never-happens bug — those
fail every time, not just after a delay; (2) `expo-sqlite/localStorage/install` correctly installs
before `createClient()` in `lib/supabase.native.ts`, `persistSession: true` is set; (3) confirmed via
`node_modules/@supabase/auth-js` source that `getSession()`'s `__loadSession()` DOES check
`expires_at` and awaits `_callRefreshToken()` before returning if expired — not a naive stale-token
return; (4) Supabase's own auth logs (last 24h) show **zero** refresh-token errors — when a refresh
is attempted, it succeeds server-side, which argues against a refresh-token-rotation-race theory.
Not caused by anything this session touched (nothing today changed sign-out, storage, or refresh
logic). Best unverified hypothesis: something client-side isn't attempting the refresh it should in
this scenario, rather than the server rejecting one — but this is a guess, not a diagnosis. Needs
real reproduction (how long is "a while"? which sign-in method?) and device-level `_debug` auth logs
to actually pin down — deliberately not blind-fixed given the founder can't verify or roll back while
traveling.

**2026-08-09: a founder-requested codebase-wide sweep for the "blank-until-revisit" async-gating bug
class found two more real instances beyond the Android sign-in fix that prompted it — seven
confirmed instances total in three weeks now, one of them (`(tabs)/plan.tsx`'s `loadWorkout()`) on
the workout hub, the single most-used screen in the app.** All seven are fixed. This is no longer
"recurring," it's a convention gap — worth a shared `useAsyncGate`-style hook or a lint rule the next
time this class of bug surfaces, not another reactive one-off patch. See Session Log for the full
list of files checked/fixed.

**T1.2, the on-device verification pass, RAN for the first time 2026-08-02 — on the Mac's iOS
Simulator, not yet a physical device.** It found real, confirmed bugs (not just theoretical
code-review findings): a live-repro'd cold-launch crash on a from-scratch native build, an
unauthenticated edge function with full service-role DB access, silent data loss on workout edits,
and a broken new feature (muscle-history's vocabulary mismatch), among others. **Both Tier-1
(blocking) and Tier-2 (real, non-blocking) findings from that pass are now fixed** (see Session
Log) — `tsc`-clean, 372/372 tests. Tier-3 (product/UX asks from the founder's own live testing) are
queued in the Open Backlog below (T3.1–T3.6), several explicitly needing founder design/scope input
before building. **T1.2 is still not fully closed**: a Simulator pass cannot confirm Live
Activities, push delivery, Sign in with Apple, or anything gated on real hardware — those still
need one physical-device pass after the next EAS build. The large body of code from the dozen-plus
sessions before this one (the entire M1–M3 Claude-buildable backlog, `MASTER_FIX_PLAN.md`'s P0/P1
batches, the
`LAUNCH_SCORE_PLAN.md` queue, Tempo Coach, the offline set-log retry queue) is now Simulator-
exercised for the first time via this pass rather than purely code-verified, which is real progress
even though the harder hardware-only claims remain open.

**Tempo Coach is built through batch C4 (the action layer) but is completely inert in production.**
The screen (`app/coach.tsx`), the propose/apply action layer (`lib/coachActions.ts`), Pro gating, and
a dev stub (`lib/coachStub.ts`, `__DEV__ && EXPO_PUBLIC_COACH_STUB=1`) all exist and are
`tsc`+test-verified, but the Edge Function has never been deployed and no Anthropic API key has ever
been set — the function does not exist in the Supabase project. Two commands unblock it:
```
cd mobile && npx supabase functions deploy tempo-coach
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```
Without these, Coach returns 503 and the screen shows "Coach isn't available right now." Building
Coach at all was a deliberate, explicit founder override of the M4 feature-freeze (2026-07-22/23) —
not an accident — so its presence here isn't a regression against `EXECUTION.md` §2's "no Tempo
Coach until M4" rule, just a fast-follow the founder chose to build now and ship later. Model is
`claude-sonnet-5`; free tier is capped at 3 messages/calendar month (both tiers share one window).
Still-open Coach decisions: the non-Anthropic-provider question is closed (rejected — cap change made
the savings irrelevant), but the server-can't-see-RevenueCat-subscriptions gap must be closed before
`pro_enabled` goes global, and C5 (remaining-count UI, paywall routing, entry points) is unbuilt.

**B0.3 (PostHog activation definition) is drafted and awaiting founder sign-off.**
`ACTIVATION_DEFINITION.md` proposes keeping the existing 2-session, no-time-window activation
definition and tracking calendar-connected as a cohort split rather than a gate — one open decision
in it (should activation gain a time window) is the founder's call. The funnel + retention dashboard
("Tempo — Activation & Retention", PostHog id 1865254) is already built and waiting; it just needs
real events flowing from a shipped build (same root blocker as T1.2 — nothing has been confirmed to
produce real PostHog data on-device yet).

**Everything else buildable without hardware or a founder decision is done.** The
`LAUNCH_SCORE_PLAN.md` queue is empty except T1.2. Pricing is live and correct on both stores
($4.99/mo, $34.99/yr, `founding-price-2026` yearly intro at a flat $24.99 first year) as of
2026-07-27 — B2.3 is closed. Google Calendar is approved for production (B0.2 closed) and multi-
calendar (B1.5) is code-complete, including a self-serve reconnect button added 2026-08-04, and
dormant pending one founder reconnect on a real device. The next real
Claude-buildable work, in order of value, is: (1) whatever the on-device pass surfaces as broken,
(2) the **Open backlog** below (`MASTER_FIX_PLAN.md`'s remaining C5–C10 craft batches, W2–W6 wedge
amplifiers once M4 unblocks them, and the four still-open 2026-07-19-addendum runner items).

**2026-08-06 — the app is now actually submitted to both stores for the first time.** A founder
pricing-bug report (paywall showed $24.99, charged $34.99) led to fixing a real iOS eligibility gap,
then discovering App Store Connect's v1.0 record had never been filled in for real production review
— category, age rating, App Privacy answers, price tier, and both subscriptions were all still unset.
All of it is now filled and submitted together (app version + both Pro subscriptions + subscription
group), per Apple's requirement that the first subscription group ship with a new app version. Google
Play's live store listing was also found still branded "Tempo" and corrected to Arclo, submitted for
review. ~~**Open from this session:** Play's Feature Graphic image still literally says "Tempo" — needs
a real redesigned asset (founder/design call, not a text fix);~~ **(Feature Graphic closed
2026-08-30 — downloaded the live asset and it reads "Arclo / Precision fitness scheduling for your
peak performance." It had already been replaced.)** RevenueCat entitlement ID still hasn't
been independently verified against `eas.json`'s value (item 5 below); both store reviews are pending
(Apple ~48h, Google typically within 7 days).

**Last updated:** 2026-08-02 — the Mac's first-ever on-device (Simulator) pass ran, found real bugs,
and every Tier-1 + Tier-2 finding from it is now fixed on Windows (see Session Log); T1.2 above
still needs a real physical device before it's fully closed.

---

## Ledger — every audit recommendation, tracked

Each row names the **metric it moves** (per `EXECUTION.md` §9 — a batch that moves no metric gets cut).

### M0 — Measurable & Reliable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B0.1 | Retention instrumentation (`activation_reached` + `calendar_connected`) | 🔍 | Measurability | `lib/activation.ts`, `analytics.ts` | Real `EXPO_PUBLIC_POSTHOG_KEY` wired into both EAS profiles + `.env.local` (2026-07-17 fix — earlier ✅ had been wrong, every `track()` call was a silent no-op). Events fire correctly in code; held at 🔍 until a real on-device build (T1.2) confirms PostHog shows a non-zero event count |
| B0.2 | Google OAuth → Production + fix "connects but no events" | ✅ | Reliability, Trust | `CalendarApiService.describeReadError` (in-app diagnostic) | **Done 2026-07-17** — Google approved the app for production, removing the Testing-mode 7-day token-expiry root cause. Still wants an eventual real >7-day on-device confirmation, but the structural cause is gone |
| B0.3 | PostHog funnel + written activation definition | 🔍 | Measurability | PostHog dashboard "Tempo — Activation & Retention" (id 1865254); `ACTIVATION_DEFINITION.md` | Funnel + retention insights built 2026-07-17 (currently empty pending real events — see B0.1). `ACTIVATION_DEFINITION.md` drafted 2026-07-17 — **awaiting founder sign-off**, one open decision named in the doc |
| B0.4 | Feature-freeze policy (no new surfaces until M4) | ✅ | Focus | `EXECUTION.md` §1/§9 | Written + in effect. **Exception granted explicitly by the founder for Tempo Coach** (2026-07-22/23) — Coach is built through C4 but deliberately not deployed; the freeze otherwise holds |
| B0.5 | Device-matrix QA of redesign; fix any blank-render | 🔍 partial | Reliability, Polish | Real device *(founder)*; iOS Simulator pass done 2026-08-02 | Home/Settings/editable-sets confirmed on-device 2026-07-17. **2026-08-02: first Simulator pass on everything shipped since** (Focus Mode, onboarding rebuild, Plan tour, Feed button, Coach, the whole `LAUNCH_SCORE_PLAN.md` queue, the offline write queue, muscle-history) — found and fixed 4 blocking bugs (see Session Log). Still needs a real physical-device pass for anything Simulator can't exercise (Live Activity, push delivery, Sign in with Apple) |

### M1 — The Wedge, Undeniable
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B1.1 | Wedge quantifier (`schedulingImpact`) | ✅ | Value Prop, Differentiation | `lib/schedulingImpact.ts` → Weekly Report, paywall, Progress, **and Home hero subtitle** (added 2026-07-23 as `LAUNCH_SCORE_PLAN.md` T1.1) | Stat card/line visible on a primary tab, above the fold |
| B1.2 | Calendar day-timeline — Home hero | ✅ | Differentiation, UX, Activation | `lib/dayTimeline.ts`, `components/DayTimeline.tsx`, `(tabs)/index.tsx` | **Confirmed on-device 2026-07-17** |
| — | IA cleanup: Train → Plan (segmented hub → calendar + split + library) | 🔍 | UX, Focus | `(tabs)/plan.tsx` | Built same batch as B1.2; Plan-specific flows not separately device-confirmed |
| B1.3 | "Reschedule my whole week" — engine + UI | ✅ | Subscription Value, Retention | `lib/weekReschedule.ts`, `reschedule.ts`, `(tabs)/index.tsx`/`plan.tsx` | Confirmed via web test; Pro-gated (B2.1). Coach's C4 action layer (`rescheduleWholeWeek`) now also calls this same engine |
| B1.4 | "Lacking time? 15-min swap" on Home | ✅ *(pre-existing)* | Retention (busy persona) | `lib/quickSuggestion.ts` → Quick Workout | Already covered free-gap/missed/restart triggers |
| B1.5 | Multi-calendar: read/select beyond `primary` | 🔍 **code complete, needs one real device test** | Differentiation, Trust; Pro gate | `calendar-picker.tsx`, `services/googleCalendar/config.ts` | Full stack built 2026-07-17; OAuth scope (`calendar.calendarlist.readonly`) enabled 2026-07-18 (OTA, no rebuild). Verified live 2026-08-04: 0 of 3 connected tokens in prod carried the new scope (a token's granted scopes are fixed at consent time — nothing server-side can add one retroactively), so `fetchCalendarList()` 403'd for every real user. **Fixed same day:** the picker now detects that exact scope-insufficient error and offers a one-tap "Reconnect Google Calendar" button (calls `connectGoogleCalendar()`, which forces `prompt=consent` to re-grant the current scope list) instead of dead-ending on static copy. **Founder's turn, unchanged:** tap it once on a real device to prove the grant actually works; if Google shows an "unverified app" interstitial instead of a normal consent screen, that means scope verification in Cloud Console isn't actually finished and needs completing there |

### M2 — It Sells Itself
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B2.1 | Re-fence Pro: free analytics, gate scheduling | ✅ | Conversion ×3–4 | `(tabs)/progress.tsx`, `paywall.tsx`, `lib/proFeatures.ts` | Analytics free; reschedule-week + Travel Mode Pro-gated. **Re-gated further 2026-07-22** onto the weekly-repetition pillars (rolling auto-schedule horizon, auto-reschedule-on-conflict) after finding Pro had become "a tip jar" — no free user's experience degrades if Pro vanished, previously true, no longer |
| B2.2 | Paywall triggers at the payable moment | ✅ | Conversion | reschedule-week, 2nd-calendar (B1.5), and **PR forecast** (`pr_forecasting` gate, added 2026-07-23 as T2.1) | Fires at the wedge action, not a random 1st workout. Paywall itself rebuilt 2026-07-22 (personalized hero, `WeekStrip`, 3 outcome cards, forced-dark palette) |
| B2.3 | Pricing raise + trial config | ✅ | ARPU | RevenueCat + App Store Connect + Play Console *(founder, done)* | **Done 2026-07-27** — $4.99/mo, $34.99/yr live on both stores; `founding-price-2026` yearly paid-intro at a flat $24.99 first year (founder's call, not a re-derived discount %). Differs from the ledger's original "$49–59" target — founder's real pricing decision supersedes it |

### M3 — Week One Doesn't Bleed
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B3.1 | Plain-language copy sweep | ✅ | Beginner activation | `onboarding/goal.tsx`, `paywall.tsx` | First-run jargon-free |
| B3.2 | Progressive disclosure (hide social/groups/map pre-activation) | ✅ | Week-1 retention | `(tabs)/profile.tsx`, `progress.tsx` | Confirmed on-device |
| B3.3 | Onboarding aha + time-budget question | 🔍 | Activation | `onboarding/*` — 6 screens (`goal→schedule→sleep→work-school→train-time→plan-preview`) | Rebuilt across two founder-testing rounds (2026-07-17) plus the engine-v2/first-run branch's Welcome screen + Home tour (see Session Log). Not yet device-tested in its current form |
| — | Settings/Profile split | ✅ | UX, Focus | `app/settings.tsx`, `(tabs)/profile.tsx` | **Confirmed on-device 2026-07-17** |
| — | Editable completed sets + unilateral weight | ✅ | Workout Experience | `(tabs)/plan.tsx`, `session-detail.tsx`, `lib/unilateralPrefs.ts` | **Confirmed on-device 2026-07-17** |
| — | Interactive Plan tour + Home tour + Welcome screen | 🔍 | Onboarding, Discoverability | `lib/tutorial.ts`, `stores/tutorial.ts`, `components/TutorialOverlay.tsx`, `app/welcome.tsx` | Plan tour built 2026-07-17; Welcome + Home tour shipped on the `feature/engine-and-first-run` branch (merged to local `main`, not yet on-device tested) |
| — | Active-session Focus Mode | 🔍 | Workout Experience | `components/FocusMode.tsx` | Rebuilt substantially since 2026-07-17 (ScrollView/keyboard fixes, RPE added, auto-close bug fixed, checkmark-vs-pencil fix, Settings on/off toggle) — still not on-device confirmed |
| — | Recovery button → Feed button → real notification center | 🔍 | Notifications, Retention | `(tabs)/index.tsx`, `app/feed.tsx`, `lib/feedLog.ts` | Built 2026-07-17, redesigned into a real merged local-log + `notification_log` inbox 2026-07-22 |
| — | Home/Progress fixes (streak, rest-day, body intelligence, photo gallery, readiness chip, goal ETA) | 🔍 | Motivation, Progress Tracking, Trust | `(tabs)/index.tsx`, `progress.tsx`, `lib/trainingLoad.ts`, `lib/goalProjection.ts`, `app/progress-photos.tsx` | Built 2026-07-17; not yet device-tested |
| — | Quick Workout redesign (slider, body-part chips, muscle hard-filter) | 🔍 | Activation, Workout Experience | `app/quick-workout.tsx`, `lib/quickWorkout.ts` | Built 2026-07-21, web-tested + fixed 2026-07-21 (later); native/device pass still open |

### M4 — It Holds a Cohort *(gate: D7 trending up before growth spend — still blocked on B0.3)*
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B4.1 | Single-player accountability loop | 🔲 *(blocked by M4 freeze)* | D7/D30 retention | new `lib/` + Home surface | A commit/streak-save loop that works with zero friends |
| B4.2 | Referral program | 🔲 *(blocked by M4 freeze)* | Virality, CAC | Supabase migration + edge fn + UI | Referral link issues + credits a month |
| B4.3 | Cohort retention analysis + iterate | 🔲 *(needs B0.3 first)* | Retention | PostHog *(founder + data)* | D1/D7/D30 measured for ≥2 cohorts |
| — | Social push nudges + auto-reschedule *(`SOCIAL_UPGRADE_PLAN.md` Stage 4 remainder)* | 🔲 *(blocked by M4 freeze)* | Retention (social persona) | extend `retention-push` with social rule keys; social-aware `reschedule.ts` | The only undelivered piece of the 4-stage social upgrade (Tempo Score, leaderboards, badges/feed, private groups, and social scheduling's core are all shipped) — new retention-push rule keys ("you're 1 workout from passing Alex," "workout with Josh tomorrow") + letting a social conflict trigger the existing reschedule engine |

### M5 — Credible & Hardened
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B5.1 | Honest readiness label | ✅ | Trust, Science | `components/ProgressCards.tsx` | Disclosure added; readiness confirmed never a gate |
| B5.2 | HealthKit import (sleep/HR/steps) | 🔍 *(one-way write only, opposite direction)* | Science, Readiness | `lib/appleHealth.ts`, `@kingstinct/react-native-healthkit` | **2026-07-22: built the opposite direction first** — Tempo now *writes* a `traditionalStrengthTraining` sample to Health (opt-in, off by default, iOS only). Reading sleep/HR/steps *into* readiness is still 🔲. Native — inert until next `eas build` + on-device confirm |
| B5.3 | Readiness → scheduling feedback | 🔲 *(= `MASTER_FIX_PLAN.md` W2)* | Differentiation | scheduling + readiness libs | Low readiness suggests moving today's heavy session |
| B5.4 | Volume landmarks (MEV/MRV) under the hood | 🔍 | Science credibility | `lib/volumeLandmarks.ts`, `lib/progression.ts`, `(tabs)/plan.tsx` | Real live MRV cap (cap only, no MEV floor); needs an on-device open-a-workout smoke test |
| B5.5 | Integration/E2E tests on state machines | ✅ | Reliability | `lib/__tests__/fakeSupabase.ts` + suites | All named bug classes regression-locked; suite has grown to 367+ tests through the F1–F10/C1–C3/W1 work below |

### M6 — Growth & Table Stakes
| ID | Item | Status | Metric it moves | Primary files / where | Done-when |
|---|---|---|---|---|---|
| B6.1 | Wedge-led App Store listing | 🔍 | Install→page conv. | App Store Connect + Play Console | **Both listings are now live and correct (2026-08-30).** iOS 1.0 is `READY_FOR_SALE` after three rejections (3.1.2, then a missing Terms of Use/EULA link, then 2.5.1 HealthKit). Android has been in Play production since 2026-08-09; on 2026-08-30 its two stale screenshots (raw `UPPER_CHEST` enum, old "Tempo" wording) were replaced, and the Feature Graphic was verified already Arclo-branded. Still 🔍 — a correct listing is not a converting one, and there is no conversion data yet. |
| B6.2 | One acquisition channel (calendar-trick content) | 🔲 | Top-of-funnel | *(founder)* | A repeatable weekly motion running. `PRODUCT_AUDIT.html` Part II has the full route (short-form video, 8-week plan, ASO fields) |
| B6.3 | "Year in Training" annual Wrapped | ⏸ | Organic growth | `lib/wrapped.ts` (extend) | Postponed past M4 |
| B6.4 | Table-stakes polish (Watch, widget, Live Activity, named programs, exercise prefs) | ⏸ | Various | various | Each unlocked only as data justifies. Superset/circuit support and "love this exercise" boosting (the other half of `MASTER_FIX_PLAN.md`'s exercise-preferences item — the "never show again" half shipped, see Open backlog) still genuinely open here |

### Deferred / Rejected pool *(tracked so nothing is "forgotten" — not active)*
| Item | Status | Reason |
|---|---|---|
| More Progress analytics depth | ❌ | Over-built; charts don't retain/convert |
| New social/community/groups surfaces | ❌ | Hide (B3.2), don't extend — the 4-stage social upgrade that already shipped is the exception that proves the rule (extended existing systems, no new surface class) |
| Muscle-map / readiness *polish* | ❌ | Fitbod echo, not the wedge |
| Premium themes/icons as headline Pro | ❌ | Bonus flair, not a subscribe reason |
| Nutrition tracking | ❌ | Link to MFP, don't build |
| AI photo form-analysis · voice logging · watch-face complication | ❌ | Flashy, high-effort, not the wedge |
| Equipment personalization images (onboarding) | ⏸ | Asset/illustration work, lower-value |
| Contextual one-off tips (first-Progress/first-Quick-Workout/first-equipment-change) + illustrated empty states | ⏸ | Deferred low-priority polish from the engine-v2/first-run build (`PLAN.md`) — the `useOnceTip` hook + current text empty states cover these adequately for now |
| Program marketplace · B2B/coach mode · corporate wellness | ⏸ | M-Future; earn $1M ARR first |
| Localization · cardio/running plans | ⏸ | Post-PMF growth levers |
| **Tempo Coach (LLM tentpole)** | 🔍 **built through C4, undeployed** | Founder explicitly overrode the M4 freeze 2026-07-22/23 to build it now; deployment (2 commands, see Current Focus) and C5 (entry points) still needed before it's live to any user |
| Apple Watch · home-screen widget · Live Activity rest timer | ⏸ | Postpone past M4 (retention proof) |
| Referral program · "Year in Training" Wrapped | ⏸ | Postpone past M4, per `MASTER_FIX_PLAN.md` P4 |
| Strength benchmarks · smart-notif timing (`MASTER_FIX_PLAN.md` W3) · weekly "plan your week" ritual (W4, a new surface — needs M4 + sign-off) | ⏸ | Nice-to-have; pull in during M5/M6 as justified |

---

## Open backlog *(absorbed from `MASTER_FIX_PLAN.md` — that file is being retired)*

`MASTER_FIX_PLAN.md`'s P0 ship-blockers (F1–F10) are 100% done, as are P1's C1 (shared date
utilities) and C2 (theme sweep) — see Session Log. What's below is everything still genuinely open,
carried forward with enough file/line detail to re-execute without re-deriving the analysis. Two
items the static plan file never got updated to reflect as done are called out explicitly (judgment
calls, not guesses — verified against the actual 2026-07-20/21/22/24 session entries before crediting
them).

| Item | Files / lines | Scope | Status |
|---|---|---|---|
| **C4 remainder — accessibility** | `(tabs)/plan.tsx`, `(tabs)/index.tsx` | **2026-08-04: another real pass, still partial by design.** Audited both files for genuinely icon-only touchables (no Text sibling — the real screen-reader failure mode; icon+text pairs already read via RN's default accessible-subtree text flattening, lower severity). `index.tsx`'s icon-only buttons were already fully labeled from the 2026-07-23 pass. `plan.tsx` had real gaps on primary actions: the hub's Start/Resume session button (the single most important control on the whole screen had NO label), Edit workout, a day-card's Edit button, both Library nav rows (Exercise Library, Manage Workouts), and Add Exercise — all fixed. Per-exercise secondary actions (Form guide/Swap/Why-this-workout, all icon+text) deliberately left for a future pass. A real VoiceOver/inspector pass is still needed — current Accessibility score (5) is code-review-only | 🔍 partial |
| **C5 — Split `plan.tsx` into Plan hub + Workout Runner** | `(tabs)/plan.tsx` (3,315 lines — the largest file in the app; hub ≈ first ~1,800 lines, runner ≈ ~2,186 on) | Pure extraction, zero behavior change. Read the whole file first to find the *real* hub/runner boundary (the line estimates are approximate). Extract the runner into its own file — a new route or a conditionally-rendered component depending on how navigation currently works; don't change the URL/nav structure as a side effect. Preserve every prop/handler/conditional branch. Re-run the full Plan/Runner on-device checklist after | 🔲 |
| **C6 — Typed routes + push routing completeness** | 33 files across `src/app` + `src/components`; `_layout.tsx`'s push-tap routing | **Done 2026-08-04.** Typed routes were never actually broken — `experiments.typedRoutes` was already on and `.expo/types/router.d.ts` generates a full, correct route union; the casts just predated that (one even had a stale `/* typed-routes regen on next run */` comment). Removed all 90 now-dead `as any`/`as never` casts on `router.push`/`router.replace` calls; `tsc` caught the 3 that were genuinely needed (a coach action's runtime-resolved route, a feed item's stored screen string, the tutorial overlay's cross-screen step navigation) and those were restored, not blanket-removed. The push-tap `default` case was **already added 2026-08-02** (routes to Home only for a real retention-push, never a local notification) — this row's text just hadn't been updated. tsc clean, 390/390 tests | ✅ |
| **C7 — Virtualize long lists** | `workout-history.tsx` (done); `social.tsx` (assessed, not converted) | **`workout-history.tsx` done 2026-08-04** — converted the `.map`-inside-`ScrollView` row list to `FlatList` (up to `PRO_ROW_LIMIT`=500 rows, the genuinely unbounded one), matching `pr-browser.tsx`'s pattern; preserved the per-row `FadeInView` stagger and the `hasHiddenHistory` upsell as `ListFooterComponent`. **`social.tsx`'s feed checked and deliberately left alone**: its `friend_feed()` RPC (`supabase/add_activity_reactions.sql`) is server-capped at `limit 30` over a 14-day window — not actually unbounded, contrary to this row's original premise. The feed is also just one interleaved section of one big multi-section `ScrollView` (requests/invites/leaderboard/feed/groups/friends/privacy all together) — splitting it out would mean restructuring the whole screen around a nested-list pattern for a ~30-row cap, real regression risk for no real gain. Not converted | ✅ *(scoped down, not skipped)* |
| **C8 — Differentiate Terms vs Privacy links** | `paywall.tsx:522/531`, `sign-in.tsx:207/209`, `legal.tsx` | **Already done** — shipped in commit `3dd5f4b` ("Three launch-audit quick wins... Terms/Privacy split..."), this row's static text was never updated to reflect it (same mislabeling pattern as the P3 rows below — verified against the actual code before crediting). `legal.tsx` takes a `section: 'terms' \| 'privacy'` param, sets a distinct screen title per section, and scrolls to the Terms block when `section=terms`; both `paywall.tsx` and `sign-in.tsx` already pass the param on their respective links. `settings.tsx:705`'s single combined "PRIVACY & TERMS" row deliberately still links to the bare `/legal` (top-of-doc) — it's one row, not a Terms/Privacy pair, so there's nothing to differentiate there | ✅ *(mislabeled open in the source file)* |
| **C9 — Analytics completeness** | `(tabs)/plan.tsx`'s `beginSession`, `_layout.tsx`, `lib/purchases.ts`, `lib/analytics.ts` | **Done 2026-08-04.** (1) `session_start` now fires from `beginSession` (the planned-session not-started→in-progress transition) with `type: 'planned'`, alongside (not replacing) the existing one-time `first_workout_started` — previously only Quick Workouts tracked a start at all. (2) New `screen_view` event fired from one centralized `usePathname()` effect in `_layout.tsx` (PostHog's own recommended Expo Router pattern, not a manual call per screen) — covers Home/Progress and every other route in one place. (3) `trial_started`/`trial_converted` now track the entitlement's own period-type transition (new `fetchProAndTrialState()` seeds a `wasTrial` baseline) instead of `nowPro && !wasPro` alone — a direct no-trial purchase no longer mislabels as `trial_converted` (the paywall's own `purchase_completed` already covers that path), and a real trial→paid conversion — which stays `isPro: true` throughout, so it never crossed the old boolean edge — now fires correctly. (4) `app_open` double-fire was **already fixed 2026-08-02** (a 2s cold-launch window in `_layout.tsx`); this row's text just hadn't been updated — verified against the live code before crediting, not re-fixed | ✅ |
| **C10 — Dependency hygiene** | `package.json` (`@lottiefiles/dotlottie-react` alongside `lottie-react-native`), `app.json` | Grep for any real usage of `@lottiefiles/dotlottie-react` (a web/DOM package with no place in an RN bundle); remove if genuinely unused. Check whether the installed `lottie-react-native` version needs a config-plugin entry for Expo SDK 56. Also just *document* (don't fix) that the `development` EAS profile has no `env` block | 🔲 |
| **W2 — Readiness → scheduling feedback** | *(= B5.3 above — tracked in the M5 ledger row, not duplicated here)* | | 🔲 |
| **W3 — Smart notification timing** | `retention-push` edge function + the calendar data it already reads | Avoid nudging mid-meeting — a "the app actually knows my day" touch. Blocked behind M4 freeze (wedge amplifier, not core loop) | 🔲 postponed |
| **W4 — Weekly "plan your week" ritual** | new surface | A Sunday-anchored moment built around the wedge. Explicitly flagged as a **new surface** — needs the M4 gate + founder sign-off, not a unilateral build | 🔲 postponed |
| **W5 — HealthKit import (reading)** | *(= B5.2's unbuilt read direction above)* | | 🔲 |
| **W6 — Streak counted by days, not sessions** | `lib/streak.ts:69,83` | `sessionStreak`/`longestSessionStreak` still increment per *completed session* for the Profile hero stat + friend-overview display — two workouts in one day still add 2 to what's presented as a "day streak." **Partially addressed 2026-08-02**: the Mac audit found this ALSO fed `social.ts`'s friend-feed milestone broadcast ("reached a 30-day streak"), turning an internal display quirk into a false claim sent to other users. Added `distinctDayStreak()` (same file) and switched ONLY `syncSocialOnOpen`'s milestone check to it — narrowly scoped since redefining `sessionStreak` itself touches the Profile hero stat and friend-overview display everywhere, a bigger blast-radius change deliberately left for this row rather than folded into a mixed fix-pass. Remaining scope: decide whether the Profile hero stat should also switch to the honest day-count (or be relabeled "Session streak"), then migrate its remaining callers | 🔍 partial |
| **P3 — plate calculator** | `lib/plateCalc.ts`, `components/PlateCalcSheet.tsx` | **Already done** — shipped 2026-07-20/21 as a Pro `plate_calculator` gate, reached from the runner's per-exercise menu. `MASTER_FIX_PLAN.md`'s static P3 list was never updated to reflect this (judgment call, verified against the actual session entry before crediting) | ✅ *(mislabeled open in the source file)* |
| **P3 — pause/vacation mode** | `lib/` pause logic + Home | **Already done** — shipped 2026-07-22 as L21, the highest-value previously-unbuilt item in the app; streak protection needed no special-casing | ✅ *(mislabeled open in the source file)* |
| **P3 — exercise preferences ("love this" / "never show again")** | `user_profiles.excluded_exercise_ids`, `lib/exerciseExclusions.ts` | "Never show again" half is done (2026-07-20/21, enforced uniformly across `generatePlan`/`quickWorkout`/`splitSchedule`). "Love this" (a positive preference boost) is still unbuilt | 🔍 half-done |
| **P3 — superset/circuit support in the runner** | runner (post-C5 split, wherever it lands) | Still fully open, not mentioned shipped anywhere | 🔲 |
| **P3 — Home/no-equipment first-class workout mode** | Quick Workout / Home | Still fully open — a large reachable segment given Tempo already models equipment | 🔲 |
| **2026-07-19 addendum — drag-to-reorder** | runner exercise list, `persistOrder()` | Founder-requested. Needs real gesture-handling (long-press-and-drag with autoscroll) — `react-native-draggable-flatlist` or a Reanimated long-press handler, persisted through the existing session-scoped `persistOrder()`. Deserves its own on-device-tested pass | 🔲 |
| **2026-07-19 addendum — first-workout rest-time prompt** | `T.firstWorkout` tutorial, the rest-length `OptionSheet` | The capability already exists (rest `OptionSheet` suggests "2 minutes," lets the user pick 60/90/120/180/custom) — it's just never proactively surfaced. Either add a step to the existing `T.firstWorkout` tour pointing at the rest-timer tool, or gate a one-time auto-open on `!firstWorkoutCompleted` inside `beginSession`. Needs founder confirmation it doesn't fight the existing tutorial system | 🔲 |
| **2026-07-19 addendum — swap/remove sync-to-split** | `replaceExercise`, `persistOrder` in the runner | *Adding* an exercise already correctly syncs to the split when `workout.source === 'split'`; *swapping*/*removing* are deliberately session-only by existing design (own code comments say so). This is a real asymmetry but changing it is a founder product call (should a same-day equipment swap rewrite every future week of your split?), not a guess — Add already offers an explicit "just today, or permanently?" choice; ask whether swap/remove should get the same | 🔲 needs founder call |
| **2026-07-19 addendum — checkmark + swipe completion animation** | `FocusMode.tsx` | The underlying bug ("abrupt switching") is fixed — this is pure animation polish (a Reanimated transition on the exercise-name/ring swap), not a defect | 🔲 nice-to-have |
| **N1 — History horizon as the Pro line: free = 4 months, Pro = unlimited** *(founder-requested 2026-08-02)* | `lib/historyHorizon.ts` (new), `lib/proFeatures.ts`, `muscle-history.tsx`, `exercise-progress.tsx`, `workout-history.tsx`, `paywall.tsx`, `web/launch.html` | **Done 2026-08-02.** New `full_history` Pro gate, extending the existing "depth & horizon" model the same way `pr_forecasting` already does (read-forward there, read-backward here) — read-time clamp only, nothing ever deleted, so buying Pro immediately reveals everything that was always there. Applied to the 3 clearest "browsing history" surfaces: `exercise-progress.tsx`'s trend chart, `muscle-history.tsx`'s range chips (a new 4M chip is the real free ceiling; 6M/1Y/All are lock-icon chips that open the paywall), and `workout-history.tsx`'s session list (date-filtered + a raised row cap for Pro). Deliberately did NOT clamp current-state facts derived from all-time data (best-ever 1RM, "last session," streak, badges) — those describe present capability, not a history browse, per `historyHorizon.ts`'s own documented scoping rule. Also fixed a real bug found while implementing this: the paywall's existing compare table and `launch.html` both already claimed free users get "full history" (pre-dating this feature) — both corrected. **`progress.tsx`'s own dashboard charts were NOT touched** (deliberately, out of scope for this pass) — that screen mixes current-state stats with historical charts via the shared `useProgressStats` hook in ways that need a careful, separate read before touching safely; noted here as a real follow-up, not forgotten. 4 new tests (`historyHorizon.test.ts`). tsc clean, 382/382 tests | ✅ |
| **T3.1 — muscle-history interactive chart** *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `muscle-history.tsx`, `components/SvgLineChart.tsx` | Founder wants to touch/drag along the sets-per-week line and see the exact value at that point (tooltip/crosshair), not just the shape. Check whether `SvgLineChart` can gain touch/drag support cheaply or needs a small custom gesture layer on top | 🔲 queued |
| **T3.2 — muscle-history per-exercise weight-progression** *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `muscle-history.tsx`'s "BY EXERCISE" breakdown | Founder: "people don't want to just see sets per week but also weight progression... definitely for exercises." The breakdown rows should show a weight/e1RM trend per exercise (data already computed in `exercise-progress.tsx`), not just set counts. Whether the muscle-GROUP rollup should also get an aggregate weight trend is explicitly undecided by the founder — don't invent one, the exercise-level addition is the clear ask | 🔲 queued |
| **N5 — Weekly Report scoped to last COMPLETED week only (founder-requested 2026-08-04)** | `lib/weeklyReport.ts`, `lib/schedulingImpact.ts`, `app/weekly-report.tsx` | **Done.** `computeWeeklyReport` used to always compute the CURRENT, still-in-progress week — opening the report on a Tuesday showed 1-2 days of data labeled "Your Week". New `weekOffset` param (0 = current week, still used by `workout-complete.tsx`'s "you've trained X days this week" celebration; 1 = last fully-completed Monday-Sunday, used by the report screen) with every date range now bounded on both ends, not just a floor. `fetchSchedulingImpact`/`summarizeSchedulingImpact` gained an optional upper bound (`weekEnd`) for the same reason — its "this week" stat would otherwise have bled into the still-open current week once the report started asking for last week specifically. Screen relabeled "Last Week" with an explicit date-range line (e.g. "Aug 4 – Aug 10") and every "this week" string corrected to "last week"/"the week before". 2 new tests (`summarizeSchedulingImpact`'s bound). tsc clean, 410/410 tests | ✅ |
| **N4 — Home's streak/readiness/check-in redesign (founder-requested 2026-08-04)** | `components/HeroStatusRow.tsx` (new), `(tabs)/index.tsx` | **Done.** Founder disliked the small `borderRadius: full` pill chips scattered across Home (three near-duplicate hand-rolled rows, one per state: mid-day, day-complete, rest-day). New `HeroStatusRow` — one instrument strip, segments divided by hairlines, matching theme.ts's own "every metric reads like a dial" principle — replaces all three. Every existing behavior preserved exactly: which segments show per state, the streak's muted-until-earned-today treatment, check-in's tap target (same `RecoveryCheckIn` sheet), readiness's tap-through to Progress. Segment order is now consistent across all three states (previously inconsistent between them) — a deliberate improvement, not an oversight. tsc clean, 397/397 tests | ✅ | *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `settings.tsx`'s LB/KG `TouchableOpacity` pair (~line 630) | Founder: "when you click it should switch, not necessarily have to click on target measurement." Check hit-slop/target sizing and add an animated cross-fade/slide on value change | 🔲 queued |
| **T3.4 — "Your first session" tip reappears repeatedly** *(Mac audit Tier 3, founder's own live testing 2026-08-02; fixed 2026-08-04)* | `stores/tutorial.ts`, `lib/tutorial.ts` | **Root cause found and fixed.** Every auto-start call site (`(tabs)/index.tsx` and `(tabs)/plan.tsx`'s `useFocusEffect`s, for the Home/Concepts/Plan tours) only ever gated on "is the tour's LAST step done" — so a tour interrupted before its final step (backgrounded, a tab switch, a force-quit mid-tour; the Concepts tour spans 3 screens, making interruption easy) still read as armed+incomplete on the next visit. `startTour()` always reset `stepIndex` to 0 regardless, discarding progress already recorded by `completeStep()` on every step the user *had* advanced through — so the ENTIRE tour replayed from card 1 every time, reading to the founder as "the tutorial keeps randomly reappearing." Fixed with new `resumeStepIndex()` (`lib/tutorial.ts`, pure + unit-tested) — resumes at the first not-yet-completed step instead of always 0. Applies uniformly to all three spotlight tours since they share one `startTour()`. The separate ad-hoc "Your first session" runner coach-mark (`plan.tsx`'s `tempo.coach.session` key) was checked too — dismiss-only, correctly one-shot, not implicated. 5 new tests (`tutorial.test.ts`). tsc clean, 390/390 tests | ✅ |
| **T3.5 — Tempo Coach character redesign** *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `app/coach.tsx`, `brand-assets/coach-poses/*` | The coach illustration doesn't show the full body. Design/layout judgment call (crop/framing) — get founder input before touching it | 🔲 queued — needs founder design input |
| **T3.6 — Focus Mode: remove inline set-editing entirely** *(Mac audit Tier 3, founder's own live testing 2026-08-02)* | `components/FocusMode.tsx` | Founder: "just make it so you can't edit in focus mode, only if they go back to the exercises." Would remove the "HOW MUCH DID YOU DO?" card's inline fields/save button/RPE-chip editing (the `dismissedKey`/`lastSetKey` mechanism fixed 2026-07-31/08-02) and make the card read-only — meaningfully simplifies the component, but is a deliberate redesign of a feature that A2 above just confirmed working as shipped. Confirm scope with the founder before the refactor | 🔲 queued — needs founder scope confirmation |
| **N3 — Revoke Apple token on account deletion** *(Mac audit 2026-08-02)* | `mobile/supabase/functions/delete-account/index.ts`, `app/sign-in.tsx` | A "deleted" account currently still shows Tempo as an authorized app in the user's Apple ID settings — `delete-account` never calls Apple's `/auth/revoke` endpoint. **Needs new Apple Developer infra the app doesn't have yet**, not just a code change: a Sign in with Apple Service ID + a private key (Team ID/Key ID/`.p8` key from the Apple Developer portal, founder-only), a server-side JWT-signed client-secret generator, capturing Apple's `authorizationCode` at sign-in (available on `credential.authorizationCode`, unused today) and exchanging it for a refresh token to store, then calling revoke with that token on deletion. The related, code-only half — an alert when Apple's sheet resolves with no `identityToken` — is already fixed | 🔲 queued — needs founder Apple Developer credentials first |
| **N2 — Make "what am I actually changing?" unambiguous across workouts vs. split days** *(founder-requested 2026-08-02)* | `(tabs)/plan.tsx`, `edit-session.tsx`, `lib/splitSchedule.ts` (new `propagateSplitDayEdit`) | **Done 2026-08-02.** Resolved both open design questions from this row's original write-up by reading `materializeSplit`'s actual behavior first: (1) the default per action — a 2-choice model ("this session only" vs. "every `{focus}` on your split"), asked only when the workout is split-sourced (a plan day already varies week-to-week via periodization with no fixed template to add "forever" to; a Quick Workout is a one-off with nothing to recur into — both skip the question and just persist to the session, immediately); reorder was deliberately left out of scope (lower-stakes, more contextual than a composition change). (2) whether "this day going forward" is distinguishable from "the split" — yes: it's scoped to ONE weekday (the split template's day-per-weekday entry + already-materialized future instances of it), never all weekdays — "the whole split" stays the Workout Builder's own job, not a 3rd choice here. **The real bug underneath the confusion:** `materializeSplit` only ever *inserts* a row for an open date, never re-syncs an existing one after the template changes — so the OLD "permanent" add only affected materializations past the entire ~4-week rolling horizon, silently doing nothing to any already-scheduled near-term day of that weekday. New `propagateSplitDayEdit` fixes this for real (updates the template AND already-materialized future same-weekday rows), applied identically to add/swap/skip. Also fixed a genuinely separate bug found along the way: "session only" adds never persisted to the DB at all, silently lost on pause/resume. `edit-session.tsx` gained an explicit scope banner + a link to the split editor. 3 new tests. tsc clean, 385/385 tests | ✅ |
| **N6 — Reschedule shouldn't default to "a different day"; add a "do it myself" → edit time path** *(founder-requested 2026-08-06, deliberately queued — a build was just submitted to both stores, no mid-review changes)* | `(tabs)/index.tsx`'s `handleReschedule`/`attnNote` copy (~line 1038, ~1251), `lib/reschedule.ts`'s slot search, the existing `setEditingWorkout` edit-sheet (~line 251/2249) | Founder: the missed/overdue card's copy and CTA ("This was scheduled for {time}. Want to do it tomorrow instead?") frame "Reschedule" as always meaning a different *day*, when the actual fix might just be a different *time* the same day. Two asks: (1) `handleReschedule`'s slot search (today's next-best slot, this week's next-best slot, etc. — check what `lib/reschedule.ts` already searches) should surface a same-day time-shift option before/alongside a different-day one, not skip straight to "tomorrow." (2) A "do it myself" path on this card that routes to Plan and opens the workout already in an editable-time state — the `setEditingWorkout` edit sheet already exists and is reachable from Plan/Home elsewhere (index.tsx:1290/2249), so this is likely a matter of wiring the missed/overdue card to it with the right prefilled workout, not building new time-editing UI from scratch. Confirm the edit sheet actually exposes a time field before assuming it's a pure wiring job | 🔲 queued |
| **N7 — Rest-timer Live Activity renders as a blank Lock Screen pill** *(founder device report 2026-08-07, deliberately not touched — a build is in App Store/Play review)* | `widgets/RestTimerActivity.ios.tsx` | First real on-device confirmation that the Live Activity displays at all without crashing (the earlier 2026-08-02 fix was for a cold-launch crash on a from-scratch build, not this) — but the Lock Screen banner shows as an empty dark capsule with no ring, "RESTING" label, exercise name, or countdown digits visible, screenshot-confirmed. The layout code (`restTimerLayout`'s `banner` case) reads correctly on inspection — ring/label/name/digits all present in the JSX — so this isn't an obvious logic bug in this repo; `expo-widgets` compiles this JS-like layout into native SwiftUI at build time in an isolated pass (see the file's own header comment), and a blank render points at that compiler/runtime not fully supporting something here rather than the call site. **Needs real Xcode/Console device debugging to diagnose** — not diagnosable by reading source alone. **Risk assessment (why this is queued, not fixed now):** low App Review rejection risk — Live Activities are a secondary feature not advertised in the App Store listing/screenshots, the app doesn't crash, and Apple's review focuses on core flows and guideline violations rather than a background widget a reviewer would have to specifically trigger (start a workout → begin rest → lock the phone). Judgment call, not a guarantee — revisit if a review actually comes back citing it | 🔲 queued — needs on-device Xcode debugging |
| **N8 — App is slow to open, especially around login; a force-quit + reopen is reliably fast** *(founder device report 2026-08-07, deliberately not touched — a build is in App Store/Play review)* | `stores/auth.ts:24-62` (primary), `(tabs)/index.tsx:688-761`'s app-open sweep (secondary), `_layout.tsx:124-163`'s entitlement effect + `stores/tutorial.ts:83`/`lib/tutorial.ts:144` (minor) | **Same bug class as the four already-fixed 2026-07-21→08-03 "blank screen on first launch" root causes** (unbounded/under-guarded async work gating a cold-start-critical screen) — this report is a slow-not-blank variant, not a new class. **Primary:** `auth.ts`'s `initialize()` awaits `getSession()` THEN `fetchProfile()` serially before flipping `loading` false; the existing 5s timeout (added 2026-08-03 for the blank-screen fix) covers both calls combined, not each one, so a slow network moment can burn most/all of it while `(tabs)/_layout.tsx` renders a bare `View` — reads as "slow," not blank, and resolves once the timeout or the real result lands. A fresh process from force-quitting doesn't inherit whatever contended for the connection/first-open storage the first time, so it's reliably fast — matches the reported symptom exactly, including "especially... logging in" (the same `fetchProfile` call also gates the post-sign-in `SIGNED_IN` branch, line 75). **Secondary:** Home's app-open sweep (missed-workout check, `refreshAdaptation`, auto-split, calendar sync, reminders, ~12 calls) runs fully serially right after login even though most steps are independent — doesn't block first paint but is a large share of the visible "still settling" feeling right after sign-in; a real parallelization candidate. **Minor, lower priority:** the RevenueCat entitlement effect and a tutorial-data SQLite read lack the same timeout guard as everything else, for consistency's sake rather than urgency. Verified directly against `auth.ts` before writing this row, not assumed | 🔲 queued — needs a timeout split (per-call, not combined) in `auth.ts` + parallelizing Home's sweep |
| **N9 — "Start blank workout" from GO / the "+"** *(founder-requested 2026-08-14)* | GO chooser (`components/TempoTabBar.tsx`'s `GoChooserSheet`), `components/AddWorkoutSheet.tsx`, the runner (`(tabs)/plan.tsx`, post-C5 split) | A third entry point alongside "today's session" and "Quick Workout": start a **completely empty** session and add exercises as you go, gym-notebook style, with **nothing persisted as a template** by default — then an explicit **"Save this workout"** afterwards if the user wants to keep it. The distinction to get right is scope: exercises added mid-session are session-only (they land in `scheduled_workouts.exercise_ids` / the `workout_logs` for THAT session), and saving afterwards is what promotes it to a reusable `workout_templates` row. Precedent already in the codebase to reuse rather than reinvent: `persistQuickWorkout` (`lib/quickWorkout.ts`) already creates a one-off `scheduled_workouts` row with `source='quick'` and hands off to the runner via `/(tabs)/plan?workoutId=…&quick=1` — a blank start is the same mechanism with an empty `exercise_ids` array, so most of the plumbing exists. Check the runner tolerates an empty exercise list on entry (it has never been opened with zero exercises — likely an unhandled empty state) | 🔲 |
| **N10 — Make exercise-action SCOPE unambiguous in Quick Workout + Travel Mode** *(founder-requested 2026-08-14)* | `(tabs)/plan.tsx`'s add/swap/remove `OptionSheet`s (~lines 3064, 3174, 3222), Quick Workout + Travel Mode sessions | The two-option scope sheet already exists and reads well **for split-sourced workouts**: "Just for today's {focus}, or every {focus} on your split from now on?" with an explicit *"Add to/Swap on/Remove from every {focus} on your split"* option. The gap is that this framing is written around a *split*, so for a Quick Workout or a travel-adapted session the wording is either absent or misleading (there is no split to add to). Founder wants each action to state plainly what it will and won't affect — e.g. "skip for today", "remove permanently", "permanently add to this workout". **Do this as copy + option-set driven by `workout.source`** (`plan`/`split`/`quick`/`custom`) plus travel state, NOT as new persistence machinery — the underlying per-session vs per-template writes already exist. Worth auditing all three sheets together so add/swap/remove use one consistent vocabulary | 🔲 |
| **N11 — Travel Mode: edit the travel version of a workout so it persists, without touching the real one** *(founder-requested 2026-08-14)* | `lib/travelSchedule.ts`, `(tabs)/plan.tsx`'s swap/add/remove handlers | Today travel adaptation is strictly one-way and **derived**: `syncTravelSchedule` stashes the original in `scheduled_workouts.travel_restore` and rewrites `exercise_ids` from it on each run. **Consequence worth knowing before designing this (traced in code 2026-08-14, not assumed): a user edit made while travelling is silently reverted on the next app open** — the sync always re-derives `newIds` from `travel_restore` (the ORIGINAL), so an edited `exercise_ids` no longer matches and gets overwritten. Pre-existing, not introduced by the 08-14 no-op optimisation (the old code overwrote unconditionally too). Founder wants travel-mode edits to **stick for the duration of travel** while leaving the underlying non-travel workout untouched, so ending travel mode still restores the true original. Design implication: the travel version needs to become **stored state rather than a pure derivation** — e.g. a `travel_override` alongside `travel_restore` that the sync respects instead of clobbering — so "the original", "the auto-adapted version", and "my edited travel version" are three distinct things. Needs a real design pass (and a migration) before code | 🔲 |

---

## Founder-only open items *(consolidated checklist — nothing here is Sonnet-buildable)*

1. **T1.2 — on-device verification pass.** The master blocker (see Current Focus). Needs a physical
   device or AVD; covers essentially everything shipped since the last confirmed on-device pass
   (2026-07-17: Home, Settings split, editable sets only).
2. **Tempo Coach deployment.** `cd mobile && npx supabase functions deploy tempo-coach` +
   `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`. Without both, Coach is 503 in production.
3. **B0.3 — activation definition sign-off.** Read `ACTIVATION_DEFINITION.md`, decide the one open
   question (should activation gain a time window), sign off.
4. **B1.5 — reconnect Google Calendar once, on a real device.** The app-side gap (no self-serve
   reconnect path) is fixed 2026-08-04 — Calendar Setup → Choose Calendars now offers a "Reconnect
   Google Calendar" button right on the scope error instead of a dead end. What's left is genuinely
   founder-only: tap it, and if Google shows an "unverified app" screen instead of the normal
   consent flow, finish scope verification in Google Cloud Console.
5. ~~**RevenueCat entitlement ID verification (F9a).**~~ **CLOSED 2026-08-19 — disproven by evidence,
   no founder action needed.** The worry was that `EXPO_PUBLIC_PRO_ENTITLEMENT="Tempo: Fitness Planner
   Pro"` is a display name rather than the dashboard identifier, silently resolving every paying user
   to not-Pro. It can't be: `purchase_completed` is tracked **only** when `res.isPro` is true, i.e.
   only when `entitlements.active["Tempo: Fitness Planner Pro"]` resolved — and that event fired
   2026-08-18T22:22:10Z. The configured string IS the real identifier. The Sentry alarm stays in place.
6. **RapidAPI key rotation.** `EXPO_PUBLIC_RAPIDAPI_KEY` is still in `eas.json` (confirmed still
   load-bearing — 641/1,285 exercises remain uncached, F9b investigated and deliberately did NOT
   remove it) but the key has been in git history and should be rotated regardless.
7. **Sentry source-map upload: only the auth token is left.** `SENTRY_DISABLE_AUTO_UPLOAD: "true"`
   was set in BOTH the `preview` and `production` EAS profiles (contradicting the pre-publish
   checklist that assumed source maps were being uploaded) — found in the 2026-08-02 Mac audit,
   removed the same session, and `SENTRY_ORG`/`SENTRY_PROJECT` (`tempo-0u`/`react-native`) added
   to both profiles in `eas.json`. The one piece that has to be a real EAS secret, not a plaintext
   `eas.json` value (unlike the other keys already committed there): `SENTRY_AUTH_TOKEN`, generated
   from the Sentry dashboard (org settings → Auth Tokens, needs `project:releases` scope) and set via
   `cd mobile && npx eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>`.
   Without it, crashes still report but stack traces stay unsymbolicated.
8. **Monthly recurring: exercise GIF/instructions backfill.** 641 GIFs + 1,285 instruction sets still
   remain after the first run (688 GIFs cached 2026-07-17, 0 instructions — the GIF loop consumed the
   whole monthly RapidAPI quota first). Re-run next billing cycle and each month after:
   `$env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/backfill-exercise-media.mjs` from `mobile/`
   (service_role key from Supabase dashboard → Project Settings → API — never commit it).
9. ~~**App Store listing submission.**~~ **Done 2026-08-06** — see Session Log. This was the actual
   first production App Store submission (not just a TestFlight round): category, content rights,
   regulated-medical-device declaration, age rating questionnaire, full App Privacy data-collection
   answers, price tier, and both Pro subscriptions were all still unset going in. All filled and the
   app version + both subscriptions + the subscription group were submitted together (Apple requires
   the first subscription group to ship with a new app version). Screenshots are the founder's own
   real device captures (resized to spec, not fabricated). Now in Apple review (up to 48h).
10. ~~**Paid Apps Agreement** (App Store Connect).~~ **Confirmed Active 2026-08-08** — founder checked
    directly in the dashboard. Not the cause of the 3.1.2 rejection (see Session Log).
11. **B6.2 — one acquisition channel running weekly.** `PRODUCT_AUDIT.html` Part II has the full
    proposed route (short-form video, 8-week start plan, ASO fields) — founder-only execution.
12. ~~**Native rebuild batch.**~~ **Closed 2026-08-30 on both platforms.** Apple Health export was
    deleted outright for App Review 2.5.1 (2026-08-24), so only Focus Mode's Settings toggle remained
    pending a rebuild — it is now live in iOS build 35 and Android versionCode 12. No native work is
    sitting inert behind a build any more.

---

## Session Log *(newest first, one entry per session — full detail always in `git log` + `ARCHITECTURE.md`)*

- **2026-09-09** — Health check: scheduling enforcement holding (0/307 unmakeable), iOS adoption
  25→3 on pre-fix JS, no Quick Workout regressions. Found Arclo's PostHog project is shared with
  an unrelated app, polluting project-wide dashboards. Instrumented the day-0 activation CTA so
  the biggest funnel drop stops being argued from inference.

- **2026-09-05** — Production bug hunt. Found and repaired 162 unmakeable scheduled sessions
  (44% of all future sessions), using the real scheduling logic rather than a SQL rewrite.
  Ruled out four other suspected bugs with evidence. Verified no collisions introduced.

- **2026-09-04 (later)** — Fixed Quick Workout target areas (Legs was returning ab holds via a
  `hip_flexors` mis-grouping plus any-primary-muscle matching), split skip from delete by workout
  source, and made both selection engines build from exercises the user has actually trained.
  Rebuilt and submitted 1.0.2 to both stores.

- **2026-09-04** — Traced "the app is buggy" to a delivery failure, not a code failure: three
  days of published fixes had reached zero users because the app never called `expo-updates`.
  Added an active update watcher and put the running bundle id on every analytics event so this
  cannot hide again. Recorded the first real activation funnel (46 signups, 1 completed workout)
  and moved Retention 4→3 on it. Bumped to 1.0.2 and started store builds.

- **2026-09-03** — Traced the "Push day with pull exercises" report to affinity fallback rather
  than the template or the classifier (both verified correct first, then the live DB queried for
  the real cases). Gave every slot a side and barred fallback from crossing it. Separately, cut
  retention pushes to one per user per day inside 08:00–21:00 local, stopped `missed_workout`
  firing before the session's own start time and `free_time_gap` firing on planned rest days, and
  rewrote every push body to state a verifiable fact. Edge function v11; OTA to runtimes 1.0.0
  and 1.0.1.

- **2026-08-31** — Bumped to 1.0.1, built iOS build 36, uploaded it, created the 1.0.1 App Store
  version, replaced its screenshots with the new frames and got it into review. No app changes in the
  binary; the release exists because Apple locks screenshots on a live version.

- **2026-08-30 (d)** — Rebuilt the store screenshots as marketing frames around real captures
  (`brand-assets/make-store-frames.py`, researched against six competitor listings, rendered as one
  strip and sliced so the devices cross the seams). Live on Play; App Store refuses screenshot edits
  on a `READY_FOR_SALE` version, so the set waits for the next iOS build.

- **2026-08-30 (c)** — Filled the site's seven blank phone frames with the live store listing's own
  screenshots (`web/img/shots/*.webp`, 224KB total). Three slots re-cast against screens the store set
  doesn't contain, rather than inventing them.

- **2026-08-30 (b)** — Swapped the marketing site: `web/launch.html` → `web/index.html`, waitlist page
  deleted, real App Store + Play URLs filled into the `STORE` constant and verified live in a browser.
  Seven blank screenshot placeholders remain open; two duplicate Pages workflows flagged, not fixed.

- **2026-08-30** — App Store approved (1.0 `READY_FOR_SALE`, both subscriptions `APPROVED`). Found
  Play production still on versionCode 11 from Aug 6, 53 commits stale; built and shipped **build 12**
  to Play production at 100% with release notes. Fixed `eas.json`'s Android submit track (`alpha` →
  `production`). Audited the live Play listing and replaced the two screenshots still carrying the
  `UPPER_CHEST` enum and the old "Tempo" wording — the same defects fixed for Apple on Aug 24 and
  never mirrored. 453/453 tests, tsc clean.

- **2026-08-24** — App Review 2.5.1 (HealthKit not clearly identified in the UI) on build 29. Removed
  HealthKit entirely on the founder's call — plugin, dependency, module, Settings row, call site.
  2.1(b) did not recur, so the IAP thread is closed. OTA `91eb15b8`, build 30 submitted.

- **2026-08-19 (b)** — Found the real cause of the dead paywall: `eas update` does not read
  `eas.json`'s build-profile env, so every OTA shipped without RevenueCat/PostHog/Sentry/RapidAPI keys.
  Added `mobile/scripts/publish-update.sh` (inlines the profile env, refuses to publish without the
  load-bearing keys), republished, and moved the paywall retry onto the always-visible sticky CTA.

- **2026-08-19** — Monetization hardening. Paywall plan loading gained retry, dashboard fallbacks
  (`lib/proPlans.ts`), a Try-again affordance, foreground re-fetch, and a `paywall_plans_unavailable`
  event naming which of five causes fired; restore and post-purchase failure messaging corrected.
  F9a (entitlement-id mismatch) closed by evidence. 438/438, OTA group `6c5b08ef`.

- **2026-08-12 (same session, continued again) — Founder asked to keep going on speed: added the 11
  missing foreign-key indexes the same advisor sweep had already surfaced** (`add_missing_fk_indexes.sql`,
  applied live) — standout was `user_plans.user_id`, which had NO index at all despite being filtered
  directly by Home's `block_phase` query on every cold start. Verified via a fresh advisor re-run: all
  11 `unindexed_foreign_keys` warnings gone (now show as `unused_index`, expected pre-launch with real
  traffic still ramping up). Deliberately left the 10 `multiple_permissive_policies` warnings alone —
  fixing those cleanly means splitting `groups`/`workout_templates`'s `ALL`-scoped owner policies into
  separate INSERT/UPDATE/DELETE policies (Postgres RLS has no "every command except SELECT" shorthand),
  more schema-editing surface for a genuinely minor win, not worth it this pass. Also explicitly did
  NOT touch the two remaining client-side speed levers named earlier this session — `(tabs)/_layout.tsx`'s
  `lazy: false` (all 4 tabs fetch on cold start) and the font-load gate — both real, but `lazy: false`
  is the DELIBERATE fix for this exact codebase's own repeatedly-proven "blank until you revisit" bug
  class (7+ confirmed instances tracked in this file across three weeks); touching it without a device
  to verify against risks reintroducing the exact bug it was built to prevent. Flagged for the founder
  to explicitly choose, not blindly attempted.
- **2026-08-12 (same session, continued) — Fixed a real, live database performance issue found via a
  Supabase advisor sweep (not a founder report, a proactive check once MCP access came back):** 41 of
  ~46 RLS policies across ~20 tables called `auth.uid()` directly in USING/WITH CHECK, which Postgres
  re-evaluates PER ROW instead of once per query — a real, compounding tax on exactly the
  high-row-count tables (`scheduled_workouts`, `set_logs`, `workout_logs`, `user_plans`) this session's
  earlier app-open-sweep work already identified as hot. Fixed via `ALTER POLICY` (not drop/recreate —
  only touches the clause given, so a policy with no `WITH CHECK` before still has none now) wrapping
  every `auth.uid()` call as `(select auth.uid())`, including occurrences nested inside `EXISTS`
  subqueries and function arguments (`are_friends()`, `is_group_member()`). Same access-control result,
  cheaper query plan — verified by re-running `get_advisors`: all 41 `auth_rls_initplan` warnings gone,
  zero new warnings introduced. Migration: `optimize_rls_auth_uid_initplan.sql`, applied live. Founder
  approved before running ("can you fix those") after being shown the finding and the (separate,
  dashboard-only) leaked-password-protection toggle, which I flagged but can't fix myself — no Supabase
  MCP tool reaches Auth config, only database objects. **Not fixed, left for a deliberate follow-up
  ask**: 10 `multiple_permissive_policies` warnings (`groups` and `workout_templates` each have two
  overlapping SELECT policies — real but smaller, and new information surfaced only by this session's
  verification pass, not something already approved) and 11 `unindexed_foreign_keys` (INFO-level,
  already tracked under Engineering Architecture's "schema.sql defines zero indexes" finding).
- **2026-08-12 — Five founder-reported bugs fixed and, for the first time this trip, actually shipped
  live via `eas update` (not just pushed to GitHub): slow app open, Quick Workout always recommending
  Core, jumpy duration slider, slow-loading GIFs, and a cold-start "asks to sign in then bounces back
  to Home" bug.** First batch (1) parallelized two safe, verified-disjoint tail pairs in Home's
  app-open sweep (travel sync + calendar-conflict resolution; calendar auto-add + reminder
  reconciliation) — left the documented dedupe→missed→adaptation→extend chain untouched (real
  read-after-write dependencies, history of a plan-cliff bug when raced). Also diagnosed but didn't
  touch: `(tabs)/_layout.tsx`'s `lazy: false` (all 4 tabs fetch on entry) and the font-load gate in
  `_layout.tsx` — both real contributors, both need a founder tradeoff call, not a blind fix. (2) Root
  cause of "always Core": `quickWorkout.ts`'s curated `is_core` pool (~60 exercises) has zero
  no-apparatus "pull" exercise, so a no-equipment Back/Arms request emptied out and silently fell back
  to the unfiltered (Core-skewed) pool. Now widens to the full ~1300-exercise library — same muscle
  filter — whenever the curated pool can't fill the requested length; never drops the Target Area
  filter just because the small staple set is thin. (3) `Slider.tsx`'s thumb rendered off the
  step-snapped `value` prop, so it hopped in 5-minute jumps instead of gliding; now tracks raw drag
  position locally for rendering only, committed value still snaps exactly as before. Shipped as
  OTA update group `93fc9eaa` on `production`, confirmed landed via `eas update:list`. **Second batch,
  same session, founder reported more while testing:** (4) `ExerciseThumb`/`ExerciseFormSheet`'s GIF
  `<Image>`s never set an expo-image `cachePolicy`, unlike `ExerciseMedia` — every re-visit to the
  library/picker/builder/form-guide re-fetched the same GIFs from Supabase Storage instead of reading
  the disk cache; now all three set `cachePolicy="memory-disk"`. Named explicitly what this does NOT
  fix: the GIFs themselves are un-resized ExerciseDB originals with no compression, and re-encoding the
  ~700 already-uploaded files is a real follow-up needing the backfill pipeline + image tooling,
  deliberately not attempted blind. (5) `stores/auth.ts`'s cold-start safety net used a flat 5s timeout
  before forcing `loading:false` — on a slow network, `getSession()`'s token-refresh round trip took
  longer than that, so the timeout fired first with `session` still null (→ redirected to `/sign-in`),
  then the real result landed and bounced back to Home. Fixed with `tempo.hadSession`, a new
  localStorage flag (same mechanism as the existing profile cache, not a new one) set whenever a real
  session resolves and cleared on sign-out: a device with no prior session keeps the original fast 5s
  timeout (nothing to wait for, no regression against the original blank-screen-forever fix this net
  exists for); a device that HAS signed in before gets 20s instead, long enough to avoid the
  flash-then-bounce cycle rather than just delaying it. `tsc` clean, 412/412 tests throughout (2 new:
  `quickWorkoutPoolWidening.test.ts`). Both batches shipped OTA to `production` (runtime `1.0.0`) —
  first real update delivery of this trip, using an `EXPO_TOKEN` the founder supplied in-chat after
  this environment's network policy (Trusted by default) had to be widened to Full to even reach
  `api.expo.dev`. Still code-verified + confirmed-landed-on-the-channel only, not yet confirmed felt
  right by the founder on their actual phone.
- **2026-08-10 — Fixed the Progress "Body Intelligence" preview showing different data + a sloppy
  locked state, pushed everything from the last two sessions as an OTA update, then investigated
  (unresolved) a "logs out after a while" report.** Two founder-reported bugs on the Progress muscle
  map: (1) the small preview card never passed `statusBySlug` to `<MuscleMap>`, so it silently fell
  back to coarse per-group shading while `/muscle-map` itself shades each muscle individually —
  fixed by computing `statusBySlug` the same way the full screen does, off data already fetched;
  (2) the locked (free-tier) preview relied only on `MuscleMap`'s internal blur — a hard-edged
  rectangle over the figure — replaced with a compact rounded lock badge (same fix `/muscle-map`'s
  own full-card lock treatment already made once for the big screen), deliberately without a colour
  legend. Also removed Home's "Week N · Deload" periodization label per founder request (the
  underlying auto-adjustment is untouched, just the label). **Then pushed all of this session's +
  the prior session's fixes (Android sign-in hang, the plan.tsx/muscle-history/plan-explainer
  stuck-loading fixes) live via `eas update`** — founder was about to lose internet for vacation, so
  confirmed no native changes were needed (all JS-only) rather than a new binary. Hit a real
  environment issue: `eas update`'s bundler OOM'd on this machine even at platform=android alone
  (V8 heap crashes at ~70-190MB, unrelated to code) — worked around it with `expo export
  --max-workers 1` run manually per-platform, then `eas update --skip-bundler --input-dir` to
  publish the pre-built output. Both platforms published (Android group `eae5eb0b`, iOS group
  `317f70c7`, branch `production`, runtime `1.0.0`). Investigated a new report ("stays
  signed in on a quick reopen, but logs out after the app's been closed a while") — unresolved, see
  Current Focus. Deliberately did not ship a blind fix given the founder had no way to verify or
  roll back while about to go offline. **Then, asked "anything else wrong right now," swept Sentry
  (7d): confirmed both OTA updates actually landed (`eas update:list` shows both groups on
  `production`, 13 hours old); found one new real bug (`registerPushToken` RLS-blocked when a
  device's token row is already owned by a different user — see Current Focus, non-urgent, silently
  caught); one Sentry-noise item (an intentional diagnostic log for "calendar returned only all-day
  events" tagged at Error level when it's really informational — 47 events/2 users over 3 days, not
  a functional bug, not touched); confirmed the two known Android push-credential/calendar-403 issues
  already tracked elsewhere are unchanged, nothing new there.**

- **2026-08-09 (later) — Second iOS rejection: missing Terms of Use (EULA) link in App Description
  metadata; also correcting the prior entry's "back in Apple review" claim.** Founder confirmed the
  two renamed subscriptions actually show "Ready to Submit" in ASC, not an active review state —
  renaming a subscription's Display Name does not itself trigger resubmission for review, contrary to
  what the 2026-08-08 entry below assumed. Separately, Apple's automated review flagged a different,
  real guideline issue on the app version itself: no functional Terms of Use link in the App
  Description metadata. Arclo uses its own custom Terms of Service (not Apple's standard EULA), so
  per Apple's own bifurcated instructions this needs two founder actions in ASC: (1) add a Terms of
  Use link to the App Description text, and (2) set the actual custom License Agreement/EULA field
  (defaults to Apple's standard one until a custom one is entered) — I have no ASC access (logged-out
  browser session, and entering Apple ID credentials is out of scope regardless), so this is
  founder-only. Once done, everything (app version + both subscriptions) needs one real resubmit
  together — Apple requires the first subscription submission to ship bundled with an app version.

- **2026-08-09 — Fixed Android Google sign-in hang, then swept the whole app for the same bug class.**
  Founder reported: tap "Sign in with Google" on Android, complete the OAuth flow, screen does
  nothing — force-quit and reopen and it's logged in. Root cause: `stores/auth.ts`'s
  `onAuthStateChange` listener awaited `fetchProfile()` before ever setting `session` in the store,
  with no timeout guard (unlike `initialize()`, fixed 2026-08-03) — a slow fetch right after an OAuth
  token exchange (peak network contention) left `session` null indefinitely, so `sign-in.tsx`'s
  redirect never fired even though the spinner had already cleared independently. Bounded the same
  way as `initialize()`: a 5s timeout lets `session` apply with a best-effort cached profile, and the
  real fetch result still applies once it lands. This is the fifth confirmed instance of this exact
  pattern (an unbounded async call gating a screen, no timeout/catch) in three weeks — founder asked
  for a full sweep. Checked every store initializer, both root-layout blank-render gates, and every
  screen/sheet with a `loading`-style state (~30 files). Found two more real instances: `muscle-
  history.tsx` (a Supabase fetch with zero `.catch()`) and `plan-explainer.tsx` (a `Promise.all` with
  no enclosing `try`), both fixed. The most consequential: `(tabs)/plan.tsx`'s `loadWorkout()` — the
  workout hub, the single most-used screen in the app, ~270 lines — had no enclosing try/catch at
  all; fixed by extending its existing per-call wrapper (`runLoad`) rather than restructuring the
  function. Everything else checked already had proper `try/finally`/`.catch()` coverage, confirmed
  on inspection. Also confirmed (separately) Google OAuth consent-screen branding is correctly
  "Arclo" with a clean home page and re-submitted Google's re-verification flow — pending their async
  review. `tsc` clean, 410/410 tests throughout. Seven instances of the same bug class in three weeks
  is a convention gap, not "recurring" — flagged in Current Focus for a shared hook/lint rule next
  time, not another reactive patch.

- **2026-08-08 — Diagnosed and fixed the iOS 3.1.2 (Business: Payments – Subscriptions) rejection.**
  Apple's rejection carried no reviewer note beyond the guideline code — ruled out several
  hypotheses before finding the real one: (1) RevenueCat entitlement ID mismatch — checked the
  dashboard directly, `Tempo: Fitness Planner Pro` matches `eas.json`'s `EXPO_PUBLIC_PRO_ENTITLEMENT`
  exactly, not the cause; (2) the `$24.99`-vs-`$34.99` intro-pricing bug — confirmed via `eas
  build:list` that iOS build #27 (the one actually submitted) already includes that fix's commit
  (`0b067c9`), so it predates this rejection, not the cause; (3) a `Configuration.swift:533` Test
  Store key crash in Sentry — real, but first/last seen a month ago on Build 15, non-recurring, not
  the cause; (4) Paid Apps Agreement incomplete — founder confirmed Active directly in the dashboard,
  not the cause. **Actual root cause**: the two subscription products' App Store Connect **Display
  Names** were still "Tempo Pro Monthly" / "Tempo Pro Yearly" (confirmed via RevenueCat's product
  catalog, which mirrors ASC metadata) — stale from before the Tempo→Arclo rebrand. StoreKit's
  native purchase sheet shows this name directly and isn't overridable from app code, so a reviewer
  would see "Arclo" everywhere in-app but "Tempo Pro Monthly" in the actual purchase confirmation —
  a classic no-detail 3.1.2 trigger. Founder renamed both to "Pro Monthly" / "Pro Yearly" in ASC;
  both back in Apple review as of this entry. The subscription group's Reference Name still shows
  "Tempo Pro" and wouldn't update — confirmed that field is internal-only (never shown to customers
  or reviewers), so it's not blocking. **Still open:** once the two subscriptions clear review, the
  rejected app version itself needs a separate explicit resubmission — subscription-metadata review
  clearing does not auto-resubmit the app version.

- **2026-08-06 — iOS pricing-eligibility fix, then the actual first App Store + Play Store production
  submissions.** Founder reported the paywall showing the $24.99 founding price but charging $34.99
  at checkout. Root cause: `product.introPrice` (iOS) describes the store OFFER's terms, not whether
  *this* user still qualifies — an already-subscribed/already-trialed Apple ID still gets `introPrice`
  back, but StoreKit charges list price at purchase. Fixed with `lib/purchases.checkIntroEligibility()`
  (wraps RevenueCat's `checkTrialOrIntroductoryPriceEligibility`, iOS-only) gating `paywall.tsx`'s
  intro-price display; Android untouched (Play Billing already filters ineligible offers before the
  SDK sees them). tsc clean, 410/410 tests. Built iOS #27 + Android build 11 from the fix, submitted
  Android to Play's alpha track — then, going to finish the iOS submission, found App Store Connect's
  v1.0 record was essentially blank: no screenshots, no description/keywords/support URL, no category,
  no content rights, no age rating, no App Privacy answers, no price tier, sign-in-required checked
  with no demo credentials. This was never actually submitted for real production review before.
  Filled it from scratch: Description/Keywords/Promotional Text adapted from `LAUNCH.md` §3 to Arclo
  branding; 6 of the founder's own real device screenshots (not fabricated) resized via `ffmpeg`
  center-crop (1179×2556 → 1284×2778, ~5px trim, no distortion) to satisfy Apple's fixed screenshot
  dimensions; Health & Fitness/Sports category; third-party-content rights (RapidAPI exercise media);
  "No" on regulated medical device; a 7-step age-rating questionnaire answered honestly per the app's
  real feature set (9+, driven by the Contests/leaderboard row); the full App Privacy data-collection
  questionnaire (9 data types, all linked-to-identity, none tracking, Product Interaction/Crash/
  Performance tied to PostHog/Sentry); Support URL (`fittempo.app`, flagged to the founder as a
  waitlist page with no dedicated support section, not a fabricated fix); Copyright and App Review
  contact info per the founder's explicit go-ahead; a guest-mode reviewer note verified against the
  actual `sign-in.tsx` button text. Apple requires the first subscription group to submit together
  with a new app version — both Pro subscriptions (already fully configured from an earlier session)
  plus the app version were bundled into one Draft Submission and sent to Apple review together.
  Separately found Google Play's **live** store listing still said "Tempo: Fitness Scheduling" — a
  real, public rebrand miss, not a code issue — and replaced app name/short/full description with the
  same Arclo-branded copy used for iOS, submitted to Google for review. Play's Feature Graphic has
  "Tempo" baked into the image itself; flagged as needing a real redesigned asset, not touched.
  `PRODUCT_AUDIT.html` and `ARCHITECTURE.md` updated same session per protocol.
- **2026-08-04 — "Delay my whole week" (new Pro feature, founder-requested).** Founder-requested
  companion to "Reschedule my whole week" (B1.3): rather than re-optimizing each workout onto a new
  best day, pushes every remaining `scheduled` workout in the CURRENT calendar week later by a single
  fixed offset (1–6 days), same order/spacing/times, just later — for a sick day, a trip, or an
  overloaded week. Explicit ask was "only delay the week" — clarified with the founder first (fixed
  offset vs. resume-on-a-day vs. reusing the existing engine; fixed offset chosen) since it's easy to
  confuse with the existing recovery-aware reschedule engine. Pure planner `lib/delayWeek.ts`
  (`computeMaxDelayDays`/`planDelayWeek`, 11 unit tests) + DB/calendar wrapper (`delayWholeWeek`/
  `getDelayWeekInfo` in `lib/reschedule.ts`), same pure/IO split as `weekReschedule.ts`/
  `rescheduleWholeWeek`. New `lib/dates.ts` helper `weekEndStr` caps the offset so a shift can never
  land past the week's last day — the mechanism that guarantees it can't collide with the DB's
  `scheduled_workouts_one_plan_per_day` unique index or bleed into next week; the commit path
  re-reads and re-clamps live rather than trusting the picker's snapshot (a race can only shrink the
  applied offset, never overflow it). Reuses the `schedule_optimization` Pro gate (same Smart
  Scheduling pillar) rather than a new `ProFeatureId`. UI: a second icon button next to Plan's
  "Reschedule my whole week" button, dynamic `OptionSheet` offset picker. Not wired into Tempo Coach
  (out of scope this session). `tsc` clean, 408/408 tests (11 new). `ARCHITECTURE.md` and
  `PRODUCT_AUDIT.html` updated same session; not yet on-device tested.

- **2026-08-04 — Rebrand (Tempo → Fitaround) + B1.5 multi-calendar reconnect fix.** Renamed the
  product after finding a real trademark collision (SoftBank-backed tempo.fit holds registered marks
  covering fitness scheduling software) — new `mobile/src/constants/brand.ts` is now the single
  source of truth for the display name across ~60 app files and the marketing site; bundle id/EAS
  slug/deep-link scheme deliberately left unchanged (founder's call, see `ARCHITECTURE.md`'s rebrand
  note). Separately, investigated why B1.5 (multi-calendar) still didn't work despite being
  "code-complete since 2026-07-17": confirmed live in prod that 0 of 3 connected Google tokens carry
  the `calendar.calendarlist.readonly` scope added 2026-07-18 — a token's granted scopes are fixed at
  consent time, so every already-connected user's `fetchCalendarList()` call 403s until they
  reconnect, and the picker had no way to prompt that. Fixed: `calendar-picker.tsx` now detects the
  scope-insufficient error specifically and offers a one-tap "Reconnect Google Calendar" button that
  calls the existing `connectGoogleCalendar()` (forces `prompt=consent`) and retries automatically on
  success. `tsc` + full jest suite (385 tests) clean after both changes.

- **2026-08-05 — Tempo Pro flipped LIVE (`app_config.pro_enabled: true`).** Founder asked "is Pro set
  up for launch" — checked `LAUNCH.md`'s §5 audit (last verified 2026-07-22: RevenueCat iOS+Android,
  App Store Connect subscriptions/pricing, Paid Apps Agreement all confirmed complete) against the
  live DB directly rather than trusting the doc. Found no code work needed — the only thing between
  "built" and "real" was the dormant flag itself. Confirmed with the founder before flipping (real
  billing, and Android's already Play-approved so live users could purchase immediately) — flipped via
  direct SQL update, no rebuild required. `tester_tools` stays `false` so the public never sees the
  in-app Pro debug switch.

- **2026-08-05 (later) — App Store listing name → "Arclo: Fitness Planner".** The bare word "Arclo"
  turned out to already be an existing (low-traction, unrelated-category) App Store app, so
  submission was rejected. Rather than pick yet another word, kept "Arclo" — founder's preference —
  and added a descriptive suffix to the **App Store/home-screen display name only**
  (`app.json`'s `name`). Verified "Arclo: Fitness Planner" has zero App Store hits. In-app branding
  (`brand.ts`'s `BRAND_NAME`, wordmark, calendar-event prefix, permission strings) deliberately
  stays the bare "Arclo" — only the formal store listing needed the suffix. No rebuild required yet
  since it's just changed in source; takes effect on the next native build.

- **2026-08-05 — Rebrand (Fitaround → Arclo), name still provisional.** Extensive naming research
  found every evocative real-word fitness name already in use by some live app or trademark; Arclo
  was the cleanest option that survived. Founder wants to start the App Store review process under
  this name without fully committing to it, so the same single-source-of-truth pattern was reused:
  `brand.ts` constants + `app.json`'s display name and permission strings updated, bundle id/package
  /scheme/associatedDomains left untouched (would orphan the already-approved Play listing and the
  existing TestFlight app record). `LEGACY_CALENDAR_EVENT_PREFIXES` now also carries `'Fitaround'`.
  `tsc` clean, full jest suite passing. Next: founder submits a fresh iOS build under "Arclo" and
  updates the Play Store listing name separately.
- **2026-08-02 (session 2) — Quick Workout curation + runner bug pass, founder-reported.** Separate
  from the Mac-audit fix pass earlier the same day (below). **Quick Workout engine (`quickWorkout.ts`,
  `quick-workout.tsx`):** Target Area chips are now genuinely multi-select (was single-select only,
  despite the underlying `targetMuscles: string[]` field already supporting a union) — new
  `computeTargetFromKeys` derives the hard muscle filter + a human-readable label from the active
  chip `Set`. Fixed the real reported bug: picking "Legs" for a strength-purpose session recommended
  Jump Rope purely because it lists `calves` as a primary muscle — `forcePatterns` used to force
  EVERY pattern present in the muscle pool including cardio/mobility regardless of the active
  purpose; now only forces cardio/mobility when the purpose's own scheme wants them. Also fixed live
  in the `exercises` table: Jump Rope's `shoulders` was miscategorized as a PRIMARY muscle (moved to
  secondary). Renamed generated titles from the generic purpose-only mapping ("15-Minute Muscle
  Builder") to `{Target Area} {Purpose}` ("15-Minute Legs Strength"). 2 new tests lock the cardio-
  leak fix both directions. **Runner (`plan.tsx`):** `doSkipExercise`'s `exercise_ids` write was
  fire-and-forget, so a pause immediately after skipping could race the next resume's reload and
  silently re-materialize the "skipped" exercise — the reported symptoms (estimated time looking
  wrong, Complete Workout never turning green after a skip); now awaited. "Add to workout
  permanently" no longer offered for Quick Workouts (one-off, no recurring template to persist into).
  Tapping the bottom rest-timer pill now opens Focus Mode. **New: a session under 5 minutes doesn't
  advance the streak** (`MIN_STREAK_MINUTES`, `lib/streak.ts`) — warns before finishing rather than
  surprising the user after; `actual_duration_min` threaded through `StreakRow` and every first-party
  streak-computing query. tsc clean, 378/378 tests (6 new). Two items from the same founder message
  explicitly deferred to N1/N2 in the Open Backlog above (Pro history-horizon model, workout/split
  edit-scope clarity) — both need a product decision + plan before code, not a quick fix.
- **2026-08-02 (session 3) — N1 and N2 built.** **N1 — Pro history horizon:** free sees the last 4
  months of training history, Pro sees all of it (`lib/historyHorizon.ts`, new `full_history` gate)
  — applied to `exercise-progress.tsx` (trend chart, not the all-time best-1RM/heaviest-set tiles or
  "last session," which are current-state facts, not history browsing), `muscle-history.tsx` (a new
  4M range chip is the real free ceiling; 6M/1Y/All are lock-icon chips), and `workout-history.tsx`
  (date filter + a raised row cap for Pro). Found and fixed a real bug while building this: the
  paywall's compare table and `launch.html` both already claimed free users get "full history,"
  predating the feature — corrected. `progress.tsx`'s own dashboard charts deliberately not touched
  (mixed current-state stats + historical charts via the shared hook — needs its own careful pass).
  **N2 — workout/split edit-scope clarity:** read `materializeSplit`'s actual behavior first, which
  resolved both open design questions from the original backlog write-up (see the N2 row above for
  the full reasoning) and surfaced a real underlying bug: "permanent" edits only ever touched the
  split TEMPLATE, which `materializeSplit` never re-syncs into already-materialized rows — so a
  "permanent" add silently had zero effect on the entire ~4-week rolling horizon of already-scheduled
  days, only on materializations past it. New `propagateSplitDayEdit` (`lib/splitSchedule.ts`) fixes
  this for real and is now wired into add/swap/skip in `(tabs)/plan.tsx`, each asking "this session
  only" vs. "every `{focus}` on your split" only when split-sourced. Also fixed a separate bug found
  along the way: "session only" adds never persisted to the DB, silently lost on pause/resume.
  `edit-session.tsx` gained a scope banner + split-editor link. 7 new tests across both features.
  tsc clean, 385/385 tests.
- **2026-08-02 — first-ever on-device (Simulator) pass ran on the Mac; every Tier-1 + Tier-2 finding
  fixed on Windows the same day.** The Mac session finally ran T1.2 for real (iOS Simulator, after
  fixing a CocoaPods `LANG`/locale issue), confirmed the three 2026-07-31 fixes (PREV blanking:
  fixed; Focus Mode auto-dismiss: fixed; muscle-history "See history": still broken), and found 6
  new Tier-1 (blocking) + 13 Tier-2 (real, non-blocking) issues via 5 parallel deep-dive reviews.
  **Tier 1, all closed:** (1) `retention-push` had zero auth check despite `verify_jwt=false` —
  closed with a Supabase Vault shared secret + `get_retention_push_secret()` RPC, confirmed live
  (unauthenticated POST → 401, real cron call → 200). (2) `edit-session.tsx` nulled
  weight/duration/distance/rep-range on every save — now preserves the original config unless the
  user actually touched that field. (3) `delete-account` never swept Storage — now removes
  `progress-photos`/`avatars` objects before deleting the auth user. (4) `muscle-history`'s "See
  history" compared mismatched muscle vocabularies (fixed via the existing `bodyMuscleOf()` mapper)
  and capped its history query oldest-first instead of newest-first (fixed). (5) Sentry source-map
  upload was disabled in both EAS profiles (`SENTRY_DISABLE_AUTO_UPLOAD`) — removed, `SENTRY_ORG`/
  `SENTRY_PROJECT` added; only the auth-token EAS secret is still a founder step. (6) A Live Activity
  import crashed EVERY cold launch on a from-scratch build — `expo-widgets` calls
  `requireNativeModule` eagerly at its own top level, so a static `import` threw before the existing
  try/catch (which only wrapped the `createLiveActivity()` call) could ever run; fixed with a guarded
  `require()` inside that same try/catch. **Tier 2, all closed:** `prefStorage.ts` write crash under
  Metro dev bundling; Home's displayed time-range/duration disagreement; `progression.ts`'s deload
  cut compounding on a same-session reactive grind-cut; `prForecast.ts` anchoring projected dates to
  `now` instead of the last logged session (silently ballooning during inactivity); two silent
  write-failure sites (`rescheduleWholeWeek`, `restampFuturePlanForExperience`) now mirror
  `adaptation.ts`'s failed-id tracking; a friend-feed streak-milestone broadcast used the
  session-count metric instead of a true distinct-day count (new `distinctDayStreak()`, W6 backlog
  row updated); `findCalendarConflicts` never surfaced all-day-event conflicts for free users; no
  in-flight guard on `handleSetDone`/`beginSession` (fast-double-tap double-insert risk); push-tap
  routing had no default case (added, scoped to retention-push notifications only); `app_open`
  double-fired on a notification-tap cold launch; calendar-autosync toggle-off was fire-and-forget
  with no failure feedback; Sign in with Apple silently no-op'd on a missing `identityToken`; and the
  PREV-blanking fix's own history query excluded the resumed session's rows in JS after the `.limit`
  instead of in the query itself. Apple token revocation on deletion needs founder-provided Apple
  Developer credentials that don't exist yet — queued as N3, not half-built. **Tier 3** (6 product/UX
  items from the founder's own live testing — muscle-history interactive chart + weight-progression,
  unit-toggle animation, a recurring tutorial-reappears bug needing real investigation, Coach
  redesign, Focus Mode read-only redesign) queued as T3.1–T3.6 in the Open Backlog, several
  explicitly needing founder input before building. Also queued from the founder directly this
  session (not audit findings): **N1** (Pro history horizon — free 4mo/Pro unlimited, across every
  progress surface + paywall + marketing) and **N2** (a written, unambiguous scope model for
  add/swap/remove/reorder across "this session" vs. "this day" vs. "the whole split" — needs a
  product decision + plan doc before code, per CLAUDE.md's Working Method). tsc clean, 372/372 tests
  (5 new). **Could not push to GitHub this session** — `git push` failed with a 403 (permission
  denied for the configured git account against `LazyLlama85/tempo.git`); all commits exist locally
  on `main` only until that's resolved.
- **2026-07-31 — founder bug reports fixed + muscle-level training history added.** (1) PREV column
  blanking after pause/resume, traced to `loadWorkout`'s history query not excluding the resumed
  session's own now-open log — one-line fix. (2) Focus Mode's "HOW MUCH DID YOU DO?" card now
  collapses once acknowledged instead of sitting up the whole rest period. (3) New `muscle-history`
  screen (sets-per-week trend + per-exercise breakdown, drilling into the existing `exercise-progress`
  screen rather than duplicating it) — reached from Body Intelligence's detail cards; `exercise-progress`
  also gained a new entry point from `ExerciseFormSheet`. tsc clean, 367/367 tests. Not yet on a device —
  T1.2 below still stands.
- **2026-07-27 — `LAUNCH_SCORE_PLAN.md` T1.3: pricing realigned to $4.99/mo · $34.99/yr, live on both
  stores.** Founder did the App Store Connect edit manually (no automatable save action existed);
  Play Console's "Set prices" flow was automated end-to-end via browser automation. Yearly founding
  intro offer left at a flat $24.99 first year on both platforms. B2.3 closed; only T1.2 remains on
  the `LAUNCH_SCORE_PLAN.md` queue.
- **2026-07-24 — offline set-log retry queue shipped** (`lib/pendingSetLogs.ts`) — the last named
  Reliability gap, and the first genuinely new production feature (not verification/bounded work) this
  multi-session run shipped. Dedup-safe (keyed `workout_log_id:exercise_id:set_number`), replays once
  at cold app-open via F5's single-owner sweep. Scoped to one table, one call site. 7 new tests, 367/367
  total. `PRODUCT_AUDIT.html` Reliability held at 7 (real code, unverified on real hardware).
- **2026-07-23 (past midnight) — `autoSchedule.ts` test coverage** (9 tests on `findCalendarConflicts`'s
  overlap math) closed one of the two remaining named Reliability gaps; the offline-write-queue
  finding's severity was corrected (only the most-recent unsaved set is at risk, not the whole
  workout — `handleSetDone` already un-checks + prompts retry on failure). Reliability 6→7.
- **2026-07-23 (very late) — audit-accuracy sweep + real recomputation, Product Score 5.9→6.2.**
  Verified (not assumed) that Reliability and Scheduling Experience were still being penalized for
  already-fixed 07-19 bugs; they were. Reliability 4→6. Then genuinely recomputed all 48 rows
  (247/40 = 6.175→6.2) since 7 rows had moved that day, not the 1-2 that previously didn't justify it.
- **2026-07-23 (late night) — `LAUNCH_SCORE_PLAN.md` T3.1: accessibility batch.** Selection-chip
  `accessibilityState` on quick-workout/muscle-map, paywall footer links made real accessible buttons,
  3 icon-only touchables fixed on the 2 worst-cited screens (profile avatar, social decline/remove-
  friend). Accessibility 4→5 — deliberately small, single-digit fixes against an 808/110 ratio.
- **2026-07-23 (late night) — T3.2 found already fixed; corrected the audit instead of writing code.**
  F1/F6's 07-19 fixes (exact-match muscle regions, split+plan miss counting, real `week_offset`) had
  genuinely landed. Personalization 6→7, Fitness Science 5→6 — corrections, not new-work credit.
- **2026-07-23 (night) — `LAUNCH_SCORE_PLAN.md` T2.1: PR forecast shipped**, a second real Pro pillar.
  `lib/prForecast.computePRForecast` (least-squares fit over existing e1RM history) projects the next
  round milestone as a calendar date; new `pr_forecasting` Pro gate. 8 new tests. Subscription Value 6→7.
- **2026-07-23 (evening) — `LAUNCH_SCORE_PLAN.md` written + T1.1 shipped.** Answered "what's worth
  doing before launch" — most low audit rows are frozen until a real cohort transacts, so wrote an
  ordered plan of what's real. T1.1: `schedulingImpact` promoted to the Home hero's own subtitle line.
  Value Proposition 5→6, Scheduling Experience 5→6.
- **2026-07-23 (pm) — Tempo Coach batch C4: the action layer.** `lib/coachActions.ts` (propose/apply
  split, `ConfirmCard`, executor switch over reschedule/substitute/travel-mode), Pro gating matching
  Plan tab, staleness guards, 15 new tests. Free tier set to 3 msgs/calendar month (product lever, not
  cost); model set to `claude-sonnet-5`. Built entirely without an API key — blocked on founder deploy.
- **2026-07-23 (am) — Tempo Coach batch C3: the screen.** `app/coach.tsx` modal route, inverted thread,
  starter prompts, typed-error banner, tap-to-retry. Text-only (no Apply affordance — that's C4).
  Founder had reversed the 2026-07-22 M4-freeze park on Coach and asked to start building it.
- **2026-07-22 (pm) — founder device-testing queue: blank-first-launch root cause + 8 fixes + Apple
  Health export.** Root cause: 4 Zustand stores read SQLite-backed `localStorage` synchronously at
  module-eval time, before any error boundary existed — fixed to default safe + self-correct
  post-mount. Also: PR trend bars→line chart, pause-mode slider, notification-toggle silent-revert
  fix, 3 missing-`ScrollView` tutorial overflow fixes, Apple Health write-only export (opt-in, iOS).
- **2026-07-22 — §29 launch queue worked top to bottom: 8 commits.** Pause/vacation mode (L21),
  achievement-unlock celebrations (L24), leaderboard-at-n=1 (L26), Terms/Privacy scroll fix (L14),
  onboarding copy (L11), progress-photo compare+share (L25), public share preview bug fixes (L27),
  then — with explicit sign-off — Pro re-gated onto weekly-repetition pillars (L1/L2) and the paywall
  rebuilt (§25). Fixed a real pre-ship regression (a Jest-breaking static import) before it shipped.
  Monetization 4→6.
- **2026-07-22 — split creation made the recommended path**, not buried: Profile's "Change Plan" sheet
  now offers "Build my own split" equally; `AddWorkoutSheet` hints toward it; onboarding names templates.
- **2026-07-22 (later) — `PRODUCT_AUDIT.html` restructured into Part I (Launch Standard, §23–29,
  executable L1–L28 work items) + Part II (Money/Marketing/Future, §30–33).** Found 3 new issues: a
  live purchase-layer bug (paywall would show $34.99 while a founding-offer store charges less),
  "Pro is a tip jar" (root cause of the L1/L2 re-gate above), and 4 `AUDIT.md` `[DESIGNED]`-never-built
  items (pause mode, returning-user Home heroes, progress-photo compare, public share previews).
- **2026-07-22 (NEW) — Feed redesigned into a real notification center.** `lib/feedLog.ts` (cooldown-
  gated local log) + `app/feed.tsx` (modal merging the log with a live `notification_log` query) —
  fixes the old Feed's "same item repeats identically every day" bug.
- **2026-07-20/21 (NEW) — founder device-testing/bug queue, 12 fixes.** RevenueCat web-platform crash
  fix; 4 Focus Mode fixes (pencil-not-checkmark icon, dead-button fix, DONE-WITH-SET copy, Lottie
  aspect-ratio investigation); GO always opens the today's-session-vs-Quick-Workout chooser; a
  `save_exercise_instructions` RPC so live ExerciseDB fetches persist back permanently; two
  multi-workout-per-day visibility gaps fixed (Home + Plan); permanent exercise deletion
  (`excluded_exercise_ids`); a new Pro plate calculator; confirmed weekly-report push and
  multi-calendar OAuth scope already fully live with zero code work remaining.
- **2026-07-21 (NEW) — Quick Workout redesigned.** One `Slider` replaces 8 duration chips; body-part
  chips (Arms/Chest/Back/Shoulders/Legs/Core/Cardio) backed by a real `primary_muscles` hard-filter
  replace movement-pattern jargon; the generated-workout preview card removed entirely (confirmed with
  founder first) — Start now goes straight into the runner.
- **2026-07-21 (later, NEW) — web-testing fixes for the Quick Workout redesign.** Slider layout fix,
  a real empty-workout bug fixed (`forcePatterns` override), preset-deletion tap target added for web,
  and likely fixed the persistent "blank screen on first load" report (Sentry init guarded on web,
  same bug class already fixed for PostHog; `TempoErrorBoundary` widened to wrap the whole root).
- **2026-07-19 (later) — founder device-testing batch, mostly Focus Mode — 10 fixes + 4 flagged.**
  ScrollView/KeyboardAvoidingView fix for unreachable buttons; the auto-close-during-rest bug (root
  cause of "abrupt switching" AND missing last-set RPE); RPE added to Focus Mode; rest-ring made
  tappable; pencil-vs-checkmark edit-icon fix; a Focus Mode on/off Settings toggle; Home "Continue"
  copy for a paused session; Quick Workout's new Target Area chips; exercise-search aliases; a
  calf-specific rep-range bump. 4 items flagged, not built: drag-to-reorder, first-workout rest-time
  prompt, swap/remove-syncs-to-split, checkmark+swipe animation (see Open backlog).
- **2026-07-19 — C2 (theme sweep) done.** New `PRCard` component replaces duplicated hardcoded
  `#B8860B` gold-card blocks (didn't adapt to light theme); 15 hardcoded colors in `workout-complete.tsx`
  mapped to theme tokens; dead `Colors` imports removed from 14 files, dead header styles from 20.
- **2026-07-19 — C1 (shared date utilities) done.** New `lib/dates.ts`; 18 modules migrated off their
  own duplicate date-string helpers; found + fixed 2 real UTC-vs-local bugs along the way
  (`adaptation.weeksBetween`, `social.ts`'s streak-day computation).
- **2026-07-19 — `MASTER_FIX_PLAN.md`'s entire P0 (F1–F10) done.** Plan-cliff bug (`week_offset`
  column + reordered app-open sweep), all-day calendar events now block scheduling, 5 silent-write-
  failure sites fixed, cache-invalidation sweep, one single owner for the app-open sweep, 2 adaptation
  correctness bugs, a 7-screen UI failure-state sweep, the app's first ErrorBoundary, RevenueCat
  entitlement-ID mismatch made loudly visible, 4 backend migrations applied + `retention-push`
  redeployed. 237 tests green throughout.
- **2026-07-19 — full codebase review produced `MASTER_FIX_PLAN.md` + honest re-score.** Three
  parallel deep-dive reviews (all 45 UI routes, every domain-logic module, the full platform layer)
  found real defects independent of the M0-M6 ledger. Re-scored `PRODUCT_AUDIT.html`: split into
  Product Score (5.9/10, potential 8.2) and Market Proof Score (4.3/10, potential 7.8); 9 rows moved
  down on newly-found evidence. Diagnosis + planning only, no app code changed.
- **2026-07-18 (dated as part of the B1.5 row) — multi-calendar OAuth scope enabled** in Google Cloud
  Console (`calendar.calendarlist.readonly`); `config.ts` scope uncommented (OTA, no rebuild).
- **2026-07-17 (Phase 9) — full audit re-review + this file's first major compaction.** Google
  Calendar approved for production (B0.2→✅, B1.5 unblocked); redirected `EXECUTION.md` §1 toward
  verification + B0.3 + B1.5 + founder-only items; compacted ~30 Current-Focus paragraphs + 25 verbose
  Session Log entries down to the ledger + a tight log (the same discipline this 2026-07-30 pass repeats).
- **2026-07-17 — Google Calendar approved for production.** Removed the single most-cited reliability
  risk (Testing-mode 7-day token expiry silently vanishing events).
- **2026-07-17 — B1.5 (multi-calendar) built end-to-end, dormant** pending the OAuth scope (enabled
  next day) and a founder reconnect+test.
- **2026-07-17 — 4 real bugs found via founder feedback, fixed.** Days Per Week made independently
  editable (was silently discarding custom splits on regen); streak no longer zeroed mid-day on a
  same-day swap; Goal ETA chip no longer dead-ends on Progress; GO button re-scoped to check today's
  schedule first before falling back to Quick Workout.
- **2026-07-17 — critical fix: analytics had never actually been flowing.**
  `EXPO_PUBLIC_POSTHOG_KEY` had never been set anywhere — every `track()` call had been a silent no-op
  in every shipped build. Fixed the key wiring; built the B0.3 PostHog funnel + retention dashboard
  ahead of the fix actually shipping.
- **2026-07-17 — "First-Launch Perfection" plan executed, 8 batches.** Per-step onboarding funnel
  analytics; removed a redundant duplicate plan-reveal screen; the reveal's "already on your calendar"
  copy made honest + conditional with an optional in-line calendar connect; badges/Progress dashboard
  activation-gated; an accessibility pass; a Home adaptation-mode chip; `APP_STORE_LISTING.md` +
  `ACTIVATION_DEFINITION.md` drafted.
- **2026-07-17 — Phase 8 (Feed button) + 7 Home/Progress fixes + a second onboarding re-cut + 2 real
  bugs + the 6-screen onboarding rebuild + Phase 6 (Plan tour) + Phase 7a-d + Phase 1-5** (scheduling
  fixes, editable sets, Settings split, Quick Workout re-scoping, Focus Mode). One very long founder-
  testing day — essentially the entire original M1–M3 Claude-buildable backlog landed, plus a large
  amount of founder-driven UX work not in the original numbered plan at all.
- **2026-07-16 — Home/Plan IA redesign (two rounds) + the day-timeline hero + B1.1/B2.1/B3.1/B3.2/
  B3.3/B5.1/B5.4/B5.5 + 3 founder-reported bugs + an adaptation-legibility fix.** 11 batches shipped
  back to back, each verified and committed individually — the day the Execution OS first drove an
  autonomous multi-batch run.
- **2026-07-15 — built the Execution OS itself** (`EXECUTION.md` + this ledger + CLAUDE.md's Execution
  Protocol), then B0.1, B1.1/B3.1 (partial), B1.3a, a silent "Remove workout" bug fix, the OTA
  `runtimeVersion` fingerprint fix (an Android crash-class root cause), and Tester Tools. Also: the
  Google Calendar diagnosis that led to the B0.2 in-app diagnostic and, two days later, production approval.
- **(undated, `feature/engine-and-first-run` branch, merged to local `main`) — Programming Engine v2 +
  First-Time Experience shipped, per `PLAN.md` (now retired — STATUS: IMPLEMENTED).** Engine v2:
  `lib/exerciseProgramming.ts` classifies exercises by `{role, slot, primaryMuscle}` from
  `primary_muscles`/name keywords (replacing the too-coarse `movement_pattern` bucketing that had
  miscategorized biceps curls as "pull," cleans as "hinge/quads," etc.); a new slot-based session
  template model replaces flat pattern lists in `generatePlan.ts`, shared by `extendActivePlan` and
  `restampFuturePlanForExperience`; role-aware prescription in `progression.ts`; a "Why this workout"
  rationale sheet. First-Time Experience: `lib/tutorial.ts`/`stores/tutorial.ts` (device-local,
  survives restart/upgrade), `TutorialOverlay` spotlight component, `app/welcome.tsx`, a 5-step Home
  tour, an evolved first-workout coach overlay, a bigger first-completion celebration, `useOnceTip`
  contextual tips. **Zero database migrations** — classifier is pure over existing columns, tutorial
  state is local. 7 checkpoints, typecheck + Metro export green throughout. One item deferred (see
  Deferred/Rejected pool): contextual one-off tips + illustrated empty states.
- **(undated, per `SOCIAL_UPGRADE_PLAN.md`, now retired) — the 4-stage social upgrade shipped and is
  live**, per `ARCHITECTURE.md`. Stage 1: Tempo Score (`lib/tempoScore.ts`, 0–1000, consistency-only,
  zero strength inputs — see `ARCHITECTURE.md` for the formula) + `friends_leaderboard_v2()` +
  `current_session_streak()` SQL mirror + a 3-tab leaderboard UI. Stage 2: 12 consistency/competitive
  badges (`lib/badges.ts`, merged with and replacing the old achievements grid) + `activity_events`-
  backed richer feed. Stage 3: private groups (`groups`/`group_members`, group-scoped leaderboards).
  Stage 4 (partial): social scheduling's core (`privacy_availability`, free-window overlap,
  `workout_invites` accept→schedule-both, social smart-reschedule) shipped; **social push nudges +
  auto-reschedule are the one still-open piece** — tracked in the M4 ledger row above.
- **2026-07-19 — `MASTER_FIX_PLAN.md`'s founder-only P0 items opened**, per its §0 shortlist: F9a
  (RevenueCat entitlement ID — code-half done, dashboard-half founder-only), F9b (RapidAPI key
  rotation — investigated, deliberately not removed from `eas.json`, still load-bearing).
