// Tempo — the Tempo Pro paywall (custom, on-brand, dynamic pricing).
//
// Prices, trial, and which plans exist are read LIVE from the RevenueCat "current"
// offering (lib/purchases.getProOffering) — nothing here is hardcoded, so changing
// price or swapping the offering in the dashboard reflects instantly with no build.
// Only the layout ships in the binary (and even that updates via `eas update`).
//
// Dormant-safe: this screen is only ever reached when a feature is `locked`
// (proEnabled && !isPro) or the user opens it from a live Pro entry point.
//
// §25 rebuild (2026-07-22): the old version described the product to someone who
// had already used it — a generic hero, a 6-row icon list, and a 9-row compare
// table before ever getting to a price. This version leads with the user's own
// data, shows the wedge with one animated visual instead of describing it, and
// collapses everything else so the price is reached in one scroll, not five.
//
// §26 carousel (2026-07-22, founder request): the benefit stack became a SWIPEABLE
// deck — one value prop per page, each with its own drawn visual, paged dots, and
// a slow auto-advance that stops permanently the moment the user touches it. Two
// reasons this beats the vertical stack it replaces: (a) every feature gets a
// full-width moment instead of competing for the same glance, and (b) the price
// moves above the fold, because six benefits now occupy one card's height instead
// of six. Slides are generated FROM `PAYWALL_POINTS` — that stays the single
// source of truth for "only sell what actually ships today", so a slide can never
// advertise a feature the app doesn't have (an App Store rejection reason).
// The personalized scheduling-impact number is preserved as the FIRST slide's
// headline rather than a separate hero, so it's still the first thing read.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, AppState,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import type { PurchasesPackage } from 'react-native-purchases'
import { Palettes, Spacing, Radius, Elevation } from '@/constants/theme'
import { BRAND_NAME } from '@/constants/brand'
import type { Palette } from '@/theme'
import { ScreenHeader, DismissButton, TempoPulse } from '@/components/brand'
import { PressableScale, FadeInView, PopIn } from '@/components/motion'
import { PAYWALL_POINTS, type IoniconName } from '@/lib/proFeatures'
import {
  loadProPlans, purchaseProPackage, restorePurchases, introOffer, checkIntroEligibility,
  type IntroOffer, type IntroEligibilityReason, type ProPlans, type PlansUnavailableReason,
} from '@/lib/purchases'
import { billingDisclosure, STORE } from '@/lib/storeCopy'
import { useEntitlementStore } from '@/stores/entitlements'
import { track } from '@/lib/analytics'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { fetchSchedulingImpact, type SchedulingImpact } from '@/lib/schedulingImpact'
import { fetchFoundingOfferEndsAt } from '@/lib/proConfig'

type PlanKey = 'annual' | 'monthly'

// What to tell the user when no plan could be resolved. Only the reachability
// case is actionable by them; every other cause is a store/dashboard problem on
// our side, so the copy says "right now" rather than blaming their connection —
// but the real reason still reaches us via the paywall_plans_unavailable event.
function unavailableMessage(reason: PlansUnavailableReason | null): string {
  if (reason === 'fetch_error') {
    return `We couldn’t reach the ${STORE.name}. Check your connection and try again — if you already subscribed, tap Restore below.`
  }
  return 'Subscriptions aren’t available right now. Try again in a moment — if you already subscribed, tap Restore below.'
}

// Always dark, regardless of the app's own light/dark setting — the cheapest
// reliable "this is the premium room" signal, and it never touches the global
// theme store (Palettes.dark is a plain constant object), so no other screen
// is affected. See §25.2.
const C: Palette = Palettes.dark

// What's actually gated today (proFeatures.ts / proLimits.ts) — the free app is
// fully functional; Pro adds foresight + automation + depth on top. The
// "Advanced analytics" row is deliberately NOT here: Free already has it, and a
// row where Free shows a checkmark is an argument against paying, printed on
// the purchase screen.
// `pro` overrides the default "∞" shown for a string free-value — right for a
// creation cap ("1 plan" → "∞"), wrong for a time-window row like the
// calendar-fit one, where the honest Pro value is "Every week," not infinity.
const COMPARE: { label: string; free: string | boolean; pro?: string }[] = [
  { label: 'Auto-scheduled workout plan', free: true },
  { label: 'Unlimited logging', free: true },
  // 2026-08-02: split out of the old "Unlimited logging & full history" row —
  // logging itself has no cap on either tier, but training history is now
  // genuinely tiered (lib/historyHorizon.ts), so a single "free: true" row
  // would have been an outright false claim the moment that gate shipped.
  { label: 'Training history', free: '4 months', pro: 'Unlimited' },
  { label: 'Full 1,300+ exercise library', free: true },
  { label: 'Auto-fit around your calendar', free: 'This week', pro: 'Every week' },
  { label: 'Custom plans', free: '1' },
  { label: 'Custom workouts & exercises', free: '5 each' },
  { label: 'Auto-move on a calendar conflict', free: false },
  { label: 'Multi-calendar & travel mode', free: false },
  // 'Premium themes & app icons' REMOVED 2026-07-22 — `premium_personalization` has no
  // implementation (no theme picker, no alternate icons, no call site). A compare-table
  // row promising it on the purchase screen is an App Store rejection risk and, worse,
  // something a paying user would notice missing on day one.
]

