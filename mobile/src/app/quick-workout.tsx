import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native'
import { ScreenHeader, DismissButton, PulseLoader } from '@/components/brand'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router'
import { Spacing, Radius, CardShadow } from '@/constants/theme'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/lib/analytics'
import { PressableScale } from '@/components/motion'
import { TempoLottie } from '@/components/TempoLottie'
import { Slider } from '@/components/Slider'
import { describeSaveError } from '@/lib/saveErrors'
import {
  generateQuickWorkout, persistQuickWorkout, getProfileForQuick,
  getScheduleRestrictions, injuriesToRestrictions,
  goalToPurpose, snapToQuickMinutes, QUICK_DURATIONS, PURPOSE_META, TARGET_AREA_OPTIONS,
  composeRestrictions,
  type QuickMinutes, type QuickPurpose, type QuickWorkout, type ProfileForQuick, type MovementPattern,
  type QuickRestrictions, type TargetAreaOption,
} from '@/lib/quickWorkout'
import { useProGate } from '@/stores/entitlements'
import { ProBadge } from '@/components/ProGate'
import { fetchPresets, savePresets, type EquipmentPreset } from '@/lib/equipmentPresets'
import { EquipmentPresetSheet } from '@/components/EquipmentPresetSheet'
import type { Equipment } from '@/types'
import { BRAND_NAME } from '@/constants/brand'

const PURPOSE_ORDER: QuickPurpose[] = [
  'strength_maintenance', 'muscle_growth', 'conditioning', 'athletic', 'recovery', 'mobility',
]

// Target Area is multi-select (2026-08-02, founder-requested — "users should
// be able to select multiple body parts"): `keys` is the set of active chips.
// Muscle-based keys union their muscle lists into a single hard filter;
// 'cardio' composes with them via targetPattern (a priority nudge WITHIN
// whatever muscle filter is active, not a competing filter) rather than
// needing its own OR-logic. `routePattern` is the passive, route-driven
// "missed leg day" suggestion — it only applies until the user's first
// explicit chip tap (the caller clears it then), matching how the old
// single-select build always let an explicit pick override the passive one.
function computeTargetFromKeys(
  keys: Set<string>,
  routePattern: MovementPattern | undefined,
): { pattern: MovementPattern | undefined; muscles: string[] | undefined; label: string | null } {
  const muscleKeys = [...keys].filter(k => k !== 'cardio')
  const muscles = muscleKeys.length
    ? [...new Set(muscleKeys.flatMap(k => TARGET_AREA_OPTIONS.find(o => o.key === k)?.muscles ?? []))]
    : undefined
  const pattern: MovementPattern | undefined = keys.has('cardio') ? 'cardio' : routePattern
  const labels = [...keys].map(k => TARGET_AREA_OPTIONS.find(o => o.key === k)?.label).filter((l): l is string => !!l)
  const label = labels.length === 0 ? null
    : labels.length === 1 ? labels[0]
    : labels.length === 2 ? `${labels[0]} & ${labels[1]}`
    : `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`
  return { pattern, muscles, label }
}

