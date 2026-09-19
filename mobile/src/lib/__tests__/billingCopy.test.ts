// Billing copy has to name the right store on the right platform.
//
// The paywall hardcoded Apple's wording, so every Android subscriber was told
// their payment goes to an Apple ID and to cancel in App Store settings, which
// is not a place that exists for them. Wrong on a live screen that takes money,
// and a Play policy problem, since Google requires the renewal disclosure to be
// accurate.
//
// STORE is resolved with Platform.select at module load, so each platform needs
// its own isolated import rather than one module and a toggle.
//
// This lives in lib/storeCopy rather than lib/purchases precisely so it can be
// tested: purchases.ts reaches the RevenueCat SDK and Sentry, neither of which
// loads under ts-jest's Node environment, which would have left the one string
// in the app with legal weight as the one string nothing covers.

function loadFor(os: 'ios' | 'android') {
  let mod: typeof import('@/lib/storeCopy')
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({
      Platform: {
        OS: os,
        select: (spec: Record<string, unknown>) =>
          (os in spec ? spec[os] : spec.default),
      },
    }))
    mod = require('@/lib/storeCopy')
  })
  return mod!
}

afterEach(() => {
  jest.resetModules()
  jest.dontMock('react-native')
})

describe('billing disclosure', () => {
  it('names Apple on iOS', () => {
    const { STORE, billingDisclosure } = loadFor('ios')
    expect(STORE.account).toBe('Apple ID')
    expect(STORE.name).toBe('App Store')

    const copy = billingDisclosure()
    expect(copy).toContain('Apple ID')
    expect(copy).toContain('App Store settings')
    expect(copy).not.toMatch(/Google|Play/)
  })

  it('names Google on Android', () => {
    const { STORE, billingDisclosure } = loadFor('android')
    expect(STORE.name).toBe('Google Play')

    const copy = billingDisclosure()
    expect(copy).toContain('Google Play')
    // The exact regression: Apple's wording must never reach an Android user.
    expect(copy).not.toMatch(/Apple|App Store/)
  })

  it('still states the terms both stores require', () => {
    // Auto-renewal and how to stop it. Dropping either is a review rejection on
    // iOS and a policy violation on Play, whatever the platform wording says.
    for (const os of ['ios', 'android'] as const) {
      const copy = loadFor(os).billingDisclosure()
      expect(copy).toMatch(/renew automatically/i)
      expect(copy).toMatch(/cancel/i)
      expect(copy).toMatch(/24 hours/i)
    }
  })
})


// ── The legal documents, which matter more than the paywall ──────────────────
//
// Terms and Privacy are linked straight from the purchase screen, which is where
// App Review opens them. The paywall's Apple-only wording was fixed first; the
// same sentences existed here, in the documents the user actually agrees to.
describe('legal text', () => {
  const { PRIVACY_SECTIONS, TERMS_SECTIONS } = require('@/constants/legalContent')

  const allText = (fill: (t: string) => string) => {
    const out: string[] = []
    const walk = (blocks: any[]) => {
      for (const b of blocks ?? []) {
        if (typeof b?.p === 'string') out.push(fill(b.p))
        if (typeof b?.sub === 'string') out.push(fill(b.sub))
        for (const li of b?.list ?? []) if (typeof li === 'string') out.push(fill(li))
      }
    }
    for (const sec of [...PRIVACY_SECTIONS, ...TERMS_SECTIONS]) walk(sec.blocks)
    return out.join(String.fromCharCode(10))
  }

  it('never tells an Android user to cancel in the App Store', () => {
    const text = allText(loadFor('android').fillLegalText)
    expect(text).toContain('Google Play')
    expect(text).toMatch(/Manage or cancel your subscription in your Google Play subscriptions/)
    // "Sign in with Apple" is a real Android-available feature and is allowed to
    // stay; the billing sentences are what must never say Apple.
    expect(text).not.toMatch(/Apple ID/)
    expect(text).not.toMatch(/App Store settings/)
  })

  it('still says Apple on iOS', () => {
    const text = allText(loadFor('ios').fillLegalText)
    expect(text).toContain('Apple ID')
    expect(text).toContain('your App Store settings')
    expect(text).not.toContain('Google Play account')
  })

  it('leaves no unresolved placeholders', () => {
    for (const os of ['ios', 'android'] as const) {
      const text = allText(loadFor(os).fillLegalText)
      expect(text).not.toMatch(/\{(brand|email|store|storeAccount|storeManage)\}/)
    }
  })
})


// ── Say where the data actually goes ─────────────────────────────────────────
//
// Founder, 2026-09-19: "make sure terms specifically state where data is going
// eg supabase". The Terms said "cloud infrastructure for storage", which names
// nobody. A policy that will not name its processors is the kind users and
// reviewers are right to distrust, and vague hosting language is a weak spot
// under GDPR/CCPA disclosure expectations.
describe('data processors are named', () => {
  const { PRIVACY_SECTIONS, TERMS_SECTIONS } = require('@/constants/legalContent')

  const textOf = (sections: any[], fill: (t: string) => string) => {
    const out: string[] = []
    for (const sec of sections) {
      out.push(fill(sec.title ?? ''))
      for (const b of sec.blocks ?? []) {
        if (typeof b?.p === 'string') out.push(fill(b.p))
        if (typeof b?.sub === 'string') out.push(fill(b.sub))
        for (const li of b?.bullets ?? []) if (typeof li === 'string') out.push(fill(li))
        for (const li of b?.list ?? []) if (typeof li === 'string') out.push(fill(li))
      }
    }
    return out.join(String.fromCharCode(10))
  }

  it('the Terms name every processor, not just "cloud infrastructure"', () => {
    const terms = textOf(TERMS_SECTIONS, loadFor('ios').fillLegalText)
    for (const name of ['Supabase', 'RevenueCat', 'PostHog', 'Sentry', 'Google Calendar']) {
      expect(terms).toContain(name)
    }
    expect(terms).not.toMatch(/cloud infrastructure for storage/)
  })

  it('the Privacy Policy says where the data physically lives', () => {
    const privacy = textOf(PRIVACY_SECTIONS, loadFor('ios').fillLegalText)
    expect(privacy).toContain('Supabase')
    expect(privacy).toContain('United States')
    // The actual region, so the claim is checkable rather than decorative.
    expect(privacy).toContain('us-east-2')
  })

  it('both documents still name the payment processor per platform', () => {
    const ios = textOf(TERMS_SECTIONS, loadFor('ios').fillLegalText)
    const android = textOf(TERMS_SECTIONS, loadFor('android').fillLegalText)
    expect(ios).toContain('App Store')
    expect(android).toContain('Google Play')
  })
})
