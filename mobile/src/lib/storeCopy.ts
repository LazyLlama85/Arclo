// Arclo — the words we use about billing, per platform.
//
// Every user-facing sentence about subscriptions names a store and an account,
// and the two platforms disagree on both. The paywall hardcoded Apple's, so
// every Android subscriber was told their payment goes to an Apple ID and to
// cancel in App Store settings, which is not a place that exists for them.
// Wrong on a live screen that takes money, and a Play policy problem, since
// Google requires the renewal disclosure to be accurate.
//
// Its own module rather than part of lib/purchases so it can be unit-tested:
// purchases.ts reaches the RevenueCat SDK and Sentry, neither of which loads in
// the Node test environment, which would leave the one string in the app with
// legal weight as the one string nothing covers.
import { Platform } from 'react-native'

export const STORE = Platform.select({
  ios: {
    /** Where the charge lands. */
    account: 'Apple ID',
    /** The storefront's name. */
    name: 'App Store',
    /** Where the user cancels, phrased to drop into a sentence. */
    manage: 'your App Store settings',
  },
  default: {
    account: 'Google Play account',
    name: 'Google Play',
    manage: 'your Google Play subscriptions',
  },
})

/** The renewal disclosure both stores require, in that store's own language. */
export function billingDisclosure(): string {
  return `Payment is charged to your ${STORE.account}. Subscriptions renew automatically `
    + `unless cancelled at least 24 hours before the period ends. Manage or cancel in `
    + `${STORE.manage}.`
}
