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
