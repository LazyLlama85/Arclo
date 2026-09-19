// Arclo — the canonical text of the Privacy Policy and Terms of Use.
//
// WHY THIS FILE EXISTS (2026-08-24). Arclo shipped TWO different legal documents:
// a thorough pair at `web/privacy.html` / `web/terms.html`, and a much thinner
// in-app summary hand-written inside `app/legal.tsx`. The in-app one — the one
// users actually agree to and the one App Review opens — omitted analytics and
// crash reporting entirely (the app sends usage events to PostHog and crash data
// to Sentry on every session), and its Terms carried no limitation of liability
// and no governing law. Two documents for one app is a liability in itself: which
// one applies is exactly the question you do not want asked.
//
// The app now renders THIS module, so the in-app text is complete rather than a
// summary. The two HTML files under `web/` remain hand-maintained and carry a
// pointer back here — the remaining drift risk is real and is logged as a backlog
// item (generate the HTML from this module) rather than pretended away.
//
// The text below is written to be readable, not to be clever. It is not a
// substitute for counsel reviewing it once before the app has real users.

// Placeholders resolved at render time by app/legal.tsx:
//   {brand} {email}                       — naming
//   {store} {storeAccount} {storeManage}  — lib/storeCopy, per platform
//
// Billing sentences MUST use the store placeholders. These documents are linked
// straight from the paywall, which is exactly where App Review looks, and an
// Android user reading that payment goes to an Apple ID is both wrong and a Play
// policy problem. This was the same bug the paywall had; the legal copy is the
// worse place for it.
export const LEGAL_UPDATED = 'August 2026'

export interface LegalBlock {
  /** A paragraph of running text. */
  p?: string
  /** A bulleted list. */
  bullets?: string[]
  /** A bolded sub-heading inside a section. */
  sub?: string
}

export interface LegalSection {
  title: string
  blocks: LegalBlock[]
}

/**
 * `{brand}` and `{email}` are substituted at render time so the brand rename
 * (Tempo → Fitaround → Arclo, still provisional) can't strand a stale name
 * inside a legal document.
 */
