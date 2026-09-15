import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Animated, Easing, LayoutAnimation, Modal,
  type StyleProp, type ViewStyle,
} from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useReducedMotion, PressableScale, PopIn, FadeInView, ScreenTransition } from '@/components/motion'
import { Image } from 'expo-image'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useProgressStats } from '@/hooks/useProgressStats'
import { fetchSplits, isAutoSplit } from '@/lib/splits'
import { materializeSplit, propagateSplitDayEdit } from '@/lib/splitSchedule'
import { removeWorkoutFromCalendar } from '@/services/calendarSync'
import { readinessFromHistory, intensityFromReadiness } from '@/lib/fitnessInsights'
import { useProGate } from '@/stores/entitlements'
import { invalidateTrainingData } from '@/lib/queryInvalidation'
import { Spacing, Radius, CardShadow, Elevation, BottomTabInset } from '@/constants/theme'
import { BRAND_NAME } from '@/constants/brand'
import { useTheme, useThemedStyles, type Palette } from '@/theme'
import { Avatar } from '@/components/Avatar'
import { ScreenHeader, HeaderActions, DismissButton, PulseLoader } from '@/components/brand'
import { EmptyState } from '@/components/EmptyState'
import { TempoLottie } from '@/components/TempoLottie'
import { AddWorkoutSheet } from '@/components/AddWorkoutSheet'
import { supabase } from '@/lib/supabase'
import { captureApiError } from '@/lib/crashReporting'
import { cancelWorkoutReminder, scheduleRestDoneNotification, cancelRestDoneNotification } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth'
import { useTutorialStore } from '@/stores/tutorial'
import { useTutorialTarget, useTutorialScrollContainer } from '@/components/TutorialOverlay'
import { TARGET } from '@/lib/tutorial'
import { track } from '@/lib/analytics'
import { buildPrescription, type ExercisePrescription, type SetPerformance } from '@/lib/progression'
import { mondayStr } from '@/lib/schedulingImpact'
import { getIntensityBias, refreshAdaptation, type IntensityBias } from '@/lib/adaptation'
import type { WeekProgression } from '@/lib/periodization'
import { getTodayReadiness } from '@/lib/recovery'
import { rescheduleWholeWeek, delayWholeWeek, getDelayWeekInfo } from '@/lib/reschedule'
import { ExerciseFormSheet } from '@/components/ExerciseFormSheet'
import { ExercisePickerSheet } from '@/components/ExercisePickerSheet'
import { FocusMode } from '@/components/FocusMode'
import { OptionSheet } from '@/components/OptionSheet'
import * as haptics from '@/lib/haptics'
import { getRestPref, setRestPref, SUGGESTED_REST_SEC } from '@/lib/restPrefs'
import { startRestActivity, updateRestActivity, endRestActivity } from '@/widgets/RestTimerActivity'
import { getUnilateralPref, setUnilateralPref } from '@/lib/unilateralPrefs'
import { useFocusModeEnabled } from '@/lib/focusModePref'
import { useSessionActiveStore } from '@/stores/sessionActive'
import { resumeElapsedSeconds, estimateSessionSec, estimateSessionMin, adaptiveRemainingSec, fetchPaceFactor, formatRemaining, WORK_SEC } from '@/lib/durationEstimate'
import { MIN_STREAK_MINUTES } from '@/lib/streak'
import { describeSaveError } from '@/lib/saveErrors'
import { queuePendingSetLog, clearPendingSetLog } from '@/lib/pendingSetLogs'
import { fetchExerciseId, gifSource } from '@/lib/exerciseGif'
import { getExerciseGifSource } from '@/data/exerciseMedia'
import { getActiveTravelMode, describeTravelEquipment } from '@/lib/travelMode'
import { excludeExercisePermanently } from '@/lib/exerciseExclusions'
import { PlateCalcSheet } from '@/components/PlateCalcSheet'
import { metricsFor } from '@/lib/customExercises'
import { classifyExercise, formatMuscleName } from '@/lib/exerciseProgramming'
import { describeSession } from '@/lib/sessionRationale'
import { expandEquipment } from '@/lib/equipmentMatch'
import { useUnitStore, unitLabel, displayWeight, toInputString, inputToLbs, type WeightUnit } from '@/lib/units'
import type { Exercise, Goal, Experience, Split, TravelMode, MetricKey, WorkoutExerciseConfig, WorkoutSource } from '@/types'
import { workoutOrigin } from '@/lib/workoutOrigin'
import { summarizeDay, type DayWorkoutStatus } from '@/lib/dayStatus'


const RPE_OPTIONS = [6, 7, 8, 9, 10]
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkoutRow {
  id: string
  focus: string
  planned_date: string
  planned_duration_min: number
  exercise_ids: string[]
  status: string
  source: WorkoutSource | null
  split_id: string | null
  progression: WeekProgression | null
  exercise_config: WorkoutExerciseConfig[] | null
  calendar_event_id: string | null
  calendar_provider: 'google' | 'device' | null
}

interface ExerciseRow {
  id: string
  name: string
  movement_pattern: string
  muscle_group?: string | null
  primary_muscles: string[]
  secondary_muscles: string[]
  required_equipment: string[]
  experience_level: string
  instructions: string[]
  video_url: string | null
  substitute_ids: string[]
  tracking_metrics?: MetricKey[]
}

// The calendar's own lightweight row shape — just enough for day dots + the
// selected-day summary card. NOT the runner's `WorkoutRow` (no exercise
// config/progression needed here; the runner loads its own full row when a
// session actually starts).
interface PlanCalRow {
  id: string
  focus: string
  planned_date: string
  planned_start_time: string
  planned_duration_min: number
  exercise_ids: string[]
  status: string
}

interface SetState {
  lbs: string
  reps: string
  durationSec: string
  distanceM: string
  rpe: number | null
  done: boolean
  // Warm-up sets are logged but excluded from progression history, PREV, and
  // volume/PR math — they'd otherwise drag next session's targets down.
  warmup?: boolean
}

// Logged input columns for a set, by tracked metric (RPE is captured separately).
const METRIC_COLS: { key: MetricKey; label: string; field: 'lbs' | 'reps' | 'durationSec' | 'distanceM'; kbd: 'decimal-pad' | 'number-pad' }[] = [
  { key: 'weight', label: 'LBS', field: 'lbs', kbd: 'decimal-pad' },
  { key: 'reps', label: 'REPS', field: 'reps', kbd: 'number-pad' },
  { key: 'duration', label: 'SEC', field: 'durationSec', kbd: 'number-pad' },
  { key: 'distance', label: 'DIST', field: 'distanceM', kbd: 'decimal-pad' },
]
function columnsFor(metrics: MetricKey[] | undefined): typeof METRIC_COLS {
  const cols = METRIC_COLS.filter(c => metrics?.includes(c.key))
  return cols.length ? cols : [METRIC_COLS[0], METRIC_COLS[1]]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function parseLocal(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Sunday as the first day of the week (matches US calendars).
function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x
}

function getWeekDays(d: Date): Date[] {
  const s = startOfWeek(d)
  return Array.from({ length: 7 }, (_, i) => addDays(s, i))
}

// 6-row month grid (42 cells) starting on the Sunday on/before the 1st, so the
// grid always aligns to weekday columns and never reflows between months.
function getMonthGrid(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const s = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(s, i))
}

// '07:00:00' → '7:00 AM' (12-hour everywhere — never 24-hour)
function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr, 10)
  return `${h % 12 || 12}:${mStr} ${h >= 12 ? 'PM' : 'AM'}`
}

function daysPerWeek(split: Split): number {
  return split.days.filter((d) => !d.rest).length
}

function splitLabels(split: Split): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of split.days) {
    if (d.rest) continue
    const l = (d.label || '').trim()
    if (l && !seen.has(l.toLowerCase())) { seen.add(l.toLowerCase()); out.push(l) }
  }
  return out.slice(0, 4)
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// Travel mode: replace any planned exercise the user can't do with their current
// equipment with a same-pattern alternative they can (curated substitute first).
// Done in memory only — the saved plan is untouched, so it reverts when they're home.
async function adaptToTravelEquipment(list: ExerciseRow[], equipment: string[]): Promise<ExerciseRow[]> {
  const have = expandEquipment(equipment)
  const undoable = list.filter(e => !e.required_equipment.some(eq => have.has(eq)))
  if (!undoable.length) return list

  const patterns = [...new Set(undoable.map(e => e.movement_pattern))]
  const { data: cands } = await supabase
    .from('exercises')
    .select('id, name, movement_pattern, muscle_group, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, video_url, substitute_ids')
    .in('movement_pattern', patterns)
  const all = (cands ?? []) as ExerciseRow[]

  const used = new Set(list.map(e => e.id))
  return list.map(e => {
    if (e.required_equipment.some(eq => have.has(eq))) return e
    const doable = all
      .filter(s => !used.has(s.id) && s.movement_pattern === e.movement_pattern && s.required_equipment.some(eq => have.has(eq)))
      .sort((a, b) => {
        const ai = e.substitute_ids?.includes(a.id) ? 0 : 1
        const bi = e.substitute_ids?.includes(b.id) ? 0 : 1
        return ai - bi
      })
    const pick = doable[0]
    if (!pick) return e          // nothing fits — keep it; the user can still skip
    used.add(pick.id)
    return pick
  })
}