export default function QuickWorkoutScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const params = useLocalSearchParams<{
    minutes?: string; purpose?: string; targetPattern?: string
    daysSinceTrained?: string; fromCalendarGap?: string
  }>()

  const initialMinutes = (Number(params.minutes) as QuickMinutes) || 15
  const daysSinceTrained = params.daysSinceTrained ? Number(params.daysSinceTrained) : undefined
  const fromCalendarGap = params.fromCalendarGap === '1'

  const [minutes, setMinutes] = useState<QuickMinutes>(
    QUICK_DURATIONS.includes(initialMinutes) ? initialMinutes : 15
  )
  const [purpose, setPurpose] = useState<QuickPurpose | null>(
    (params.purpose as QuickPurpose) || null
  )
  // A missed "leg day" suggestion arrives via route param, pattern-based
  // (e.g. 'squat') — a passive suggestion only, cleared the moment the user
  // makes any explicit Target Area pick (see computeTargetFromKeys above).
  const [routeTargetPattern, setRouteTargetPattern] = useState<MovementPattern | undefined>(
    (params.targetPattern as MovementPattern) || undefined
  )
  // Target Area is multi-select — the set of active chip keys. targetPattern/
  // targetMuscles/targetAreaLabel below are all DERIVED from this (+ the route
  // suggestion), so every existing call site that already used targetPattern/
  // targetMuscles keeps working unchanged.
  const [selectedAreaKeys, setSelectedAreaKeys] = useState<Set<string>>(new Set())
  // Mirrors selectedAreaKeys so a tap always toggles against the LATEST set.
  // Target Area is multi-select, and three quick taps (Chest, Arms, Shoulders)
  // are three separate events: reading `selectedAreaKeys` out of the handler's
  // closure could see a set from before the previous tap had re-rendered, so the
  // third tap regenerated with the wrong muscles. Changing the duration
  // afterwards passed the correctly-derived value and appeared to "fix" it,
  // which is exactly how the founder hit it (2026-09-07).
  const areaKeysRef = useRef<Set<string>>(new Set())
  const { pattern: targetPattern, muscles: targetMuscles, label: targetAreaLabel } = useMemo(
    () => computeTargetFromKeys(selectedAreaKeys, routeTargetPattern),
    [selectedAreaKeys, routeTargetPattern],
  )
  const [workout, setWorkout] = useState<QuickWorkout | null>(null)
  const [generating, setGenerating] = useState(true)
  const [starting, setStarting] = useState(false)
  const [empty, setEmpty] = useState(false)
  // Training style + equipment are real, useful, but not what a beginner needs
  // staring at on open — collapsed by default, auto-opened when a route param
  // already picked a purpose so that choice isn't hidden from the user.
  const [moreOpen, setMoreOpen] = useState(!!params.purpose)
  const profileRef = useRef<ProfileForQuick | null>(null)
  // Cached separately rather than pre-merged: injuries always apply, schedule
  // avoidance only applies when Tempo is the one choosing. See the composition
  // in regenerate() below for why.
  const injuryRestrictionsRef = useRef<QuickRestrictions | null>(null)
  const scheduleRestrictionsRef = useRef<QuickRestrictions | null>(null)
  // Guards against overlapping regenerate() calls resolving out of order — e.g.
  // dragging the duration slider back and forth fires a new regenerate() before
  // an earlier one's Supabase round trip has returned. Without this, whichever
  // call happened to resolve LAST won (not whichever was called last), so a
  // stale result for a duration/target you'd already changed away from could
  // silently overwrite the current one — reported as "picked 30 min, it worked,
  // picked 20, it worked, picked 30 again and got a wrong (all-Core) workout."
  const requestIdRef = useRef(0)

  // ── Equipment presets (Pro): build a session around a saved setup ("Home",
  // "Hotel gym"). Free users can use their default gear; a saved preset's
  // custom-equipment regeneration is the Pro gate (consistent with Travel Mode).
  const { locked } = useProGate()
  const [presets, setPresets] = useState<EquipmentPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [presetSheet, setPresetSheet] = useState<{ open: boolean; edit: EquipmentPreset | null }>({ open: false, edit: null })
  useEffect(() => {
    if (!userId) return
    fetchPresets(supabase, userId).then(setPresets).catch(() => {})
  }, [userId])

  const selectedPreset = selectedPresetId ? presets.find((p) => p.id === selectedPresetId) ?? null : null
  const isCustomEquipment = !!selectedPreset
  const teased = isCustomEquipment && locked && !empty   // ready, but gated behind Pro

  const openPaywall = () => {
    track('paywall_shown', { context: 'quick_equipment' })
    router.push({ pathname: '/paywall', params: { context: 'quick_equipment' } })
  }

  const regenerate = useCallback(async (
    m: QuickMinutes, p: QuickPurpose | null, equipOverride: Equipment[] | null,
    tp: MovementPattern | undefined, tm: string[] | undefined, al: string | null,
    ak: string[],
  ) => {
    if (!userId) return
    const requestId = ++requestIdRef.current
    setGenerating(true)
    setEmpty(false)
    try {
      if (!profileRef.current) {
        profileRef.current = await getProfileForQuick(supabase, userId)
      }
      // A selected preset overrides the profile's equipment for this session.
      const base = profileRef.current
      const profile = equipOverride ? { ...base, equipment: equipOverride } : base
      injuryRestrictionsRef.current ??= injuriesToRestrictions(base.injuries)
      const injuryR = injuryRestrictionsRef.current
      // Schedule awareness — skip what's scheduled soon (don't pre-empt tomorrow's
      // leg day) or was just trained — applies ONLY when the user has not named a
      // Target Area.
      //
      // It is a preference about what Tempo should choose on the user's behalf,
      // and it was being applied as a hard constraint on top of what the user had
      // explicitly asked for. getScheduleRestrictions avoids the patterns of every
      // session from yesterday to +2 days, so someone training most days has push,
      // squat and hinge avoided — and since generateQuickWorkout applies
      // avoidPatterns BEFORE any muscle filter, an explicit "Legs + Arms + Core"
      // request literally could not return a leg exercise. What came back was
      // core plus whatever pattern survived, i.e. the founder's "mostly core and
      // some random exercises" (2026-09-27).
      //
      // Injuries are a genuine constraint and still apply either way.
      const explicitTarget = ak.length > 0
      if (!explicitTarget) {
        scheduleRestrictionsRef.current ??= await getScheduleRestrictions(supabase, userId)
      }
      const restrictions = composeRestrictions(
        injuryR, scheduleRestrictionsRef.current, explicitTarget,
      )
      // If the requested target (e.g. a missed "leg day" route param) is now
      // avoided because it's scheduled soon, drop it.
      const effectiveTarget = tp && restrictions.avoidPatterns.includes(tp) ? undefined : tp
      const effectivePurpose = p ?? goalToPurpose(profile.goal)
      const w = await generateQuickWorkout(
        supabase, userId,
        {
          minutes: m, purpose: effectivePurpose, targetPattern: effectiveTarget,
          targetMuscles: tm, targetAreaKeys: ak, targetAreaLabel: al,
          daysSinceTrained, fromCalendarGap, restrictions,
        },
        profile,
      )
      // A newer regenerate() call started while this one was still in flight —
      // its result (or the newer call's own, once IT resolves) is what the
      // screen should show, not this now-stale one. Drop it silently.
      if (requestId !== requestIdRef.current) return
      setWorkout(w)
      setEmpty(w.exercises.length === 0)
      if (w.exercises.length > 0) {
        track('quick_workout_generated', { minutes: m, purpose: effectivePurpose })
      }
    } catch {
      if (requestId !== requestIdRef.current) return
      setEmpty(true)
    } finally {
      if (requestId === requestIdRef.current) setGenerating(false)
    }
  // daysSinceTrained / fromCalendarGap are stable per-mount params
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Pre-generate on open so a Start button is ready immediately (<10s to start).
  useEffect(() => {
    regenerate(minutes, purpose, null, targetPattern, targetMuscles, targetAreaLabel, [...selectedAreaKeys])
  }, [regenerate]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentEquip = () => selectedPreset?.equipment ?? null
  const handlePickMinutes = (m: QuickMinutes) => {
    setMinutes(m)
    regenerate(m, purpose, currentEquip(), targetPattern, targetMuscles, targetAreaLabel, [...selectedAreaKeys])
  }
  const handlePickPurpose = (p: QuickPurpose) => {
    const next = p === purpose ? null : p
    setPurpose(next)
    regenerate(minutes, next, currentEquip(), targetPattern, targetMuscles, targetAreaLabel, [...selectedAreaKeys])
  }
  // Target Area is multi-select: tapping a chip toggles it in/out of
  // selectedAreaKeys rather than replacing a single selection. "Pick for me"
  // is an explicit reset to Tempo's normal purpose-driven pick, not a filter
  // of its own. Any explicit tap clears the passive route-driven pattern
  // suggestion (a missed "leg day") — an explicit pick always wins.
  const handleToggleTargetArea = (opt: TargetAreaOption) => {
    if (opt.surprise) {
      areaKeysRef.current = new Set()
      setSelectedAreaKeys(new Set())
      setRouteTargetPattern(undefined)
      regenerate(minutes, purpose, currentEquip(), undefined, undefined, null, [])
      return
    }
    setRouteTargetPattern(undefined)
    const next = new Set(areaKeysRef.current)
    if (next.has(opt.key)) next.delete(opt.key)
    else next.add(opt.key)
    areaKeysRef.current = next
    setSelectedAreaKeys(next)
    const { pattern, muscles, label } = computeTargetFromKeys(next, undefined)
    regenerate(minutes, purpose, currentEquip(), pattern, muscles, label, [...next])
  }
  const handlePickPreset = (id: string | null) => {
    setSelectedPresetId(id)
    const pr = id ? presets.find((p) => p.id === id) ?? null : null
    regenerate(minutes, purpose, pr?.equipment ?? null, targetPattern, targetMuscles, targetAreaLabel, [...selectedAreaKeys])
  }
  const handleSavePreset = async (preset: EquipmentPreset) => {
    const next = presets.some((p) => p.id === preset.id)
      ? presets.map((p) => (p.id === preset.id ? preset : p))
      : [...presets, preset]
    setPresets(next)
    setPresetSheet({ open: false, edit: null })
    setSelectedPresetId(preset.id)
    regenerate(minutes, purpose, preset.equipment, targetPattern, targetMuscles, targetAreaLabel, [...selectedAreaKeys])
    await savePresets(supabase, userId, next)
  }
  const handleDeletePreset = async (id: string) => {
    const next = presets.filter((p) => p.id !== id)
    setPresets(next)
    setPresetSheet({ open: false, edit: null })
    if (selectedPresetId === id) { setSelectedPresetId(null); regenerate(minutes, purpose, null, targetPattern, targetMuscles, targetAreaLabel, [...selectedAreaKeys]) }
    await savePresets(supabase, userId, next)
  }

  const handleStart = async () => {
    if (!workout || starting || !workout.exercises.length) return
    if (teased) { openPaywall(); return }  // custom-equipment session is a Pro gate
    setStarting(true)
    let id: string | null = null
    try {
      id = await persistQuickWorkout(supabase, userId, workout)
    } catch (err) {
      setStarting(false)
      const info = describeSaveError(err, 'start your session')
      Alert.alert('Couldn’t start', `${info.message}\n\nYour session is still ready — tap Start again.`)
      return
    }
    if (!id) {
      setStarting(false)
      Alert.alert('Couldn’t start', 'Check your connection and tap Start again — your session is still ready.')
      return
    }
    track('session_start', {
      type: 'quick',
      duration_min: workout.estimatedMinutes,
      purpose: workout.purpose,
    })
    router.replace({ pathname: '/(tabs)/plan', params: { workoutId: id, quick: '1' } })
  }

  if (!session) return <Redirect href="/sign-in" />

  const activePurpose = workout?.purpose ?? purpose ?? 'muscle_growth'

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Quick Workout"
        size="sm"
        leading={<DismissButton kind="x" onPress={() => router.back()} label="Close" />}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <TempoLottie source={require('@/assets/lottie/coach/walking.json')} width={46} height={82} style={styles.coachWalking} />
        <Text style={styles.lead}>How much time do you have?</Text>
        <Text style={styles.leadSub}>
          No setup. {BRAND_NAME} builds the highest-impact session for your window and goal.
        </Text>

        {/* Duration — one slider instead of eight separate buttons */}
        <View style={styles.durationCard}>
          <Text style={styles.durationBig}>{minutes}<Text style={styles.durationUnit}> min</Text></Text>
          {/* durationCard centers its text (alignItems:'center'), which also
              collapses any child with no explicit width to its content size
              instead of stretching — the Slider's own track has no width of
              its own, so it needs an explicit full-width wrapper here rather
              than relying on the parent's default stretch behavior. */}
          <View style={styles.sliderWrap}>
            <Slider
              value={minutes}
              min={5}
              max={60}
              step={5}
              onChange={(v) => setMinutes(snapToQuickMinutes(v))}
              onSlidingComplete={(v) => handlePickMinutes(snapToQuickMinutes(v))}
              formatValue={(v) => `${snapToQuickMinutes(v)} min`}
              accessibilityLabel="Workout duration"
            />
          </View>
        </View>

        {/* Target Area — the primary, beginner-friendly decision (real body
            parts, not training-taxonomy jargon like "push"/"pull"). Multi-
            select: tap as many as you want (e.g. Legs + Cardio together). */}
        <Text style={styles.sectionLabel}>TARGET AREA</Text>
        <Text style={styles.sectionHint}>Tap as many as you like</Text>
        <View style={styles.targetGrid}>
          {TARGET_AREA_OPTIONS.map(opt => {
            const active = opt.surprise
              ? selectedAreaKeys.size === 0 && !routeTargetPattern
              : selectedAreaKeys.has(opt.key)
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.targetChip, active && styles.targetChipActive]}
                onPress={() => handleToggleTargetArea(opt)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Ionicons name={opt.icon as any} size={17} color={active ? C.onPrimary : C.primary} />
                <Text style={[styles.targetChipText, active && styles.targetChipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Training style + equipment — real, but not what a beginner needs
            staring at by default. Tucked behind one disclosure instead of two
            more always-visible pill rows. */}
        <TouchableOpacity
          style={styles.moreToggle}
          onPress={() => setMoreOpen(v => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded: moreOpen }}
          accessibilityLabel={moreOpen ? 'Show fewer options' : 'Show more options'}
        >
          <Text style={styles.moreToggleText}>{moreOpen ? 'Fewer options' : 'More options'}</Text>
          <Ionicons name={moreOpen ? 'chevron-up' : 'chevron-down'} size={15} color={C.textSecondary} />
        </TouchableOpacity>

        {moreOpen && (
          <>
            <Text style={styles.sectionLabel}>TRAINING STYLE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.purposeRow}>
              {PURPOSE_ORDER.map(p => {
                const active = p === activePurpose
                const pm = PURPOSE_META[p]
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.purposeChip, active && styles.purposeChipActive]}
                    onPress={() => handlePickPurpose(p)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={pm.label}
                  >
                    <Ionicons name={pm.icon as any} size={15} color={active ? C.onPrimary : C.primary} />
                    <Text style={[styles.purposeText, active && styles.purposeTextActive]}>{pm.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            <View style={styles.rowBetween}>
              <Text style={styles.sectionLabel}>EQUIPMENT</Text>
              {locked && <ProBadge />}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
              <TouchableOpacity
                style={[styles.presetChip, !selectedPresetId && styles.presetChipActive]}
                onPress={() => handlePickPreset(null)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ selected: !selectedPresetId }}
                accessibilityLabel="All my gear"
              >
                <Ionicons name="home" size={14} color={!selectedPresetId ? C.onPrimary : C.primary} />
                <Text style={[styles.presetChipText, !selectedPresetId && styles.presetChipTextActive]}>All my gear</Text>
              </TouchableOpacity>
              {presets.map((pr) => {
                const on = selectedPresetId === pr.id
                return (
                  // A plain View wrapping two separate touch targets, not one
                  // nested inside the other — long-press-to-edit doesn't exist
                  // as a gesture on web, so editing needs its own real tap
                  // target, not just a gesture only native users can find.
                  <View key={pr.id} style={[styles.presetChip, on && styles.presetChipActive]}>
                    <TouchableOpacity
                      style={styles.presetChipMain}
                      onPress={() => handlePickPreset(pr.id)}
                      onLongPress={() => setPresetSheet({ open: true, edit: pr })}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={locked ? `${pr.name}, Pro` : pr.name}
                    >
                      <Ionicons name="cube" size={14} color={on ? C.onPrimary : C.primary} />
                      <Text style={[styles.presetChipText, on && styles.presetChipTextActive]} numberOfLines={1}>{pr.name}</Text>
                      {locked && <Ionicons name="lock-closed" size={11} color={on ? 'rgba(255,255,255,0.9)' : C.gold} />}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.presetChipEdit}
                      onPress={() => setPresetSheet({ open: true, edit: pr })}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit or delete ${pr.name}`}
                    >
                      <Ionicons name="pencil" size={12} color={on ? 'rgba(255,255,255,0.85)' : C.outline} />
                    </TouchableOpacity>
                  </View>
                )
              })}
              <TouchableOpacity
                style={styles.presetNew}
                onPress={() => setPresetSheet({ open: true, edit: null })}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="New equipment preset"
              >
                <Ionicons name="add" size={15} color={C.primary} />
                <Text style={styles.presetNewText}>New</Text>
              </TouchableOpacity>
            </ScrollView>
            {presets.length > 0 && (
              <Text style={styles.presetHint}>Tap the pencil on a preset to edit or delete it.</Text>
            )}
          </>
        )}

        {/* No preview card by design — Start goes straight into the runner,
            which has full swap/skip/remove tools the old read-only preview
            never did. Only an actual problem gets a message here. */}
        {generating ? (
          <PulseLoader caption="Building your session…" />
        ) : empty ? (
          <View style={styles.emptyRow}>
            <Ionicons name="alert-circle-outline" size={20} color={C.textSecondary} />
            <Text style={styles.emptyText}>
              No moves match your equipment for {selectedAreaKeys.size > 1 ? 'these target areas' : 'this target area'}. Try another area, or add equipment under More options.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky Start */}
      <View style={styles.footer}>
        <PressableScale
          style={[styles.startBtn, (generating || empty || starting) && { opacity: 0.5 }]}
          onPress={handleStart}
          disabled={generating || empty || starting}
        >
          {starting ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : teased ? (
            <>
              <Ionicons name="sparkles" size={16} color={C.onPrimary} />
              <Text style={styles.startBtnText}>Unlock to Start</Text>
            </>
          ) : (
            <>
              <Ionicons name="play" size={16} color={C.onPrimary} />
              <Text style={styles.startBtnText}>Start {minutes}-Minute Workout</Text>
            </>
          )}
        </PressableScale>
      </View>

      <EquipmentPresetSheet
        visible={presetSheet.open}
        preset={presetSheet.edit}
        onClose={() => setPresetSheet({ open: false, edit: null })}
        onSave={handleSavePreset}
        onDelete={handleDeletePreset}
      />
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 120, gap: Spacing.md },

  lead: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.3, marginTop: Spacing.xs },
  coachWalking: { marginBottom: Spacing.xs },
  leadSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, lineHeight: 20 },

  durationCard: {
    alignItems: 'center', backgroundColor: C.background, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm, paddingBottom: Spacing.xs, ...CardShadow,
  },
  durationBig: { fontFamily: C.fontDisplay, fontSize: 40, color: C.text, letterSpacing: -1 },
  durationUnit: { fontFamily: 'Inter_500Medium', fontSize: 16, color: C.textSecondary },
  sliderWrap: { alignSelf: 'stretch', width: '100%' },

  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.xs },
  sectionHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  targetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  targetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  targetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  targetChipText: { fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.text },
  targetChipTextActive: { color: C.onPrimary },

  moreToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: Spacing.xs, marginTop: Spacing.xs,
  },
  moreToggleText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },

  purposeRow: { gap: Spacing.xs, paddingRight: Spacing.lg },
  purposeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  purposeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  purposeText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text },
  purposeTextActive: { color: C.onPrimary },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  presetRow: { gap: Spacing.xs, paddingRight: Spacing.lg, paddingVertical: 2 },
  // Used directly (as a single TouchableOpacity) by "All my gear," and as a
  // container (View wrapping two separate touch targets: select + edit) for
  // a saved preset — see presetChipMain/presetChipEdit.
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 200,
    backgroundColor: C.background, borderWidth: 1.5, borderColor: C.outlineVariant,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  presetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  presetChipText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text, flexShrink: 1 },
  presetChipTextActive: { color: C.onPrimary },
  presetChipMain: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  presetChipEdit: { marginLeft: 6, paddingHorizontal: 2, paddingVertical: 2 },
  presetNew: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: C.primaryLine, borderStyle: 'dashed',
    borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  presetNewText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  presetHint: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.outline, lineHeight: 16 },

  emptyRow: {
    flexDirection: 'row', gap: Spacing.sm, backgroundColor: C.surfaceContainerLow,
    borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'flex-start',
  },
  emptyText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary, lineHeight: 19 },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm, paddingBottom: Spacing.xl,
    backgroundColor: C.surface, borderTopWidth: 0.5, borderTopColor: C.outlineVariant,
  },
  startBtn: {
    height: 56, backgroundColor: C.primary, borderRadius: Radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
  },
  startBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
})