export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: 'What we collect',
    blocks: [
      { sub: 'Information you give us' },
      {
        bullets: [
          'Account: when you sign in with Apple or Google we receive your email address and, where available, your name. You can also use {brand} as a guest, with no account at all.',
          'Training profile: your goal, experience level, available equipment, and your weekly availability — work, school, sleep, and days off.',
          'Training data: your plans, scheduled and completed workouts, logged sets, reps, weights, RPE, session feedback, and recovery check-ins.',
          'Body measurements: bodyweight and any measurements you choose to log, and their history over time.',
          'Progress photos, if you add them. They are stored privately to your account and you can delete them at any time.',
        ],
      },
      { sub: 'Information from your device, with your permission' },
      {
        bullets: [
          'Calendar: {brand} reads your busy times so it can schedule workouts around your commitments, and — only if you switch it on — adds your scheduled sessions to your calendar. If you connect Google Calendar, your authorization is stored securely server-side and deleted when you disconnect or delete your account.',
          'Notifications: {brand} sends pre-workout reminders and occasional nudges when you have drifted off your plan. You can turn these off per type in Settings, or entirely in your device settings.',
          'Photos: only the images you pick yourself, for your avatar or progress photos. {brand} never browses your library.',
        ],
      },
      { sub: 'Information collected automatically' },
      {
        bullets: [
          'Usage analytics (PostHog): which screens you open and which features you use, tied to your account id so we can understand how the app is actually used and improve it.',
          'Crash and diagnostic data (Sentry): crash reports and basic device information when something goes wrong, so it can be fixed.',
          'Subscription data (RevenueCat and {store}): whether you have an active subscription, which plan, and when it renews. Payment details go to {store}, never to us — we never see your card.',
        ],
      },
    ],
  },
  {
    title: 'How we use it',
    blocks: [
      {
        bullets: [
          'Generate and adapt your training plan.',
          'Schedule sessions around your real availability, and reschedule them when you miss one or find one too hard.',
          'Track your progress, measurements, and trends.',
          'Send the reminders and notifications you have opted into.',
          'Keep the app secure, diagnose problems, and improve it.',
        ],
      },
      {
        p: 'We do not sell your personal information, and we do not use it for third-party advertising.',
      },
    ],
  },
  {
    title: 'Who we share it with',
    blocks: [
      { p: 'Only the service providers that make {brand} work, and only with what they need:' },
      {
        bullets: [
          'Supabase — the cloud database and authentication that store your account and training data.',
          'Apple and Google — sign-in, when you choose those options.',
          'Expo Push, APNs, and FCM — delivering the notifications you opt into.',
          'PostHog — product analytics. Sentry — crash reporting.',
          'RevenueCat and {store} — managing your subscription and processing payment.',
        ],
      },
      {
        p: 'We may also disclose information where the law requires it, or to protect the rights and safety of our users and our service.',
      },
      { sub: 'Google Calendar data' },
      {
        p: '{brand}’s use and transfer of information received from Google APIs follows the Google API Services User Data Policy, including its Limited Use requirements. {brand} requests the calendar.events scope only to read when you are busy, so it can schedule training around your commitments, and — when you opt in — to add your sessions to your calendar. Google data is never used for advertising, never sold, and never transferred except as needed to provide these features or as required by law. No human reads your calendar.',
      },
    ],
  },
  {
    title: 'Security',
    blocks: [
      {
        p: 'Your data travels encrypted (HTTPS/TLS) and is stored with our cloud provider under access controls that keep your records readable only by you. Sensitive tokens stay server-side and are never shipped inside the app. No system is perfectly secure, but we treat your training history as yours alone.',
      },
    ],
  },
  {
    title: 'Where your data is stored',
    blocks: [
      {
        p: 'Your account, plans, workouts and logs live in a Postgres database hosted by Supabase in the United States (AWS us-east-2, Ohio). Files you upload, such as progress photos, are stored in Supabase Storage in the same region. Access is restricted by row-level security so one account cannot read another’s data.',
      },
      {
        p: 'Our other providers process data in the United States as well. If you use {brand} from outside the United States, your information is transferred there and handled under this policy and the providers’ own terms.',
      },
    ],
  },
  {
    title: 'How long we keep it',
    blocks: [
      {
        p: 'We keep your information for as long as your account is active. When you delete your account we delete the personal data associated with it, except anything we are legally required to retain.',
      },
    ],
  },
  {
    title: 'Your choices and rights',
    blocks: [
      {
        bullets: [
          'Delete everything: Profile → Settings → Delete Account (the gear icon on the Profile tab). This permanently removes your profile, plans, workouts, logs, measurements, photos, and any connected-calendar tokens. It cannot be undone.',
          'See and correct your data: most of it is editable directly in the app. Email us if you need help with the rest.',
          'Withdraw permissions: calendar, notifications, and photos can each be revoked in your device settings at any time. {brand} keeps working without them.',
          'Depending on where you live, you may have additional rights over your data — including access, portability, and objection. Email us and we will honour them.',
        ],
      },
    ],
  },
  {
    title: 'Children',
    blocks: [
      {
        p: '{brand} is not directed to children under 13, and we do not knowingly collect personal information from them. If you believe a child has given us information, contact us and we will delete it.',
      },
    ],
  },
  {
    title: 'Changes',
    blocks: [
      {
        p: 'We may update this policy. When we do, we will change the date at the top and, where it matters, tell you in the app.',
      },
    ],
  },
  {
    title: 'Contact',
    blocks: [{ p: 'Questions about your privacy or your data? Email {email}.' }],
  },
]

