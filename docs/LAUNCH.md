# 🚀 Tempo — Launch & Store-Ops Runbook (iOS + Android)

Single source of truth for shipping Tempo — the core app **and** Tempo Pro — to the App Store and
Google Play. Consolidates what used to be five documents (`LAUNCH.md`, `APP_STORE_LISTING.md`,
`STORE_SUBMISSION.md`, `PRO_LAUNCH_CHECKLIST.md`, `PRO_SETUP_GUIDE.md`) into one. The **code and
backend are launch-ready**; what's left is account/dashboard work only the founder can do (marked 👤).

---

## 1. Status overview (reconciled against PRO_SETUP_GUIDE's 2026-07-22 audited-live facts)

**Core app — built (nothing to do in code):** Apple Sign In, Google OAuth (PKCE), guest mode; real
Google + device calendar connect during onboarding; unified day/week/month schedule; autoregulated
workout runner (RPE logging, rest timer, smart swaps, form guides + exercise GIFs); Quick Workouts;
periodized mesocycle + `adaptation_mode`; stats/PRs/achievements/Wrapped; body-weight/body-fat/waist
trends; progress photos; injury/limitations editor; notifications toggle; equipment editor; travel
mode; recovery check-ins. Backend: 15+ Supabase tables with RLS, edge functions (`delete-account`,
`google-calendar-token`, `retention-push`), hourly retention-push cron. Infra: PostHog + Sentry
(both no-op without keys). Store-readiness: app icon, splash, Android adaptive icons, in-app Privacy
Policy + Terms, App Store-compliant account deletion (Guideline 5.1.1(v)), marketing site in `web/`.

| Item | Status |
|------|--------|
| App code + Supabase backend (tables, functions, cron, storage) | ✅ live |
| Public privacy-policy URL | ✅ live at `fittempo.app/privacy.html` (+ `/terms.html`) |
| Expo account / `eas init` | ✅ done — existing TestFlight builds prove this |
| Apple Developer Program | ✅ done — app exists in App Store Connect / TestFlight |
| Google Play Console | ✅ done — app is live in Play **Closed testing** (`com.fittempo.app`) |
| iOS export-compliance flag + photo-library permission string | ✅ in `app.json` |
| `eas submit` profile scaffold | ⚠️ **Android only** — `eas.json`'s `submit.production` has no `ios` block (`appleId`/`ascAppId`/`appleTeamId`). `eas submit --platform ios` will prompt for these interactively if run as-is; fill them in first for a non-interactive run |
| **Tempo Pro — RevenueCat + App Store Connect (iOS)** | ✅ **complete** — see §5 |
| **Tempo Pro — App Store Connect subscriptions + Paid Apps Agreement** | ✅ **complete** — see §5 |
| **Tempo Pro — `app_config.pro_enabled`** | ✅ **LIVE for everyone, flipped 2026-08-05** — real billing is active on any build already installed (Android especially, since Play is approved) |
| **APNs key (iOS push) / FCM v1 service-account JSON (Android push)** | 👤 **unconfirmed** — verify via `eas credentials` |
| **Google OAuth verification** (sensitive `calendar.events` scope) | ✅ **done** (confirmed by founder 2026-08-05) |
| **iOS App Store v1.0 listing** (screenshots, description) | 👤 **open** — needed for public App Store submission; the Arclo-rebrand build in progress is the one that will carry the Pro subscriptions through Apple's review, per §5 STATUS |
| **Tempo Pro — Android (RevenueCat Play service-account credential)** | ✅ **complete** — see §5 (one cosmetic dashboard badge, not believed to be a real blocker — worth a final glance) |
| `founding_offer` config row (paywall countdown banner) | 👤 optional — not yet set, needs an `ends_at` date |
| Telemetry keys (`EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_SENTRY_DSN`) | ✅ **already set** in both `preview` and `production` env blocks (this row was previously mislabeled as open — verified 2026-08-05) |
| Store metadata (category, age rating, data-collection forms) | 👤 — copy in §3, compliance answers in §4 |

**Note on the two "Android service account" credentials** — don't conflate them: the FCM v1
service-account JSON (push notifications, row above) and the RevenueCat Play service-account
credential (§5 Part D2.1, purchase validation) are two separate Google Cloud service accounts with
separate setup flows. Neither doc source distinguished this clearly.

---

## 2. iOS + Android launch runbook