// A progress fill that eases to its new width whenever a set is logged — the
// session header visibly moves with every rep you bank.
function AnimatedFill({ pct, style }: { pct: number; style?: StyleProp<ViewStyle> }) {
  const width = useRef(new Animated.Value(pct)).current
  useEffect(() => {
    const anim = Animated.timing(width, {
      toValue: pct, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    })
    anim.start()
    return () => anim.stop()
  }, [pct, width])
  return (
    <Animated.View
      style={[style, { width: width.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}
    />
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorkoutsScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useLocalSearchParams<{ workoutId?: string; quick?: string; justSwitched?: string }>()
  // Params are consumed (cleared) once acted on, so pushing the same workoutId
  // twice still re-triggers; '' therefore means "no param".
  const workoutIdParam = params.workoutId || undefined
  const quickParam = params.quick || undefined
  // Landed here right after Change Plan (plan-preview.tsx's replan exit) — a
  // brief, self-dismissing confirmation that the switch actually happened,
  // instead of silently dropping the user on Home to go find out for
  // themselves. Consumed once (param cleared) so it can't re-show on a later
  // unrelated focus of this same screen.
  const [justSwitchedBanner, setJustSwitchedBanner] = useState(false)
  useEffect(() => {
    if (params.justSwitched !== '1') return
    setJustSwitchedBanner(true)
    router.setParams({ justSwitched: '' })
    const t = setTimeout(() => setJustSwitchedBanner(false), 5000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.justSwitched])
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const experience = useAuthStore(s => s.profile?.experience)
  const preferredTimeOfDay = useAuthStore(s => s.profile?.preferred_time_of_day)

  // Plan tour targets (Phase 6) — calendar, current split, library doors.
  const planCalendarTarget = useTutorialTarget(TARGET.planCalendar, { scrollIntoView: true })
  const planSplitTarget = useTutorialTarget(TARGET.planSplit, { scrollIntoView: true })
  const planLibraryTarget = useTutorialTarget(TARGET.planLibrary, { scrollIntoView: true })
  // Registers this screen's ScrollView so a below-the-fold step (e.g. plan_library,
  // "the split" further down) scrolls itself into view instead of pointing at
  // whatever happened to already be on screen.
  const { scrollRef: tourScrollRef, onScroll: tourOnScroll } = useTutorialScrollContainer()

  // ── Plan hub (IA redesign, 2026-07-16 Phase 2) ──────────────────────────────
  // Was a 4-way segmented control (Session/Readiness/Splits/Workouts); now Plan
  // owns all multi-day scheduling (moved from Home) plus a condensed current-
  // split card and simple nav rows into the existing Library screens. The
  // runner below (sessionActive branch) is completely untouched.
  const today = new Date()
  const todayStr = toDateStr(today)
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [weekRescheduleConfirm, setWeekRescheduleConfirm] = useState(false)
  const [weekRescheduling, setWeekRescheduling] = useState(false)
  const [delayWeekOptions, setDelayWeekOptions] = useState<{ key: string; label: string; icon: string; offsetDays: number }[] | null>(null)
  const [delayWeekLoading, setDelayWeekLoading] = useState(false)
  const [weekDelaying, setWeekDelaying] = useState(false)
  const [addWorkoutOpen, setAddWorkoutOpen] = useState(false)
  const { requirePro: requireProForSchedule } = useProGate()
  const { requirePro: requireProForPlates } = useProGate()
  const [plateCalcWeight, setPlateCalcWeight] = useState<number | null>(null)
  const [plateCalcOpen, setPlateCalcOpen] = useState(false)
  const { workouts: histWorkouts, logTimes, muscleTimeline } = useProgressStats(userId)
  // Readiness stays a chip here (the point-of-decision glance, same as Home's
  // hero) — the full readiness card + muscle recovery detail live on Progress
  // now, not a dedicated Train segment.
  const trainReady = useMemo(() => {
    const r = readinessFromHistory(histWorkouts, logTimes, new Date())
    return { readiness: r, intensity: intensityFromReadiness(r.score) }
  }, [histWorkouts, logTimes])
  // B5.4 — real completed sets this week, per muscle group, from the SAME
  // already-fetched muscleTimeline the readiness card uses (no new query).
  // Feeds buildPrescription's weekly-volume MRV cap below.
  const weeklySetsByGroup = useMemo(() => {
    const monday = mondayStr()
    const counts = new Map<string, number>()
    for (const s of muscleTimeline) {
      if (!s.group || !s.at) continue
      if (s.at.slice(0, 10) < monday) continue
      counts.set(s.group, (counts.get(s.group) ?? 0) + 1)
    }
    return counts
  }, [muscleTimeline])
  // Always fetched now (was gated behind the removed Splits segment) — the
  // condensed "current split" card needs it on every hub visit.
  const { data: hubSplits = [] } = useQuery({
    queryKey: ['train_splits', userId],
    queryFn: () => fetchSplits(supabase, userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
  const activeSplit = useMemo(() => hubSplits.find(s => s.is_active) ?? null, [hubSplits])

  // ── Calendar (moved from Home) ───────────────────────────────────────────────
  const selDate = useMemo(() => parseLocal(selectedDate), [selectedDate])
  const weekDays = useMemo(() => getWeekDays(selDate), [selDate])
  const monthGrid = useMemo(() => getMonthGrid(selDate), [selDate])
  const calRange = useMemo(() => {
    const cells = viewMode === 'month' ? monthGrid : weekDays
    return { start: toDateStr(cells[0]), end: toDateStr(cells[cells.length - 1]) }
  }, [viewMode, weekDays, monthGrid])

  const { data: calWorkouts = [] } = useQuery<PlanCalRow[]>({
    queryKey: ['plan_cal_workouts', userId, calRange.start, calRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_workouts')
        .select('id, focus, planned_date, planned_start_time, planned_duration_min, exercise_ids, status')
        .eq('user_id', userId)
        .gte('planned_date', calRange.start)
        .lte('planned_date', calRange.end)
        .order('planned_date')
        .order('planned_start_time')
      if (error) throw error
      return (data ?? []) as PlanCalRow[]
    },
    enabled: !!userId,
    placeholderData: keepPreviousData,
  })

  const calWorkoutsByDate = useMemo(() => {
    const map: Record<string, PlanCalRow[]> = {}
    for (const w of calWorkouts) {
      if (w.status === 'rescheduled' || w.status === 'skipped') continue
      ;(map[w.planned_date] ||= []).push(w)
    }
    return map
  }, [calWorkouts])

  // Every live workout on the selected day — was `?.[0] ?? null` (silently
  // dropped a second workout the same day, e.g. an AM+PM split or two
  // manually scheduled sessions, from the day-detail card entirely).
  const selectedDayWorkouts = calWorkoutsByDate[selectedDate] ?? []
  const selectedDayWorkout = selectedDayWorkouts[0] ?? null

  // A day the active split expects a real workout on, but nothing live is
  // scheduled for it — either skipped/removed, or never materialized. Distinct
  // from a genuine rest day: the split's own weekday pattern says this SHOULD
  // be a training day, so "no workout" here is a gap to offer to close, not a
  // planned day off.
  const missingSplitDay = useMemo(() => {
    if (selectedDayWorkout || !activeSplit || isAutoSplit(activeSplit)) return null
    const weekday = ((selDate.getDay() + 6) % 7) + 1 // 1=Mon … 7=Sun, matches splitSchedule.ts
    const day = activeSplit.days.find(d => d.weekday === weekday)
    return day && !day.rest && (day.exercise_ids?.length ?? 0) > 0 ? day : null
  }, [selectedDayWorkout, activeSplit, selDate])

  const [addingBackDay, setAddingBackDay] = useState(false)
  const handleAddBackDay = async () => {
    if (addingBackDay || !activeSplit) return
    setAddingBackDay(true)
    try {
      await materializeSplit(supabase, userId, activeSplit, (preferredTimeOfDay as any) ?? null)
      queryClient.invalidateQueries({ queryKey: ['plan_cal_workouts'] })
    } catch {
      Alert.alert('Could not add it back', 'Please try again in a moment.')
    } finally {
      setAddingBackDay(false)
    }
  }

  const rangeLabel = useMemo(() => {
    if (viewMode === 'month') return selDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const a = weekDays[0], b = weekDays[6]
    const sameMonth = a.getMonth() === b.getMonth()
    const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const right = b.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })
    return `${left} – ${right}`
  }, [viewMode, selDate, weekDays])

  const isThisRange = useMemo(() => {
    if (viewMode === 'month') return selDate.getFullYear() === today.getFullYear() && selDate.getMonth() === today.getMonth()
    return weekDays.some(d => toDateStr(d) === todayStr)
  }, [viewMode, selDate, weekDays, todayStr])

  const shiftRange = (delta: number) => {
    if (viewMode === 'month') {
      const d = new Date(selDate.getFullYear(), selDate.getMonth() + delta, 1)
      const sameMonth = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
      setSelectedDate(sameMonth ? todayStr : toDateStr(d))
    } else {
      setSelectedDate(toDateStr(addDays(selDate, delta * 7)))
    }
  }

  function renderDayCell(day: Date, compact: boolean) {
    const ds = toDateStr(day)
    const dayWorkouts = calWorkoutsByDate[ds] ?? []
    const isSelected = ds === selectedDate
    const isToday = ds === todayStr
    const inMonth = day.getMonth() === selDate.getMonth()
    const hasWorkout = dayWorkouts.length > 0
    // A day reads as trained when something was actually done and nothing is
    // still pending on it. It used to require EVERY session on the day to be
    // 'completed', so swapping your plan session for a different one left the
    // day un-green even though you trained: the abandoned row sits there as
    // 'missed' next to the completed one and drags the whole day down with it.
    // (An explicitly removed session is already 'skipped', which
    // calWorkoutsByDate filters out entirely, so only the missed case was
    // broken.) Founder, 2026-09-15: "cancel your plan exercise but do a new one
    // ... it still shows green in plan."
    const { trained: allDone, missed: anyMissed } =
      summarizeDay(dayWorkouts.map(w => w.status as DayWorkoutStatus))

    return (
      <PressableScale
        key={ds}
        style={compact ? styles.gridCell : styles.weekCell}
        onPress={() => setSelectedDate(ds)}
        scaleTo={0.88}
      >
        {!compact && <Text style={[styles.weekDow, isSelected && styles.weekDowActive]}>{DOW[day.getDay()]}</Text>}
        <View
          style={[
            styles.dayPill,
            compact && styles.dayPillGrid,
            isToday && !isSelected && styles.dayPillToday,
            isSelected && styles.dayPillSelected,
          ]}
        >
          <Text
            style={[
              styles.dayNum,
              compact && !inMonth && styles.dayNumMuted,
              isToday && !isSelected && styles.dayNumToday,
              isSelected && styles.dayNumSelected,
            ]}
          >
            {day.getDate()}
          </Text>
        </View>
        {hasWorkout ? (
          <View style={[styles.dayDot, allDone ? styles.dotDone : anyMissed ? styles.dotMissed : styles.dotWorkout, isSelected && styles.dotOnSelected]} />
        ) : (
          <View style={styles.dayDotPlaceholder} />
        )}
      </PressableScale>
    )
  }

  // "Reschedule my whole week" (moved from Home) — one tap re-lays every
  // upcoming session via the existing lib/reschedule engine.
  const handleWeekReschedule = () => {
    if (weekRescheduling) return
    if (!requireProForSchedule('schedule_optimization')) return
    setWeekRescheduleConfirm(true)
  }

  const confirmWeekReschedule = async () => {
    setWeekRescheduleConfirm(false)
    if (weekRescheduling) return
    setWeekRescheduling(true)
    try {
      const { moved, total } = await rescheduleWholeWeek(supabase, userId)
      track('week_reschedule_used', { moved, total })
      queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
      queryClient.invalidateQueries({ queryKey: ['plan_cal_workouts'] })
      queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })
      if (total === 0) {
        Alert.alert('Nothing to reschedule', 'Your week is already clear of upcoming workouts.')
      } else if (moved === 0) {
        Alert.alert('Week already fits', 'Every upcoming workout already has its best slot — nothing needed to move.')
      } else {
        Alert.alert(
          'Week rescheduled',
          `${BRAND_NAME} moved ${moved} of ${total} upcoming workout${total === 1 ? '' : 's'} to a better time and re-synced your calendar.`,
        )
      }
    } catch (err) {
      const info = describeSaveError(err, 'reschedule your week')
      Alert.alert(info.title, info.message)
    } finally {
      setWeekRescheduling(false)
    }
  }

  // "Delay my whole week" — the literal companion to reschedule above: push
  // every remaining workout this week later by a fixed number of days (a sick
  // day, a trip, an overloaded week), same spacing and times, no re-planning.
  // Scoped to ONLY this week (lib/delayWeek.ts caps the offset), so the picker
  // is built from a live read of how much room is actually left this week.
  const handleWeekDelay = async () => {
    if (delayWeekLoading || weekDelaying) return
    if (!requireProForSchedule('schedule_optimization')) return
    setDelayWeekLoading(true)
    try {
      const { total, maxOffsetDays } = await getDelayWeekInfo(supabase, userId)
      if (total === 0) {
        Alert.alert('Nothing to delay', 'Your week is already clear of upcoming workouts.')
        return
      }
      if (maxOffsetDays <= 0) {
        Alert.alert(
          'Already at the end of the week',
          'Your last workout this week is already on its final day — there\'s no room left to push it back without landing in next week. Try "Reschedule my week" instead.',
        )
        return
      }
      const offered = Math.min(maxOffsetDays, 6)
      setDelayWeekOptions(Array.from({ length: offered }, (_, i) => {
        const n = i + 1
        return { key: String(n), label: `Delay by ${n} day${n === 1 ? '' : 's'}`, icon: 'play-forward-outline', offsetDays: n }
      }))
    } catch (err) {
      const info = describeSaveError(err, 'check your week')
      Alert.alert(info.title, info.message)
    } finally {
      setDelayWeekLoading(false)
    }
  }

  const confirmWeekDelay = async (key: string) => {
    const offsetDays = delayWeekOptions?.find(o => o.key === key)?.offsetDays
    setDelayWeekOptions(null)
    if (!offsetDays || weekDelaying) return
    setWeekDelaying(true)
    try {
      const { moved, total, appliedOffset } = await delayWholeWeek(supabase, userId, offsetDays)
      track('week_delay_used', { offsetDays: appliedOffset, moved, total })
      queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
      queryClient.invalidateQueries({ queryKey: ['plan_cal_workouts'] })
      queryClient.invalidateQueries({ queryKey: ['missed_workouts', userId] })
      if (total === 0) {
        Alert.alert('Nothing to delay', 'Your week is already clear of upcoming workouts.')
      } else if (appliedOffset === 0) {
        // computeMaxDelayDays re-checked at commit time and found no room left —
        // a race since the picker opened (a workout landed on the week's last day).
        Alert.alert(
          'Couldn\'t delay by that much',
          'Your week filled up (or finished) since you opened this — there isn\'t room left to push it back. Try again for an updated option.',
        )
      } else if (moved === 0) {
        // appliedOffset > 0 but nothing actually moved — every row update failed
        // (offline/RLS), distinct from the boundary case above.
        Alert.alert('Couldn\'t delay your week', 'Something went wrong saving the change — check your connection and try again.')
      } else {
        const dayWord = appliedOffset === 1 ? 'day' : 'days'
        const partial = appliedOffset !== offsetDays ? ` (the most that still fit inside this week)` : ''
        Alert.alert(
          'Week delayed',
          `${BRAND_NAME} pushed ${moved} of ${total} upcoming workout${total === 1 ? '' : 's'} back ${appliedOffset} ${dayWord}${partial} and re-synced your calendar.`,
        )
      }
    } catch (err) {
      const info = describeSaveError(err, 'delay your week')
      Alert.alert(info.title, info.message)
    } finally {
      setWeekDelaying(false)
    }
  }

  const [workout, setWorkout] = useState<WorkoutRow | null>(null)
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [workoutLogId, setWorkoutLogId] = useState<string | null>(null)
  const [sets, setSets] = useState<Record<string, SetState[]>>({})
  const [exMetrics, setExMetrics] = useState<Record<string, MetricKey[]>>({})
  const reduceMotion = useReducedMotion()

  // Smoothly grow/shrink the exercise card when its accordion toggles.
  const toggleExpand = (id: string) => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
      )
    }
    setExpandedId((cur) => (cur === id ? null : id))
  }
  const [prevBySet, setPrevBySet] = useState<Record<string, string[]>>({})
  const [targets, setTargets] = useState<Record<string, ExercisePrescription>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Set when there's no PENDING session today but one was already completed —
  // distinguishes "you're done for today" from "nothing was ever planned",
  // which used to both render the same "No session scheduled today" empty
  // state and made a finished day look like a broken/empty one.
  const [todayCompletedFocus, setTodayCompletedFocus] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  // Whether the live logging session is open. Tapping the Workouts tab lands on the
  // hub (false); you enter the session deliberately and can leave it back to the hub.
  const [sessionActive, setSessionActive] = useState(false)
  // Mirror into the shared store so sibling screens (the tab bar's GO button)
  // can react to "a session is active" without prop-drilling — every existing
  // setSessionActive(...) call site stays exactly as it is; this just observes
  // the result. Reset to false on unmount so leaving the tab never strands GO
  // hidden.
  useEffect(() => {
    useSessionActiveStore.getState().setActive(sessionActive)
  }, [sessionActive])
  useEffect(() => () => { useSessionActiveStore.getState().setActive(false) }, [])
  // Rest timer is wall-clock: we store WHEN it ends, and derive the display from
  // that — so locking the phone between sets can't freeze the countdown.
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)
  const [restSecondsLeft, setRestSecondsLeft] = useState<number | null>(null)
  // Original rest length, so the pill can show time draining as a bar.
  const [restTotal, setRestTotal] = useState(SUGGESTED_REST_SEC)
  // The user's chosen rest for THIS workout (persisted per workout name);
  // overrides per-exercise prescriptions once set.
  const [restOverride, setRestOverride] = useState<number | null>(null)
  // Optional post-log RPE capture: shows under the set that JUST logged.
  // Logging never waits on it — the ✓ is instant, RPE is a bonus.
  const [rpeFollowUp, setRpeFollowUp] = useState<{ exId: string; idx: number } | null>(null)
  // Add-exercise mid-session: picker → "today only vs permanently" choice.
  const [addExOpen, setAddExOpen] = useState(false)
  const [addChoiceEx, setAddChoiceEx] = useState<ExerciseRow | null>(null)
  // Pause / leave-session sheet (replaces the ambiguous back chevron).
  const [pauseSheet, setPauseSheet] = useState(false)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [finishEarlyConfirm, setFinishEarlyConfirm] = useState<{ remaining: number; done: number; total: number } | null>(null)
  // A session under MIN_STREAK_MINUTES doesn't advance the streak (lib/streak.ts)
  // — surfaced here, before finishing, so the choice to keep going vs. bank a
  // short session is the user's, made with full information.
  const [tooShortConfirm, setTooShortConfirm] = useState(false)
  const [removeSetConfirm, setRemoveSetConfirm] = useState<{ exId: string; idx: number; wasDone: boolean } | null>(null)
  // A logged set can be re-opened for edit (wrong number typed in, fix it
  // after the fact) instead of the old delete-and-redo-only path. Only one
  // set edits at a time.
  const [editingSet, setEditingSet] = useState<{ exId: string; idx: number } | null>(null)
  // Per-exercise "the number I type is per side" toggle — no schema change;
  // doubles into the stored total at log time. Remembered per exercise name
  // (lib/unilateralPrefs.ts), seeded when the exercise list loads.
  const [perSide, setPerSide] = useState<Record<string, boolean>>({})
  const togglePerSide = (ex: ExerciseRow) => {
    haptics.tapLight()
    const next = !perSide[ex.id]
    setPerSide(prev => ({ ...prev, [ex.id]: next }))
    setUnilateralPref(ex.name, next)
  }
  const [skipExerciseConfirm, setSkipExerciseConfirm] = useState<ExerciseRow | null>(null)
  const [removeExerciseConfirm, setRemoveExerciseConfirm] = useState<ExerciseRow | null>(null)
  const [swapSheet, setSwapSheet] = useState<{ ex: ExerciseRow; candidates: ExerciseRow[] } | null>(null)
  // N2 (2026-08-02): the scope choice shown after picking a swap candidate,
  // only for a split-sourced workout — see addChoiceEx's identical shape.
  const [swapChoice, setSwapChoice] = useState<{ oldId: string; oldName: string; next: ExerciseRow } | null>(null)
  // Per-exercise action sheet (machine occupied → swap / move to end / skip / reorder).
  const [exActionEx, setExActionEx] = useState<ExerciseRow | null>(null)
  // Session note ("bench felt heavy today") → workout_logs.notes.
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  // One-time coach overlay on the very first live session.
  const [coachVisible, setCoachVisible] = useState(false)
  // "Why this workout" reasoning sheet (hub).
  const [whyOpen, setWhyOpen] = useState(false)
  // How this user's real session lengths compare to estimates (historical).
  const [paceFactor, setPaceFactor] = useState(1)
  const [formSheetEx, setFormSheetEx] = useState<ExerciseRow | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [gifIds, setGifIds] = useState<Record<string, string | null>>({})
  // Cached Supabase Storage GIFs 404 for the ~640 exercises not yet backfilled
  // (scripts/backfill-exercise-media.mjs runs monthly, quota-limited) — track a
  // failed load per exercise so those rows fall back to the barbell icon instead
  // of a blank/broken image.
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({})
  // Separate from thumbFailed: that one means "the curated clip failed, fall
  // through to the remote one". This means "the REMOTE clip failed too, show the
  // placeholder". Sharing one flag would send a failed remote clip back to the
  // curated branch it already fell out of.
  const [gifThumbFailed, setGifThumbFailed] = useState<Record<string, boolean>>({})
  const [goal, setGoal] = useState<Goal>('general_fitness')
  const [bias, setBias] = useState<IntensityBias>(0)
  const unit = useUnitStore(s => s.unit)
  const focusModeEnabled = useFocusModeEnabled()
  const [travel, setTravel] = useState<TravelMode | null>(null)
  const restDefaults = useRef<Record<string, number>>({})
  const startedAt = useRef(new Date())
  // Wall-clock session timing: seconds banked from earlier stretches of this
  // session (pauses at the hub, app restarts) + when the current stretch resumed.
  const accumulatedSec = useRef(0)
  const resumedAtMs = useRef<number | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  // Lifecycle guards, kept in a ref so the focus effect can read the latest
  // values without re-arming itself every render (which would loop).
  const lifecycle = useRef({ sessionActive: false, hasParam: false, inFlight: false, lastLoadAt: 0 })
  useEffect(() => { lifecycle.current.sessionActive = sessionActive }, [sessionActive])
  useEffect(() => { lifecycle.current.hasParam = !!workoutIdParam }, [workoutIdParam])
  // Whether the running session came from a Quick Workout — survives param
  // consumption so the completion screen still knows.
  const isQuickSession = useRef(false)

  const runLoad = async (explicitId?: string): Promise<{ id: string | null; resumedLogId: string | null }> => {
    const l = lifecycle.current
    if (l.inFlight) return { id: null, resumedLogId: null }
    l.inFlight = true
    try {
      const res = await loadWorkout(explicitId)
      l.lastLoadAt = Date.now()
      return res
    } catch (e) {
      // loadWorkout has no enclosing try/catch of its own — a throw anywhere in
      // its ~270 lines (a `.single()` with 0 rows, a network drop mid-chain)
      // used to leave `loading` stuck true forever with no error shown, since
      // its own setLoading(false) calls only sit on specific early-return
      // branches, not a catch-all. Same bug class as the muscle-history.tsx /
      // plan-explainer.tsx fixes (2026-08-09) — this is the highest-traffic
      // screen it was found on.
      captureApiError('plan.loadWorkout', e)
      setLoading(false)
      return { id: null, resumedLogId: null }
    } finally {
      l.inFlight = false
    }
  }

  // Explicit starts: Home's "Start Session" and Quick Workouts push a workoutId,
  // which drops straight into the live session (resuming an already-open log
  // rather than opening a phantom second one). The param is then consumed via
  // setParams so starting the same workout again re-triggers cleanly.
  useEffect(() => {
    if (!userId || !workoutIdParam) return
    isQuickSession.current = quickParam === '1'
    ;(async () => {
      const { id, resumedLogId } = await runLoad(workoutIdParam)
      if (id) {
        if (resumedLogId) setSessionActive(true)
        else await beginSession(id)
      }
      router.setParams({ workoutId: '', quick: '' })
    })()
  }, [userId, workoutIdParam])

  // Hub freshness. All tabs mount at app start (lazy: false), so load once on
  // mount for a warm first visit, then re-check on every tab focus — a finished
  // workout, a new plan, or a date change must never leave yesterday's session
  // on screen. A live logging session is never disturbed.
  useEffect(() => {
    if (!userId || workoutIdParam) return
    runLoad()
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(
    useCallback(() => {
      if (!userId) return
      const l = lifecycle.current
      if (l.sessionActive || l.hasParam || l.inFlight) return
      if (Date.now() - l.lastLoadAt < 15_000) return // fresh enough — skip the churn
      runLoad()
    }, [userId]), // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Plan tour (Phase 6) — fires the first time this tab is focused post-welcome,
  // independent of the Home tour (a user may open Plan before ever settling on
  // The Plan tour is gone (2026-08-31): its three steps taught a calendar with
  // a Week/Month toggle, a split card and a labelled nav row, none of which the
  // UI needed help saying. The one idea worth keeping from it (what a split is)
  // moved into the single first-run tour, which Home starts and which walks the
  // user here for its last two steps. Nothing auto-starts from this screen now.

  // Learn how this user's real sessions compare to estimates (best-effort).
  useEffect(() => {
    if (!userId) return
    fetchPaceFactor(supabase, userId).then(setPaceFactor).catch(() => {})
  }, [userId])

  // Prepare a workout for the hub/session: loads the row, exercises, targets and
  // pre-filled sets, but does NOT open a workout_logs row — that happens on start,
  // so merely viewing the hub never creates a phantom session. If a log row is
  // already open for this workout (app killed mid-session), it's adopted and its
  // logged sets rehydrated, so nothing is lost and no duplicate log is created.
  async function loadWorkout(explicitId?: string): Promise<{ id: string | null; resumedLogId: string | null }> {
    setNotFound(false)
    let targetId: string | undefined = explicitId

    if (!targetId) {
      // Fall back to today's first scheduled workout
      const { data: found } = await supabase
        .from('scheduled_workouts')
        .select('id')
        .eq('user_id', userId)
        .eq('planned_date', toDateStr(new Date()))
        .eq('status', 'scheduled')
        .limit(1)
        .maybeSingle()
      if (!found) {
        // Nothing PENDING today — but don't assume nothing was ever planned.
        // Check for an already-completed session so the hub can say "you're
        // done," not imply the day was empty.
        const { data: doneToday } = await supabase
          .from('scheduled_workouts')
          .select('focus')
          .eq('user_id', userId)
          .eq('planned_date', toDateStr(new Date()))
          .eq('status', 'completed')
          .order('planned_start_time', { ascending: false })
          .limit(1)
          .maybeSingle()
        setTodayCompletedFocus((doneToday?.focus as string | undefined) ?? null)
        setNotFound(true)
        setLoading(false)
        return { id: null, resumedLogId: null }
      }
      setTodayCompletedFocus(null)
      targetId = found.id
    }

    const { data: workoutRow } = await supabase
      .from('scheduled_workouts')
      .select('id, focus, planned_date, planned_duration_min, exercise_ids, status, source, split_id, progression, exercise_config, calendar_event_id, calendar_provider')
      .eq('id', targetId)
      .single()

    if (!workoutRow) { setNotFound(true); setLoading(false); return { id: null, resumedLogId: null } }
    setWorkout(workoutRow as WorkoutRow)
    setRestOverride(getRestPref((workoutRow as WorkoutRow).focus))
    const progression = (workoutRow.progression ?? null) as WeekProgression | null

    // An open (never-completed) log for this workout means a session was already
    // running when the app died or the user walked away. Adopt a fresh one;
    // close out a stale one so it stops haunting the data.
    let resumedLog: { id: string; started_at: string; active_seconds: number | null } | null = null
    try {
      const { data: openLog } = await supabase
        .from('workout_logs')
        .select('id, started_at, notes, active_seconds')
        .eq('user_id', userId)
        .eq('scheduled_workout_id', workoutRow.id)
        .is('completed_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (openLog) {
        const ageMs = Date.now() - new Date(openLog.started_at as string).getTime()
        if (ageMs < 12 * 60 * 60 * 1000) {
          resumedLog = openLog as { id: string; started_at: string; active_seconds: number | null }
          setNoteText((openLog.notes as string | null) ?? '')
          setNoteSaved(!!(openLog.notes as string | null))
        } else {
          // Too old to resume — zero-length close so it never counts as time trained.
          await supabase.from('workout_logs')
            .update({ completed_at: openLog.started_at })
            .eq('id', openLog.id)
        }
      }
    } catch { /* resume is best-effort; worst case is the old behaviour */ }

    if (resumedLog) {
      setWorkoutLogId(resumedLog.id)
      startedAt.current = new Date(resumedLog.started_at)
      // Resume the ACTIVE time, not the wall clock. Deriving it from started_at
      // counted every minute the user was paused — pause a session, come back two
      // hours later, and the timer read two hours, which also inflated the
      // duration written on completion (founder, 2026-09-07: "when pausing
      // workout, time should pause too"). Logs written before active_seconds
      // existed have no value, so those keep the old derivation rather than
      // resuming from a number we do not have.
      accumulatedSec.current = resumeElapsedSeconds(resumedLog.active_seconds, startedAt.current)
      setElapsed(Math.floor(accumulatedSec.current))
    } else {
      setWorkoutLogId(null)
      accumulatedSec.current = 0
      setElapsed(0)
      setNoteText('')
      setNoteSaved(false)
    }

    const exerciseIds: string[] = workoutRow.exercise_ids ?? []

    // The user's goal drives rep/rest schemes; a rough recovery day trims volume;
    // their last "too easy / too hard" feedback biases this session's volume.
    const [{ data: profileRow }, readiness, intensityBias] = await Promise.all([
      supabase.from('user_profiles').select('goal').eq('user_id', userId).maybeSingle(),
      getTodayReadiness(userId),
      getIntensityBias(supabase, userId),
    ])
    const goal = (profileRow?.goal ?? 'general_fitness') as Goal
    setGoal(goal)
    setBias(intensityBias)
    const readinessLow = readiness != null && readiness < 50

    // Fetch full exercise rows and restore the plan's original order
    const { data: exRows } = exerciseIds.length
      ? await supabase
          .from('exercises')
          .select('id, name, movement_pattern, muscle_group, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, video_url, substitute_ids, tracking_metrics')
          .in('id', exerciseIds)
      : { data: [] }

    // A user-built ("custom") workout carries its own per-exercise prescription +
    // metrics; honor those instead of the autoregulated plan targets.
    const cfgByEx = new Map<string, WorkoutExerciseConfig>(
      ((workoutRow.exercise_config ?? []) as WorkoutExerciseConfig[]).map(c => [c.exercise_id, c]),
    )

    const orderedRaw = exerciseIds
      .map(id => (exRows ?? []).find((e: any) => e.id === id))
      .filter(Boolean) as ExerciseRow[]

    // If the user is travelling, adapt the session in memory to the gear they have.
    const tm = await getActiveTravelMode(supabase, userId)
    setTravel(tm)
    const ordered = tm ? await adaptToTravelEquipment(orderedRaw, tm.equipment) : orderedRaw
    const effectiveIds = ordered.map(e => e.id)

    setExercises(ordered)
    setExpandedId(ordered[0]?.id ?? null)
    setGifIds({})
    setPerSide(Object.fromEntries(ordered.map(ex => [ex.id, getUnilateralPref(ex.name)])))

    // Pre-fetch exercise IDs in the background; expo-image handles the actual GIF download with auth headers
    ordered.forEach(ex => {
      if (getExerciseGifSource(ex.id)) return // verified clip by id — no name lookup needed
      fetchExerciseId(ex.name).then(id => {
        if (id) setGifIds(prev => ({ ...prev, [ex.id]: id }))
      })
    })

    // Build each exercise's "last session" performance → next-session prescription
    // + the per-set PREV column. History is read before the new log exists, so the
    // current session can't contaminate it.
    const prevBySetMap: Record<string, string[]> = {}
    const targetMap: Record<string, ExercisePrescription> = {}
    const metricsMap: Record<string, MetricKey[]> = {}

    // Metrics per exercise: a custom workout's config wins; otherwise the exercise's
    // own tracking_metrics (built-ins default to weight + reps).
    for (const ex of ordered) {
      const cfg = cfgByEx.get(ex.id)
      metricsMap[ex.id] = cfg?.metrics?.length ? cfg.metrics : metricsFor(ex as any)
    }

    if (effectiveIds.length) {
      // Bounded: we only need each exercise's LAST working session for PREV +
      // the prescription, so cap the pull instead of scanning years of history
      // (a 10-year account has tens of thousands of set_logs rows). Warm-ups are
      // excluded — they must never drag next session's targets or PREV down.
      let historyQuery = supabase
        .from('set_logs')
        .select('exercise_id, workout_log_id, set_number, weight_lbs, reps_completed, rpe, duration_sec, distance_m, completed_at')
        .in('exercise_id', effectiveIds)
        .not('is_warmup', 'is', true)
      // Exclude the CURRENT session's own log (resumedLog, if this is a
      // pause/resume reload) — otherwise re-running this on resume, after even
      // one set is already logged today, sees today's own partial log as the
      // "most recent" (its completed_at is newer than the real last session)
      // and PREV blanks for every set not yet logged today. Fixed 2026-08-02:
      // this used to filter in JS AFTER the .limit() below, so today's own
      // rows (sorted first, being most recent) could eat into the capped
      // budget before it reached far enough back for a workout with many
      // exercises — now excluded in the query itself, so the limit is only
      // ever spent on genuinely relevant historical rows.
      if (resumedLog?.id) historyQuery = historyQuery.neq('workout_log_id', resumedLog.id)
      const { data: history } = await historyQuery
        .order('completed_at', { ascending: false })
        .limit(Math.max(60, effectiveIds.length * 20))

      for (const ex of ordered) {
        const rows = (history ?? []).filter(r => r.exercise_id === ex.id)
        const lastLogId = rows[0]?.workout_log_id
        const lastSets = rows
          .filter(r => r.workout_log_id === lastLogId)
          .sort((a, b) => a.set_number - b.set_number)
        const perf: SetPerformance[] = lastSets.map(r => ({
          weight_lbs: r.weight_lbs, reps: r.reps_completed, rpe: r.rpe,
        }))
        // PREV column renders in the user's display unit (storage stays lbs).
        const u = useUnitStore.getState().unit
        prevBySetMap[ex.id] = lastSets.map(r =>
          r.weight_lbs != null ? `${displayWeight(r.weight_lbs, u)}×${r.reps_completed}`
            : r.duration_sec != null ? `${r.duration_sec}s`
              : r.distance_m != null ? `${r.distance_m}m`
                : `${r.reps_completed}`)

        const cfg = cfgByEx.get(ex.id)
        targetMap[ex.id] = cfg
          ? {
              sets: Math.max(1, cfg.sets), repLow: cfg.rep_low, repHigh: cfg.rep_high,
              restSeconds: 90, suggestedWeight: cfg.weight_lbs, direction: 'new',
              reason: 'Your target for this workout.', lastSummary: null,
            }
          : buildPrescription(perf, goal, ex.movement_pattern, readinessLow, intensityBias, progression, classifyExercise(ex).role, { group: ex.muscle_group ?? null, setsThisWeek: weeklySetsByGroup.get(ex.muscle_group ?? '') ?? 0, experience }, classifyExercise(ex).slot)
      }
    } else {
      for (const ex of ordered) {
        const cfg = cfgByEx.get(ex.id)
        if (cfg) targetMap[ex.id] = {
          sets: Math.max(1, cfg.sets), repLow: cfg.rep_low, repHigh: cfg.rep_high,
          restSeconds: 90, suggestedWeight: cfg.weight_lbs, direction: 'new',
          reason: 'Your target for this workout.', lastSummary: null,
        }
      }
    }

    setPrevBySet(prevBySetMap)
    setTargets(targetMap)
    setExMetrics(metricsMap)

    // Pre-fill sets from each prescription so logging is a one-tap confirm, not
    // manual entry — matching the "least manual input" principle.
    const initialSets: Record<string, SetState[]> = {}
    for (const ex of ordered) {
      const p = targetMap[ex.id]
      const cfg = cfgByEx.get(ex.id)
      const count = p?.sets ?? 3
      restDefaults.current[ex.id] = p?.restSeconds ?? 90
      initialSets[ex.id] = Array.from({ length: count }, () => ({
        // Weight inputs hold the DISPLAY unit; converted back to lbs on log.
        lbs: toInputString(p?.suggestedWeight, useUnitStore.getState().unit),
        reps: p ? String(p.repHigh) : '',
        durationSec: cfg?.duration_sec != null ? String(cfg.duration_sec) : '',
        distanceM: cfg?.distance_m != null ? String(cfg.distance_m) : '',
        rpe: null,
        done: false,
      }))
    }

    // Resuming an open session: lay the already-logged sets back over the grid so
    // the user picks up exactly where the session died — nothing re-logged twice.
    if (resumedLog) {
      try {
        const { data: loggedSets } = await supabase
          .from('set_logs')
          .select('exercise_id, set_number, weight_lbs, reps_completed, rpe, duration_sec, distance_m, is_warmup')
          .eq('workout_log_id', resumedLog.id)
          .order('set_number')
        for (const s of (loggedSets ?? []) as any[]) {
          const arr = initialSets[s.exercise_id as string]
          if (!arr) continue
          const idx = Math.max(0, (s.set_number as number) - 1)
          while (arr.length <= idx) {
            arr.push({ lbs: '', reps: '', durationSec: '', distanceM: '', rpe: null, done: false })
          }
          arr[idx] = {
            lbs: toInputString(s.weight_lbs as number | null, useUnitStore.getState().unit),
            reps: s.reps_completed != null ? String(s.reps_completed) : '',
            durationSec: s.duration_sec != null ? String(s.duration_sec) : '',
            distanceM: s.distance_m != null ? String(s.distance_m) : '',
            rpe: (s.rpe as number | null) ?? null,
            done: true,
            warmup: !!s.is_warmup,
          }
        }
      } catch { /* worst case: previously logged sets show as unlogged */ }
    }
    setSets(initialSets)

    setLoading(false)
    return { id: workoutRow.id, resumedLogId: resumedLog?.id ?? null }
  }

  // Open the live logging session for a prepared workout: stamp the start time, open
  // a workout_logs row, and switch into the session view. Called on an explicit start
  // or from the hub's "Start session" — never just from viewing the hub.
  //
  // beginningSessionRef guards the async gap between tap and `setSessionActive`/
  // `setWorkoutLogId` actually landing: the button's onPress still reads the PRE-
  // update `workoutLogId` (null) on a fast double-tap, since React hasn't
  // re-rendered yet, so both taps would otherwise reach the insert below and
  // open two concurrent workout_logs rows for the same session.
  const beginningSessionRef = useRef(false)
  async function beginSession(scheduledId: string) {
    if (beginningSessionRef.current) return
    beginningSessionRef.current = true
    try {
    startedAt.current = new Date()
    accumulatedSec.current = 0
    setElapsed(0)
    const { data: logRow, error } = await supabase
      .from('workout_logs')
      .insert({
        scheduled_workout_id: scheduledId,
        user_id: userId,
        started_at: startedAt.current.toISOString(),
      })
      .select('id')
      .single()
    if (error || !logRow) {
      // Without a log row nothing in the session could save (sets no-op, Complete
      // is dead) — never enter that trap silently. Classify the failure: an expired
      // session in a gym is NOT a connection problem, and saying so sends the user
      // chasing the wrong fix.
      const info = describeSaveError(error, 'start your session')
      Alert.alert('Couldn’t start session', `${info.message}\n\nTap Start again when you’re ready.`)
      return
    }
    setSaveWarned.current = false
    setWorkoutLogId(logRow.id)
    setSessionActive(true)
    // session_start previously only fired from quick-workout.tsx — a planned
    // session (the far more common path) never tracked its own start at all,
    // so the funnel undercounted every non-Quick-Workout session (C9).
    track('session_start', { type: 'planned', duration_min: workout?.planned_duration_min ?? undefined })
    } finally {
      beginningSessionRef.current = false
    }
  }

  // ── Timer ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Timer only runs while the session view is open — leaving to the hub pauses it.
    // Wall-clock based: locking the phone between sets must not stop the clock, so
    // each tick derives elapsed from real timestamps instead of counting intervals.
    if (!workoutLogId || !sessionActive) return
    resumedAtMs.current = Date.now()
    const tick = () => {
      const running = resumedAtMs.current != null ? (Date.now() - resumedAtMs.current) / 1000 : 0
      setElapsed(Math.floor(accumulatedSec.current + running))
    }
    tick()
    const iv = setInterval(tick, 1000)
    const logId = workoutLogId
    return () => {
      clearInterval(iv)
      // Bank the stretch that just ended so a hub pause doesn't lose (or double) time.
      if (resumedAtMs.current != null) {
        accumulatedSec.current += (Date.now() - resumedAtMs.current) / 1000
        resumedAtMs.current = null
      }
      // Persist it, so a pause that outlives this component — app restart, tab
      // switch, resuming tomorrow — comes back to the time actually trained
      // rather than the wall clock. Best-effort: a failed write just means this
      // session resumes on the old derivation, never a lost or blocked pause.
      const banked = Math.floor(accumulatedSec.current)
      if (logId && banked > 0) {
        supabase.from('workout_logs')
          .update({ active_seconds: banked })
          .eq('id', logId)
          .then(() => {}, () => {})
      }
    }
  }, [workoutLogId, sessionActive])

  // Keep the screen awake during a live session — a dimming phone mid-set is how
  // people lose their place (and their rest timer).
  useEffect(() => {
    if (!sessionActive) return
    activateKeepAwakeAsync('tempo-session').catch(() => {})
    return () => { deactivateKeepAwake('tempo-session') }
  }, [sessionActive])

  // First live session ever → a one-time coach overlay explaining the logger, plus
  // the first-workout analytics moment (once per account, framework-tracked).
  const firstWorkoutTracked = useRef(false)
  const firstSetTracked = useRef(false)
  useEffect(() => {
    if (!sessionActive) return
    try {
      const seen = (globalThis as { localStorage?: Storage }).localStorage?.getItem('tempo.coach.session')
      if (!seen) setCoachVisible(true)
    } catch { /* no storage → just skip the coach */ }
    const tut = useTutorialStore.getState()
    if (!firstWorkoutTracked.current && !tut.data.firstWorkoutCompleted) {
      firstWorkoutTracked.current = true
      track('first_workout_started', { experience })
    }
  }, [sessionActive])
  const dismissCoach = () => {
    setCoachVisible(false)
    try { (globalThis as { localStorage?: Storage }).localStorage?.setItem('tempo.coach.session', '1') } catch { /* best-effort */ }
  }

  // Session note ("bench felt heavy today") → workout_logs.notes.
  const saveNote = async () => {
    setNoteOpen(false)
    if (!workoutLogId) return
    const note = noteText.trim()
    setNoteSaved(!!note)
    await supabase.from('workout_logs').update({ notes: note || null }).eq('id', workoutLogId).then(() => {}, () => {})
  }

  // ── Set actions ────────────────────────────────────────────────────────────

  const updateSet = (exId: string, idx: number, field: 'lbs' | 'reps' | 'durationSec' | 'distanceM', value: string) => {
    setSets(prev => ({
      ...prev,
      [exId]: prev[exId].map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }))
  }

  // One "your set didn't save" alert per session — offline in a gym shouldn't
  // nag on every set, but the unchecked ✓ always shows the truth.
  const setSaveWarned = useRef(false)

  // The rest that applies right now for an exercise: the user's per-workout
  // choice wins; otherwise the prescription; otherwise the 2-minute default.
  const restFor = (exId: string): number =>
    restOverride ?? restDefaults.current[exId] ?? SUGGESTED_REST_SEC

  // The typed weight, converted to stored lbs — doubled first if this exercise
  // is toggled "per side" (no schema change: the stored total is what every
  // existing volume/PR calculation already reads, so this is the only place
  // the convention needs to be applied).
  const weightLbsFor = (exId: string, lbsInput: string): number | null => {
    if (!lbsInput) return null
    const total = inputToLbs(lbsInput, useUnitStore.getState().unit)
    if (total == null) return null
    return perSide[exId] ? total * 2 : total
  }

  // Tapping ✓ logs the set IMMEDIATELY — rest starts, haptic fires, done. RPE is
  // captured after the fact via an optional follow-up bar; it must never gate
  // logging or the rest timer.
  //
  // pendingSetLogRef guards against a fast double-tap inserting the SAME set
  // twice: `set.done` below reads from `sets` state, which React only updates
  // on the next render — two taps landing before that render both see
  // `done: false` and would otherwise both reach the insert below (no unique
  // DB constraint backstops it). A ref updates synchronously, so the second
  // tap is caught here regardless of render timing. Keyed per set (not a
  // single flag) so logging one exercise's set never blocks another's.
  const pendingSetLogRef = useRef<Set<string>>(new Set())
  const handleSetDone = async (exId: string, idx: number) => {
    if (!workoutLogId) return
    const setKey = `${exId}:${idx}`
    if (pendingSetLogRef.current.has(setKey)) return
    const set = sets[exId]?.[idx]
    if (!set || set.done) return
    pendingSetLogRef.current.add(setKey)
    try {

    haptics.tapLight()
    // The very first set this account ever logs — the retention hinge moment.
    if (!firstSetTracked.current && !useTutorialStore.getState().data.firstWorkoutCompleted) {
      firstSetTracked.current = true
      track('first_set_logged', { experience })
    }
    setSets(prev => ({
      ...prev,
      [exId]: prev[exId].map((s, i) => i === idx ? { ...s, done: true } : s),
    }))
    setRpeFollowUp({ exId, idx })

    // Auto-start the rest timer using this exercise's effective rest
    startRest(restFor(exId), exercises.find(e => e.id === exId)?.name)
    // Rest deserves the whole screen — nothing else to do while it counts
    // down. Only auto-OPENS; never auto-closes an already-open Focus Mode
    // on a different exercise mid-flow. Respects the "Workout Focus Mode"
    // device preference — off means classic scrolling-list only.
    setFocusExId(exId)
    if (focusModeEnabled) setFocusOpen(true)
    setLastLoggedSet({ exId, idx })

    // Exercise fully banked? A firmer tick, and the next incomplete exercise
    // opens by itself so the flow never stalls on a collapsed accordion.
    const after = sets[exId].map((s, i) => (i === idx ? { ...s, done: true } : s))
    if (after.every(s => s.done)) {
      haptics.tapMedium()
      const next = exercises.find(e => e.id !== exId && (sets[e.id] ?? []).some(s => !s.done))
      if (next) {
        if (!reduceMotion) {
          LayoutAnimation.configureNext(
            LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
          )
        }
        setExpandedId(next.id)
      }
    }

    const setLogPayload = {
      workout_log_id: workoutLogId,
      exercise_id: exId,
      set_number: idx + 1,
      reps_completed: parseInt(set.reps) || 0,
      // The input holds the display unit — storage is always lbs (doubled
      // first if this exercise is toggled "per side").
      weight_lbs: weightLbsFor(exId, set.lbs),
      duration_sec: set.durationSec ? parseInt(set.durationSec) : null,
      distance_m: set.distanceM ? parseFloat(set.distanceM) : null,
      rpe: null,
      is_warmup: !!set.warmup,
      completed_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('set_logs').insert(setLogPayload)
    if (error) {
      // Un-check it — a ✓ that never reached the server would silently drop the
      // set from PRs, volume, and next session's PREV column. The exercise may have
      // been swapped out while the insert was in flight — its row is gone then, and
      // there's nothing to un-check.
      setSets(prev => prev[exId]
        ? { ...prev, [exId]: prev[exId].map((s, i) => i === idx ? { ...s, done: false } : s) }
        : prev)
      setRpeFollowUp(cur => (cur?.exId === exId && cur?.idx === idx ? null : cur))
      // Durable fallback for "the user never taps retry and closes the app" —
      // the visible retry prompt above is still the primary recovery path;
      // this just means a network blip can't silently cost the set entirely.
      // See lib/pendingSetLogs.ts.
      queuePendingSetLog(setLogPayload).catch(() => {})
      if (!setSaveWarned.current) {
        setSaveWarned.current = true
        const info = describeSaveError(error, 'save this set')
        Alert.alert('Set didn’t save', `${info.message}\n\nYour numbers are still in the row — tap the ✓ to retry.`)
      }
    } else {
      // Clears a stale queued attempt if this set had failed once already and
      // is now succeeding via the manual retry — otherwise a later app-open
      // flush would insert it a second time. No-op (cheap) in the overwhelmingly
      // common case where nothing was ever queued for this set.
      clearPendingSetLog(setLogPayload).catch(() => {})
    }

    } finally {
      pendingSetLogRef.current.delete(setKey)
    }
  }

  // Save an edit to an already-logged set (wrong reps/weight typed in the
  // moment — fix it after the fact rather than delete-and-redo). Targets the
  // same natural key attachRpe already uses (workout_log_id + exercise_id +
  // set_number), so it can't drift from the row this UI is actually showing.
  const savingSetEdit = useRef(false)
  const saveSetEdit = async (exId: string, idx: number) => {
    if (savingSetEdit.current) return
    const set = sets[exId]?.[idx]
    setEditingSet(null)
    if (!set || !workoutLogId) return
    savingSetEdit.current = true
    try {
      const { error } = await supabase
        .from('set_logs')
        .update({
          reps_completed: parseInt(set.reps) || 0,
          weight_lbs: weightLbsFor(exId, set.lbs),
          duration_sec: set.durationSec ? parseInt(set.durationSec) : null,
          distance_m: set.distanceM ? parseFloat(set.distanceM) : null,
        })
        .eq('workout_log_id', workoutLogId)
        .eq('exercise_id', exId)
        .eq('set_number', idx + 1)
      if (error) {
        const info = describeSaveError(error, 'save that edit')
        Alert.alert('Couldn’t save the edit', info.message)
        return
      }
      // Progress/volume/PRs all re-derive live from set_logs on next fetch —
      // nothing else caches a stale copy of this number, so invalidating the
      // shared training-data keys is enough to make the edit show up everywhere.
      invalidateTrainingData(queryClient)
    } finally {
      savingSetEdit.current = false
    }
  }

  // Attach an RPE to a set that already logged (optional, after the fact).
  const attachRpe = async (exId: string, idx: number, rpe: number) => {
    haptics.tapLight()
    setRpeFollowUp(null)
    setSets(prev => prev[exId]
      ? { ...prev, [exId]: prev[exId].map((s, i) => i === idx ? { ...s, rpe } : s) }
      : prev)
    if (!workoutLogId) return
    // A fast tap can race the set's own insert (still in flight) — if the update
    // matched no row, retry once shortly after so the RPE isn't silently dropped.
    const runUpdate = () => supabase.from('set_logs')
      .update({ rpe })
      .eq('workout_log_id', workoutLogId)
      .eq('exercise_id', exId)
      .eq('set_number', idx + 1)
      .select('id')
    const { data } = await runUpdate()
    if (!data?.length) {
      setTimeout(() => { runUpdate().then(() => {}, () => {}) }, 1200)
    }
  }

  const addSet = (exId: string) => {
    haptics.tapLight()
    setSets(prev => ({
      ...prev,
      [exId]: [...prev[exId], { lbs: '', reps: '', durationSec: '', distanceM: '', rpe: null, done: false }],
    }))
  }

  // Warm-up sets are excluded from PREV / progression / volume everywhere. They
  // go before the first NOT-yet-logged set: at the top normally, but never before
  // an already-logged set (that would shift a done set's position and collide its
  // server set_number).
  const addWarmupSet = (exId: string) => {
    haptics.tapLight()
    setSets(prev => {
      const arr = prev[exId] ?? []
      const firstOpen = arr.findIndex(s => !s.done)
      const at = firstOpen === -1 ? arr.length : firstOpen
      const warm: SetState = { lbs: '', reps: '', durationSec: '', distanceM: '', rpe: null, done: false, warmup: true }
      return { ...prev, [exId]: [...arr.slice(0, at), warm, ...arr.slice(at)] }
    })
  }

  // Remove a set — accidental taps on "+ Add Set" or a mis-logged set shouldn't
  // pollute volume, totals or the next session's PREV column. A logged set's
  // row is deleted server-side and later sets renumbered so history stays dense.
  const removeSet = (exId: string, idx: number) => {
    const arr = sets[exId]
    if (!arr || arr.length <= 1) {
      Alert.alert('Can’t remove', 'Every exercise needs at least one set — swap or skip the exercise instead.')
      return
    }
    setRemoveSetConfirm({ exId, idx, wasDone: arr[idx].done })
  }

  const doRemoveSet = async () => {
    const confirm = removeSetConfirm
    setRemoveSetConfirm(null)
    if (!confirm) return
    const { exId, idx, wasDone } = confirm
    haptics.tapMedium()
    setRpeFollowUp(cur => (cur?.exId === exId ? null : cur))
    setSets(prev => prev[exId]
      ? { ...prev, [exId]: prev[exId].filter((_, i) => i !== idx) }
      : prev)
    if (!workoutLogId) return
    try {
      if (wasDone) {
        await supabase.from('set_logs')
          .delete()
          .eq('workout_log_id', workoutLogId)
          .eq('exercise_id', exId)
          .eq('set_number', idx + 1)
      }
      // Close the numbering gap so resume/PREV rebuilds line up with the
      // shifted local rows — later LOGGED sets slide down one slot whether
      // the removed set was logged or not.
      const { data: later } = await supabase.from('set_logs')
        .select('id, set_number')
        .eq('workout_log_id', workoutLogId)
        .eq('exercise_id', exId)
        .gt('set_number', idx + 1)
        .order('set_number')
      for (const row of (later ?? []) as { id: string; set_number: number }[]) {
        await supabase.from('set_logs').update({ set_number: row.set_number - 1 }).eq('id', row.id)
      }
    } catch { /* worst case: a gap in set numbers — totals still correct */ }
  }

  // ── Add exercise mid-session ────────────────────────────────────────────────

  // Append an exercise to the RUNNING session. This ALWAYS persists to the
  // scheduled row (so a pause/resume or app restart keeps it — fixed
  // 2026-08-02: this used to only persist when `goingForward` was true,
  // silently losing a "just for today" addition the moment the session was
  // reloaded, since loadWorkout always rebuilds `exercises` from this same
  // column). `goingForward` additionally propagates into the split template
  // AND every already-materialized future instance of this weekday
  // (lib/splitSchedule.propagateSplitDayEdit — see its own header comment for
  // why both are needed), so "going forward" actually means every upcoming
  // day, not just ones more than ~4 weeks out.
  const addExerciseToSession = async (ex: ExerciseRow, goingForward: boolean) => {
    const prescription = buildPrescription([], goal, ex.movement_pattern, false, bias, workout?.progression ?? null, classifyExercise(ex).role, { group: ex.muscle_group ?? null, setsThisWeek: weeklySetsByGroup.get(ex.muscle_group ?? '') ?? 0, experience }, classifyExercise(ex).slot)
    restDefaults.current[ex.id] = prescription.restSeconds
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
      )
    }
    setExercises(prev => [...prev, ex])
    setTargets(prev => ({ ...prev, [ex.id]: prescription }))
    setPrevBySet(prev => ({ ...prev, [ex.id]: [] }))
    setExMetrics(prev => ({ ...prev, [ex.id]: metricsFor(ex as any) }))
    setSets(prev => ({
      ...prev,
      [ex.id]: Array.from({ length: prescription.sets }, () => ({
        lbs: '', reps: String(prescription.repHigh), durationSec: '', distanceM: '', rpe: null, done: false,
      })),
    }))
    setExpandedId(ex.id)
    haptics.tapLight()

    if (!workout) return
    const newIds = [...workout.exercise_ids, ex.id]
    setWorkout({ ...workout, exercise_ids: newIds })
    await supabase.from('scheduled_workouts').update({ exercise_ids: newIds }).eq('id', workout.id)

    if (goingForward && workout.source === 'split' && workout.split_id) {
      try {
        const d = new Date(`${workout.planned_date}T00:00:00`)
        const weekday = ((d.getDay() + 6) % 7) + 1
        await propagateSplitDayEdit(supabase, userId, workout.split_id, weekday, { type: 'add', exerciseId: ex.id })
      } catch { /* the session's own scheduled row still carries it */ }
    }
  }

  // ── Exercise ordering / skip (gym reality: machine occupied, changed my mind) ──

  // Persist the current exercise ORDER to the scheduled row so a reorder survives
  // a pause/restart. Never touches the split template (that's a session-level tweak).
  // Returns the write's promise so a caller where losing the race actually matters
  // (doSkipExercise below) can await it; a plain reorder still fires-and-forgets.
  const persistOrder = async (orderedIds: string[]): Promise<void> => {
    if (!workout) return
    setWorkout({ ...workout, exercise_ids: orderedIds })
    await supabase.from('scheduled_workouts').update({ exercise_ids: orderedIds }).eq('id', workout.id).then(() => {}, () => {})
  }

  const animateReorder = () => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
      )
    }
  }

  const moveExercise = (exId: string, dir: -1 | 1) => {
    haptics.tapLight()
    animateReorder()
    setExercises(prev => {
      const i = prev.findIndex(e => e.id === exId)
      const j = i + dir
      if (i === -1 || j < 0 || j >= prev.length) return prev
      const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]
      persistOrder(next.map(e => e.id))
      return next
    })
  }

  const moveExerciseToEnd = (exId: string) => {
    haptics.tapMedium()
    animateReorder()
    setExercises(prev => {
      const ex = prev.find(e => e.id === exId)
      if (!ex) return prev
      const next = [...prev.filter(e => e.id !== exId), ex]
      persistOrder(next.map(e => e.id))
      return next
    })
    // Reveal the new first unfinished exercise so the flow keeps moving.
    setExpandedId(cur => (cur === exId ? (exercises.find(e => e.id !== exId)?.id ?? cur) : cur))
  }

  // Skip an exercise for THIS session — removes it from the live grid and the
  // scheduled row's order. Any sets already logged for it are deleted so it
  // doesn't count. `goingForward` (N2, 2026-08-02) additionally removes it
  // from the split template AND every already-materialized future instance
  // of this weekday — only offered/meaningful for a split-sourced workout
  // (see addExerciseToSession's comment for why both matter); a plan/quick
  // workout (or the default, unconfirmed choice) stays session-only exactly
  // as before.
  const skipExercise = (ex: ExerciseRow) => setSkipExerciseConfirm(ex)
  const doSkipExercise = async (ex: ExerciseRow, goingForward = false) => {
    haptics.tapMedium()
    animateReorder()
    const remaining = exercises.filter(e => e.id !== ex.id)
    setExercises(remaining)
    setExpandedId(cur => (cur === ex.id ? (remaining[0]?.id ?? null) : cur))
    setSets(prev => { const { [ex.id]: _, ...rest } = prev; return rest })
    // Awaited — unlike a plain reorder, losing this race matters: pausing right
    // after a skip re-runs loadWorkout on resume, which rebuilds `exercises`
    // straight from this same exercise_ids column. If the write hadn't landed
    // yet, resume silently re-materializes the "skipped" exercise with its full,
    // never-completable set count — the estimated time remaining looks wrong and
    // Complete Workout can never reach 100% again, since the user believes it's
    // gone. Fixed 2026-08-02.
    await persistOrder(remaining.map(e => e.id))
    if (workoutLogId) {
      await supabase.from('set_logs').delete().eq('workout_log_id', workoutLogId).eq('exercise_id', ex.id).then(() => {}, () => {})
    }
    if (goingForward && workout?.source === 'split' && workout.split_id) {
      try {
        const d = new Date(`${workout.planned_date}T00:00:00`)
        const weekday = ((d.getDay() + 6) % 7) + 1
        await propagateSplitDayEdit(supabase, userId, workout.split_id, weekday, { type: 'remove', exerciseId: ex.id })
      } catch { /* the session's own scheduled row still reflects the skip */ }
    }
  }

  // Remove an exercise from THIS session (same as skip) AND stop it from ever
  // being suggested again — every future plan/split/quick-workout generation
  // filters against excluded_exercise_ids (exerciseExclusions.ts).
  const removeExercisePermanently = (ex: ExerciseRow) => setRemoveExerciseConfirm(ex)
  const doRemoveExercisePermanently = async (ex: ExerciseRow) => {
    await doSkipExercise(ex)
    if (userId) await excludeExercisePermanently(supabase, userId, ex.id).catch(() => {})
  }

  // ── Swap exercise (smart substitutions) ──────────────────────────────────────

  const handleSwap = async (ex: ExerciseRow) => {
    if (swapping) return
    setSwapping(true)
    try {
      // When travelling, swaps are offered against the equipment on hand, not home.
      const baseEquipment = travel ? travel.equipment : null
      const { data: profileRow } = baseEquipment
        ? { data: { equipment: baseEquipment } }
        : await supabase.from('user_profiles').select('equipment').eq('user_id', userId).maybeSingle()
      const equipment = expandEquipment(profileRow?.equipment ?? [])
      const inWorkout = new Set(exercises.map(e => e.id))

      // Prefer curated substitutes; fall back to same-pattern lifts the user can do.
      const { data: subs } = await supabase
        .from('exercises')
        .select('id, name, movement_pattern, muscle_group, primary_muscles, secondary_muscles, required_equipment, experience_level, instructions, video_url, substitute_ids')
        .eq('movement_pattern', ex.movement_pattern)
        .neq('id', ex.id)

      const candidates = (subs ?? []).filter((s: any) => {
        if (inWorkout.has(s.id)) return false
        const curated = ex.substitute_ids?.includes(s.id)
        const doable = (s.required_equipment as string[]).some(eq => equipment.has(eq))
        return curated || doable
      }) as ExerciseRow[]

      // Curated substitutes first
      candidates.sort((a, b) => {
        const ai = ex.substitute_ids?.includes(a.id) ? 0 : 1
        const bi = ex.substitute_ids?.includes(b.id) ? 0 : 1
        return ai - bi
      })

      if (!candidates.length) {
        Alert.alert('No substitutes', 'No alternatives match your equipment for this movement.')
        return
      }

      // A sheet, not Alert.alert — Android caps alerts at 3 buttons and silently
      // drops the rest, so a 4-candidate swap list lost options there.
      setSwapSheet({ ex, candidates: candidates.slice(0, 8) })
    } finally {
      setSwapping(false)
    }
  }

  // `goingForward` (N2, 2026-08-02) — only meaningful for a split-sourced
  // workout: propagates the swap into the split template AND every already-
  // materialized future instance of this weekday (see addExerciseToSession's
  // comment / lib/splitSchedule.propagateSplitDayEdit for why both matter).
  // Defaults false — a swap stays session-only unless the caller explicitly
  // asked "going forward" (the swap sheet only asks when there's a split to
  // propagate into; a plan/quick workout swaps immediately, as before).
  const replaceExercise = async (oldId: string, next: ExerciseRow, goingForward = false) => {
    const prescription = buildPrescription([], goal, next.movement_pattern, false, bias, workout?.progression, classifyExercise(next).role, { group: next.muscle_group ?? null, setsThisWeek: weeklySetsByGroup.get(next.muscle_group ?? '') ?? 0, experience }, classifyExercise(next).slot)
    restDefaults.current[next.id] = prescription.restSeconds

    setExercises(prev => prev.map(e => e.id === oldId ? next : e))
    setTargets(prev => {
      const { [oldId]: _, ...rest } = prev
      return { ...rest, [next.id]: prescription }
    })
    setPrevBySet(prev => {
      const { [oldId]: _, ...rest } = prev
      return { ...rest, [next.id]: [] }
    })
    setSets(prev => {
      const { [oldId]: _, ...rest } = prev
      return {
        ...rest,
        [next.id]: Array.from({ length: prescription.sets }, () => ({
          lbs: '', reps: String(prescription.repHigh), durationSec: '', distanceM: '', rpe: null, done: false,
        })),
      }
    })
    setExMetrics(prev => {
      const { [oldId]: _, ...rest } = prev
      return { ...rest, [next.id]: metricsFor(next as any) }
    })
    setExpandedId(cur => cur === oldId ? next.id : cur)

    // Persist the swap into the plan so it sticks for this workout
    if (workout) {
      const newIds = workout.exercise_ids.map(id => id === oldId ? next.id : id)
      setWorkout({ ...workout, exercise_ids: newIds })
      await supabase.from('scheduled_workouts').update({ exercise_ids: newIds }).eq('id', workout.id)

      if (goingForward && workout.source === 'split' && workout.split_id) {
        try {
          const d = new Date(`${workout.planned_date}T00:00:00`)
          const weekday = ((d.getDay() + 6) % 7) + 1
          await propagateSplitDayEdit(supabase, userId, workout.split_id, weekday, { type: 'swap', fromId: oldId, toId: next.id })
        } catch { /* the session's own scheduled row still carries it */ }
      }
    }
  }

  // ── Complete workout ───────────────────────────────────────────────────────

  const finishWorkout = async () => {
    if (!workout || !workoutLogId) return
    setCompleting(true)
    stopRest()
    const now = new Date().toISOString()
    // Wall-clock minutes, capped so a session resumed hours later can't log an
    // absurd duration.
    const mins = Math.min(240, Math.max(1, Math.round(elapsed / 60)))

    const [{ error: schedErr }, { error: logErr }] = await Promise.all([
      supabase.from('scheduled_workouts')
        .update({ status: 'completed', completed_at: now, actual_duration_min: mins })
        .eq('id', workout.id),
      supabase.from('workout_logs')
        .update({ completed_at: now })
        .eq('id', workoutLogId),
    ])
    if (schedErr || logErr) {
      // Never celebrate a completion that didn't save (gym wifi dies at the door).
      // The session stays live so one more tap finishes it for real.
      setCompleting(false)
      const info = describeSaveError(schedErr ?? logErr, 'save your workout')
      Alert.alert(
        'Couldn’t save your workout',
        `${info.message}\n\nYour session is still here — tap Complete Workout again.`,
      )
      return
    }

    haptics.success()
    cancelWorkoutReminder(workout.id).catch(() => {})

    // Every screen keyed on training data (Home schedule, Progress, streak,
    // next-workout) refreshes NOW — not whenever it happens to remount.
    invalidateTrainingData(queryClient)

    // Re-evaluate the block's adaptation mode now that another session is logged —
    // may shift the coming weeks into recovery/deload (best-effort, never blocks).
    refreshAdaptation(supabase, userId).catch(() => {})

    // Motivational summary — streak impact, consistency, weekly target progress.
    router.replace({
      pathname: '/workout-complete',
      params: { minutes: String(mins), quick: isQuickSession.current ? '1' : '0', logId: workoutLogId ?? '' },
    })

    // Reset the logger behind the summary so returning to this tab shows a fresh
    // hub (the focus reload repopulates it), not the completed session's grid.
    setSessionActive(false)
    setWorkoutLogId(null)
    setLoading(true)
    lifecycle.current.lastLoadAt = 0
    setCompleting(false)
  }

  // Guardrails: an accidental tap must not mint a fake completed session — that
  // would inflate the streak/consistency and feed junk into adaptation.
  const handleCompleteWorkout = () => {
    if (!workout || !workoutLogId || completing) return
    const all = Object.values(sets)
    const total = all.reduce((n, arr) => n + arr.length, 0)
    const done = all.reduce((n, arr) => n + arr.filter(s => s.done).length, 0)
    // Warm-ups don't count as "real work" — a warm-up-only session is empty.
    const workingDone = all.reduce((n, arr) => n + arr.filter(s => s.done && !s.warmup).length, 0)

    if (workingDone === 0) {
      Alert.alert(
        'No working sets logged',
        'Log at least one working set (warm-ups don’t count) — an empty workout would still count toward your streak and stats.',
      )
      return
    }
    // Founder-requested 2026-08-02: a session under MIN_STREAK_MINUTES doesn't
    // advance the streak (lib/streak.ts) — warn here, before finishing, rather
    // than let the user discover it after the fact.
    if (elapsed < MIN_STREAK_MINUTES * 60) {
      setTooShortConfirm(true)
      return
    }
    if (total > 0 && done < total) {
      setFinishEarlyConfirm({ remaining: total - done, done, total })
      return
    }
    finishWorkout().catch(() => setCompleting(false))
  }

  // "Finish anyway" from the too-short warning still needs the same
  // not-all-sets-logged check handleCompleteWorkout would have done next.
  const finishAfterTooShortConfirm = () => {
    const all = Object.values(sets)
    const total = all.reduce((n, arr) => n + arr.length, 0)
    const done = all.reduce((n, arr) => n + arr.filter(s => s.done).length, 0)
    if (total > 0 && done < total) {
      setFinishEarlyConfirm({ remaining: total - done, done, total })
      return
    }
    finishWorkout().catch(() => setCompleting(false))
  }

  // ── Pause / leave session ───────────────────────────────────────────────────

  // Walking away with zero sets logged shouldn't leave an open log haunting the
  // resume path — delete it and return to a clean hub.
  const discardSession = async () => {
    stopRest()
    if (workoutLogId) {
      try {
        await supabase.from('set_logs').delete().eq('workout_log_id', workoutLogId)
        await supabase.from('workout_logs').delete().eq('id', workoutLogId)
      } catch { /* an orphaned zero-set log is closed out by the stale-log sweep */ }
    }
    // Discarding fully cancels this session: drop it from the plan/feed ('rescheduled'
    // is ignored by the streak and never re-synced) and pull any synced calendar event,
    // so nothing lingers on the user's calendar or their upcoming week.
    if (workout) {
      try {
        if (workout.calendar_event_id) {
          await removeWorkoutFromCalendar(supabase, {
            id: workout.id,
            focus: workout.focus,
            planned_date: workout.planned_date,
            planned_start_time: '00:00:00', // unused by remove; add-only field
            planned_duration_min: workout.planned_duration_min,
            calendar_event_id: workout.calendar_event_id,
            calendar_provider: workout.calendar_provider,
          }, userId)
        }
        await supabase.from('scheduled_workouts').update({ status: 'rescheduled' }).eq('id', workout.id).eq('user_id', userId)
        setWorkout(null)
        queryClient.invalidateQueries({ queryKey: ['scheduled_workouts'] })
        queryClient.invalidateQueries({ queryKey: ['range_events', userId] })
      } catch { /* best-effort — a partial failure never corrupts anything */ }
    }
    setSessionActive(false)
    setWorkoutLogId(null)
    accumulatedSec.current = 0
    setElapsed(0)
  }

  const onPauseChoice = (key: string) => {
    setPauseSheet(false)
    if (key === 'pause') {
      // Progress is saved (logged sets are on the server; the open log resumes
      // from the hub or after an app restart). Cancel the pending rest buzz so
      // a paused workout doesn't vibrate the pocket.
      stopRest()
      setSessionActive(false)
    } else if (key === 'end') {
      const done = Object.values(sets).reduce((n, arr) => n + arr.filter(s => s.done).length, 0)
      if (done === 0) {
        setDiscardConfirm(true)
      } else {
        handleCompleteWorkout()
      }
    }
  }

  // ── Rest timer ─────────────────────────────────────────────────────────────

  // The countdown derives from the wall-clock end time, so backgrounding never
  // freezes it; the scheduled OS notification covers a locked phone. In the
  // foreground, completion is a vibration — not an Alert that steals the screen.
  // Name of whatever's resting right now — set alongside restEndsAt so
  // adjustRest (which only has a delta, not an exercise id) can still push a
  // correctly-labeled Live Activity update.
  const restExerciseName = useRef('Resting')

  useEffect(() => {
    if (restEndsAt === null) { setRestSecondsLeft(null); return }
    const tick = () => {
      const left = Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000))
      if (left <= 0) {
        setRestEndsAt(null)
        setRestSecondsLeft(null)
        haptics.warning()
        cancelRestDoneNotification().catch(() => {})
        endRestActivity()
      } else {
        setRestSecondsLeft(left)
      }
    }
    tick()
    const iv = setInterval(tick, 500)
    return () => clearInterval(iv)
  }, [restEndsAt])

  const startRest = (seconds: number, exerciseName?: string) => {
    restExerciseName.current = exerciseName ?? workout?.focus ?? 'Resting'
    const endsAt = Date.now() + seconds * 1000
    setRestTotal(seconds)
    setRestEndsAt(endsAt)
    scheduleRestDoneNotification(seconds).catch(() => {})
    startRestActivity(restExerciseName.current, endsAt, seconds)
  }
  const stopRest = () => {
    setRestEndsAt(null)
    cancelRestDoneNotification().catch(() => {})
    endRestActivity()
  }

  // Rest-length choices in a sheet, not Alert.alert (Android caps alerts at 3
  // buttons, which dropped an option). Picking a length also becomes this
  // workout's rest going forward (persisted per workout name) — "customize per
  // workout" without a settings hunt.
  const [restSheet, setRestSheet] = useState(false)
  const [customRestOpen, setCustomRestOpen] = useState(false)
  const [customRestSec, setCustomRestSec] = useState(SUGGESTED_REST_SEC)

  // ── Focus Mode ──────────────────────────────────────────────────────────
  // A full-screen view for the set currently in play — auto-opens when a rest
  // timer starts (nothing else to look at while resting), and can be reopened
  // manually per exercise. Tracks only WHICH EXERCISE; the current set within
  // it is always derived (first not-yet-done set) so it can never drift out
  // of sync with the list as sets get logged.
  const [focusOpen, setFocusOpen] = useState(false)
  const [focusExId, setFocusExId] = useState<string | null>(null)
  // The set that just logged — so Focus Mode can ask "how much weight did you
  // do?" during the rest that follows, without the user ever exiting to the
  // list. Only rendered while resting (see the FocusMode props below); reusing
  // updateSet/saveSetEdit means this is the SAME edit-after-logging path the
  // list view already has, not a second one.
  const [lastLoggedSet, setLastLoggedSet] = useState<{ exId: string; idx: number } | null>(null)
  const focusSetsArr = focusExId ? (sets[focusExId] ?? []) : []
  const focusIdx = focusSetsArr.findIndex(s => !s.done)
  const focusSet = focusIdx >= 0 ? focusSetsArr[focusIdx] : null
  const focusEx = exercises.find(e => e.id === focusExId) ?? null
  // Auto-close once this exercise's sets are all done AND rest (if any) is
  // over — nothing left to focus on. Waiting on rest here (not closing the
  // instant the last set logs) is deliberate: closing immediately used to cut
  // Focus Mode off mid-celebration, before the user could see the rest ring,
  // log "how much did you do?", or rate RPE for that final set — the same
  // window every other set in the exercise gets.
  useEffect(() => {
    if (focusOpen && focusExId && focusIdx === -1 && restEndsAt === null) setFocusOpen(false)
  }, [focusOpen, focusExId, focusIdx, restEndsAt])

  const adjustRest = (deltaSec: number) => {
    if (restEndsAt === null) return
    haptics.tapLight()
    const next = Math.max(Date.now() + 1000, restEndsAt + deltaSec * 1000)
    setRestEndsAt(next)
    setRestTotal(t => Math.max(1, t + deltaSec))
    updateRestActivity(restExerciseName.current, next, Math.max(1, restTotal + deltaSec))
  }

  const focusSkip = () => {
    if (!focusExId) return
    if (restEndsAt !== null) { stopRest(); return }
    if (focusIdx >= 0) removeSet(focusExId, focusIdx)
  }
  const focusDone = () => {
    if (!focusExId || focusIdx < 0) return
    handleSetDone(focusExId, focusIdx)
  }
  const handleRestTimer = () => {
    if (restEndsAt !== null) {
      stopRest()
      return
    }
    setRestSheet(true)
  }
  const applyRestChoice = (secs: number) => {
    if (!Number.isFinite(secs) || secs <= 0) return
    setRestOverride(secs)
    if (workout) setRestPref(workout.focus, secs)
    startRest(secs, exercises.find(e => e.id === focusExId)?.name)
  }
  const pickRest = (key: string) => {
    setRestSheet(false)
    if (key === 'custom') {
      setCustomRestSec(restOverride ?? SUGGESTED_REST_SEC)
      setCustomRestOpen(true)
      return
    }
    applyRestChoice(parseInt(key, 10))
  }

  const handleShowExerciseList = () => {
    const list = exercises.map((ex, i) => `${i + 1}. ${ex.name}`).join('\n')
    Alert.alert('Exercise List', list || 'No exercises loaded.', [{ text: 'OK' }])
  }

  // ── Progress ───────────────────────────────────────────────────────────────

  const totalSets = Object.values(sets).reduce((n, arr) => n + arr.length, 0)
  const doneSets = Object.values(sets).reduce((n, arr) => n + arr.filter(s => s.done).length, 0)
  const progress = totalSets > 0 ? doneSets / totalSets : 0

  // Honest duration numbers: a realistic static estimate (rests, transitions,
  // equipment time — see lib/durationEstimate), scaled by the user's historical
  // pace, then sharpened live by the pace they're actually logging at.
  const sessionEstimateSec = useMemo(() => estimateSessionSec(exercises.map(ex => ({
    sets: sets[ex.id]?.length ?? targets[ex.id]?.sets ?? 3,
    restSec: restOverride ?? restDefaults.current[ex.id] ?? null,
    workSec: exMetrics[ex.id]?.includes('duration')
      ? (parseInt(sets[ex.id]?.[0]?.durationSec || '', 10) || WORK_SEC)
      : null,
  }))), [exercises, sets, targets, exMetrics, restOverride])
  const hubEstimateMin = Math.max(5, Math.round((sessionEstimateSec / 60) * paceFactor))
  const remainingSec = adaptiveRemainingSec({
    elapsedSec: elapsed,
    doneSets,
    totalSets,
    staticPerSetSec: sessionEstimateSec / Math.max(1, totalSets),
    paceFactor,
  })

  // ── Early returns ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
        <ScreenHeader
          right={
            <HeaderActions>
              <TouchableOpacity onPress={() => router.push('/exercise-library')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Exercise Library">
                <Ionicons name="book-outline" size={22} color={C.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open your profile">
                <Avatar size={32} iconSize={16} />
              </TouchableOpacity>
            </HeaderActions>
          }
        />
        <View style={styles.emptyStateContainer}>
          <PulseLoader caption="Loading today's session…" />
        </View>
      </ScreenTransition>
    </SafeAreaView>
    )
  }

  // Rest day / nothing scheduled today is handled inside the hub's Session segment
  // below (so the Readiness / Splits / Workouts segments stay available too).

  // ── Hub (pre-session) ───────────────────────────────────────────────────────
  // Landing on the Workouts tab shows the day's session ready to go. You start it
  // deliberately here, and can step back out of the live session to this hub at any
  // time — so being on a workout day never traps you in the exercise logger.
  if (!sessionActive) {
    const showToday = selectedDate === todayStr
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
        <ScreenHeader
          right={
            <HeaderActions>
              <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open your profile">
                <Avatar size={32} iconSize={16} />
              </TouchableOpacity>
            </HeaderActions>
          }
        />
        <ScrollView
          ref={tourScrollRef}
          onScroll={tourOnScroll}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {/* Week / Month + range nav + "Reschedule my whole week" — moved from
              Home; Plan now owns all multi-day scheduling. */}
          <View style={styles.segment} ref={planCalendarTarget}>
            {(['week', 'month'] as const).map((m) => (
              <PressableScale
                key={m}
                style={[styles.segmentBtn, viewMode === m && styles.segmentBtnActive]}
                onPress={() => setViewMode(m)}
                scaleTo={0.94}
              >
                <Text style={[styles.segmentText, viewMode === m && styles.segmentTextActive]}>
                  {m === 'week' ? 'Week' : 'Month'}
                </Text>
              </PressableScale>
            ))}
          </View>

          <View style={styles.rangeRow}>
            <Text style={styles.rangeText}>{rangeLabel}</Text>
            <View style={styles.rangeNav}>
              {!isThisRange && (
                <TouchableOpacity style={styles.todayChip} onPress={() => setSelectedDate(todayStr)}>
                  <Text style={styles.todayChipText}>Today</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.weekRescheduleBtn, weekRescheduling && { opacity: 0.5 }]}
                onPress={handleWeekReschedule}
                disabled={weekRescheduling}
                accessibilityRole="button"
                accessibilityLabel="Reschedule my whole week"
              >
                {weekRescheduling ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <Ionicons name="repeat-outline" size={18} color={C.primary} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.weekRescheduleBtn, (delayWeekLoading || weekDelaying) && { opacity: 0.5 }]}
                onPress={handleWeekDelay}
                disabled={delayWeekLoading || weekDelaying}
                accessibilityRole="button"
                accessibilityLabel="Delay my whole week"
              >
                {(delayWeekLoading || weekDelaying) ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <Ionicons name="play-forward-outline" size={18} color={C.primary} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => shiftRange(-1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Previous ${viewMode}`}
              >
                <Ionicons name="chevron-back" size={22} color={C.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => shiftRange(1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Next ${viewMode}`}
              >
                <Ionicons name="chevron-forward" size={22} color={C.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <FadeInView key={viewMode} duration={240}>
            {viewMode === 'month' ? (
              <View style={styles.grid}>
                <View style={styles.gridDowRow}>
                  {DOW.map((d, i) => <Text key={i} style={styles.gridDowLabel}>{d}</Text>)}
                </View>
                <View style={styles.gridBody}>
                  {monthGrid.map(day => renderDayCell(day, true))}
                </View>
                {/* The dots are the only information in a month of numbers —
                    without this they're an unexplained colour code. */}
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.dayDot, styles.dotWorkout]} />
                    <Text style={styles.legendText}>Scheduled</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.dayDot, styles.dotDone]} />
                    <Text style={styles.legendText}>Done</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.dayDot, styles.dotMissed]} />
                    <Text style={styles.legendText}>Missed</Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.weekStrip}>
                {weekDays.map(day => renderDayCell(day, false))}
              </View>
            )}
          </FadeInView>

          {/* Selected day: today shows the full runner-ready session card
              (unchanged logic — `workout`/`exercises` always resolve to
              today's session); any other day shows a lighter read-only
              summary, since the runner state itself is always today's. */}
          {showToday ? (workout ? (
          <>
          <FadeInView style={styles.hubHero}>
            <View style={styles.hubEyebrowRow}>
              <Text style={styles.hubEyebrow}>{workoutLogId ? 'IN PROGRESS' : "TODAY'S SESSION"}</Text>
              {(() => {
                const origin = workoutOrigin(workout.source)
                return (
                  <View style={[styles.originChip, origin.byTempo ? styles.originChipTempo : styles.originChipYours]}>
                    <Ionicons name={origin.icon as any} size={11} color={origin.byTempo ? C.primary : C.textSecondary} />
                    <Text style={[styles.originText, { color: origin.byTempo ? C.primary : C.textSecondary }]}>{origin.label}</Text>
                  </View>
                )
              })()}
            </View>
            <Text style={styles.hubTitle}>{workout.focus}</Text>
            {/* Readiness glance — tap through to Progress's full readiness card. */}
            <PressableScale style={styles.hubReadyChip} scaleTo={0.96} onPress={() => router.push('/(tabs)/progress')}>
              <View style={[styles.hubReadyDot, { backgroundColor: trainReady.readiness.score >= 80 ? C.readyHigh : trainReady.readiness.score >= 55 ? C.readyMed : C.readyLow }]} />
              <Text style={styles.hubReadyText}>{trainReady.readiness.score}% ready · go {trainReady.intensity.label.toLowerCase()}</Text>
              <Ionicons name="chevron-forward" size={13} color={C.outline} />
            </PressableScale>
            <View style={styles.hubMetaRow}>
              <Text style={styles.hubMeta}>{exercises.length} exercise{exercises.length === 1 ? '' : 's'} · ~{hubEstimateMin} min</Text>
              <PressableScale
                style={styles.hubEditBtn}
                scaleTo={0.93}
                onPress={() => {
                  // Force a fresh load when we come back — the edit may change everything.
                  lifecycle.current.lastLoadAt = 0
                  router.push(`/edit-session?workoutId=${workout.id}`)
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit workout"
              >
                <Ionicons name="create-outline" size={14} color={C.primary} />
                <Text style={styles.hubEditText}>Edit workout</Text>
              </PressableScale>
            </View>
          </FadeInView>

          <FadeInView delay={70} style={styles.hubList}>
            {exercises.map((ex, i) => (
              <View key={ex.id} style={[styles.hubRow, i > 0 && styles.hubRowDivider]}>
                <Text style={styles.hubRowNum}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hubRowName} numberOfLines={1}>{ex.name}</Text>
                  <Text style={styles.hubRowMuscle} numberOfLines={1}>{ex.primary_muscles.map(formatMuscleName).join(' · ').toUpperCase()}</Text>
                </View>
                <Text style={styles.hubRowSets}>{sets[ex.id]?.length ?? targets[ex.id]?.sets ?? 3} sets</Text>
              </View>
            ))}
          </FadeInView>

          {/* Why this workout — makes the plan feel designed, not random */}
          {describeSession(exercises, workout.focus) && (
            <FadeInView delay={100}>
              <PressableScale style={styles.whyBtn} scaleTo={0.97} onPress={() => setWhyOpen(true)}>
                <Ionicons name="bulb-outline" size={16} color={C.primary} />
                <Text style={styles.whyBtnText}>Why this workout?</Text>
                <Ionicons name="chevron-forward" size={15} color={C.outline} />
              </PressableScale>
            </FadeInView>
          )}

          <FadeInView delay={140}>
            <PressableScale
              style={styles.hubStartBtn}
              onPress={() => (workoutLogId ? setSessionActive(true) : beginSession(workout.id))}
              accessibilityRole="button"
              accessibilityLabel={workoutLogId ? 'Resume session' : 'Start session'}
            >
              <Ionicons name={workoutLogId ? 'play' : 'barbell'} size={18} color={C.onPrimary} />
              <Text style={styles.hubStartText}>{workoutLogId ? 'Resume session' : 'Start session'}</Text>
            </PressableScale>
          </FadeInView>
          </>
          ) : todayCompletedFocus ? (
            <View style={styles.dayCard}>
              <View style={styles.completedTodayRow}>
                <Ionicons name="checkmark-circle" size={20} color={C.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.dayCardTitle}>Today's session is done</Text>
                  <Text style={styles.dayCardMeta}>{todayCompletedFocus} — nice work.</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={{ paddingVertical: Spacing.xl }}>
              <EmptyState
                kind="flash"
                title="No session scheduled today"
                body="Rest day, or nothing planned yet — start a Quick Workout, or check your current split below."
                actionLabel="Start a Quick Workout"
                onAction={() => router.push('/quick-workout')}
              />
            </View>
          )) : (
            // A different day than today — a lighter read-only summary (the
            // runner's own `workout` state always resolves to TODAY's session,
            // so a past/future day never gets Start/Resume treatment here).
            <View style={styles.dayCard}>
              {/* Which day you're actually looking at — "Rest day" with no date
                  gives no clue which cell you tapped. */}
              <Text style={styles.dayCardEyebrow}>
                {selDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}
              </Text>
              {selectedDayWorkouts.length > 0 ? (
                selectedDayWorkouts.map((w, i) => (
                  <View key={w.id} style={[styles.dayCardWorkoutBlock, i > 0 && styles.dayCardWorkoutDivider]}>
                    <Text style={styles.dayCardStatus}>
                      {w.status === 'completed' ? 'COMPLETED' : w.status === 'missed' ? 'MISSED' : 'SCHEDULED'}
                    </Text>
                    <Text style={styles.dayCardTitle}>{w.focus}</Text>
                    <Text style={styles.dayCardMeta}>
                      {formatTime(w.planned_start_time)} · {w.planned_duration_min} min ·{' '}
                      {w.exercise_ids.length} exercise{w.exercise_ids.length === 1 ? '' : 's'}
                    </Text>
                    <PressableScale
                      style={styles.dayCardEditBtn}
                      scaleTo={0.96}
                      onPress={() => router.push(`/edit-session?workoutId=${w.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${w.focus}`}
                    >
                      <Ionicons name="create-outline" size={14} color={C.primary} />
                      <Text style={styles.dayCardEditText}>Edit</Text>
                    </PressableScale>
                  </View>
                ))
              ) : missingSplitDay ? (
                <>
                  <View style={styles.dayCardRest}>
                    <Ionicons name="alert-circle-outline" size={15} color={C.ember} />
                    <Text style={styles.dayCardRestText}>
                      Unscheduled this week — {missingSplitDay.label || 'a workout'} isn't on the calendar.
                    </Text>
                  </View>
                  <PressableScale
                    style={[styles.dayCardEditBtn, addingBackDay && { opacity: 0.6 }]}
                    scaleTo={0.96}
                    onPress={handleAddBackDay}
                  >
                    {addingBackDay ? (
                      <ActivityIndicator size="small" color={C.primary} />
                    ) : (
                      <Ionicons name="add-circle-outline" size={14} color={C.primary} />
                    )}
                    <Text style={styles.dayCardEditText}>Add it back</Text>
                  </PressableScale>
                </>
              ) : (
                <>
                  <View style={styles.dayCardRest}>
                    <Ionicons name="moon-outline" size={15} color={C.outline} />
                    <Text style={styles.dayCardRestText}>Rest day — recovery is part of the plan.</Text>
                  </View>
                  <TouchableOpacity onPress={() => setAddWorkoutOpen(true)} activeOpacity={0.7}>
                    <Text style={styles.dayCardAddText}>+ Add a workout</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* Landed here right after Change Plan — confirms the switch
              actually happened and which split is now active, instead of
              silently dropping the user on Home to go check for themselves. */}
          {justSwitchedBanner && (
            <PopIn style={styles.switchedBanner}>
              <Ionicons name="checkmark-circle" size={18} color={C.success} />
              <Text style={styles.switchedBannerText}>
                Switched to your new {activeSplit?.kind === 'auto' ? `${BRAND_NAME}-generated` : ''} plan
              </Text>
            </PopIn>
          )}

          {/* Current split — the audit's "one Programs door," condensed from
              the old full Splits list to just the active one. */}
          <View style={styles.splitCard} ref={planSplitTarget}>
            <Text style={styles.splitLabel}>CURRENT SPLIT</Text>
            {activeSplit ? (
              <>
                <View style={styles.splitTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.splitName}>{activeSplit.name}</Text>
                    <Text style={styles.splitMeta}>
                      {daysPerWeek(activeSplit)} day{daysPerWeek(activeSplit) === 1 ? '' : 's'}/week
                      {activeSplit.kind === 'auto' ? ` · ${BRAND_NAME}` : ' · Yours'}
                    </Text>
                  </View>
                  <PressableScale style={styles.splitEditBtn} scaleTo={0.95} onPress={() => router.push('/my-splits')}>
                    <Text style={styles.splitEditText}>Edit Split</Text>
                  </PressableScale>
                </View>
                {splitLabels(activeSplit).length > 0 && (
                  <View style={styles.chipRow}>
                    {splitLabels(activeSplit).map((l, i) => (
                      <View key={i} style={styles.splitChip}><Text style={styles.splitChipText}>{l}</Text></View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <>
                <TempoLottie source={require('@/assets/lottie/coach/idle.json')} width={38} height={98} style={styles.coachIdle} />
                <EmptyState
                  kind="barbell"
                  compact
                  title="No split yet"
                  body="A split is your weekly training pattern — Push/Pull/Legs, Upper/Lower, and more."
                  actionLabel="Create a split"
                  onAction={() => router.push('/my-splits')}
                />
              </>
            )}
          </View>

          {/* Library & Tools — simple doors into the existing screens, not an
              inline list (the old Workouts segment's searchable list moved out
              of the hub entirely; My Workouts already does that job). */}
          <Text style={styles.libraryLabel}>LIBRARY & TOOLS</Text>
          <View style={styles.libraryCard} ref={planLibraryTarget}>
            <TouchableOpacity style={styles.libraryRow} onPress={() => router.push('/exercise-library')} accessibilityRole="button" accessibilityLabel="Exercise Library">
              <Ionicons name="book-outline" size={18} color={C.textSecondary} />
              <Text style={styles.libraryRowText}>Exercise Library</Text>
              <Ionicons name="chevron-forward" size={16} color={C.outline} />
            </TouchableOpacity>
            <View style={styles.libraryDivider} />
            <TouchableOpacity style={styles.libraryRow} onPress={() => router.push('/my-workouts')} accessibilityRole="button" accessibilityLabel="Manage Workouts">
              <Ionicons name="barbell-outline" size={18} color={C.textSecondary} />
              <Text style={styles.libraryRowText}>Manage Workouts</Text>
              <Ionicons name="chevron-forward" size={16} color={C.outline} />
            </TouchableOpacity>
          </View>
        </ScrollView>

        <AddWorkoutSheet
          visible={addWorkoutOpen}
          userId={userId}
          client={supabase}
          date={selectedDate}
          onClose={() => setAddWorkoutOpen(false)}
        />

        <OptionSheet
          visible={weekRescheduleConfirm}
          title="Reschedule your week"
          subtitle={`${BRAND_NAME} will re-lay every upcoming workout onto its best day and time this week — recovery-aware and around your calendar. Nothing gets dropped, and your calendar stays in sync.`}
          options={[{ key: 'reschedule', label: 'Reschedule my week', icon: 'repeat-outline' }]}
          onSelect={confirmWeekReschedule}
          onClose={() => setWeekRescheduleConfirm(false)}
        />

        <OptionSheet
          visible={!!delayWeekOptions}
          title="Delay your week"
          subtitle={`Push every upcoming workout this week back by the same number of days — same order, same times, just later. Stays inside this week; next week is never touched.`}
          options={delayWeekOptions ?? []}
          onSelect={confirmWeekDelay}
          onClose={() => setDelayWeekOptions(null)}
        />

        {/* Why this workout — the reasoning behind the order + selection */}
        <Modal visible={whyOpen} animationType="fade" transparent onRequestClose={() => setWhyOpen(false)}>
          <View style={styles.coachBackdrop}>
            <View style={styles.coachCard}>
              <View style={styles.coachIcon}><Ionicons name="bulb" size={24} color={C.onPrimary} /></View>
              {(() => {
                const r = describeSession(exercises, workout?.focus ?? '')
                if (!r) return null
                return (
                  <>
                    <Text style={styles.coachTitle}>{r.headline}</Text>
                    {r.lines.map((l, i) => (
                      <View key={i} style={styles.whyRow}>
                        <Text style={styles.whyNum}>{i + 1}</Text>
                        <Text style={styles.whyLine}>{l}</Text>
                      </View>
                    ))}
                  </>
                )
              })()}
              <PressableScale style={styles.coachBtn} onPress={() => setWhyOpen(false)}>
                <Text style={styles.coachBtnText}>Got it</Text>
              </PressableScale>
            </View>
          </View>
        </Modal>
      </ScreenTransition>
    </SafeAreaView>
    )
  }

  // ── Main render (live session) ──────────────────────────────────────────────
  // Reaching here means a session is active, which can't happen without a workout;
  // this guard just narrows the type (a harmless no-op in practice).
  if (!workout) return null

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenTransition>
      {/* Header — an explicit, labeled Pause control leads the centered masthead.
          The old bare chevron read as "exit workout" and scared people into
          thinking progress was lost; the session title bar sits flush below, so
          the amber rule is suppressed here. */}
      <ScreenHeader
        size="sm"
        rule={false}
        leading={
          <TouchableOpacity
            style={styles.pauseBtn}
            onPress={() => setPauseSheet(true)}
            accessibilityRole="button"
            accessibilityLabel="Pause or end this workout"
          >
            <Ionicons name="pause" size={16} color={C.text} />
            <Text style={styles.pauseBtnText}>Pause</Text>
          </TouchableOpacity>
        }
        right={
          <TouchableOpacity style={styles.avatar} onPress={() => router.push('/(tabs)/profile')} accessibilityRole="button" accessibilityLabel="Open your profile">
            <Ionicons name="person" size={16} color={C.onPrimary} />
          </TouchableOpacity>
        }
      />

      {/* Session title bar */}
      <View style={styles.sessionBar}>
        <View style={styles.sessionLeft}>
          <Text style={styles.sessionLabel}>ACTIVE SESSION</Text>
          <Text style={styles.sessionTitle} numberOfLines={1}>{workout.focus}</Text>
        </View>
        <View style={styles.sessionRight}>
          <Text style={styles.estLabel}>
            {doneSets > 0 ? `~${formatRemaining(remainingSec).toUpperCase()} LEFT` : `EST. ${hubEstimateMin} MINS`}
          </Text>
          <Text style={styles.timerText}>{formatElapsed(elapsed)}</Text>
        </View>
      </View>

      {/* Progress bar — sweeps forward as sets are logged */}
      <View style={styles.progressTrack}>
        <AnimatedFill pct={Math.round(progress * 100)} style={styles.progressFill} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {travel && (
          <View style={styles.travelBanner}>
            <Ionicons name="airplane" size={15} color={C.primary} />
            <Text style={styles.travelBannerText}>
              Travel mode — this session is adapted to {describeTravelEquipment(travel.equipment)}.
            </Text>
          </View>
        )}
        {workout.progression?.isDeload ? (
          <View style={[styles.travelBanner, styles.deloadBanner]}>
            <Ionicons name="leaf" size={15} color={C.success} />
            {/* Makes adaptation legible (audit: "personalization you can't perceive
                doesn't retain"): period.note already distinguishes a scheduled
                deload from a reactive one triggered by missed sessions / "too
                hard" feedback — surface that real reason instead of one flat
                generic line for every deload regardless of why it happened. */}
            <Text style={styles.travelBannerText}>{workout.progression.note}</Text>
          </View>
        ) : workout.progression?.phase === 'peak' ? (
          <View style={styles.travelBanner}>
            <Ionicons name="trending-up" size={15} color={C.primary} />
            <Text style={styles.travelBannerText}>{workout.progression.note}</Text>
          </View>
        ) : null}
        {exercises.map((ex) => {
          const exSets = sets[ex.id] ?? []
          const doneCount = exSets.filter(s => s.done).length
          const isExpanded = expandedId === ex.id
          const allDone = exSets.length > 0 && doneCount === exSets.length
          const p = targets[ex.id]
          const cols = columnsFor(exMetrics[ex.id])
          // Warm-ups show "W"; working sets keep a clean 1..N ordinal.
          let workCounter = 0
          const setLabels = exSets.map(s => (s.warmup ? 'W' : String(++workCounter)))

          return (
            <View key={ex.id} style={styles.exerciseCard}>
              {/* Accordion header */}
              <TouchableOpacity
                style={styles.exerciseHeader}
                onPress={() => toggleExpand(ex.id)}
                activeOpacity={0.7}
              >
                {/* GIF thumbnail */}
                <View style={styles.thumbWrap}>
                  {!thumbFailed[ex.id] && getExerciseGifSource(ex.id) ? (
                    <Image
                      source={getExerciseGifSource(ex.id)!}
                      style={styles.thumb}
                      contentFit="contain"
                      onError={() => setThumbFailed(m => ({ ...m, [ex.id]: true }))}
                    />
                  ) : gifIds[ex.id] ? (
                    <Image
                      source={gifSource(gifIds[ex.id]!)}
                      style={styles.thumb}
                      contentFit="contain"
                    />
                  ) : (
                    <Ionicons name="barbell-outline" size={22} color={C.outlineVariant} />
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.exerciseName}>{ex.name}</Text>
                  <Text style={styles.muscleLabel}>
                    {ex.primary_muscles.map(formatMuscleName).join(' · ').toUpperCase()}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                  {allDone ? (
                    <PopIn style={styles.doneChip}>
                      <Ionicons name="checkmark-circle" size={14} color={C.success} />
                      <Text style={styles.doneChipText}>Done</Text>
                    </PopIn>
                  ) : (
                    <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: C.outline }}>
                      {doneCount}/{exSets.length}
                    </Text>
                  )}
                  {/* Machine occupied? Changed the order? Per-exercise menu. */}
                  <TouchableOpacity
                    onPress={() => setExActionEx(ex)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Options for ${ex.name}`}
                  >
                    <Ionicons name="ellipsis-horizontal" size={18} color={C.outline} />
                  </TouchableOpacity>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={C.outline}
                  />
                </View>
              </TouchableOpacity>

              {isExpanded && (
                <>
                  {/* Coach prescription — only shown when there's something real to
                      say (a direction change from last time + why). The exact
                      numbers are pre-filled into the set rows below already, so
                      repeating them here was pure duplication; a brand-new exercise
                      has no trend yet, so there's nothing useful to add over the
                      pre-filled rep target already visible in the first set row. */}
                  {p && p.direction !== 'new' && (
                    <View style={styles.targetCard}>
                      <View style={styles.targetRow}>
                        <Text style={[styles.targetReason, { flex: 1 }]}>{p.reason}</Text>
                        <View style={[
                          styles.dirBadge,
                          p.direction === 'up' && { backgroundColor: C.successSoft },
                          p.direction === 'down' && { backgroundColor: C.dangerSoft },
                        ]}>
                          <Ionicons
                            name={p.direction === 'up' ? 'trending-up' : p.direction === 'down' ? 'trending-down' : 'remove'}
                            size={13}
                            color={p.direction === 'up' ? C.success : p.direction === 'down' ? C.error : C.textSecondary}
                          />
                          <Text style={[
                            styles.dirBadgeText,
                            { color: p.direction === 'up' ? C.success : p.direction === 'down' ? C.error : C.textSecondary },
                          ]}>
                            {p.direction === 'up' ? 'GO UP' : p.direction === 'down' ? 'BACK OFF' : 'HOLD'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Form guide + smart swap */}
                  <View style={styles.exActions}>
                    {focusModeEnabled && exSets.some(s => !s.done) && (
                      <PressableScale
                        style={styles.exActionBtn}
                        onPress={() => { setFocusExId(ex.id); setFocusOpen(true) }}
                        scaleTo={0.93}
                        accessibilityLabel="Open focus mode for this exercise"
                      >
                        <Ionicons name="expand-outline" size={15} color={C.primary} />
                        <Text style={styles.exActionText}>Focus</Text>
                      </PressableScale>
                    )}
                    <PressableScale style={styles.exActionBtn} onPress={() => setFormSheetEx(ex)} scaleTo={0.93}>
                      <Ionicons name="book-outline" size={15} color={C.primary} />
                      <Text style={styles.exActionText}>Form guide</Text>
                    </PressableScale>
                    {/* History, mid-session — the moment you actually want it is
                        standing at the rack deciding what to load, not later on
                        the Progress tab. It existed only inside the Form guide
                        sheet, two taps down and behind a label nobody reads as
                        "history". Free tier included: historyHorizon clamps free
                        users to the last 4 months rather than locking the screen,
                        so this is a plain button with no paywall tease.
                        Shown only when there IS something to look at —
                        prevBySet is populated from the most recent prior session
                        for this lift, so an exercise you have never done doesn't
                        offer a button that opens an empty chart. */}
                    {!!prevBySet[ex.id]?.length && (
                      <PressableScale
                        style={styles.exActionBtn}
                        onPress={() => router.push({ pathname: '/exercise-progress', params: { exerciseId: ex.id, name: ex.name } })}
                        scaleTo={0.93}
                        accessibilityLabel={`See ${ex.name} training history`}
                      >
                        <Ionicons name="stats-chart-outline" size={15} color={C.primary} />
                        <Text style={styles.exActionText}>History</Text>
                      </PressableScale>
                    )}
                    <PressableScale style={styles.exActionBtn} onPress={() => handleSwap(ex)} disabled={swapping} scaleTo={0.93}>
                      <Ionicons name="swap-horizontal" size={15} color={C.primary} />
                      <Text style={styles.exActionText}>Swap</Text>
                    </PressableScale>
                    {/* Whether the weight you type is per side (dumbbell press,
                        single-arm row, a lunge) or the total — no reliable way
                        to infer this from the exercise alone, so it's a
                        remembered-per-exercise toggle, not a guess. */}
                    {cols.some(c => c.key === 'weight') && (
                      <PressableScale
                        style={[styles.exActionBtn, perSide[ex.id] && styles.exActionBtnActive]}
                        onPress={() => togglePerSide(ex)}
                        scaleTo={0.93}
                        accessibilityRole="button"
                        accessibilityLabel={perSide[ex.id] ? 'Logging per side — tap to log total instead' : 'Logging total weight — tap to log per side instead'}
                      >
                        <Ionicons name="git-compare-outline" size={15} color={perSide[ex.id] ? C.onPrimary : C.primary} />
                        <Text style={[styles.exActionText, perSide[ex.id] && { color: C.onPrimary }]}>
                          {perSide[ex.id] ? '×2 per side' : 'Per side?'}
                        </Text>
                      </PressableScale>
                    )}
                  </View>

                  {/* Table header — columns follow this exercise's tracked metrics */}
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableHeadCell, { flex: 0.5 }]}>SET</Text>
                    <Text style={[styles.tableHeadCell, { flex: 1.5 }]}>PREV</Text>
                    {cols.map((c) => (
                      <Text key={c.key} style={styles.tableHeadCell}>
                        {c.key === 'weight' ? unitLabel(unit).toUpperCase() : c.label}
                      </Text>
                    ))}
                    <Text style={[styles.tableHeadCell, { flex: 0.5 }]}>✓</Text>
                    <View style={styles.setTrashSpacer} />
                  </View>

                  {/* Set rows — ✓ logs instantly (rest starts, haptic fires); RPE
                      is an optional follow-up bar, never a gate. */}
                  {exSets.map((set, idx) => {
                    const followingUp = rpeFollowUp?.exId === ex.id && rpeFollowUp?.idx === idx
                    const isEditing = editingSet?.exId === ex.id && editingSet?.idx === idx
                    return (
                    <View key={idx}>
                      <View style={[styles.setRow, set.warmup && styles.setRowWarmup]}>
                        <Text style={[styles.setNum, set.warmup && styles.setNumWarmup]}>{setLabels[idx]}</Text>

                        {/* PREV column — hidden for warm-ups; working sets index by
                            their working ordinal (warm-ups shift the raw row index). */}
                        <Text style={[styles.setCell, styles.prevCell]}>
                          {set.warmup ? 'warm-up' : (prevBySet[ex.id]?.[Number(setLabels[idx]) - 1] ?? '—')}
                        </Text>

                        {set.done && !isEditing ? (
                          <>
                            {cols.map((c) => <Text key={c.key} style={styles.setCell}>{set[c.field] || '0'}</Text>)}
                            {/* Tap to fix a wrong number after the fact — was
                                permanently locked once logged; delete-and-redo
                                was the only option. A pencil (not a second
                                checkmark) so "this is done, tap to edit" never
                                reads as "check it again" — the single ✓ this
                                flow uses means "confirm," full stop. */}
                            <PressableScale
                              style={styles.checkCircleFilled}
                              scaleTo={0.85}
                              onPress={() => setEditingSet({ exId: ex.id, idx })}
                              accessibilityRole="button"
                              accessibilityLabel={`Edit set ${idx + 1}`}
                            >
                              <Ionicons name="pencil" size={13} color={C.onPrimary} />
                            </PressableScale>
                          </>
                        ) : set.done && isEditing ? (
                          <>
                            {cols.map((c) => (
                              <View key={c.key} style={styles.inputBox}>
                                <TextInput
                                  style={styles.inputText}
                                  value={set[c.field]}
                                  onChangeText={v => updateSet(ex.id, idx, c.field, v)}
                                  keyboardType={c.kbd}
                                  placeholder="0"
                                  placeholderTextColor={C.outline}
                                  autoFocus
                                />
                              </View>
                            ))}
                            <PressableScale
                              style={styles.checkCircleFilled}
                              scaleTo={0.85}
                              onPress={() => saveSetEdit(ex.id, idx)}
                              accessibilityRole="button"
                              accessibilityLabel={`Save edit to set ${idx + 1}`}
                            >
                              <Ionicons name="checkmark" size={14} color={C.onPrimary} />
                            </PressableScale>
                          </>
                        ) : (
                          <>
                            {cols.map((c) => (
                              <View key={c.key} style={styles.inputBox}>
                                <TextInput
                                  style={styles.inputText}
                                  value={set[c.field]}
                                  onChangeText={v => updateSet(ex.id, idx, c.field, v)}
                                  keyboardType={c.kbd}
                                  placeholder="0"
                                  placeholderTextColor={C.outline}
                                />
                              </View>
                            ))}
                            <PressableScale
                              style={styles.emptyCircle}
                              onPress={() => handleSetDone(ex.id, idx)}
                              scaleTo={0.8}
                              hitSlop={6}
                              accessibilityLabel={`Log set ${idx + 1}`}
                            >
                              <View />
                            </PressableScale>
                          </>
                        )}

                        <TouchableOpacity
                          onPress={() => removeSet(ex.id, idx)}
                          hitSlop={8}
                          style={styles.setTrash}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove set ${idx + 1}`}
                        >
                          <Ionicons name="trash-outline" size={15} color={C.outlineVariant} />
                        </TouchableOpacity>
                      </View>

                      {/* Optional RPE follow-up — shows only for the set that just logged */}
                      {followingUp && set.done && (
                        <View style={styles.rpeBar}>
                          <Text style={styles.rpeBarLabel}>How hard?</Text>
                          {RPE_OPTIONS.map(n => (
                            <PressableScale
                              key={n}
                              style={styles.rpeChip}
                              onPress={() => attachRpe(ex.id, idx, n)}
                              scaleTo={0.88}
                              accessibilityRole="button"
                              accessibilityLabel={`Rate this set RPE ${n}`}
                            >
                              <Text style={styles.rpeChipText}>{n}</Text>
                            </PressableScale>
                          ))}
                          <TouchableOpacity style={styles.rpeSkip} onPress={() => setRpeFollowUp(null)}>
                            <Text style={styles.rpeSkipText}>skip</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {set.done && set.rpe != null && (
                        <Text style={styles.rpeLogged}>Logged · RPE {set.rpe}</Text>
                      )}
                    </View>
                    )
                  })}

                  {/* Add Set / Add Warm-up */}
                  <View style={styles.addSetRow}>
                    <PressableScale style={styles.addSetBtn} onPress={() => addSet(ex.id)} scaleTo={0.95}>
                      <Text style={styles.addSetBtnText}>+ Add Set</Text>
                    </PressableScale>
                    <PressableScale style={styles.addSetBtn} onPress={() => addWarmupSet(ex.id)} scaleTo={0.95}>
                      <Text style={styles.addSetBtnText}>+ Warm-up</Text>
                    </PressableScale>
                  </View>
                </>
              )}
            </View>
          )
        })}

        {/* Add an exercise mid-session — machine taken, extra energy, whatever.
            The "today only vs permanently" choice is explicit (see sheet below). */}
        <PressableScale style={styles.addExerciseBtn} onPress={() => setAddExOpen(true)} scaleTo={0.97} accessibilityRole="button" accessibilityLabel="Add Exercise">
          <Ionicons name="add" size={18} color={C.primary} />
          <Text style={styles.addExerciseText}>Add Exercise</Text>
        </PressableScale>

        {/* Complete Workout — shifts to sage the moment every set is banked */}
        <PressableScale
          style={[
            styles.completeButton,
            progress === 1 && styles.completeButtonReady,
            completing && { opacity: 0.6 },
          ]}
          onPress={handleCompleteWorkout}
          disabled={completing}
        >
          {completing ? (
            <ActivityIndicator color={C.onPrimary} />
          ) : (
            <>
              <Text style={styles.completeButtonText}>
                {progress === 1 ? 'ALL SETS DONE — FINISH' : 'COMPLETE WORKOUT'}
              </Text>
              <Ionicons name="checkmark" size={16} color={C.onPrimary} />
            </>
          )}
        </PressableScale>
      </ScrollView>

      {restSecondsLeft !== null && (
        <PopIn style={[styles.restPill, { bottom: insets.bottom + 84 }]}>
          <View style={styles.restPillRow}>
            {/* Tapping the timer itself reopens Focus Mode for the exercise
                that's resting — explicit request, so it opens regardless of
                the "Workout Focus Mode" device preference (that preference
                only gates the AUTOMATIC open after logging a set). "Skip"
                keeps its own separate tap target and behavior. */}
            <TouchableOpacity
              style={styles.restPillMain}
              onPress={() => setFocusOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Open Focus Mode"
            >
              <Ionicons name="timer-outline" size={18} color="#fff" />
              <Text style={styles.restPillText}>Rest · {formatElapsed(restSecondsLeft)}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={stopRest} hitSlop={8}>
              <Text style={styles.restPillSkip}>Skip</Text>
            </TouchableOpacity>
          </View>
          {/* Time draining out of the bar — you can feel the next set coming */}
          <View style={styles.restPillTrack}>
            <AnimatedFill
              pct={Math.max(0, Math.min(100, (restSecondsLeft / Math.max(1, restTotal)) * 100))}
              style={styles.restPillFill}
            />
          </View>
        </PopIn>
      )}
      <View style={[styles.floatingTools, { bottom: insets.bottom + 84 }]}>
        <PressableScale
          style={[styles.floatingTool, restSecondsLeft !== null && styles.floatingToolActive]}
          onPress={handleRestTimer}
          scaleTo={0.85}
          accessibilityLabel={restSecondsLeft !== null ? 'Stop rest timer' : 'Start rest timer'}
        >
          <Ionicons name="timer-outline" size={22} color={C.primary} />
        </PressableScale>
        <PressableScale
          style={[styles.floatingTool, noteSaved && styles.floatingToolActive]}
          onPress={() => setNoteOpen(true)}
          scaleTo={0.85}
          accessibilityLabel="Session note"
        >
          <Ionicons name={noteSaved ? 'document-text' : 'document-text-outline'} size={21} color={C.primary} />
        </PressableScale>
        <PressableScale style={styles.floatingTool} onPress={handleShowExerciseList} scaleTo={0.85} accessibilityLabel="Show exercise list">
          <Ionicons name="list-outline" size={22} color={C.primary} />
        </PressableScale>
      </View>

      <ExerciseFormSheet exercise={formSheetEx} onClose={() => setFormSheetEx(null)} />

      <PlateCalcSheet
        visible={plateCalcOpen}
        onClose={() => setPlateCalcOpen(false)}
        initialWeight={plateCalcWeight}
        unit={unit}
      />

      {(() => {
        if (!focusEx) return null
        const p = targets[focusEx.id]
        const targetRepsLabel = p
          ? p.repLow === p.repHigh ? `TARGET ${p.repHigh} REPS` : `TARGET ${p.repLow}-${p.repHigh} REPS`
          : 'TARGET REPS'
        // Same working-ordinal scheme as the list (warm-ups don't count).
        let workCounter = 0
        const setLabels = focusSetsArr.map(s => (s.warmup ? 'W' : String(++workCounter)))
        const totalWorking = focusSetsArr.filter(s => !s.warmup).length
        const setLabel = focusSet
          ? (focusSet.warmup ? 'WARM-UP SET' : `SET ${setLabels[focusIdx]} OF ${totalWorking}`)
          : ''
        const primaryFormSource = thumbFailed[focusEx.id] ? null : getExerciseGifSource(focusEx.id)
        const formImage = primaryFormSource ?? (gifIds[focusEx.id] ? gifSource(gifIds[focusEx.id]!) : null)

        // "How much weight did you do?" — only while resting, only for the set
        // that just logged (not the upcoming one focusSet/focusIdx track).
        const lastSet = lastLoggedSet ? sets[lastLoggedSet.exId]?.[lastLoggedSet.idx] : undefined
        const lastSetFields = (restEndsAt !== null && lastLoggedSet && lastSet)
          ? columnsFor(exMetrics[lastLoggedSet.exId]).map(c => ({
              key: c.key,
              label: c.key === 'weight' ? unitLabel(unit).toUpperCase() : c.label,
              value: lastSet[c.field],
              kbd: c.kbd,
              onChange: (v: string) => updateSet(lastLoggedSet.exId, lastLoggedSet.idx, c.field, v),
            }))
          : undefined

        return (
          <FocusMode
            visible={focusOpen}
            onClose={() => setFocusOpen(false)}
            exerciseName={focusEx.name}
            setLabel={setLabel}
            targetRepsLabel={targetRepsLabel}
            resting={restEndsAt !== null}
            restSecondsLeft={restSecondsLeft}
            restTotal={restTotal}
            onAdjustRest={adjustRest}
            formImage={formImage}
            onViewForm={() => { setFocusOpen(false); setFormSheetEx(focusEx) }}
            done={!focusSet}
            onSkip={focusSkip}
            onDone={focusDone}
            lastSetFields={lastSetFields}
            lastSetKey={lastLoggedSet ? `${lastLoggedSet.exId}:${lastLoggedSet.idx}` : null}
            onSaveLastSet={lastLoggedSet ? () => saveSetEdit(lastLoggedSet.exId, lastLoggedSet.idx) : undefined}
            lastSetRpe={lastSet?.rpe ?? null}
            onSetRpe={lastLoggedSet ? (n: number) => attachRpe(lastLoggedSet.exId, lastLoggedSet.idx, n) : undefined}
          />
        )
      })()}
      <OptionSheet
        visible={restSheet}
        title="Rest timer"
        subtitle={`Suggested: 2 minutes. Your pick becomes this workout's rest between sets — you'll feel a buzz when it's time, even with the phone locked.${restOverride ? ` Current: ${Math.round(restOverride)}s.` : ''}`}
        options={[
          { key: '60', label: '60 seconds', sub: 'Short and sweaty — supersets, accessories', icon: 'timer-outline' },
          { key: '90', label: '90 seconds', sub: 'Hypertrophy pace', icon: 'timer-outline' },
          { key: '120', label: '2 minutes', sub: 'Suggested — solid recovery for most lifts', icon: 'star-outline' },
          { key: '180', label: '3 minutes', sub: 'Full recovery for heavy compound sets', icon: 'timer-outline' },
          { key: 'custom', label: 'Custom…', sub: 'Pick any length', icon: 'options-outline' },
        ]}
        onSelect={pickRest}
        onClose={() => setRestSheet(false)}
      />

      {/* Custom rest length — stepper in 15s increments */}
      <Modal visible={customRestOpen} animationType="fade" transparent onRequestClose={() => setCustomRestOpen(false)}>
        <View style={styles.customRestBackdrop}>
          <View style={styles.customRestCard}>
            <Text style={styles.customRestTitle}>Custom rest</Text>
            <View style={styles.customRestRow}>
              <PressableScale
                style={styles.customRestStep}
                onPress={() => setCustomRestSec(s => Math.max(15, s - 15))}
                scaleTo={0.9}
                accessibilityLabel="15 seconds less"
              >
                <Ionicons name="remove" size={22} color={C.text} />
              </PressableScale>
              <Text style={styles.customRestValue}>{formatElapsed(customRestSec)}</Text>
              <PressableScale
                style={styles.customRestStep}
                onPress={() => setCustomRestSec(s => Math.min(600, s + 15))}
                scaleTo={0.9}
                accessibilityLabel="15 seconds more"
              >
                <Ionicons name="add" size={22} color={C.text} />
              </PressableScale>
            </View>
            <PressableScale
              style={styles.customRestStart}
              onPress={() => { setCustomRestOpen(false); applyRestChoice(customRestSec) }}
            >
              <Text style={styles.customRestStartText}>Start rest</Text>
            </PressableScale>
            <TouchableOpacity onPress={() => setCustomRestOpen(false)} style={{ paddingVertical: Spacing.xs }}>
              <Text style={styles.customRestCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add exercise mid-session: pick, then — only for a split-sourced
          workout, where "going forward" is an actual, well-defined thing
          (lib/splitSchedule.propagateSplitDayEdit) — decide how long it
          sticks around. A plan day (periodization already varies it week to
          week; there's no fixed template to add "forever" to) or a Quick
          Workout (a one-off with nothing to recur into) skip the question
          entirely: it's just added to this session, immediately. */}
      <ExercisePickerSheet
        visible={addExOpen}
        userId={userId}
        client={supabase}
        existingIds={exercises.map(e => e.id)}
        onClose={() => setAddExOpen(false)}
        onAdd={(ex: Exercise) => {
          setAddExOpen(false)
          if (workout?.source === 'split' && workout.split_id) {
            setAddChoiceEx(ex as unknown as ExerciseRow)
          } else {
            addExerciseToSession(ex as unknown as ExerciseRow, false).catch(() => {})
          }
        }}
        onRemove={() => {}}
      />
      <OptionSheet
        visible={addChoiceEx !== null}
        title={addChoiceEx ? `Add ${addChoiceEx.name}` : ''}
        subtitle={`Just for today's ${workout?.focus ?? 'workout'}, or every ${workout?.focus ?? 'day'} on your split from now on?`}
        options={[
          { key: 'today', label: 'Add for this session only', sub: 'One-off — the rest of your split is unchanged', icon: 'today-outline' },
          { key: 'forward', label: `Add to every ${workout?.focus ?? 'day'} on your split`, sub: 'Updates your split template and every upcoming day already scheduled', icon: 'bookmark-outline' },
        ]}
        onSelect={(key) => {
          const ex = addChoiceEx
          setAddChoiceEx(null)
          if (ex) addExerciseToSession(ex, key === 'forward').catch(() => {})
        }}
        onClose={() => setAddChoiceEx(null)}
      />

      {/* Pause / end — explicit about what happens to progress. */}
      <OptionSheet
        visible={pauseSheet}
        title="Pause workout?"
        subtitle="Logged sets are saved either way."
        options={[
          { key: 'pause', label: 'Resume later', sub: 'Save progress and step out — pick it up from the Workouts tab any time', icon: 'pause-circle-outline' },
          { key: 'end', label: 'End workout', sub: doneSets > 0 ? 'Finish now — everything you logged counts' : 'Discard this session — nothing is logged yet', icon: 'flag-outline', destructive: doneSets === 0 },
        ]}
        onSelect={onPauseChoice}
        onClose={() => setPauseSheet(false)}
      />

      <OptionSheet
        visible={discardConfirm}
        title="End workout?"
        subtitle="Nothing is logged yet — this session will be discarded (it won’t count toward your streak or stats)."
        options={[{ key: 'discard', label: 'Discard session', icon: 'trash-outline', destructive: true }]}
        onSelect={() => { setDiscardConfirm(false); discardSession().catch(() => {}) }}
        onClose={() => setDiscardConfirm(false)}
      />

      <OptionSheet
        visible={finishEarlyConfirm !== null}
        title="Finish early?"
        subtitle={finishEarlyConfirm
          ? `${finishEarlyConfirm.remaining} set${finishEarlyConfirm.remaining === 1 ? '' : 's'} ${finishEarlyConfirm.remaining === 1 ? "isn't" : "aren't"} logged yet (${finishEarlyConfirm.done} of ${finishEarlyConfirm.total} done). Complete the workout anyway?`
          : ''}
        options={[{ key: 'complete', label: 'Complete workout', icon: 'checkmark-circle-outline' }]}
        onSelect={() => { setFinishEarlyConfirm(null); finishWorkout().catch(() => setCompleting(false)) }}
        onClose={() => setFinishEarlyConfirm(null)}
      />

      <OptionSheet
        visible={tooShortConfirm}
        title="Finish already?"
        subtitle={`This session is under ${MIN_STREAK_MINUTES} minutes — it'll still save what you logged, but it won't count toward your streak.`}
        options={[
          { key: 'keep_going', label: 'Keep going', icon: 'play-outline' },
          { key: 'finish', label: 'Finish anyway', icon: 'checkmark-circle-outline' },
        ]}
        onSelect={(key) => { setTooShortConfirm(false); if (key === 'finish') finishAfterTooShortConfirm() }}
        onClose={() => setTooShortConfirm(false)}
      />

      <OptionSheet
        visible={removeSetConfirm !== null}
        title="Remove set?"
        subtitle={removeSetConfirm ? `Set ${removeSetConfirm.idx + 1} will be removed${removeSetConfirm.wasDone ? ' and its logged numbers deleted' : ''}.` : ''}
        options={[{ key: 'remove', label: 'Remove', icon: 'trash-outline', destructive: true }]}
        onSelect={doRemoveSet}
        onClose={() => setRemoveSetConfirm(null)}
      />

      {/* Per-exercise menu — machine occupied, changed my mind, reorder. */}
      <OptionSheet
        visible={exActionEx !== null}
        title={exActionEx?.name ?? ''}
        subtitle="Machine taken or changed your mind? Adjust this exercise."
        options={(() => {
          const i = exActionEx ? exercises.findIndex(e => e.id === exActionEx.id) : -1
          return [
            { key: 'swap', label: 'Swap exercise', sub: 'Same movement, different equipment', icon: 'swap-horizontal' },
            { key: 'plates', label: 'Plate Calculator', sub: 'See exactly what to load per side', icon: 'barbell-outline' },
            { key: 'end', label: 'Move to end', sub: 'Come back to it after the others', icon: 'arrow-down-circle-outline' },
            ...(i > 0 ? [{ key: 'up', label: 'Move up', icon: 'chevron-up-outline' }] : []),
            ...(i >= 0 && i < exercises.length - 1 ? [{ key: 'down', label: 'Move down', icon: 'chevron-down-outline' }] : []),
            { key: 'skip', label: 'Skip for today', sub: 'Remove from this session (kept in your plan)', icon: 'close-circle-outline', destructive: true },
            { key: 'remove', label: 'Remove permanently', sub: "Never suggest this exercise to me again", icon: 'trash-outline', destructive: true },
          ]
        })()}
        onSelect={(key) => {
          const ex = exActionEx
          setExActionEx(null)
          if (!ex) return
          if (key === 'plates') {
            if (!requireProForPlates('plate_calculator')) return
            const suggested = targets[ex.id]?.suggestedWeight
            setPlateCalcWeight(suggested != null ? displayWeight(suggested, unit) : null)
            setPlateCalcOpen(true)
            return
          }
          if (key === 'swap') handleSwap(ex)
          else if (key === 'end') moveExerciseToEnd(ex.id)
          else if (key === 'up') moveExercise(ex.id, -1)
          else if (key === 'down') moveExercise(ex.id, 1)
          else if (key === 'skip') skipExercise(ex)
          else if (key === 'remove') removeExercisePermanently(ex)
        }}
        onClose={() => setExActionEx(null)}
      />

      <OptionSheet
        visible={skipExerciseConfirm !== null}
        title="Skip this exercise?"
        subtitle={
          skipExerciseConfirm && workout?.source === 'split' && workout.split_id
            ? `Just for today's ${workout.focus}, or every ${workout.focus} on your split from now on?`
            : skipExerciseConfirm ? `${skipExerciseConfirm.name} will be removed from today's session. Your plan keeps it for next time.` : ''
        }
        options={
          workout?.source === 'split' && workout.split_id
            ? [
                { key: 'skip', label: 'Skip today only', sub: 'One-off — the rest of your split is unchanged', icon: 'close-circle-outline', destructive: true },
                { key: 'forward', label: `Remove from every ${workout.focus} on your split`, sub: 'Updates your split template and every upcoming day already scheduled', icon: 'trash-outline', destructive: true },
              ]
            : [{ key: 'skip', label: 'Skip today', icon: 'close-circle-outline', destructive: true }]
        }
        onSelect={(key) => { const ex = skipExerciseConfirm; setSkipExerciseConfirm(null); if (ex) void doSkipExercise(ex, key === 'forward') }}
        onClose={() => setSkipExerciseConfirm(null)}
      />

      <OptionSheet
        visible={removeExerciseConfirm !== null}
        title="Remove this exercise for good?"
        subtitle={removeExerciseConfirm ? `${removeExerciseConfirm.name} will come out of today's session, and ${BRAND_NAME} will never program it for you again — in this plan, a split, or a Quick Workout. You can't undo this from here.` : ''}
        options={[{ key: 'remove', label: 'Remove permanently', icon: 'trash-outline', destructive: true }]}
        onSelect={() => { const ex = removeExerciseConfirm; setRemoveExerciseConfirm(null); if (ex) void doRemoveExercisePermanently(ex) }}
        onClose={() => setRemoveExerciseConfirm(null)}
      />

      <OptionSheet
        visible={swapSheet !== null}
        title="Swap exercise"
        subtitle={swapSheet ? `Replace ${swapSheet.ex.name} with:` : ''}
        options={(swapSheet?.candidates ?? []).map(c => ({ key: c.id, label: c.name, icon: 'swap-horizontal' }))}
        onSelect={(key) => {
          const s = swapSheet
          setSwapSheet(null)
          const next = s?.candidates.find(c => c.id === key)
          if (!s || !next) return
          // Only a split-sourced workout has a real "going forward" to ask
          // about (N2) — a plan/quick workout swaps immediately, as before.
          if (workout?.source === 'split' && workout.split_id) {
            setSwapChoice({ oldId: s.ex.id, oldName: s.ex.name, next })
          } else {
            void replaceExercise(s.ex.id, next)
          }
        }}
        onClose={() => setSwapSheet(null)}
      />

      <OptionSheet
        visible={swapChoice !== null}
        title={swapChoice ? `Swap ${swapChoice.oldName} → ${swapChoice.next.name}` : ''}
        subtitle={`Just for today's ${workout?.focus ?? 'workout'}, or every ${workout?.focus ?? 'day'} on your split from now on?`}
        options={[
          { key: 'today', label: 'Swap for this session only', sub: 'One-off — the rest of your split is unchanged', icon: 'today-outline' },
          { key: 'forward', label: `Swap on every ${workout?.focus ?? 'day'} on your split`, sub: 'Updates your split template and every upcoming day already scheduled', icon: 'bookmark-outline' },
        ]}
        onSelect={(key) => {
          const s = swapChoice
          setSwapChoice(null)
          if (s) void replaceExercise(s.oldId, s.next, key === 'forward')
        }}
        onClose={() => setSwapChoice(null)}
      />

      {/* Session note — "bench felt heavy today" → workout_logs.notes */}
      <Modal visible={noteOpen} animationType="fade" transparent onRequestClose={() => setNoteOpen(false)}>
        <View style={styles.customRestBackdrop}>
          <View style={styles.noteCard}>
            <Text style={styles.customRestTitle}>Session note</Text>
            <Text style={styles.noteHint}>Anything worth remembering — how it felt, what to change next time. Saved with this session.</Text>
            <TextInput
              style={styles.noteInput}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="e.g. Bench felt heavy — try 5 lb less next week"
              placeholderTextColor={C.outline}
              multiline
              maxLength={500}
              autoFocus
            />
            <PressableScale style={styles.customRestStart} onPress={saveNote}>
              <Text style={styles.customRestStartText}>Save note</Text>
            </PressableScale>
            <TouchableOpacity onPress={() => setNoteOpen(false)} style={{ paddingVertical: Spacing.xs }}>
              <Text style={styles.customRestCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* First-session coach overlay (one-time) */}
      <Modal visible={coachVisible} animationType="fade" transparent onRequestClose={dismissCoach}>
        <View style={styles.coachBackdrop}>
          <View style={styles.coachCard}>
            <View style={styles.coachIcon}><Ionicons name="barbell" size={26} color={C.onPrimary} /></View>
            <Text style={styles.coachTitle}>Your first session</Text>
            <Text style={styles.coachBody}>A few things so you can just train:</Text>
            {[
              ['checkmark-circle-outline', 'Tap the ○ to log a set', 'Your rest timer starts automatically — no extra taps.'],
              ['timer-outline', 'Rest is handled', 'You’ll feel a buzz when it’s time, even with the phone locked.'],
              ['ellipsis-horizontal-circle-outline', 'Machine taken?', 'Tap ⋯ on any exercise to swap, reorder, or skip it.'],
              ['pause-circle-outline', 'Step away anytime', 'Pause up top — everything you logged is saved.'],
            ].map(([icon, title, body]) => (
              <View key={title} style={styles.coachRow}>
                <Ionicons name={icon as any} size={20} color={C.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.coachRowTitle}>{title}</Text>
                  <Text style={styles.coachRowBody}>{body}</Text>
                </View>
              </View>
            ))}
            <PressableScale style={styles.coachBtn} onPress={dismissCoach}>
              <Text style={styles.coachBtnText}>Let’s go</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>
    </ScreenTransition>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
// All original styles preserved. New styles appended at the bottom.

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { padding: Spacing.containerPadding, gap: Spacing.lg, paddingBottom: BottomTabInset + 54 },
  travelBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.sm,
  },
  travelBannerText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },
  deloadBanner: { backgroundColor: C.successSoft },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerPadding, paddingVertical: Spacing.md,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerLogo: { fontFamily: C.fontDisplay, fontSize: 16, color: C.primary, letterSpacing: 2 },
  avatar: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  // The title and the timer sit on one row. Neither side used to be flex-
  // constrained and the title had no numberOfLines, so both children claimed
  // their intrinsic width and simply collided: a Quick Workout called
  // "15-Minute Muscle Builder" rendered as "15-Minute Muscle Builder115:59"
  // with no gap and the timer jammed against the screen edge (seen on device).
  // The measurements are not marginal — that title alone is ~300dp of the
  // ~371dp available on a Pixel 8, so it overflows even with a two-digit
  // timer; a three-digit one (a session left open over an hour, which happens
  // whenever someone forgets to hit Complete) just makes it obvious.
  // Now the title side flexes and truncates while the timer keeps its full
  // width — the elapsed time must never be the thing that gets clipped.
  sessionBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: Spacing.containerPadding, paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  sessionLeft: { flex: 1, minWidth: 0, gap: 2 },
  sessionLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  sessionTitle: { fontFamily: C.fontDisplay, fontSize: 24, color: C.text, letterSpacing: -0.24 },
  sessionRight: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  estLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  timerText: { fontFamily: C.fontNumeric, fontSize: 24, color: C.text, letterSpacing: -0.5 },
  progressTrack: { height: 3, backgroundColor: C.surfaceContainerHigh, marginHorizontal: Spacing.containerPadding, borderRadius: Radius.full, marginBottom: Spacing.md },
  progressFill: { height: 3, backgroundColor: C.primary, borderRadius: Radius.full },
  exerciseCard: { backgroundColor: C.background, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md, ...CardShadow, borderWidth: 1, borderColor: C.outlineVariant },
  exerciseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  thumbWrap: {
    width: 58, height: 58, borderRadius: 12,
    backgroundColor: C.surfaceContainerLow,
    borderWidth: 1, borderColor: C.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', flexShrink: 0,
  },
  thumb: { width: 58, height: 58 },
  exerciseName: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text, letterSpacing: -0.2 },
  exerciseTarget: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, marginTop: 2 },
  timerRing: { width: 52, height: 52, borderRadius: Radius.full, borderWidth: 3, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  timerRingText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  tableHeader: { flexDirection: 'row', paddingBottom: Spacing.xs, borderBottomWidth: 1, borderBottomColor: C.surfaceContainerHigh },
  tableHeadCell: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.5, textAlign: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, gap: Spacing.xs },
  setRowActive: { backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: C.primary, paddingHorizontal: Spacing.sm, marginHorizontal: -Spacing.sm },
  setNum: { width: 28, fontFamily: 'Inter_700Bold', fontSize: 16, color: C.outline, textAlign: 'center' },
  setNumActive: { color: C.primary },
  setCell: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, textAlign: 'center' },
  inputBox: { flex: 1, height: 40, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.outlineVariant },
  inputText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, textAlign: 'center', width: '100%' },
  addBtn: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  checkCircle: { width: 28, height: 28, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  emptyCircle: { width: 28, height: 28, borderRadius: Radius.full, borderWidth: 1.5, borderColor: C.outlineVariant, alignSelf: 'center' },
  completeButton: { height: 52, backgroundColor: C.primary, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
  completeButtonText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.onPrimary, letterSpacing: 1 },
  upNextSection: { gap: Spacing.sm },
  upNextLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline, letterSpacing: 0.6 },
  upNextCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
  upNextImage: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  upNextInfo: { flex: 1 },
  upNextName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  upNextMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, marginTop: 2 },
  // `bottom` is set inline (insets-aware, clears the floating dock) — see caller.
  floatingTools: { position: 'absolute', right: Spacing.containerPadding, gap: Spacing.sm },
  floatingTool: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center', ...CardShadow, shadowOpacity: 0.08 },

  // ── New ───────────────────────────────────────────────────────────────────
  checkCircleFilled: {
    width: 28, height: 28, borderRadius: Radius.full,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
  },
  prevCell: { flex: 1.5, fontSize: 13, color: C.outline },
  muscleLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary, letterSpacing: 0.6, marginTop: 2 },
  addSetRow: { flexDirection: 'row', gap: Spacing.sm },
  addSetBtn: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center' },
  addSetBtnText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  setRowWarmup: { opacity: 0.85 },
  setNumWarmup: { color: C.primary, fontSize: 12 },
  noteCard: {
    alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, gap: Spacing.sm, ...CardShadow,
  },
  noteHint: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  noteInput: {
    minHeight: 90, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.md,
    fontFamily: 'Inter_400Regular', fontSize: 15, color: C.text, textAlignVertical: 'top',
  },
  coachBackdrop: {
    flex: 1, backgroundColor: 'rgba(27,27,28,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: Spacing.xl,
  },
  coachCard: {
    alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, gap: Spacing.sm, ...CardShadow,
  },
  coachIcon: {
    width: 52, height: 52, borderRadius: Radius.full, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: Spacing.xs,
  },
  coachTitle: { fontFamily: C.fontDisplay, fontSize: 22, color: C.text, letterSpacing: -0.3, textAlign: 'center' },
  coachBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, textAlign: 'center', marginBottom: Spacing.xs },
  coachRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', paddingVertical: 5 },
  coachRowTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  coachRowBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 1 },
  coachBtn: {
    height: 50, borderRadius: Radius.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm,
  },
  coachBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
  emptyStateContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  emptyIconWrap: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  emptyStateText: { fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text, textAlign: 'center', marginBottom: Spacing.xs },
  emptyStateSubtext: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.textSecondary, textAlign: 'center', lineHeight: 22 },
  quickCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: C.primary, borderRadius: Radius.lg, height: 52, paddingHorizontal: Spacing.xl, marginTop: Spacing.lg, alignSelf: 'stretch' },
  quickCtaText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.onPrimary },
  // ── Calendar (moved from Home) ───────────────────────────────────────────────
  segment: {
    flexDirection: 'row', marginBottom: Spacing.xs,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md, padding: 4, gap: 4,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: Radius.sm + 4 },
  segmentBtnActive: { backgroundColor: C.primary },
  segmentText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textSecondary },
  segmentTextActive: { color: C.onPrimary },
  rangeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Spacing.md, paddingBottom: Spacing.sm,
  },
  rangeText: { fontFamily: 'Inter_700Bold', fontSize: 20, color: C.text, letterSpacing: -0.3 },
  rangeNav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  todayChip: { backgroundColor: C.primarySoft, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  todayChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  weekRescheduleBtn: { width: 32, height: 32, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primarySoft },
  weekStrip: { flexDirection: 'row', marginBottom: Spacing.md },
  weekCell: { flex: 1, alignItems: 'center', gap: 5 },
  weekDow: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline, letterSpacing: 0.4 },
  weekDowActive: { color: C.primary },
  dayPill: {
    width: 38, height: 38, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent',
  },
  dayPillToday: { borderColor: C.primary },
  dayPillSelected: { backgroundColor: C.primary, borderColor: C.primary },
  dayNum: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  dayNumToday: { color: C.primary },
  dayNumSelected: { color: C.onPrimary },
  dayNumMuted: { color: C.outline },
  dayDot: { width: 5, height: 5, borderRadius: Radius.full },
  dotWorkout: { backgroundColor: C.primary },
  dotDone: { backgroundColor: C.success },
  dotMissed: { backgroundColor: C.error },
  dotOnSelected: { backgroundColor: '#FFFFFF' },
  dayDotPlaceholder: { width: 5, height: 5 },
  grid: { marginBottom: Spacing.md },
  gridDowRow: { flexDirection: 'row', marginBottom: Spacing.xs },
  gridDowLabel: { flex: 1, textAlign: 'center', fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline },
  gridBody: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4, gap: 3 },
  dayPillGrid: { width: 34, height: 34 },
  legendRow: {
    flexDirection: 'row', justifyContent: 'center', gap: Spacing.md,
    marginTop: Spacing.sm, paddingTop: Spacing.sm,
    borderTopWidth: 1, borderTopColor: C.outlineVariant,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline },

  // ── Selected-day summary (non-today) ─────────────────────────────────────────
  dayCard: {
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card, padding: Spacing.lg,
    gap: Spacing.xs, marginBottom: Spacing.md, ...Elevation.e1,
  },
  dayCardEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  dayCardStatus: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  dayCardWorkoutBlock: { gap: Spacing.xs },
  dayCardWorkoutDivider: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: C.outlineVariant },
  dayCardTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  completedTodayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dayCardMeta: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textSecondary },
  dayCardEditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: C.primarySoft, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 6, marginTop: Spacing.xs,
  },
  dayCardEditText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primary },
  dayCardRest: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  dayCardRestText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.outline },
  dayCardAddText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.primary, marginTop: Spacing.xs },

  switchedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  switchedBannerText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 13.5, color: C.text },
  coachIdle: { alignSelf: 'center', marginBottom: Spacing.xs },

  // ── Current split card ────────────────────────────────────────────────────--
  splitCard: {
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card, padding: Spacing.lg,
    gap: Spacing.sm, marginBottom: Spacing.md, ...Elevation.e1,
  },
  splitLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6 },
  splitTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  splitName: { fontFamily: C.fontDisplay, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  splitMeta: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: C.textSecondary, marginTop: 1 },
  splitEditBtn: { backgroundColor: C.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  splitEditText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.onPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  splitChip: { backgroundColor: C.surfaceContainerHigh, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
  splitChipText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.textSecondary, letterSpacing: 0.2 },

  // ── Library & Tools ──────────────────────────────────────────────────────────
  libraryLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginBottom: Spacing.xs },
  libraryCard: {
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card,
    borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden', marginBottom: Spacing.xl,
  },
  libraryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  libraryRowText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14.5, color: C.text },
  libraryDivider: { height: 1, backgroundColor: C.outlineVariant, marginLeft: Spacing.md + 18 + Spacing.sm },

  floatingToolActive: { borderWidth: 1.5, borderColor: C.primary },
  restPill: {
    position: 'absolute',
    // `bottom` is set inline (insets-aware, clears the floating dock) — see caller.
    alignSelf: 'center',
    minWidth: 230,
    gap: 8,
    backgroundColor: '#1B1C20',
    borderRadius: Radius.xl,
    paddingVertical: 12,
    paddingHorizontal: 20,
    zIndex: 40,
    shadowColor: '#101114',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 8,
  },
  restPillRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  restPillMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  restPillText: {
    fontFamily: C.fontNumeric,
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
  },
  restPillSkip: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#8DB4FF',
  },
  restPillTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  restPillFill: { height: 3, borderRadius: 2, backgroundColor: '#4E8BFF' },
  doneChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.successSoft, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs, paddingVertical: 3,
  },
  doneChipText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.success },
  completeButtonReady: { backgroundColor: C.success },

  // ── Adaptive coaching (Track 1) ─────────────────────────────────────────────
  targetCard: {
    backgroundColor: C.primarySoft,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 6,
  },
  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dirBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs, paddingVertical: 4,
  },
  dirBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  targetReason: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  exActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  exActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  exActionText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  exActionBtnActive: { backgroundColor: C.primary },
  emptyCircleActive: { borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  rpeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, marginBottom: Spacing.xs,
  },
  rpeBarLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textSecondary, marginRight: 2 },
  rpeChip: {
    flex: 1, height: 32, borderRadius: Radius.sm, backgroundColor: C.background,
    borderWidth: 1, borderColor: C.outlineVariant, alignItems: 'center', justifyContent: 'center',
  },
  rpeChipText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.text },
  rpeSkip: { paddingHorizontal: 4 },
  rpeSkipText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline },
  rpeLogged: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.outline, textAlign: 'right', marginTop: -2, marginBottom: 4 },

  // ── Hub (pre-session) ───────────────────────────────────────────────────────
  hubHero: { gap: 4 },
  hubEyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  hubEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.6 },
  originChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1,
  },
  originChipTempo: { backgroundColor: C.primarySoft, borderColor: 'transparent' },
  originChipYours: { backgroundColor: C.surfaceContainerLow, borderColor: C.outlineVariant },
  originText: { fontFamily: 'Inter_700Bold', fontSize: 10.5, letterSpacing: 0.3 },
  hubTitle: { fontFamily: C.fontDisplay, fontSize: 28, color: C.text, letterSpacing: -0.4 },
  hubMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  hubMeta: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
  hubReadyChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, paddingLeft: 10, paddingRight: 8, paddingVertical: 6, marginTop: 2 },
  hubReadyDot: { width: 8, height: 8, borderRadius: 4 },
  hubReadyText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: C.text },
  hubEditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primarySoft, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  hubEditText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },
  whyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: C.primarySoft, borderRadius: Radius.lg, padding: Spacing.md,
  },
  whyBtnText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
  whyRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', paddingVertical: 5 },
  whyNum: {
    fontFamily: 'Inter_700Bold', fontSize: 12, color: C.onPrimary,
    backgroundColor: C.primary, width: 20, height: 20, borderRadius: 10,
    textAlign: 'center', lineHeight: 20, overflow: 'hidden',
  },
  whyLine: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13.5, color: C.textSecondary, lineHeight: 19 },
  hubNav: { flexDirection: 'row', gap: Spacing.sm },
  hubNavCard: {
    flex: 1, alignItems: 'center', gap: Spacing.xs,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.card,
    borderWidth: 1, borderColor: C.outlineVariant,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xs,
    ...Elevation.e1,
  },
  hubNavIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  hubNavLabel: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text, letterSpacing: -0.1 },
  hubList: {
    backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, ...Elevation.e1,
  },
  hubRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  hubRowDivider: { borderTopWidth: 1, borderTopColor: C.surfaceContainerHigh },
  hubRowNum: { fontFamily: C.fontDisplay, fontSize: 14, color: C.outline, width: 20, textAlign: 'center' },
  hubRowName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.text },
  hubRowMuscle: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textSecondary, letterSpacing: 0.4, marginTop: 1 },
  hubRowSets: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textSecondary },
  hubStartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    height: 56, borderRadius: Radius.lg, backgroundColor: C.primary,
    ...Elevation.e2,
  },
  hubStartText: { fontFamily: C.fontDisplay, fontSize: 16, color: C.onPrimary, letterSpacing: 0.2 },

  // ── Session controls (pause, remove set, add exercise, custom rest) ─────────
  pauseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full,
    borderWidth: 1, borderColor: C.outlineVariant,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  pauseBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.text },
  setTrash: { width: 22, alignItems: 'center', justifyContent: 'center' },
  setTrashSpacer: { width: 22 },
  addExerciseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    paddingVertical: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.primary,
    backgroundColor: C.surfaceContainerLow,
  },
  addExerciseText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  customRestBackdrop: {
    flex: 1, backgroundColor: 'rgba(27,27,28,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: Spacing.xl,
  },
  customRestCard: {
    alignSelf: 'stretch', backgroundColor: C.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, gap: Spacing.md, alignItems: 'center', ...CardShadow,
  },
  customRestTitle: { fontFamily: C.fontDisplay, fontSize: 20, color: C.text, letterSpacing: -0.3 },
  customRestRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  customRestStep: {
    width: 44, height: 44, borderRadius: Radius.full, backgroundColor: C.surfaceContainerLow,
    borderWidth: 1, borderColor: C.outlineVariant, alignItems: 'center', justifyContent: 'center',
  },
  customRestValue: { fontFamily: C.fontNumeric, fontSize: 32, color: C.text, minWidth: 96, textAlign: 'center' },
  customRestStart: {
    alignSelf: 'stretch', height: 50, borderRadius: Radius.lg, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  customRestStartText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
  customRestCancel: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.textSecondary },
})