export const TERMS_SECTIONS: LegalSection[] = [
  {
    title: 'Acceptance',
    blocks: [
      {
        p: 'These terms govern your use of the {brand} app and related services. By using {brand} you agree to them. If you do not agree, please do not use the app.',
      },
    ],
  },
  {
    title: 'Who can use {brand}',
    blocks: [
      {
        p: 'You must be at least 13 years old, or the minimum age of digital consent where you live if that is higher. If you are under the age of majority in your country, use {brand} only with a parent or guardian involved.',
      },
    ],
  },
  {
    title: 'Not medical advice',
    blocks: [
      {
        p: '{brand} provides general fitness and informational content only. It is not medical advice and is not a substitute for professional guidance.',
      },
      {
        p: 'Exercise carries inherent risk. Consult a qualified healthcare professional before starting any exercise programme — especially if you have a medical condition, are injured, are pregnant, or have any concern about your health. Stop and seek medical attention if you experience pain, dizziness, or discomfort.',
      },
      {
        p: 'Where you tell {brand} about an injury, it adjusts which exercises it selects. That is a programming preference, not a medical assessment: {brand} cannot examine you, cannot diagnose anything, and cannot tell you whether training is safe for you. You use {brand} and perform every exercise at your own risk.',
      },
    ],
  },
  {
    title: 'Your account',
    blocks: [
      {
        bullets: [
          'Sign in with Apple or Google, or use the app as a guest. Keeping your account and device secure is your responsibility.',
          'Give accurate information — goals, availability, injuries — so recommendations fit you. {brand} is not responsible for outcomes based on inaccurate information.',
          'You are responsible for activity under your account.',
        ],
      },
    ],
  },
  {
    title: 'Acceptable use',
    blocks: [
      { p: 'You agree not to:' },
      {
        bullets: [
          'Use {brand} unlawfully or in breach of these terms.',
          'Reverse engineer, decompile, or try to extract source code or bypass security, except where law prohibits that restriction.',
          'Interfere with the app, its servers, or its networks, or try to reach data that is not yours.',
          'Resell, sublicense, or commercially exploit the app without our permission.',
        ],
      },
    ],
  },
  {
    title: 'Subscriptions',
    blocks: [
      {
        p: '{brand} Pro is an auto-renewing subscription sold through {store}. Payment is charged to your {storeAccount} at confirmation of purchase. It renews automatically unless you cancel at least 24 hours before the end of the current period, and your account is charged for renewal within 24 hours of the period ending.',
      },
      {
        p: 'Manage or cancel your subscription in {storeManage} — we cannot cancel it for you. Refunds are handled by {store} under their policies, not by us. Any introductory offer is available once per {storeAccount}, at {store}’s determination.',
      },
    ],
  },
  {
    title: 'Third-party services',
    blocks: [
      {
        p: '{brand} depends on third parties to work: Supabase for the database, authentication and file storage that hold your account and training data; Apple and Google for sign-in; Google Calendar for optional scheduling; {store} and RevenueCat for payments and subscription management; Expo Push, APNs and FCM for notifications; PostHog for product analytics; and Sentry for crash reporting. Your data is stored in the United States. Your use of those services is governed by their own terms and privacy policies, and our Privacy Policy sets out exactly what each one receives. Google Calendar data is handled per the Google API Services User Data Policy, including its Limited Use requirements.',
      },
    ],
  },
  {
    title: 'Your content and data',
    blocks: [
      {
        p: 'You own the data you put into {brand} — your profile, workouts, logs, measurements, and photos. You give us only the permission needed to store and process it in order to run the app for you, as described in our Privacy Policy. You can delete your account and its data at any time from Profile → Settings → Delete Account.',
      },
    ],
  },
  {
    title: 'Intellectual property',
    blocks: [
      {
        p: '{brand} — its software, design, content, and branding — is ours and is protected by intellectual-property law. We grant you a personal, non-exclusive, non-transferable, revocable licence to use the app for your own non-commercial training. All other rights are reserved.',
      },
    ],
  },
  {
    title: 'No guaranteed results',
    blocks: [
      {
        p: 'Training outcomes depend on factors outside our control — your effort, consistency, sleep, nutrition, genetics, and health. {brand} does not promise any particular result, and nothing in the app should be read as a promise of one.',
      },
    ],
  },
  {
    title: 'Disclaimers',
    blocks: [
      {
        p: '{brand} is provided “as is” and “as available,” without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the app will be uninterrupted or error-free, or that it will meet your expectations.',
      },
    ],
  },
  {
    title: 'Limitation of liability',
    blocks: [
      {
        // Founder's call 2026-08-24: add the standard monetary cap, skip counsel
        // for now. Worth knowing what it does and doesn't do — in most US states
        // a cap does NOT limit personal-injury claims and gross negligence can't
        // be waived, so for the injury scenario the real protection is the
        // "Not medical advice" section, assumption of risk, and the disclaimer
        // at the point injuries are collected. This clause covers the contract-
        // shaped claims (billing, data loss) instead.
        p: 'To the maximum extent permitted by law, {brand} and its providers will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, profits, or goodwill arising out of or related to your use of the app.',
      },
      {
        p: 'To the maximum extent permitted by law, our total liability for all claims relating to {brand} is limited to the greater of the amount you paid us in the twelve months before the claim arose, or fifty US dollars.',
      },
      {
        p: 'Some places do not allow certain limitations, so parts of this may not apply to you. Nothing here limits liability that cannot lawfully be limited.',
      },
    ],
  },
  {
    title: 'Termination',
    blocks: [
      {
        p: 'You can stop using {brand} and delete your account at any time. We may suspend or end access if these terms are breached, or if we discontinue the service.',
      },
    ],
  },
  {
    title: 'Governing law',
    blocks: [
      {
        // Also carried over verbatim. Naming an actual state and venue is the
        // stronger clause, but that is a fact about the operator that only the
        // founder can state — not something to infer.
        p: 'These terms are governed by the laws of the United States and the state in which the operator of {brand} resides, without regard to conflict-of-law rules. Nothing in these terms limits any consumer-protection rights you have under the laws of your own country.',
      },
    ],
  },
  {
    title: 'Changes',
    blocks: [
      {
        p: 'We may update these terms. Continuing to use {brand} after an update means you accept the revised version.',
      },
    ],
  },
  {
    title: 'Contact',
    blocks: [{ p: 'Questions about these terms? Email {email}.' }],
  },
]