### Pre-flight
1. `cd mobile && npx tsc --noEmit` → clean.
2. `npm i -g eas-cli && eas login && eas init` (already done — confirm you're on the right account).
3. (Optional) add `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_SENTRY_DSN` to `eas.json` →
   `build.production.env`. For symbolicated crash stacks also set `SENTRY_ORG` / `SENTRY_PROJECT` /
   `SENTRY_AUTH_TOKEN` as EAS secrets **and remove `SENTRY_DISABLE_AUTO_UPLOAD` from the
   `preview`/`production` env** — that flag is currently set so release builds skip the Sentry
   source-map upload (which otherwise fails the Gradle build when the token is absent).
4. All Supabase migrations are already applied — nothing to run.

### iOS
1. `eas build --profile production --platform ios` (EAS provisions signing).
   For push: `eas credentials` → **iOS → Push Notifications → upload an APNs key** (verify this is
   actually done — status unconfirmed, see §1).
2. App Store Connect: fill v1.0 metadata, screenshots (6.7" + 5.5"), 1024px icon, privacy URL, age
   rating, and the **App Privacy** form — see §4.2 for the filled-in answers.
3. In `eas.json` fill `submit.production.ios` (`appleId`, `ascAppId`, `appleTeamId`), then
   `eas submit --profile production --platform ios`.
4. Submit for review. In review notes, tell them to use **guest mode** (no login needed).
5. **Tempo Pro on iOS is already fully wired** (RevenueCat + App Store Connect subscriptions) — see
   §5 rather than redoing any of that here.

### Android
1. `eas build --profile production --platform android` (app-bundle).
   For push: upload the **FCM v1 service-account JSON** (`eas credentials` or Play/Firebase console)
   — verify this is actually done, status unconfirmed, see §1.
2. Complete Play **Data safety**, content rating, target audience, privacy URL, store listing +
   phone screenshots — see §4.3 for the filled-in answers.
3. Save the Play service-account JSON as `mobile/play-service-account.json` (git-ignored), then
   `eas submit --profile production --platform android` → roll out to **internal testing** first
   (the app is currently in **Closed testing**), then promote to production.
4. **Tempo Pro on Android is blocked solely on the RevenueCat Play service-account credential** —
   see §5 Part D2.1. That's a separate credential from the FCM push one in step 1.

### Post-launch
- Watch **Sentry** (crashes) and the **PostHog** funnel (`app_open → onboarding_complete →
  session_start`).
- The `retention-push` cron runs hourly; check `notification_log` for delivery/failures.

---

## 3. Store listing copy (paste-ready, verbatim)

Written per `PRODUCT_AUDIT.html` §16/§27 L15's prescription: lead with the calendar wedge, never a
workout card (every competitor already does that). Every claim below maps to something the app
actually does today — no advertising unbuilt features. **Founder still needs to:** take the actual
screenshots (the copy below tells you what to capture and in what order), paste these fields into
App Store Connect / Play Console, and pick real device screens once multi-calendar/B1.5 is verified
live for your own account (a one-time Google reconnect — see `ARCHITECTURE.md`).

**Refreshed 2026-07-22** — added two bullets for features that shipped since the original draft
(pause mode, progress-photo compare); everything else held up and is unchanged.

### iOS — App Store Connect

**App Name** (30 char max) — 24 chars:
```
Tempo: Workout Scheduler
```

**Subtitle** (30 char max) — 29 chars:
```
Training that fits your week
```

**Promotional Text** (170 char max, editable anytime without a review — 168 chars):
```
Tempo builds your training plan and schedules it around your real calendar — then reshuffles it the moment life changes. Never guess when to train again.
```

**Keywords** (100 char max, comma-separated, no spaces, don't repeat words already in Name/Subtitle
— 98 chars):
```
gym calendar,training planner,fit workout schedule,busy fitness,plan gym time,schedule lifting,PPL
```

**Category:** Health & Fitness (primary), Sports (secondary, optional).

### Android — Google Play Console

**App name** (30 char max) — 24 chars:
```
Tempo: Workout Scheduler
```

**Short description** (80 char max — 79 chars):
```
Training that fits your real week — scheduled around your actual calendar.
```

**Category:** Health & Fitness.

### Full Description (both stores — same copy, opens with the wedge, not a feature list)

```
Training that fits your real week.

Most fitness apps hand you a workout and hope you find the time. Tempo does the opposite: it builds
your training plan, then schedules every session into your actual day — around your sleep, your work
hours, and (when you connect one) your real calendar. When life changes, Tempo moves with it.

WHAT TEMPO DOES
• Builds a real program from your goal, experience, and equipment — periodized, not a random list.
• Schedules every session at a specific day and time that actually fits your week.
• Reshuffles your whole week in one tap when a busy stretch hits.
• Adapts automatically — eases off when you're overreached, levels you up as you get stronger.
• Going away? Pause your plan and pick up right where you left off — no broken streak, nothing to catch up on.
• A clean, fast logger built for the gym: instant set logging, rest timers, form videos, offline-safe.
• Free progress tracking — volume trends, personal records, consistency streaks, and a before/after photo compare.

WHO IT'S FOR
Busy people who still want to train seriously, and don't want "when do I even fit this in" to be the
reason they stop.

Your data, your control. Full account deletion anytime. No calendar event details ever leave your
phone — Tempo only reads busy/free times.
```

### Screenshot Narrative (5 screens, in this order — the actual conversion lever per §16)

1. **The calendar with a workout slotted into a real gap.**
   Caption: *"Training that fits your real week."*
   This is the single most important screenshot in the whole listing — it's the one thing no
   competitor (Hevy, Strong, Fitbod) can show, because none of them touch a calendar.

2. **The "reschedule my whole week" moment** — before/after, a busy day shown moving a session.
   Caption: *"Life gets busy? One tap re-plans your whole week."*

3. **The live workout runner** — instant set logging, rest timer, form video visible.
   Caption: *"Log fast, rest smart — built for the gym, not the couch."*

4. **Progress proof** — the volume trend chart + a personal-record moment.
   Caption: *"Watch your strength and consistency climb."*

5. **The 15-minute escape hatch** (Quick Workout, GO button).
   Caption: *"Only have 15 minutes? Tempo still makes it count."*

Do not lead with a plain workout-card screenshot anywhere in the sequence — that's the generic
"every dark fitness app" look the audit specifically warns against.

### Why these choices (so the founder can override with reasoning, not from scratch)

- **Name subtitle over generic "Tempo"**: "Tempo" alone is a crowded ASO term (many unrelated apps
  share it). "Workout Scheduler" is low-competition and high-intent — nobody else owns that search.
- **Keywords avoid restating Name/Subtitle words** (Apple already indexes those) — every keyword
  here is a phrase a busy-but-serious lifter would actually type that competitors don't target.
- **Promo text is the one field you can change without a review** — update it seasonally (e.g. New
  Year's resolution season) without waiting on App Review.
- **Description leads with one sentence, not a bullet list**, per §16 and §22's closing line: "the
  market rewards the one that says one true thing and delivers it flawlessly."

---

## 4. Store compliance answers (paste-ready, verbatim)

This is the paste-ready detail for the parts that trip people up: Google OAuth verification, the
App Store **App Privacy** questionnaire, and the Play **Data safety** form. Values below match the
actual app (`com.fittempo.app`, domain `fittempo.app`).

> **Support email:** `fittempo.app@gmail.com` — used consistently across the app (`legal.tsx`)
> and the web pages (privacy, terms, delete-account). Use the same address on the store listings and
> the OAuth consent screen.

### 4.0. Brand assets to upload (in `brand-assets/`)

| Asset | File | Where it goes |
|-------|------|---------------|
| Google OAuth consent-screen logo (120×120, no alpha) | `brand-assets/google-oauth-logo-120.png` | Google Cloud → OAuth consent screen → App logo |
| App icon 512×512 (no alpha) | `brand-assets/app-icon-512.png` | Play Console → Store listing → App icon |
| App icon 1024×1024 | `mobile/assets/images/icon.png` | App Store Connect → App icon (EAS also embeds it) |

Still to make (need text/screenshots — do in Canva/Figma): Play **feature graphic** 1024×500, and
phone **screenshots** for both stores (6.7" + 5.5" for iOS; phone for Android).

### 4.1. Google OAuth verification (the "app isn't verified" fix)

You need this because the app requests `https://www.googleapis.com/auth/calendar.events`, which Google
classifies as a **sensitive** scope. Until verified you're capped at 100 test users, testers see the
"unverified" warning, and — importantly — **calendar refresh tokens expire after 7 days in "Testing"
mode**, so connected calendars silently stop syncing weekly. Verifying + publishing to Production fixes
all of that. **Nothing confirms this is done yet — treat as open.**

**4.1a. Verify your domain (once)**
1. Go to **[Google Search Console](https://search.google.com/search-console)** with the same Google
   account that owns your Cloud project.
2. Add property `fittempo.app` → verify via **DNS TXT record** (add the record at your domain registrar).

**4.1b. Configure the OAuth consent screen**
Google Cloud Console → your project → **APIs & Services → OAuth consent screen**
(newer projects: **Google Auth Platform → Branding / Audience / Verification**). Enter exactly:

| Field | Value |
|-------|-------|
| User type | External |
| App name | `Tempo` |
| User support email | *your support email* |
| App logo | `brand-assets/google-oauth-logo-120.png` |
| Application home page | `https://fittempo.app` |
| Application privacy policy | `https://fittempo.app/privacy.html` |
| Application terms of service | `https://fittempo.app/terms.html` |
| Authorized domain | `fittempo.app` |
| Developer contact email | *your email* |

**4.1c. Confirm the redirect URI (Credentials)**
APIs & Services → **Credentials** → your OAuth 2.0 Client ID → **Authorized redirect URIs** must contain
your Supabase callback:
```
https://rtoahppnekykgmjukujm.supabase.co/auth/v1/callback
```
(If you set up the Supabase custom domain in §4.4, change this to `https://auth.fittempo.app/auth/v1/callback`.)

**4.1d. Scopes + justification (paste-ready)**
Add these scopes:
```
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/calendar.events        ← sensitive, needs justification
```
Justification for `calendar.events`:
> Tempo is a workout-planning app. With the user's explicit opt-in, it reads the times of the user's
> Google Calendar events to schedule training sessions around their real commitments, and it adds the
> workouts the user schedules to their calendar. The `calendar.events` scope is the minimum needed to
> read event times and create/update the app's own workout events. Calendar data is used solely for
> this scheduling feature, is never sold, and is never used for advertising.

**4.1e. Demo video (required for sensitive scopes)**
Record an unlisted YouTube video (~60–90s) showing:
1. The OAuth consent screen with the app name **Tempo** and the domain visible.
2. The user granting the calendar permission.
3. In-app: Profile → Connect Google Calendar, then a scheduled workout appearing on the calendar.
Narrate that calendar access is only used to schedule workouts.

**4.1f. Submit**
Set **Publishing status → In production**, then **Submit for verification** and attach the video.
Sensitive-scope review typically takes **2–6 weeks**; respond quickly to any follow-ups.

**Until it's approved:** add your email under **Test users** so you can click through the warning.

**4.1g. "Additional info" field (paste-ready, ≤1000 chars)**
This box caps at **1000 characters**. The text below is 928; swapping in a short `youtu.be/…` link and
your project ID keeps the final under 1000. Replace the two «placeholders»:

```
Tempo (iOS & Android, com.fittempo.app) plans workouts around the user's life. We request one Google scope: calendar.events. With the user's opt-in, it reads their event times to schedule workouts around commitments and creates/updates its own workout events on their primary calendar. We don't touch other calendars, sharing, or settings, so calendar.events (not full calendar) is minimal. The refresh token is stored server-side (Supabase), never on-device, deleted on disconnect/account deletion. Google data is used only for scheduling — never sold, shared, or read by humans — per the Limited Use requirements (see privacy policy). The app is in closed beta (not public); demo video «URL» shows the full consent + sync flow. We can add a reviewer to TestFlight/Play internal or send an APK (fittempo.app@gmail.com). Single Google Cloud project (ID «id»); auth is brokered by Supabase, so the redirect URI is on supabase.co.
```

### 4.2. Apple — App Store Connect "App Privacy" answers

App Store Connect → your app → **App Privacy**. "Do you or your third-party partners collect data?" → **Yes**.

Declare these data types (all **linked to the user's identity**, all purpose **App Functionality**,
none **used for tracking**):

| Data type | Category | Notes |
|-----------|----------|-------|
| Email Address | Contact Info | From Apple/Google sign-in |
| Name | Contact Info | If provided by the sign-in provider |
| Health & Fitness | Health & Fitness | Workouts, sets/reps/weight, body measurements |
| Photos | User Content | Progress photos (only if the user adds them) |
| User ID | Identifiers | Account identifier |
| Coarse/other usage | Usage Data → Product Interaction | **Only if** `EXPO_PUBLIC_POSTHOG_KEY` is set (also purpose: Analytics) |
| Crash Data + Performance Data | Diagnostics | **Only if** `EXPO_PUBLIC_SENTRY_DSN` is set |

**Tracking:** answer **No** — Tempo does not track users across apps/websites or share data with data
brokers, so **no App Tracking Transparency prompt is required**. (If you ever add ad SDKs, revisit this.)

Account deletion: the app has Profile → Delete Account, and the public URL is
`https://fittempo.app/delete-account.html` — reference it if asked.

Apple review note (put in "Notes for Reviewer"): *"You can explore the full app without an account via
'Continue as guest' on the sign-in screen."*

### 4.3. Google Play — "Data safety" answers

Play Console → your app → **App content → Data safety**.

- **Does your app collect or share user data?** → **Yes** (collected; **not shared** with third parties).
- **Is all data encrypted in transit?** → **Yes**.
- **Do you provide a way to request data deletion?** → **Yes** →
  URL `https://fittempo.app/delete-account.html` (and in-app Profile → Delete Account).

Data types to declare (all **Collected**, **Not shared**, purpose **App functionality** unless noted):

| Play data type | Category |
|----------------|----------|
| Email address | Personal info |
| Name | Personal info |
| User IDs | Personal info |
| Health & fitness info | Health and fitness |
| Photos | Photos and videos (progress photos) |
| Calendar events | Calendar — mark collected for App functionality (server can access via the stored Google token) |
| App interactions | App activity — **only if** PostHog is enabled (purpose: Analytics) |
| Crash logs + Diagnostics | App info and performance — **only if** Sentry is enabled |

Also complete: content rating questionnaire (Health & Fitness, no objectionable content → likely
Everyone/PEGI 3), target audience (13+), and the privacy-policy URL `https://fittempo.app/privacy.html`.

### 4.4. The "weird supabase.co URL" during Google sign-in

Supabase is the OAuth broker, so the callback is on `…supabase.co`. Options:
- **Cleanest:** enable a **Supabase custom domain** (Project Settings → General → Custom Domains, paid
  add-on) so the callback becomes `auth.fittempo.app`. Then update the redirect URI in §4.1c and your
  Supabase site URL. Users only ever see `fittempo.app`.
- **Free:** once the consent screen is branded (name + logo) and verified, it leads with "Tempo" and
  the supabase.co host is a minor detail.
- **Later / biggest win:** switch Google to *native* sign-in (`@react-native-google-signin/google-signin`
  + Supabase `signInWithIdToken`, same pattern as Apple) — native account picker, no browser, no
  supabase.co at all. New dependency + iOS/web client IDs + a rebuild.

### 4.5. Store listing metadata (both stores)
App name **Tempo** · category **Health & Fitness** · short + full description (§3) · keywords · app
icon (1024 iOS / 512 Android) · phone screenshots · privacy-policy URL
`https://fittempo.app/privacy.html` · support email · age rating · the data forms above.

### 4.6. Order of operations
1. Deploy `web/` so `fittempo.app`, `/privacy.html`, `/terms.html`, `/delete-account.html` are all live.
2. Verify `fittempo.app` in Search Console.
3. Configure + submit the OAuth consent screen for verification (long pole — do it early).
4. Add yourself as a Test user so you're unblocked meanwhile.
5. EAS production build → TestFlight / Play internal (new icon, splash, buttons ship here).
6. Fill App Privacy + Data safety using §4.2/§4.3.
7. Upload screenshots + metadata, then submit for review.

---

## 5. Tempo Pro / RevenueCat setup

> **Goal:** take Tempo Pro from *built-but-dormant* to *live and purchasable*. Everything in the app
> is already coded (paywall, gates, free-tier caps, entitlement wiring). This is the store + dashboard
> + flip-the-flag runbook. Follow it top to bottom.
>
> **Companion files:** `MONETIZATION_PLAN.md` (what/why), `ARCHITECTURE.md` (§ Pro),
> `mobile/src/lib/purchases.ts` + `proConfig.ts` (the code).

> **✅ STATUS (audited live 2026-07-22 — most of this is now DONE, iOS and Android both):**
> - **RevenueCat — iOS:** entitlement `Tempo: Fitness Planner Pro` (exact match ✓), real products
>   **`tempo_pro_month`** + **`tempo_pro_year`** attached, current offering **`default`** wires
>   `$rc_monthly`→month and `$rc_annual`→year, In-App-Purchase Key + App-Store-Connect API key both
>   "Valid credentials". **Complete.**
> - **RevenueCat — Android (fixed 2026-07-22, see D2.1):** the service-account credential was
>   broken (zero active keys — the uploaded JSON was orphaned; two required Google Cloud APIs
>   weren't enabled; the service account was never invited into Play Console). All three fixed same
>   day. Both Play products (`tempo_pro_month:monthly`, `tempo_pro_year:yearly`) imported, **Published**,
>   attached to the entitlement, and wired into the `default` offering's `$rc_monthly`/`$rc_annual`
>   packages alongside the iOS products. Real-time developer notifications (Pub/Sub) connected —
>   confirmed "Successfully connected to Google." Android SDK key in `eas.json` verified byte-for-byte
>   against RevenueCat's public key. **Complete** (one cosmetic "Credentials need attention" badge
>   persists despite every real capability — import, attach, offering save, Pub/Sub — working; likely a
>   narrow/stale check, not a blocker).
> - **App Store Connect:** subscription group *Tempo Pro* with Monthly **$7.99** + Yearly **$49.99**
>   confirmed live (all ~175 territories). **Paid Apps Agreement is now Active** (was the launch
>   blocker as of 07-18 — resolved between then and 07-22: bank account + W-9 tax form both Active).
>   **Complete.**
> - **Pricing/offer decision (2026-07-22, founder-confirmed):** the Yearly plan's introductory offer
>   is a **paid 50%-off first year** ($24.99 of $49.99), not a free trial — this is the intended,
>   correct configuration (matches `paywall.tsx`'s existing "FOUNDING PRICE" badge logic exactly,
>   which was built for precisely this case). The Monthly plan has no intro offer. Any earlier mention
>   in this repo of a "7-day free trial" describes a superseded plan — see `MONETIZATION_PLAN.md`.
> - **Supabase:** `app_config.pro_enabled` flipped to globally `true` on **2026-08-05** — Pro is now
>   LIVE, not dormant. The founder's uid remains in `test_user_ids` (harmless now that `enabled` is
>   already true for everyone) with `tester_tools: false`, so the public never sees the in-app Pro
>   debug switch. `founding_offer` config row (for the paywall's countdown banner) still not set —
>   optional, needs an `ends_at` date before it's added.
> - **⛔ REMAINING (founder-only, blocks public purchases):** the app's iOS **App Store version 1.0 is
>   still "Prepare for Submission"** with zero screenshots and empty description/promotional text —
>   that blocks a *full public App Store submission*, but **not** subscription testing. Apple requires
>   the first auto-renewable subscription to be submitted for review together with a build, but that
>   build does **not** need to go public: submitting to an **external TestFlight testing group**
>   triggers Apple's (lighter) Beta App Review, which reviews the attached subscriptions the same as
>   full App Review — and TestFlight's own metadata (What to Test, beta description) is separate from,
>   and much lighter than, the App Store listing's screenshots. **Internal-only TestFlight distribution
>   does not trigger any review and will not get the subscriptions approved** — it must go to an
>   external group. See §5 C3–C4.
> The rest of this section is the reference for how each piece was set up (and how to redo/verify it).

### 5.0. How Tempo's Pro system works (read first — it explains every step)

Three facts drive the whole thing:

1. **A remote "dormant" flag** (`app_config` row `pro_enabled`, read by `lib/proConfig.ts`). While it's
   off, Pro is completely inert — no paywall, no gates, no caps. You flip it on with one SQL update,
   **no new build required**. You can flip it on for *just your account* first.
2. **One entitlement** unlocks everything. Its identifier is set in `mobile/eas.json` as
   `EXPO_PUBLIC_PRO_ENTITLEMENT` = **`Tempo: Fitness Planner Pro`**. ⚠️ **This string must match the
   RevenueCat entitlement identifier EXACTLY**, or purchases will succeed but never unlock Pro.
3. **The app is offering-agnostic.** No product IDs or prices are hardcoded. The paywall renders
   whatever the RevenueCat *current* offering contains (annual/monthly/lifetime, prices, and the free
   trial). So you configure everything in the dashboards — the app just reflects it.

The iOS RevenueCat public key is already in `eas.json`: `appl_GkKqdQbhrRmYuPsFcquklZsSJOf`.

**Order of operations:** App Store Connect (create the products) → RevenueCat (wire them to the
entitlement + offering) → flip the flag for yourself → TestFlight sandbox-test → flip it on for
everyone.

### Part A — App Store Connect (create the subscriptions + the free trial)

**A1. Prerequisites (do these once)**
- **Agreements, Tax, and Banking** → the **Paid Apps** agreement must be **Active** (Apple won't show
  any IAP until it is). App Store Connect → Business → Agreements.
- The Tempo app record must exist (it does — it's in TestFlight).
- Have your **App-Specific Shared Secret** ready (App Store Connect → your app → App Information →
  "App-Specific Shared Secret", or the newer **In-App Purchase Key** under Users and Access → Keys →
  In-App Purchase). RevenueCat needs one of these in Part B.

**A2. Create a Subscription Group**
App Store Connect → your app → **Monetization → Subscriptions → Create** a Subscription Group.
- **Reference Name:** `Tempo Pro` (internal only).
- A group means the annual and monthly plans are mutually exclusive and users can upgrade/downgrade
  between them cleanly. Put **both** plans in the **same** group.

**A3. Create the two auto-renewable subscriptions**
Inside the group, **Create** each of these:

| Plan | Product ID (as actually created) | Price | Duration |
|---|---|---|---|
| Annual | `tempo_pro_year` | **$49.99** | 1 Year |
| Monthly | `tempo_pro_month` | **$7.99** | 1 Month |

> **Price changed 2026-07-22** (was $34.99 / $4.99). See "Changing prices later" at the end of
> Part D2 — **there is nothing to change in RevenueCat or in the app** when a price moves.

For **each** subscription fill in:
- **Reference Name** (internal): e.g. "Tempo Pro Annual".
- **Subscription Duration** + **Price** (pick the price tier, all territories).
- **Localization** (App Store Display Name + Description). ⚠️ The Description field caps at **~55
  characters**, so keep it tight and *accurate* (Apple rejects over-claims). What's live now:
  Display Name "Tempo Pro (Yearly)" / "Tempo Pro (Monthly)", Description
  **"Unlimited custom plans, workouts & smart scheduling."** (Do NOT advertise unbuilt features like
  "AI coaching" or free ones like "photos".)
- **Review Information:** a screenshot of the Tempo paywall + a note ("Subscription unlocks Tempo Pro
  features; see review notes"). Apple requires a paywall screenshot per product.

**A4. Add the 7-day free trial (Introductory Offer)**
On the **Annual** subscription → **Subscription Prices** / **Introductory Offers → Create**:
- **Type:** Free Trial
- **Duration:** **1 week (7 days)**
- **Territories:** All
- Eligibility: new subscribers (Apple default).

> The app reads this automatically: `trialLabel()` in `paywall.tsx` turns any $0 intro offer into
> "7-days free" and the CTA becomes **"Start Free Trial"**. You do **not** touch app code to enable
> the trial — configuring it here is enough. (Optional: add a shorter intro/trial on Monthly too;
> most apps trial only the annual to push annual.)
>
> **Superseded per the 2026-07-22 pricing decision above** — the live Yearly offer is a paid 50%-off
> first year, not this free trial. Left here as the mechanism reference in case that changes back.

**A5. (Optional) Lifetime — a Non-Consumable IAP**
If you decide to offer lifetime (see `MONETIZATION_PLAN.md` §5): Monetization → **In-App Purchases →
Create → Non-Consumable**, product ID `tempo_pro_lifetime`, price ~**$79.99–$99.99**. You can add this
later without touching app code.

**A6. Required app metadata (before submitting for review)**
- Your app's **privacy policy URL** and **terms (EULA)** — Tempo links to `/legal` in-app; make sure
  the App Store Connect fields are filled too. Apple requires functional Terms + Privacy links on any
  subscription app.
- The first subscription **must be submitted WITH an app version** — it can't be submitted standalone.
  See §5 C3–C4 for the (build → attach → add subscriptions → submit) flow, including the fact that you
  probably **don't need a fresh EAS build**.

### Part B — RevenueCat (wire the products to the entitlement)

**B1. Project + app**
- Create/confirm a RevenueCat **project** for Tempo. Add an **App** → platform **App Store**.
- Enter the **bundle identifier** (must match `mobile/app.json` → `ios.bundleIdentifier`).
- Paste the **App-Specific Shared Secret / In-App Purchase Key** from Part A1 (this lets RevenueCat
  validate receipts).

**B2. API keys (confirm, don't change)**
- RevenueCat → API keys → the **public** Apple SDK key should be
  **`appl_GkKqdQbhrRmYuPsFcquklZsSJOf`** (already in `eas.json`). If RevenueCat shows a *different*
  key for this app, update `EXPO_PUBLIC_REVENUECAT_KEY` (and/or `EXPO_PUBLIC_REVENUECAT_IOS_KEY`) in
  `eas.json` to match, and rebuild.

**B3. Create the entitlement — exact identifier**
RevenueCat → **Entitlements → New**:
- **Identifier:** `Tempo: Fitness Planner Pro`  ← **must be byte-for-byte identical** to
  `EXPO_PUBLIC_PRO_ENTITLEMENT` in `eas.json`. Copy-paste it. This is the #1 thing that silently
  breaks Pro if it's off by a character.

**B4. Import the products + attach to the entitlement *(done)***
- RevenueCat → **Products → + New / Import** → import `tempo_pro_year`, `tempo_pro_month` (and
  `tempo_pro_lifetime` if you add one) from App Store Connect.
- Open each product → **attach it to the `Tempo: Fitness Planner Pro` entitlement.** They all grant
  the same entitlement. *(Note: two old "Test Store" products — `monthly`/`yearly` — are also attached
  from early testing; harmless in production, delete anytime.)*

**B5. Create the Offering (this is what the paywall reads) *(done)***
RevenueCat → **Offerings** — the **Current** offering is **`default`** (marked with the check).
- Its packages use RevenueCat's standard identifiers so the app's `offering.annual` /
  `offering.monthly` accessors light up:
  | Package | Identifier | Product |
  |---|---|---|
  | Annual | `$rc_annual` | `tempo_pro_year` |
  | Monthly | `$rc_monthly` | `tempo_pro_month` |
- *(Cleanup: there's a stray unused offering literally named `offerings.current` — it is NOT the
  current one and can be deleted to avoid confusion. The SDK's `getOfferings().current` returns
  whatever is flagged Current in the dashboard — i.e. `default` — not an offering named that.)*
  | Lifetime (optional) | `$rc_lifetime` | `tempo_pro_lifetime` |
- **Set this offering as Current.** `paywall.tsx` reads `offerings.current` and shows the annual as the
  default-selected best-value option automatically, computes the savings %, and shows the trial.

> You do **not** need to build a RevenueCat-hosted paywall — Tempo ships its own custom on-brand
> paywall (`app/paywall.tsx`). RevenueCat is only the billing/entitlement engine here.

### Part C — Turn Pro on in the app (staged: you first, then everyone)

**C1. Make sure `app_config` exists**
Apply `mobile/supabase/add_app_config.sql` to the live project if it isn't already (Supabase SQL
editor, or MCP `apply_migration`). It creates the `app_config` table + the dormant `pro_enabled` row.

**C2. Flip it on for your account only (private test)**
Run this in the Supabase SQL editor — replace the UUID with your own `auth.users` id:

```sql
-- Pro system LIVE for just your account (everyone else stays free).
update app_config
set value = jsonb_build_object(
  'enabled', false,                       -- still OFF for the public
  'test_user_ids', jsonb_build_array('YOUR-AUTH-UUID-HERE'),  -- paywall live for you
  'pro_user_ids', jsonb_build_array(),    -- (comp list — grant Pro without paying)
  'tester_tools', true                    -- shows the in-app Pro on/off switch (Profile → Tester Tools)
)
where key = 'pro_enabled';
```

With `test_user_ids` set, **your** account sees the real paywall + gates + caps; everyone else is
unchanged. `tester_tools: true` also gives you an in-app Pro on/off toggle (Profile → Tester Tools) so
you can flip between the free and Pro experience without buying.

**C3. Get a build with the RevenueCat module (you probably ALREADY have one)**
RevenueCat is a **native module**, so it must be compiled into a build — but **that's already true of
your existing TestFlight builds** (RevenueCat is reporting live SDK usage from them). Everything added
since (paywall, free-tier caps, multi-calendar scope) is **JavaScript-only** and ships **over-the-air**:
```
cd mobile
npx eas update --branch production      # pushes latest JS to existing builds — does NOT use build quota
```
Only cut a **fresh native build** if you changed native config/plugins:
```
npx eas build --profile production --platform ios
```
> **Out of free EAS builds?** You most likely don't need one for Pro. If you truly do: `eas build
> --local` needs **macOS + Xcode** (won't run on Windows), so either wait for the monthly quota to
> reset, buy on-demand builds / upgrade at **expo.dev/pricing**, or build on a Mac (`expo prebuild` →
> Xcode Archive).

Install/test on a **real device** (StoreKit/sandbox doesn't work in the simulator or Expo Go).

**C3b. Submit the app version WITH the subscriptions (required for Apple to approve them)**
The build alone does **not** submit the subscriptions, and the first subscription can't be submitted
on its own. In App Store Connect:
1. Open the **1.0 app version** → select a build for it (an existing TestFlight build is fine).
2. Add the two subscriptions to the submission — the **"Add for Review"** button on the *Tempo Pro*
   subscription group, or the version's **In-App Purchases and Subscriptions** section.
3. **Submit** — the app + subscriptions are reviewed together.
> ⚠️ The App Review tester must be able to **reach the paywall**. While Pro is dormant (only your uid
> in `test_user_ids`) a reviewer can't find the purchase → likely rejection. Before submitting, either
> flip `pro_enabled → enabled: true` (§5 C5) so the paywall is reachable, or add reviewer notes with
> exact steps to trigger it (e.g. "create a 2nd custom plan to see the paywall").

**C4. Sandbox-test everything**
On the device, signed into a **Sandbox Apple ID** (Settings → App Store → Sandbox Account):
- [ ] Paywall loads with **Annual (7-days free)** + Monthly, correct prices, savings %.
- [ ] **Start Free Trial** → completes → Pro unlocks instantly; gated features open.
- [ ] Each **free-tier cap** shows the paywall at the right moment (as a free/test user):
  create a **2nd custom plan**, a **6th custom exercise**, a **6th saved workout** → paywall.
  Editing existing ones is **never** blocked; logging/adaptive-plan/library are **never** blocked.
- [ ] **Reschedule-my-week**, **multi-calendar picker**, **travel mode** show the paywall when locked.
- [ ] **Restore** works on a fresh install with the same Apple ID.
- [ ] Cancel from the App Store → entitlement drops on next refresh.

**C5. Public launch**
When you're happy, flip the global switch:
```sql
update app_config
set value = jsonb_set(
  jsonb_set(value, '{enabled}', 'true'),   -- Pro LIVE for everyone
  '{tester_tools}', 'false'                -- hide the tester toggle from the public
)
where key = 'pro_enabled';
```
No rebuild needed for the flip itself — it's read on app open. (A build *was* needed once, in C3, to
get the native module onto devices.)

### Part D — Pricing changes later (zero code)
Because the app is offering-agnostic, changing price, swapping the trial length, or adding lifetime is
a **dashboard-only** change: edit the price/intro offer in App Store Connect, and RevenueCat + the
paywall reflect it on next launch. Revisit pricing the day Tempo Coach ships (see `MONETIZATION_PLAN.md`
§5's note).

### Part D2 — Android / Google Play (all founder-only; audited 2026-07-18)

The app is `com.fittempo.app` on Play (name "Tempo: Fitness Scheduling"), in **Closed testing**. The
same RevenueCat entitlement + offering serve Android. Progress as of 2026-07-18:

1. **✅ Google Play merchant account — DONE** (founder). The *Monetize with Play* page no longer shows
   the "set up a merchant account" block.
2. **✅ Play subscriptions created + activated** (2026-07-18, **repriced 2026-07-22**):
   `tempo_pro_month` → monthly base plan **$7.99**; `tempo_pro_year` → yearly base plan **$49.99**
   **+ a `free-trial` offer** (Free trial phase, **1 week**, eligibility "New customer acquisition →
   Never had any subscription" — one trial per user, matching iOS). Prices auto-converted to all
   174–177 regions.
3. **⛔ RevenueCat → Play Store app → Service account credentials JSON — STILL EMPTY (do this next).**
   Without it RevenueCat can't validate Android purchases *and can't even import the Play products*.
   **This is the only thing blocking Android.** Full walkthrough in **D2.1** below.
4. **RevenueCat wiring** (after 3): import `tempo_pro_month:monthly` / `tempo_pro_year:yearly` (Play
   products are `subscriptionId:basePlanId`), **attach both to the `Tempo: Fitness Planner Pro`
   entitlement**, and add them to the **`default` offering**'s `$rc_monthly` / `$rc_annual` packages
   (so each package holds *both* the App Store and Play product).
5. **Android SDK key — DONE (verify):** `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` is now in `eas.json`
   (`goog_oxlGATTCFaOSINDjTcKnkPbPBSp`). ⚠️ **Verify this matches RevenueCat → Apps → Play Store → Public
   API Key exactly** — it was read off-screen; a single wrong character silently breaks Android purchases
   (same class of failure as the entitlement id). `purchases.ts` already uses this key on Android.
6. **Build + test:** Android builds **can** be done on Windows (`eas build --profile production
   --platform android`, or `--local`), unlike iOS. Test purchases on the **Closed testing** track with a
   **License tester** account (Play Console → Setup → License testing) — no need to go to production.

The `pro_enabled` flag and the paywall/caps code are already cross-platform — once step 3 (credential)
+ step 4 (wiring) are done and an Android build ships, Pro works on Android identically to iOS.

**D2.1 — Google Play service-account credentials (the step 3 walkthrough)**

Founder-only; ~15 minutes of clicking, then **up to 36 hours of waiting**. Start it early — the wait
is the long pole on Android, not the setup.

You are creating a robot Google account that RevenueCat uses to ask Play "is this purchase real, and
is it still active?" It lives in **Google Cloud Console** (the project behind your Play account) and
is then *invited into* **Play Console** like a team member.

**Step 1 — Enable three APIs.** Google Cloud Console → make sure you're in the project linked to your
Play developer account → **APIs & Services → Library**, and Enable each:
- **Google Play Android Developer API** (a.k.a. Android Publisher API) — purchase validation.
- **Google Play Developer Reporting API** — reporting.
- **Cloud Pub/Sub API** — real-time developer notifications (renewals, cancellations, refunds
  reaching RevenueCat without polling). **Easy to forget, and the most common cause of "renewals
  don't show up."**

Each shows **Manage** instead of **Enable** once it's on.

**Step 2 — Create the service account.** Cloud Console → **IAM & Admin → Service Accounts → Create
service account**. Name it something obvious like `revenuecat`. **Create and continue.**

**Step 3 — Grant it two roles** (on the "Grant this service account access to project" step):
- **Pub/Sub Editor** — lets it receive Play's notifications. *(If you later hit permission errors,
  Pub/Sub Admin is the documented fallback.)*
- **Monitoring Viewer** — lets RevenueCat monitor the notification queue.

Skip the optional third step → **Done**.

**Step 4 — Create the JSON key.** In the Service Accounts list, the **⋮** menu on your new account →
**Manage keys → Add key → Create new key → JSON** → it downloads immediately.
⚠️ **This file is a credential — treat it like a password.** Do **not** commit it to this repo, do not
put it in `mobile/`, do not paste it into a chat. Upload it to RevenueCat, then delete the download.
Google auto-disables service accounts whose keys it detects as leaked.

**Step 5 — Invite the service account into Play Console.** Play Console → **Users and permissions →
Invite new user** → paste the service account's **email address** (it looks like
`revenuecat@your-project.iam.gserviceaccount.com`, visible in the Service Accounts list).
- Under **App permissions**, add **Tempo** (`com.fittempo.app`).
- Grant these **Account permissions**:
  - **View app information and download bulk reports** (read-only)
  - **View financial data, orders, and cancellation survey responses**
  - **Manage orders and subscriptions**
- **Invite user.**

**Step 6 — Upload to RevenueCat.** RevenueCat → **Project Settings → Apps → your Play Store app** →
**Service Account Credentials JSON** → upload the file → Save.

**Step 7 — Wait, then verify.** Google's docs say **up to 36 hours** for the credential to start
working. Until then RevenueCat may show a validation error (503/521) — that is expected, not a
mistake you made. Documented accelerant: open Play Console → **Monetize → Subscriptions**, make a
trivial edit to a product description and save it; that sometimes nudges validation through sooner.

**When it's working**, RevenueCat can import the Play products, and you can do step 4 of D2 above
(attach `tempo_pro_month:monthly` / `tempo_pro_year:yearly` to the `Tempo: Fitness Planner Pro`
entitlement and add them to the `default` offering's existing `$rc_monthly` / `$rc_annual` packages,
so each package holds *both* the App Store and the Play product).

**If it doesn't work after 36 hours**, check in this order — these are the documented failure modes:
1. Was **Cloud Pub/Sub API** actually enabled? (Step 1, third one.)
2. Are all **three** Play Console account permissions granted? (Step 5.)
3. Is the uploaded JSON the right file, from the right project?
4. Has a **signed AAB/APK ever been uploaded** to this Play app? Play won't serve the API for an app
   with no release. *(Tempo is in Closed testing, so this one is satisfied.)*
5. Was the service account auto-disabled? (Cloud Console → Service Accounts → check it's enabled.)

**Changing prices later (e.g. the 2026-07-22 move to $7.99 / $49.99)**

**There is nothing to do in RevenueCat, and nothing to do in the app.** This is worth stating plainly
because it looks like it should require work:

- **Prices come from the stores, not from RevenueCat.** The SDK reads the live product from StoreKit
  (iOS) / Billing Client (Android) on the device. RevenueCat maps products to entitlements; it does
  not store the price you charge.
- **The app hardcodes no prices.** `app/paywall.tsx` renders `product.priceString`,
  `pricePerMonthString`, and an auto-computed savings % straight from the current offering. At
  $7.99 / $49.99 the paywall will show **$4.17/mo billed yearly** and a **SAVE 48%** badge with no
  code change. (It also updates over the air — even the layout ships via `eas update`.)
- **The 7-day free trial is unaffected** — it's an Introductory Offer (iOS) / offer phase (Play)
  attached to the annual product, independent of the base price.

What to actually verify after a reprice:
- [ ] **App Store Connect** → each subscription shows the new price as *current*, all territories.
      There is no existing paying cohort, so "preserve prices for existing subscribers" is moot —
      apply to everyone.
- [ ] **Play Console** → each base plan shows the new price and is still **Active**. Play treats a
      base plan's **ID and billing period as immutable** once created; price is editable, but if the
      console won't let you change it, the fallback is a **new base plan** at the new price with the
      old one deactivated — in which case the RevenueCat product id changes
      (`tempo_pro_year:<new-base-plan-id>`) and the offering must be re-pointed at it.
- [ ] **RevenueCat → Offerings → `default`** still shows both packages resolving to a product, with
      the new price displayed. If RevenueCat shows a stale price, it's a cache — it refreshes from
      the stores; the *device* is the source of truth for what the user is charged.
- [ ] Open the paywall on a real device and confirm the price, the `/mo` line, and the savings badge.

### Part E — Gotchas checklist
- [ ] **Entitlement identifier** in RevenueCat is *exactly* `Tempo: Fitness Planner Pro` (Part B3).
      This is the most common silent failure.
- [ ] **Paid Apps agreement** is Active (Part A1) — without it, no products appear.
- [ ] The RevenueCat **iOS key matches `eas.json`** (`appl_GkKq…`), else the SDK can't reach RevenueCat.
- [ ] Offering is set as **Current** and its packages use `$rc_annual` / `$rc_monthly` identifiers.
- [ ] The **free trial** is an **Introductory Offer** on the annual product (Part A4) — the app shows
      it automatically; nothing to code.
- [ ] Test on a **real device** from **TestFlight** with a **Sandbox Apple ID** — never the simulator.
- [ ] Each product has a **paywall screenshot** in its Review Information (Apple rejects otherwise).
- [ ] Terms + Privacy URLs are set in App Store Connect (subscription apps require them).
- [ ] After launch, `tester_tools` is `false` so the public never sees the in-app Pro override.
- [ ] **Android (Part D2):** merchant account set up, Play subscriptions created, RevenueCat service-
      account credential uploaded, Play products attached to the entitlement + offering, and the
      `goog_` key in `eas.json` verified. All still open.

### Notes / decisions baked in
- **Model:** Depth & horizon — free is fully functional forever; Pro sells depth/foresight, not a
  crippled free tier. The engine (plan generation, adaptation, quick workouts, logging, scheduling)
  is never gated.
- **Downgrade never deletes data** — gating controls access, not storage.
- **Fast-follow Pro surfaces** (each is a `<ProGate>` wrap + a `PAYWALL_POINTS` entry, shippable via
  `eas update` with no rebuild): smart scheduling optimization, muscle-group analysis + PR
  forecasting, long-horizon/goal-date planning, premium themes + app icons, and **Tempo Coach**.

---

## 6. Remaining roadmap + key commands

Built this pass: ✅ injury editor, ✅ notifications toggle, ✅ body-fat/waist trends, ✅ progress
photos, ✅ mobility/stretch exercise content.

Still open:
- **Free-time-gap push from real calendar** — the retention rule currently uses a daytime heuristic.
  True calendar-aware gaps need device calendar free/busy synced to the backend (the engine runs
  server-side and can't read the on-device calendar). Architectural; deferred.
- **Progress-photo gallery / before-after compare** — photos are captured + stored privately now;
  a timeline/compare view is a follow-up.
- **HealthKit / Google Fit** weight import; Apple Watch.
- **Automated test suite** — pure logic (`scoring`/`periodization`/`progression`/trends) is
  structured for unit tests; none exist yet.
- **iOS App Store v1.0 public submission** — needs real screenshots + description (§3 has the copy).

### Key commands
```
cd mobile
npx tsc --noEmit                                   # typecheck
eas build --profile preview --platform ios         # installable test build
eas build --profile production --platform ios      # store build (or --platform android)
eas submit  --profile production --platform ios     # upload to the store
eas credentials                                     # manage APNs / FCM push keys
npx eas update --branch production                  # push JS-only changes OTA (no build quota used)
```