const TRUST: { icon: IoniconName; label: string }[] = [
  { icon: 'lock-closed', label: 'Secure' },
  { icon: 'shield-checkmark', label: 'Private' },
  { icon: 'close-circle', label: 'No ads' },
  { icon: 'refresh', label: 'Cancel anytime' },
]

// The trial length in DAYS (for the "how your trial works" timeline). Normalizes
// whatever unit the store reports (a 7-day trial can come back as 1 WEEK or 7 DAY).
function daysOf(offer: IntroOffer): number {
  const n = offer.periodNumberOfUnits || 0
  const unit = offer.periodUnit.toUpperCase()
  if (unit.includes('WEEK')) return n * 7
  if (unit.includes('MONTH')) return n * 30
  if (unit.includes('YEAR')) return n * 365
  return n
}

function foundingEndsLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

export default function PaywallScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ context?: string }>()
  const context = params.context ?? 'unknown'
  const setIsPro = useEntitlementStore((s) => s.setIsPro)
  const userId = useAuthStore((s) => s.session?.user.id) ?? ''

  const [plans, setPlans] = useState<ProPlans | null>(null)
  const [eligibility, setEligibility] = useState<Record<string, IntroEligibilityReason>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PlanKey>('annual')
  const [busy, setBusy] = useState(false)
  const [impact, setImpact] = useState<SchedulingImpact | null>(null)
  const [foundingEndsAt, setFoundingEndsAt] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)

  // ── Feature carousel state ──────────────────────────────────────────────────
  // `pageW` is measured via onLayout rather than derived from window width minus
  // padding: paging only lines up if the page width EXACTLY matches the scroll
  // view's, and measuring is immune to future padding changes.
  const [page, setPage] = useState(0)
  const [pageW, setPageW] = useState(0)
  const carouselRef = useRef<ScrollView>(null)
  // Auto-advance is a courtesy, not a carousel that fights you: the first touch
  // (swipe OR dot tap) turns it off for the rest of the session.
  const autoAdvance = useRef(true)

  // Personalized proof: how many workouts Tempo has already planned + scheduled for
  // this user. The single most persuasive element on the screen, so it leads the
  // hero rather than sitting below the fold — shown from the first real workout
  // (not held back for an arbitrary "3 scheduled" threshold).
  useEffect(() => {
    if (!userId) return
    fetchSchedulingImpact(supabase, userId).then(setImpact).catch(() => {})
  }, [userId])

  useEffect(() => {
    fetchFoundingOfferEndsAt(supabase).then(setFoundingEndsAt).catch(() => {})
  }, [])

  // Loading the plans is a named, repeatable operation rather than a one-shot
  // effect body, because it now has to be re-runnable: from the "Try again"
  // button in the unavailable state, and automatically when the app comes back
  // to the foreground (the founder's most likely recovery — background the app,
  // fix the connection or the store state, come back). Previously a single
  // failed fetch left the screen permanently dead until it was closed and
  // reopened, which is how a transient blip turned into "monetization is broken".
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])

  // Mirrors for the foreground listener below: it is registered once (so it
  // isn't torn down and re-added on every render) and would otherwise close
  // over the first render's state forever.
  const plansRef = useRef<ProPlans | null>(null)
  const busyRef = useRef(false)
  useEffect(() => { plansRef.current = plans }, [plans])
  useEffect(() => { busyRef.current = busy }, [busy])

  const load = useCallback(async (isRetry: boolean) => {
    setLoading(true)
    const p = await loadProPlans()
    if (cancelledRef.current) return
    setPlans(p)
    // Default to annual when it exists (best value), else monthly.
    setSelected(p.annual ? 'annual' : 'monthly')
    // Gate intro/trial pricing on real eligibility before ever painting it —
    // see checkIntroEligibility's doc comment. Held in the same loading gate
    // as the offering fetch so the price never flashes $24.99 then $35.
    const ids = [p.annual, p.monthly].filter((x): x is PurchasesPackage => !!x).map((x) => x.product.identifier)
    const elig = await checkIntroEligibility(ids)
    if (cancelledRef.current) return
    setEligibility(elig)
    setLoading(false)

    if (p.reason) {
      // Nothing to buy. Say WHY, remotely — this is the event that makes the
      // difference between "monetization is broken" and a one-line diagnosis.
      track('paywall_plans_unavailable', {
        reason: p.reason,
        offering_id: p.offeringId ?? undefined,
        package_count: p.packageCount,
        retry: isRetry,
      })
      return
    }
    // Report WHY the annual offer is (or isn't) being advertised. Founder-
    // reported 2026-08-18 that "the year deal doesn't show" — without this,
    // answering that needs a physical device, because "already used it",
    // "the offer no longer exists", and "the store couldn't say" all look
    // identical from the outside and have completely different fixes.
    const annualId = p.annual?.product.identifier
    track('paywall_intro_offer', {
      plan: 'annual',
      reason: annualId ? (elig[annualId] ?? 'unknown') : 'no_package',
      // Whether the product carries an intro offer at all, independent of who
      // is asking — separates "offer removed in App Store Connect" from "this
      // Apple ID is not eligible for it".
      offer_exists: !!p.annual?.product.introPrice,
    })
  }, [])

  useEffect(() => { void load(false) }, [load])

  // Retry on foreground, but only while there is still nothing to buy — a
  // resolved paywall must never re-fetch behind the user (it would reset the
  // selected plan mid-decision, and a foreground event also fires when the
  // native purchase sheet closes).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && plansRef.current?.reason && !busyRef.current) void load(true)
    })
    return () => sub.remove()
  }, [load])

  const annualPkg = plans?.annual ?? null
  const monthlyPkg = plans?.monthly ?? null
  const selectedPkg = selected === 'annual' ? annualPkg : monthlyPkg
  const hasPlans = !!(annualPkg || monthlyPkg)

  // Only ever surface an intro/trial price for a package the user is actually
  // eligible for — an existing `introPrice` describes the offer, not whether
  // THIS purchase will honor it.
  //
  // Fixed 2026-08-18: this tested `!== 'ineligible'`, which fails OPEN — any id
  // missing from the map (the empty initial state, an id the store didn't return,
  // an unresolved status) counted as eligible and advertised a discount the store
  // may not honor. That is precisely the bug this gate exists to prevent, so it
  // now requires a positively confirmed 'eligible'.
  const introOfferIfEligible = (pkg: PurchasesPackage | null): IntroOffer | null =>
    pkg && eligibility[pkg.product.identifier] === 'eligible' ? introOffer(pkg) : null

  const annualIntro = introOfferIfEligible(annualPkg)
  const selectedIntro = introOfferIfEligible(selectedPkg)
  const hasFreeTrial = !!selectedIntro?.isFree
  const hasPaidIntro = !!selectedIntro && !selectedIntro.isFree

  // Savings badge: a paid intro on annual compares against the EFFECTIVE first-
  // year cost, not the list price — $19.99 vs 12×$4.99 is 67% off, a materially
  // stronger (and honest) number than list-vs-list, which is what this used to
  // compute unconditionally.
  const savingsPct = useMemo(() => {
    if (!annualPkg || !monthlyPkg || monthlyPkg.product.price <= 0) return null
    const annualEffective = annualIntro && !annualIntro.isFree ? annualIntro.price : annualPkg.product.price
    return Math.round((1 - annualEffective / (monthlyPkg.product.price * 12)) * 100)
  }, [annualPkg, monthlyPkg, annualIntro])

  const trialDays = hasFreeTrial && selectedIntro ? daysOf(selectedIntro) : null

  const close = () => {
    track('paywall_dismissed', { context })
    router.back()
  }

  const onPurchase = async () => {
    if (!selectedPkg || busy) return
    setBusy(true)
    track('purchase_started', { plan: selected, context })
    const res = await purchaseProPackage(selectedPkg)
    setBusy(false)
    if (res.cancelled) {
      track('purchase_failed', { plan: selected, reason: 'cancelled' })
      return
    }
    if (res.isPro) {
      setIsPro(true) // unlock gates instantly; the live listener will confirm
      track('purchase_completed', { plan: selected, context })
      router.back()
      return
    }
    track('purchase_failed', { plan: selected, reason: 'error', code: res.code, message: res.message })
    if (res.ok) {
      // The store completed the transaction but the Pro entitlement isn't active
      // on the returned customer info. Telling this user "you were not charged"
      // would be false — and it's the one failure a Restore can actually fix
      // (RevenueCat's receipt sync catching up), so point them at it.
      Alert.alert(
        'Almost there',
        `Your purchase went through, but ${BRAND_NAME} Pro hasn’t unlocked yet. Tap Restore below — if it still doesn’t unlock, contact us and we’ll sort it out.`,
      )
      return
    }
    Alert.alert('Purchase didn’t complete', 'Something went wrong and you were not charged. Please try again.')
  }

  const onRestore = async () => {
    if (busy) return
    setBusy(true)
    const res = await restorePurchases()
    setBusy(false)
    track('restore_completed', { restored: res.isPro })
    if (res.isPro) {
      setIsPro(true)
      // A restore is also the recovery path when plans failed to load, so pull
      // the screen back out of its unavailable state on the way out.
      Alert.alert(`${BRAND_NAME} Pro restored`, 'Your subscription is active again.', [
        { text: 'Great', onPress: () => router.back() },
      ])
    } else if (res.failed) {
      Alert.alert('Couldn’t check your purchases', `We couldn’t reach the ${STORE.name}. Check your connection and try again.`)
    } else {
      Alert.alert('Nothing to restore', `We couldn’t find an active subscription on this ${STORE.account}.`)
    }
  }

  const ctaLabel = hasFreeTrial
    ? 'Start Free Trial'
    : hasPaidIntro && selectedIntro
      ? `Get Pro — ${selectedIntro.priceString} for the Year`
      : `Unlock ${BRAND_NAME} Pro`

  // One slide per shipped value prop. PAYWALL_POINTS decides WHAT may be
  // advertised (never add a slide outside it — see the file header); this only
  // decides how each one is worded and drawn. Slide 0 carries the personalized
  // proof number when the user has one, which is why it isn't a plain map.
  const slides = useMemo(() => {
    const n = impact?.scheduledByTempo ?? 0
    return PAYWALL_POINTS.map((p, i) => (
      i === 0 && n >= 1
        ? {
            key: p.title,
            icon: p.icon,
            title: `${BRAND_NAME} has already scheduled ${n} workout${n === 1 ? '' : 's'} around your real life.`,
            body: 'Keep it doing that automatically — every week ahead, not just this one.',
          }
        : { key: p.title, icon: p.icon, title: p.title, body: p.benefit }
    ))
  }, [impact])

  // Mirrors `page` for the auto-advance timer: reading state inside a long-lived
  // interval would close over the value from the render that created it.
  const pageRef = useRef(0)
  useEffect(() => { pageRef.current = page }, [page])

  useEffect(() => {
    if (!pageW || slides.length < 2) return
    const id = setInterval(() => {
      if (!autoAdvance.current) return
      const next = (pageRef.current + 1) % slides.length
      carouselRef.current?.scrollTo({ x: next * pageW, animated: true })
      setPage(next)
    }, 4500)
    return () => clearInterval(id)
  }, [pageW, slides.length])

  // Which value prop people actually dwell on — the input that eventually tells us
  // whether the scheduling wedge or the depth features are what sells Pro.
  useEffect(() => {
    const s = slides[page]
    if (s) track('paywall_slide_viewed', { slide: s.key, index: page })
  }, [page, slides])

  const goToPage = (i: number) => {
    autoAdvance.current = false // an explicit dot tap always wins over the timer
    if (!pageW) return
    carouselRef.current?.scrollTo({ x: i * pageW, animated: true })
    setPage(i)
  }

  const onCarouselScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!pageW) return
    const i = Math.round(e.nativeEvent.contentOffset.x / pageW)
    if (i >= 0 && i < slides.length && i !== page) setPage(i)
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title={`${BRAND_NAME} Pro`}
        size="sm"
        leading={<DismissButton kind="x" onPress={close} label="Close" />}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Wordmark — the "premium room" marker, kept small so the deck leads. */}
        <FadeInView style={styles.brandRow} delay={20}>
          <View style={styles.heroGlow} pointerEvents="none" />
          <TempoPulse size={22} />
          <Text style={styles.brandWord}>{BRAND_NAME.toUpperCase()}</Text>
          <View style={styles.brandPro}><Text style={styles.brandProText}>PRO</Text></View>
        </FadeInView>

        {/* The swipeable feature deck. */}
        <PopIn delay={120}>
          <View onLayout={(e) => setPageW(e.nativeEvent.layout.width)}>
            <ScrollView
              ref={carouselRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onTouchStart={() => { autoAdvance.current = false }}
              onMomentumScrollEnd={onCarouselScrollEnd}
              scrollEventThrottle={16}
              accessibilityRole="adjustable"
              accessibilityLabel={`${BRAND_NAME} Pro features`}
            >
              {slides.map((s) => (
                <View key={s.key} style={[styles.slide, { width: pageW }]}>
                  <View style={styles.slideVisual}>
                    <SlideVisual icon={s.icon} />
                  </View>
                  <Text style={styles.slideTitle}>{s.title}</Text>
                  <Text style={styles.slideBody}>{s.body}</Text>
                </View>
              ))}
            </ScrollView>
          </View>

          {/* Dots — tappable, and sized generously enough to actually hit. */}
          <View style={styles.dots}>
            {slides.map((s, i) => (
              <TouchableOpacity
                key={s.key}
                onPress={() => goToPage(i)}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel={`Show ${s.key}`}
                accessibilityState={{ selected: i === page }}
              >
                <View style={[styles.dot, i === page && styles.dotOn]} />
              </TouchableOpacity>
            ))}
          </View>
        </PopIn>

        {/* Founding-price banner — only while a real, unexpired offer exists. */}
        {foundingEndsAt && hasPaidIntro && (
          <View style={styles.foundingBanner}>
            <Ionicons name="time-outline" size={15} color={C.gold} />
            <Text style={styles.foundingBannerText}>Founding price ends {foundingEndsLabel(foundingEndsAt)}</Text>
          </View>
        )}

        {/* Plans */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={C.primary} />
            <Text style={styles.loadingText}>Loading plans…</Text>
          </View>
        ) : !hasPlans ? (
          <View style={styles.loadingBox}>
            <Ionicons
              name={plans?.reason === 'fetch_error' ? 'cloud-offline-outline' : 'card-outline'}
              size={22}
              color={C.textSecondary}
            />
            {/* The retry lives on the sticky footer button, not here — see the comment
                there. An inline button in this block is invisible whenever the
                message lands near the fold, which is exactly how it shipped. */}
            <Text style={styles.loadingText}>{unavailableMessage(plans?.reason ?? null)}</Text>
          </View>
        ) : (
          // Side-by-side cards: the two prices are compared against each other, so
          // they belong on one line where the eye can do that in a single glance.
          // `flex: 1` per card means adding a third package (lifetime) later needs
          // no layout change.
          <View style={styles.plansRow}>
            {annualPkg && (
              <PlanCard
                label="Annual"
                price={annualIntro && !annualIntro.isFree ? annualIntro.priceString : annualPkg.product.priceString}
                strikePrice={annualIntro && !annualIntro.isFree ? annualPkg.product.priceString : undefined}
                subline={
                  annualIntro && !annualIntro.isFree
                    ? `first year, then ${annualPkg.product.priceString}/yr`
                    : annualPkg.product.pricePerMonthString
                      ? `only ${annualPkg.product.pricePerMonthString}/mo, billed yearly`
                      : 'Billed yearly'
                }
                badge={
                  annualIntro && !annualIntro.isFree ? 'FOUNDING PRICE'
                    : savingsPct && savingsPct > 0 ? `SAVE ${savingsPct}%`
                    : 'BEST VALUE'
                }
                selected={selected === 'annual'}
                onPress={() => setSelected('annual')}
              />
            )}
            {monthlyPkg && (
              <PlanCard
                label="Monthly"
                price={monthlyPkg.product.priceString}
                subline="Flexible month-to-month"
                selected={selected === 'monthly'}
                onPress={() => setSelected('monthly')}
              />
            )}
          </View>
        )}

        {/* What you pay / trial timeline — offer-aware, never both at once. */}
        {hasFreeTrial && trialDays ? (
          <View style={styles.timelineCard}>
            <Text style={styles.timelineHead}>How your {trialDays}-day free trial works</Text>
            <TimelineRow icon="lock-open" title="Today" body="Unlock everything in Pro — instantly." />
            {trialDays > 2 && (
              <TimelineRow
                icon="notifications-outline"
                title={`Day ${trialDays - 2}`}
                body="We'll remind you before your trial ends."
              />
            )}
            <TimelineRow
              icon="star"
              title={`Day ${trialDays}`}
              body={`Your plan begins${selectedPkg?.product.priceString ? ` (${selectedPkg.product.priceString}${selected === 'annual' ? '/yr' : '/mo'})` : ''} — cancel anytime before.`}
              last
            />
          </View>
        ) : hasPaidIntro && selectedIntro ? (
          <View style={styles.timelineCard}>
            <Text style={styles.timelineHead}>What you pay</Text>
            <TimelineRow icon="today-outline" title="Today" body={`${selectedIntro.priceString}, everything unlocked for a year.`} />
            <TimelineRow
              icon="refresh-outline"
              title="In 12 months"
              body={`Renews at ${selectedPkg?.product.priceString}/yr — cancel anytime before.`}
              last
            />
          </View>
        ) : null}

        {/* Compare, collapsed — closed by default; the full free/Pro line for
            anyone who wants to check, not the primary sales surface. */}
        <TouchableOpacity
          style={styles.compareToggle}
          onPress={() => setCompareOpen((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Compare free and Pro"
          accessibilityState={{ expanded: compareOpen }}
        >
          <Text style={styles.compareToggleText}>Compare free and Pro</Text>
          <Ionicons name={compareOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSecondary} />
        </TouchableOpacity>
        {compareOpen && (
          <View style={styles.compareCard}>
            <View style={styles.compareHead}>
              <Text style={styles.compareHeadLabel}>What you get</Text>
              <Text style={styles.compareCol}>Free</Text>
              <Text style={[styles.compareCol, styles.compareColPro]}>Pro</Text>
            </View>
            {COMPARE.map((row, i) => (
              <View key={i} style={[styles.compareRow, i > 0 && styles.compareRowDivider]}>
                <Text style={styles.compareLabel}>{row.label}</Text>
                <View style={styles.compareCell}>
                  {typeof row.free === 'string'
                    ? <Text style={styles.compareFreeVal}>{row.free}</Text>
                    : row.free
                      ? <Ionicons name="checkmark" size={16} color={C.textSecondary} />
                      : <Ionicons name="remove" size={16} color={C.outlineVariant} />}
                </View>
                <View style={styles.compareCell}>
                  {typeof row.free === 'string'
                    ? row.pro
                      ? <Text style={styles.compareProValText}>{row.pro}</Text>
                      : <Text style={styles.compareProVal}>∞</Text>
                    : <Ionicons name="checkmark-circle" size={18} color={C.primary} />}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Trust indicators */}
        <View style={styles.trustRow}>
          {TRUST.map((t) => (
            <View key={t.label} style={styles.trustItem}>
              <Ionicons name={t.icon} size={15} color={C.success} />
              <Text style={styles.trustText}>{t.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Sticky CTA footer */}
      {/* `loading` gates this too (2026-08-18, founder-reported: "for a second it
          flashed Get Pro 25 which shouldn't happen, then it said unlock arclo
          pro"). The plans block above was already behind the loading gate, but
          this footer was not — so the moment the offering resolved it rendered a
          price-bearing label while eligibility was still unknown, then corrected
          itself a tick later. It was also tappable in that window, i.e. a purchase
          could start before we knew which price the store would actually charge. */}
      {/* When there are no plans, this button RETRIES rather than sitting disabled.
          Founder screenshot 2026-08-19: the unavailable state's own inline "Try
          again" button had been pushed below the fold by this very footer, so the
          only control visible on the screen was a dead greyed-out one — a dead end
          that looks like a broken app. The sticky footer is the one thing here that
          is always on screen, so the recovery action belongs in it. */}
      <View style={styles.footer}>
        <PressableScale
          style={[styles.cta, (busy || loading) && styles.ctaDisabled]}
          onPress={hasPlans ? onPurchase : () => void load(true)}
          disabled={busy || loading}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={loading ? 'Loading plans' : hasPlans ? ctaLabel : 'Try loading plans again'}
          accessibilityState={{ disabled: busy || loading, busy: busy || loading }}
        >
          {busy || loading ? (
            <ActivityIndicator color="#fff" />
          ) : hasPlans ? (
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          ) : (
            <View style={styles.ctaRetryRow}>
              <Ionicons name="refresh" size={17} color="#fff" />
              <Text style={styles.ctaText}>Try again</Text>
            </View>
          )}
        </PressableScale>

        <View style={styles.footerLinks}>
          <Text
            style={styles.footerLink}
            onPress={onRestore}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
          >
            Restore
          </Text>
          <Text style={styles.footerDot}>·</Text>
          <Text
            style={styles.footerLink}
            onPress={() => router.push({ pathname: '/legal', params: { section: 'terms' } })}
            accessibilityRole="button"
            accessibilityLabel="Terms of Service"
          >
            Terms
          </Text>
          <Text style={styles.footerDot}>·</Text>
          <Text
            style={styles.footerLink}
            onPress={() => router.push({ pathname: '/legal', params: { section: 'privacy' } })}
            accessibilityRole="button"
            accessibilityLabel="Privacy Policy"
          >
            Privacy
          </Text>
        </View>
        <Text style={styles.finePrint}>{billingDisclosure()}</Text>
      </View>
    </SafeAreaView>
  )
}

// A seven-day strip: grey blocks are "real life", the primary-tinted block is
// where Tempo fit training into a gap. Static content (a representative week,
// not the user's literal calendar — no extra fetch, no risk of showing empty
// days for a thin account) with one entrance animation, matching §25's ask for
// something that SHOWS the product rather than another paragraph describing it.
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
// Each day: how "busy" the block reads (0-1) + whether a workout landed in the gap.
const DAY_PATTERN: { busy: number; workout: boolean }[] = [
  { busy: 0.55, workout: true }, { busy: 0.7, workout: false }, { busy: 0.35, workout: true },
  { busy: 0.6, workout: false }, { busy: 0.75, workout: true }, { busy: 0.2, workout: false },
  { busy: 0.15, workout: true },
]

// `pattern` / `height` are additive props with the original values as defaults, so
// the strip can be reused at a smaller size on the "reschedule my week" slide
// without a second copy of the drawing code.
function WeekStrip({ pattern = DAY_PATTERN, height = 100 }: { pattern?: typeof DAY_PATTERN; height?: number } = {}) {
  return (
    <View style={[weekStyles.row, { height }]}>
      {pattern.map((d, i) => (
        <View key={i} style={weekStyles.col}>
          <View style={weekStyles.track}>
            <View style={[weekStyles.busyBlock, { height: `${d.busy * 100}%` }]} />
            {d.workout && (
              <View style={[weekStyles.workoutBlock, { bottom: `${d.busy * 100 + 4}%` }]} />
            )}
          </View>
          <Text style={weekStyles.label}>{DAY_LABELS[i]}</Text>
        </View>
      ))}
    </View>
  )
}

// ── Slide visuals ─────────────────────────────────────────────────────────────
// One drawing per value prop, keyed off the point's own icon so the deck stays
// generated from PAYWALL_POINTS rather than a parallel hand-maintained list.
// All of these are plain Views + Ionicons on purpose: no image assets to ship, no
// SVG parsing, nothing to fail to load on a cold first paint of the purchase screen.
function SlideVisual({ icon }: { icon: IoniconName }) {
  switch (icon) {
    case 'shuffle': return <ConflictMoveVisual />
    case 'repeat': return <ReplanVisual />
    case 'airplane': return <TravelVisual />
    case 'body': return <MuscleVisual />
    case 'sparkles': return <UnlimitedVisual />
    case 'infinite':
    default: return <WeekStrip />
  }
}

// Auto-reschedule: the same evening, before and after Tempo moves the session.
function ConflictMoveVisual() {
  return (
    <View style={vis.row2}>
      <View style={vis.miniCard}>
        <Text style={vis.miniLabel}>Conflict</Text>
        <View style={[vis.block, vis.blockBusy]}><Text style={vis.blockText}>Meeting</Text></View>
        <View style={[vis.block, vis.blockClash]}><Text style={vis.blockText}>Workout</Text></View>
      </View>
      <Ionicons name="arrow-forward" size={16} color={C.primary} />
      <View style={vis.miniCard}>
        <Text style={vis.miniLabelOn}>Auto-moved</Text>
        <View style={[vis.block, vis.blockBusy]}><Text style={vis.blockText}>Meeting</Text></View>
        <View style={[vis.block, vis.blockGo]}><Text style={vis.blockTextOn}>Workout</Text></View>
      </View>
    </View>
  )
}

// Reschedule-my-week: the same seven days, re-laid around a busy stretch.
const REPLAN_PATTERN: typeof DAY_PATTERN = [
  { busy: 0.8, workout: false }, { busy: 0.85, workout: false }, { busy: 0.75, workout: false },
  { busy: 0.3, workout: true }, { busy: 0.25, workout: true }, { busy: 0.15, workout: true },
  { busy: 0.2, workout: true },
]
function ReplanVisual() {
  return (
    <View style={vis.center}>
      <WeekStrip pattern={REPLAN_PATTERN} height={78} />
      <View style={vis.pill}>
        <Ionicons name="repeat" size={13} color={C.primary} />
        <Text style={vis.pillText}>Whole week, one tap</Text>
      </View>
    </View>
  )
}

const TRAVEL_KIT = ['Dumbbells', 'Bands', 'Bodyweight', 'Bench']
function TravelVisual() {
  return (
    <View style={vis.center}>
      <View style={vis.orb}><Ionicons name="airplane" size={26} color={C.primary} /></View>
      <View style={vis.chipWrap}>
        {TRAVEL_KIT.map((k) => (
          <View key={k} style={vis.chip}>
            <Ionicons name="checkmark" size={11} color={C.success} />
            <Text style={vis.chipText}>{k}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// Muscle intelligence: balance at a glance. The two low bars read gold — that's
// the "weak point" the feature exists to surface.
const MUSCLES: { name: string; fill: number }[] = [
  { name: 'Back', fill: 0.92 }, { name: 'Chest', fill: 0.78 },
  { name: 'Quads', fill: 0.64 }, { name: 'Arms', fill: 0.7 },
  { name: 'Delts', fill: 0.34 }, { name: 'Core', fill: 0.28 },
]
function MuscleVisual() {
  return (
    <View style={vis.muscleWrap}>
      {MUSCLES.map((m) => (
        <View key={m.name} style={vis.muscleItem}>
          <Text style={vis.muscleName}>{m.name}</Text>
          <View style={vis.muscleTrack}>
            <View
              style={[
                vis.muscleFill,
                { width: `${m.fill * 100}%`, backgroundColor: m.fill < 0.4 ? C.gold : C.primary },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  )
}

function UnlimitedVisual() {
  return (
    <View style={vis.center}>
      <View style={vis.stackWrap}>
        <View style={[vis.stackCard, { transform: [{ rotate: '-7deg' }], opacity: 0.3 }]} />
        <View style={[vis.stackCard, { transform: [{ rotate: '5deg' }], opacity: 0.55 }]} />
        <View style={[vis.stackCard, vis.stackTop]}>
          <Text style={vis.infinity}>∞</Text>
        </View>
      </View>
      <Text style={vis.stackCaption}>Plans · Workouts · Exercises</Text>
    </View>
  )
}

const vis = StyleSheet.create({
  center: { width: '100%', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },

  row2: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  miniCard: {
    flex: 1, maxWidth: 128, gap: 5, padding: Spacing.sm,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant,
  },
  miniLabel: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: C.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  miniLabelOn: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: C.primary, letterSpacing: 0.5, textTransform: 'uppercase' },
  block: { borderRadius: Radius.sm, paddingVertical: 7, paddingHorizontal: 8 },
  blockBusy: { backgroundColor: 'rgba(255,255,255,0.12)' },
  blockClash: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: C.gold, borderStyle: 'dashed' },
  blockGo: { backgroundColor: C.primary },
  blockText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary },
  blockTextOn: { fontFamily: 'Inter_700Bold', fontSize: 11, color: '#fff' },

  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primarySoft, borderRadius: Radius.full, paddingHorizontal: 11, paddingVertical: 5,
  },
  pillText: { fontFamily: 'Inter_700Bold', fontSize: 11.5, color: C.primary },

  orb: { width: 58, height: 58, borderRadius: Radius.full, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: C.outlineVariant,
  },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.text },

  muscleWrap: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.xs },
  muscleItem: { width: '47%', gap: 5 },
  muscleName: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary },
  muscleTrack: { height: 7, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  muscleFill: { height: '100%', borderRadius: Radius.full },

  stackWrap: { width: 108, height: 86, alignItems: 'center', justifyContent: 'center' },
  stackCard: {
    position: 'absolute', width: 82, height: 78, borderRadius: Radius.lg,
    backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.outlineVariant,
  },
  stackTop: { backgroundColor: C.primarySoft, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  infinity: { fontFamily: 'Inter_800ExtraBold', fontSize: 36, color: C.primary, lineHeight: 42 },
  stackCaption: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary },
})

const weekStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', gap: 6, height: '100%' },
  track: { width: '100%', flex: 1, borderRadius: 6, overflow: 'visible', justifyContent: 'flex-end', position: 'relative' },
  busyBlock: { width: '100%', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 6 },
  workoutBlock: { position: 'absolute', width: '100%', height: 14, backgroundColor: C.primary, borderRadius: 6 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 10.5, color: C.textSecondary },
})

// A single plan tile. Same data and the same a11y contract as the row it replaced
// (radio role, spoken price + subline, selected state) — only the layout changed.
function PlanCard({
  label, price, strikePrice, subline, badge, selected, onPress,
}: {
  label: string; price: string; strikePrice?: string; subline: string; badge?: string; selected: boolean; onPress: () => void
}) {
  return (
    <PressableScale
      style={[styles.plan, selected && styles.planSelected]}
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityLabel={`${label} plan, ${strikePrice ? `${price}, was ${strikePrice}` : price}${subline ? `, ${subline}` : ''}`}
      accessibilityState={{ selected }}
    >
      {badge && (
        <View style={styles.planBadge}>
          <Text style={styles.planBadgeText}>{badge}</Text>
        </View>
      )}
      <View style={styles.planTop}>
        <Text style={styles.planLabel}>{label}</Text>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected && <Ionicons name="checkmark" size={12} color="#fff" />}
        </View>
      </View>
      {strikePrice && <Text style={styles.planPriceStrike}>{strikePrice}</Text>}
      <Text style={styles.planPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{price}</Text>
      <Text style={styles.planSubline}>{subline}</Text>
    </PressableScale>
  )
}

function TimelineRow({ icon, title, body, last }: { icon: IoniconName; title: string; body: string; last?: boolean }) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={styles.timelineDot}>
          <Ionicons name={icon} size={15} color={C.primary} />
        </View>
        {!last && <View style={styles.timelineLine} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : Spacing.md }}>
        <Text style={styles.timelineRowTitle}>{title}</Text>
        <Text style={styles.timelineRowBody}>{body}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, paddingBottom: Spacing.lg, gap: Spacing.lg },

  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingTop: 2 },
  brandWord: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: 1.5 },
  brandPro: { backgroundColor: C.gold, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
  brandProText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, color: '#1b1400', letterSpacing: 0.8 },
  // Resized for the compact brand row (was 220px behind a 200px-tall hero). At the
  // old size this translucent disc would spill a hard blue edge across the top of
  // the slide card; at 170 it reads as a halo behind the wordmark and bleeds up
  // under the header instead of down over the deck.
  heroGlow: { position: 'absolute', top: -70, left: '50%', width: 170, height: 170, borderRadius: 85, marginLeft: -85, backgroundColor: C.primaryGlow },

  // Every slide is the same height so the dots and the price below never jump as
  // the deck advances — a shifting purchase screen reads as broken.
  slide: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xs },
  slideVisual: {
    width: '100%', height: 152, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.md, ...Elevation.e1,
  },
  // minHeight on both text blocks keeps a 1-line title from sitting at a different
  // vertical position than the personalized 2–3 line one as you swipe between them.
  slideTitle: {
    fontFamily: C.fontDisplay, fontSize: 23, color: C.text, letterSpacing: -0.4,
    textAlign: 'center', lineHeight: 28, marginTop: Spacing.xs, minHeight: 56,
  },
  slideBody: {
    fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary,
    textAlign: 'center', lineHeight: 20, minHeight: 60,
  },

  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: Spacing.sm },
  dot: { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: C.outline },
  dotOn: { width: 20, backgroundColor: C.primary },

  foundingBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(217,161,59,0.14)', borderRadius: Radius.md, paddingVertical: 8,
  },
  foundingBannerText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.gold },

  loadingBox: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg },
  ctaRetryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, textAlign: 'center', lineHeight: 19 },

  // marginTop leaves room for the badge that floats above the annual card.
  plansRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.sm, marginTop: 8 },
  plan: {
    flex: 1, gap: 2,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderWidth: 2, borderColor: 'transparent',
    ...Elevation.e1,
  },
  planSelected: {
    borderColor: C.primary, backgroundColor: C.primarySoft,
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  radio: {
    width: 20, height: 20, borderRadius: Radius.full, borderWidth: 2, borderColor: C.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: C.primary, backgroundColor: C.primary },
  planLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  planSubline: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.textSecondary, lineHeight: 16, marginTop: 2 },
  planPrice: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.4, marginTop: 4 },
  planPriceStrike: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary, textDecorationLine: 'line-through', marginTop: 4 },
  planBadge: {
    position: 'absolute', top: -9, left: Spacing.md, zIndex: 2,
    backgroundColor: C.gold, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 2.5,
  },
  planBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: '#1b1400', letterSpacing: 0.5 },

  timelineCard: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1, padding: Spacing.lg, paddingBottom: Spacing.md },
  timelineHead: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text, marginBottom: Spacing.md },
  timelineRow: { flexDirection: 'row', gap: Spacing.md },
  timelineRail: { alignItems: 'center', width: 32 },
  timelineDot: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  timelineLine: { flex: 1, width: 2, backgroundColor: C.outlineVariant, marginVertical: 2 },
  timelineRowTitle: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.text },
  timelineRowBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18, marginTop: 1 },

  compareToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  compareToggleText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  compareCard: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, ...Elevation.e1, paddingHorizontal: Spacing.md, paddingBottom: Spacing.xs },
  compareHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: C.outlineVariant },
  compareHeadLabel: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, textTransform: 'uppercase' },
  compareCol: { width: 46, textAlign: 'center', fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.4 },
  compareColPro: { color: C.primary },
  compareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm + 1 },
  compareRowDivider: { borderTopWidth: 1, borderTopColor: C.surfaceContainerHigh },
  compareLabel: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13.5, color: C.text },
  compareCell: { width: 46, alignItems: 'center' },
  compareFreeVal: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textSecondary },
  compareProVal: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.primary, lineHeight: 20 },
  compareProValText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, textAlign: 'center', lineHeight: 14 },

  trustRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: Spacing.md, marginTop: 2 },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trustText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },

  footer: { paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: C.outlineVariant },
  cta: { backgroundColor: C.primary, borderRadius: Radius.lg, paddingVertical: Spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 52, ...Elevation.e2 },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#fff', letterSpacing: 0.2 },
  footerLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  footerLink: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary },
  footerDot: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.outline },
  finePrint: { fontFamily: 'Inter_400Regular', fontSize: 10.5, color: C.outline, textAlign: 'center', lineHeight: 15 },
})
