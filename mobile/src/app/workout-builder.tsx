// Tempo — workout builder (modal).
//
// Build a workout from the library + custom exercises, set per-exercise metrics,
// then save it as a reusable template and/or schedule it onto a date & time. Opens
// fresh (create), with ?templateId to edit a saved template, and ?date to preset the
// schedule day (e.g. tapped a calendar day).

import { useEffect, useRef, useState } from 'react'
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { PulseLoader, ScreenHeader, DismissButton } from '@/components/brand'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Spacing, Radius, CardShadow, type Palette } from '@/constants/theme'
import { useTheme, useThemedStyles } from '@/theme'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { PressableScale } from '@/components/motion'
import { scheduleWorkoutReminders, requestPermissions } from '@/lib/notifications'
import { suggestTimeOnDate } from '@/lib/reschedule'
import { defaultStartTime } from '@/lib/defaultStartTime'
import { useWeightUnit, unitLabel, toInputString, inputToLbs, type WeightUnit } from '@/lib/units'
import { ExercisePickerSheet } from '@/components/ExercisePickerSheet'
import { ExerciseThumb } from '@/components/ExerciseThumb'
import { useExerciseLibrary } from '@/lib/exerciseSearch'
import { OptionSheet } from '@/components/OptionSheet'
import { TimePickerSheet, formatTime12 } from '@/components/TimePickerSheet'
import { EXERCISE_COLUMNS } from '@/lib/customExercises'
import {
  type DraftItem, makeDraftItem, estimateDurationMin,
  saveTemplate, scheduleWorkout, templateToItems, countTemplates,
} from '@/lib/workoutBuilder'
import { useCreateLimit } from '@/lib/proLimits'
import { WORKOUT_PRESETS, workoutPresetById, hydrateWorkoutPreset } from '@/lib/starterTemplates'
import { setSplitHandoff } from '@/lib/handoff'
import { track } from '@/lib/analytics'
import * as haptics from '@/lib/haptics'
import type { Exercise, WorkoutTemplate } from '@/types'

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const NEXT_DAYS = Array.from({ length: 21 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d })

export default function WorkoutBuilderScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { templateId, date, presetId, forSplit, addExerciseIds } = useLocalSearchParams<{ templateId?: string; date?: string; presetId?: string; forSplit?: string; addExerciseIds?: string }>()
  const { session } = useAuthStore()
  const userId = session?.user.id ?? ''
  const { canCreate } = useCreateLimit()
  const unit = useWeightUnit()

  // Two modes:
  //   • create/edit a saved workout (no `date`) — just name + save to the library.
  //   • schedule onto a day (`date` present, e.g. from the calendar's Add Workout) —
  //     also shows the date/time picker + a Schedule action.
  const scheduling = !!date

  const [name, setName] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scheduleDate, setScheduleDate] = useState<string>(date ?? toDateStr(new Date()))
  // Never a past time. The calendar-aware suggestion below is better when it
  // works, but it is async and can legitimately come back null (no free window
  // left, no calendar access, a failed fetch). This is the floor underneath it,
  // computed synchronously so there is nothing to wait for and nothing to flash.
  const [time, setTime] = useState(() => defaultStartTime(date ?? toDateStr(new Date())))
  const [showTime, setShowTime] = useState(false)
  // Smart pre-fill: the same free-slot engine auto-scheduling uses suggests a time
  // for the chosen day. A manually picked time always wins and is never overwritten.
  const [suggestedTime, setSuggestedTime] = useState<string | null>(null)
  const [timeTouched, setTimeTouched] = useState(false)
  const [busy, setBusy] = useState<null | 'template' | 'schedule'>(null)
  const [loading, setLoading] = useState(!!templateId || !!presetId)

  // Load an existing template, or pre-fill from a starter preset, into the editor.
  useEffect(() => {
    if (!userId) return
    // try/finally on both loaders: a rejected hydrate must never strand the screen
    // on its full-screen loader (there's no other way out of it).
    if (templateId) {
      ;(async () => {
        try {
          const { data } = await supabase.from('workout_templates').select('*').eq('id', templateId).maybeSingle()
          if (data) {
            const tpl = data as WorkoutTemplate
            setName(tpl.name)
            setItems(await templateToItems(supabase, tpl))
          }
        } finally {
          setLoading(false)
        }
      })()
    } else if (presetId) {
      const preset = workoutPresetById(presetId)
      if (!preset) { setLoading(false); return }
      ;(async () => {
        try {
          setName(preset.name)
          setItems(await hydrateWorkoutPreset(supabase, preset))
        } finally {
          setLoading(false)
        }
      })()
    }
  }, [templateId, presetId, userId])

  // Exercises picked from the standalone Exercise Library (which has no way to
  // hold a draft of its own) arrive as ids on the URL; add them once the shared,
  // already-cached library query resolves. Gated on a ref so re-navigating back
  // to this same screen instance (e.g. after removing one) doesn't re-add it.
  const { data: pickerLibrary } = useExerciseLibrary(!!addExerciseIds)
  const appliedPickRef = useRef(false)
  useEffect(() => {
    if (!addExerciseIds || appliedPickRef.current || !pickerLibrary) return
    appliedPickRef.current = true
    const ids = new Set(addExerciseIds.split(',').filter(Boolean))
    const toAdd = pickerLibrary.filter((ex) => ids.has(ex.id))
    if (toAdd.length) setItems((p) => [...p, ...toAdd.filter((ex) => !p.some((i) => i.exercise.id === ex.id)).map(makeDraftItem)])
  }, [addExerciseIds, pickerLibrary])

  // Suggest a calendar-aware time whenever the chosen day changes (schedule mode
  // only). It fills the field only while the user hasn't picked a time themselves.
  useEffect(() => {
    if (!scheduling || !userId) return
    let stale = false
    // Re-floor immediately for the newly chosen day, so switching from tomorrow
    // back to today can never leave yesterday's morning slot sitting in the
    // field while the suggestion is in flight.
    if (!timeTouched) setTime(defaultStartTime(scheduleDate))
    suggestTimeOnDate(supabase, userId, scheduleDate, estMin || 45)
      .then((s) => {
        if (stale) return
        setSuggestedTime(s?.start_time ?? null)
        if (timeTouched) return
        // A null suggestion means the engine found nothing, not that 7am is
        // fine. Fall back to the floor rather than whatever was already there.
        setTime(s ? s.start_time : defaultStartTime(scheduleDate))
      })
      .catch(() => { if (!stale && !timeTouched) setTime(defaultStartTime(scheduleDate)) })
    return () => { stale = true }
  // estMin/timeTouched deliberately aren't deps — re-suggest per day, not per keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduling, userId, scheduleDate])

  // Replace the current draft with a starter template (offered when empty).
  // A bottom sheet, not Alert.alert — Android caps alerts at 3 buttons, which
  // silently hid most presets.
  const [presetSheet, setPresetSheet] = useState(false)
  const applyPreset = async (presetKey: string) => {
    const p = WORKOUT_PRESETS.find((x) => x.id === presetKey)
    setPresetSheet(false)
    if (!p) return
    setLoading(true)
    try {
      setName((n) => n.trim() || p.name)
      setItems(await hydrateWorkoutPreset(supabase, p))
    } catch {
      // Same guard the split-editor's preset loader has — a rejection here used to
      // strand the builder on its loader.
      Alert.alert('Couldn’t load template', 'Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const addExercise = (ex: Exercise) => setItems((p) => (p.some((i) => i.exercise.id === ex.id) ? p : [...p, makeDraftItem(ex)]))
  const removeItem = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i))
  const moveItem = (i: number, dir: -1 | 1) => setItems((p) => {
    const j = i + dir
    if (j < 0 || j >= p.length) return p
    const next = [...p]; [next[i], next[j]] = [next[j], next[i]]; return next
  })
  const patch = (i: number, partial: Partial<DraftItem>) =>
    setItems((p) => p.map((it, idx) => (idx === i ? { ...it, ...partial } : it)))

  const num = (s: string): number | null => { const n = parseFloat(s); return Number.isFinite(n) ? n : null }
  const estMin = items.length ? estimateDurationMin(items) : 0

  const validate = (): boolean => {
    if (!name.trim()) { Alert.alert('Name it', 'Give your workout a name.'); return false }
    if (items.length === 0) { Alert.alert('Add an exercise', 'Add at least one exercise to your workout.'); return false }
    return true
  }

  const handleSaveTemplate = async () => {
    if (busy || !validate()) return
    setBusy('template')
    // Free-tier cap: block saving a NEW custom workout past the limit (routes to the
    // paywall). Inert while Pro is dormant; editing an existing template is never gated.
    if (!templateId) {
      const count = await countTemplates(supabase, userId)
      if (!canCreate('custom_workouts', count)) { setBusy(null); return }
    }
    const id = await saveTemplate(supabase, userId, { name, items, templateId: templateId ?? null })
    setBusy(null)
    if (id) {
      track('custom_workout_saved', { exercise_count: items.length, scheduled: false })
      if (forSplit) {
        // Came from the split editor's “create a new workout for this day” — hand
        // the result back and return immediately; the split editor assigns it to
        // the day and reopens, so there's nothing to hunt for.
        setSplitHandoff(id)
        router.back()
        return
      }
      Alert.alert('Saved', `”${name.trim()}” is in My Workouts.`)
      router.back()
    } else Alert.alert('Could not save', 'Please try again.')
  }

  const handleSchedule = async () => {
    if (busy || !validate()) return
    setBusy('schedule')
    const id = await scheduleWorkout(supabase, userId, {
      name, items, plannedDate: scheduleDate, plannedStartTime: time, durationMin: estMin,
    })
    setBusy(null)
    if (id) {
      track('custom_workout_saved', { exercise_count: items.length, scheduled: true })
      // Best-effort: also keep it as a reusable template the first time.
      if (!templateId) saveTemplate(supabase, userId, { name, items }).catch(() => {})
      // Pre-workout reminder, like plan workouts get (best-effort, never blocks).
      requestPermissions()
        .then((granted) => {
          if (granted) return scheduleWorkoutReminders([
            { id, focus: name.trim(), planned_date: scheduleDate, planned_start_time: time, planned_duration_min: estMin, status: 'scheduled' },
          ])
        })
        .catch(() => {})
      // Close immediately instead of gating on an Alert dismiss — the whole
      // point of scheduling is seeing it land on the calendar right behind
      // this screen, and a modal "Done" tap was just standing in the way of
      // that. A success haptic is the confirmation now, not a dialog.
      haptics.success()
      router.back()
    } else Alert.alert('Could not schedule', 'Please try again.')
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header C={C} styles={styles} onClose={() => router.back()} title="Edit workout" />
        <View style={styles.center}><PulseLoader caption="Loading…" /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        C={C}
        styles={styles}
        onClose={() => router.back()}
        title={scheduling ? 'Add workout' : templateId ? 'Edit workout' : 'New workout'}
        onSave={scheduling ? handleSchedule : handleSaveTemplate}
        saving={!!busy}
        saveLabel={scheduling ? 'Schedule' : templateId ? 'Save' : 'Save'}
      />

      <ScrollView style={styles.flex} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={styles.label}>WORKOUT NAME</Text>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Push Day, Saturday Run"
          placeholderTextColor={C.outline}
          maxLength={48}
        />

        <View style={styles.rowBetween}>
          <Text style={styles.label}>EXERCISES{items.length ? ` · ${items.length}` : ''}</Text>
          {estMin > 0 && <Text style={styles.estText}>~{estMin} min</Text>}
        </View>

        {items.length === 0 && !templateId && (
          <TouchableOpacity style={styles.templateBtn} onPress={() => setPresetSheet(true)} activeOpacity={0.85}>
            <Ionicons name="sparkles" size={16} color={C.primary} />
            <Text style={styles.templateBtnText}>Start from a template</Text>
            <Ionicons name="chevron-forward" size={15} color={C.outline} />
          </TouchableOpacity>
        )}

        {items.map((it, i) => (
          <View key={it.exercise.id} style={styles.exCard}>
            <View style={styles.exHead}>
              <ExerciseThumb exerciseId={it.exercise.id} isCustom={it.exercise.is_custom} size={36} C={C} />
              <View style={{ flex: 1 }}>
                <Text style={styles.exName} numberOfLines={1}>{it.exercise.name}</Text>
                <Text style={styles.exMeta} numberOfLines={1}>{it.exercise.category ?? it.exercise.movement_pattern}</Text>
              </View>
              <View style={styles.exHeadActions}>
                <TouchableOpacity onPress={() => moveItem(i, -1)} disabled={i === 0} hitSlop={6}><Ionicons name="chevron-up" size={18} color={i === 0 ? C.outlineVariant : C.outline} /></TouchableOpacity>
                <TouchableOpacity onPress={() => moveItem(i, 1)} disabled={i === items.length - 1} hitSlop={6}><Ionicons name="chevron-down" size={18} color={i === items.length - 1 ? C.outlineVariant : C.outline} /></TouchableOpacity>
                <TouchableOpacity onPress={() => removeItem(i)} hitSlop={6}><Ionicons name="close-circle" size={20} color={C.outline} /></TouchableOpacity>
              </View>
            </View>

            <View style={styles.metricRow}>
              <Field styles={styles} C={C} label="SETS" value={String(it.sets)} onChange={(v) => patch(i, { sets: Math.max(1, Math.round(num(v) ?? 1)) })} keyboardType="number-pad" />
              {it.metrics.includes('reps') && (
                <Field styles={styles} C={C} label="REPS" value={it.repHigh ? String(it.repHigh) : ''} onChange={(v) => { const n = num(v); patch(i, { repLow: n ?? 0, repHigh: n ?? 0 }) }} keyboardType="number-pad" placeholder="—" />
              )}
              {it.metrics.includes('weight') && (
                <WeightField
                  styles={styles}
                  C={C}
                  unit={unit}
                  initial={toInputString(it.weightLbs, unit)}
                  onLbs={(lbs) => patch(i, { weightLbs: lbs })}
                />
              )}
              {it.metrics.includes('duration') && (
                <Field styles={styles} C={C} label="SECS" value={it.durationSec != null ? String(it.durationSec) : ''} onChange={(v) => patch(i, { durationSec: num(v) })} keyboardType="number-pad" placeholder="—" />
              )}
              {it.metrics.includes('distance') && (
                <Field styles={styles} C={C} label="DIST (M)" value={it.distanceM != null ? String(it.distanceM) : ''} onChange={(v) => patch(i, { distanceM: num(v) })} keyboardType="decimal-pad" placeholder="—" />
              )}
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addBtn} onPress={() => setPickerOpen(true)} activeOpacity={0.85}>
          <Ionicons name="add" size={20} color={C.primary} />
          <Text style={styles.addBtnText}>Add exercise</Text>
        </TouchableOpacity>

        {/* Schedule — only when adding to the calendar (date present). Creating a
            workout just saves it to your library; you schedule it from the calendar. */}
        {scheduling ? (
          <>
            <Text style={[styles.label, { marginTop: Spacing.lg }]}>SCHEDULE FOR</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysRow}>
              {NEXT_DAYS.map((d) => {
                const ds = toDateStr(d); const on = ds === scheduleDate
                return (
                  <TouchableOpacity key={ds} style={[styles.dayChip, on && styles.dayChipOn]} onPress={() => setScheduleDate(ds)} activeOpacity={0.85}>
                    <Text style={[styles.dayWd, on && styles.dayTextOn]}>{WD[d.getDay()]}</Text>
                    <Text style={[styles.dayNum, on && styles.dayTextOn]}>{d.getDate()}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
            <TouchableOpacity style={styles.timeBtn} onPress={() => setShowTime(true)} activeOpacity={0.7}>
              <Ionicons name="time-outline" size={18} color={C.primary} />
              <Text style={styles.timeBtnText}>{formatTime12(time)}</Text>
              <Ionicons name="chevron-forward" size={16} color={C.outline} />
            </TouchableOpacity>
            {suggestedTime !== null && time === suggestedTime && (
              <View style={styles.freeHint}>
                <Ionicons name="sparkles" size={13} color={C.primary} />
                <Text style={styles.freeHintText}>You’re free at this time — picked around your day</Text>
              </View>
            )}
          </>
        ) : (
          <View style={styles.saveHint}>
            <Ionicons name="bookmark-outline" size={15} color={C.textSecondary} />
            <Text style={styles.saveHintText}>Saved to your library — reuse it when adding a workout to your calendar or building a split.</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) + Spacing.sm }]}>
        {scheduling ? (
          <>
            <PressableScale style={[styles.secondaryBtn, busy && { opacity: 0.6 }]} onPress={handleSaveTemplate} disabled={!!busy}>
              {busy === 'template' ? <ActivityIndicator color={C.primary} /> : <Text style={styles.secondaryBtnText}>Save to library</Text>}
            </PressableScale>
            <PressableScale style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={handleSchedule} disabled={!!busy}>
              {busy === 'schedule' ? <ActivityIndicator color={C.onPrimary} /> : (
                <><Ionicons name="calendar" size={16} color={C.onPrimary} /><Text style={styles.primaryBtnText}>Schedule</Text></>
              )}
            </PressableScale>
          </>
        ) : (
          <PressableScale style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={handleSaveTemplate} disabled={!!busy}>
            {busy === 'template' ? <ActivityIndicator color={C.onPrimary} /> : (
              <><Ionicons name="bookmark" size={16} color={C.onPrimary} /><Text style={styles.primaryBtnText}>{templateId ? 'Save changes' : 'Save workout'}</Text></>
            )}
          </PressableScale>
        )}
      </View>

      <ExercisePickerSheet
        visible={pickerOpen}
        userId={userId}
        client={supabase}
        existingIds={items.map((i) => i.exercise.id)}
        onClose={() => setPickerOpen(false)}
        onAdd={addExercise}
        onRemove={(ex) => setItems((p) => p.filter((i) => i.exercise.id !== ex.id))}
      />
      <TimePickerSheet visible={showTime} value={time} title="Workout time" onSelect={(v) => { setTime(v); setTimeTouched(true); setShowTime(false) }} onClose={() => setShowTime(false)} />
      <OptionSheet
        visible={presetSheet}
        title="Start from a template"
        subtitle="Pre-fill with a proven workout — you can tweak everything after."
        options={WORKOUT_PRESETS.map((p) => ({ key: p.id, label: p.name, sub: `${p.exercises.length} exercises`, icon: 'barbell-outline' }))}
        onSelect={applyPreset}
        onClose={() => setPresetSheet(false)}
      />
    </SafeAreaView>
  )
}

function Header({ C, styles, onClose, title, onSave, saving, saveLabel }: {
  C: Palette; styles: any; onClose: () => void; title: string
  onSave?: () => void; saving?: boolean; saveLabel?: string
}) {
  return (
    <ScreenHeader
      title={title}
      size="sm"
      leading={<DismissButton kind="x" onPress={onClose} label="Close" />}
      right={onSave ? (
        <TouchableOpacity onPress={onSave} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel={saveLabel ?? 'Save'}>
          {saving ? <ActivityIndicator color={C.primary} /> : <Text style={styles.headerSave}>{saveLabel ?? 'Save'}</Text>}
        </TouchableOpacity>
      ) : undefined}
    />
  )
}

// Weight input keeps its own text (in the DISPLAY unit) so typing "22.5" in kg
// never round-trips through a number mid-keystroke and loses the decimal point;
// the draft model still stores lbs.
function WeightField({ styles, C, unit, initial, onLbs }: {
  styles: any; C: Palette; unit: WeightUnit; initial: string; onLbs: (lbs: number | null) => void
}) {
  const [text, setText] = useState(initial)
  return (
    <Field
      styles={styles}
      C={C}
      label={unitLabel(unit).toUpperCase()}
      value={text}
      onChange={(v) => { setText(v); onLbs(inputToLbs(v, unit)) }}
      keyboardType="decimal-pad"
      placeholder="—"
    />
  )
}

function Field({ styles, C, label, value, onChange, keyboardType, placeholder }: {
  styles: any; C: Palette; label: string; value: string; onChange: (v: string) => void
  keyboardType?: 'number-pad' | 'decimal-pad'; placeholder?: string
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType ?? 'number-pad'}
        placeholder={placeholder ?? '0'}
        placeholderTextColor={C.outline}
        maxLength={6}
      />
    </View>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerSave: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.primary },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 120, gap: Spacing.xs },
  label: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.outline, letterSpacing: 0.6, marginTop: Spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  estText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary, marginTop: Spacing.sm },
  freeHint: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Spacing.xs },
  freeHintText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.primary },
  nameInput: { height: 50, backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.md, fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text },
  exCard: { backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, padding: Spacing.md, gap: Spacing.sm, ...CardShadow },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  exName: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  exMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, textTransform: 'capitalize', marginTop: 1 },
  exHeadActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  field: { flex: 1, minWidth: 64, gap: 4 },
  fieldLabel: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.outline, letterSpacing: 0.5 },
  fieldInput: { height: 42, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.md, borderWidth: 1, borderColor: C.outlineVariant, paddingHorizontal: Spacing.sm, fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text, textAlign: 'center' },
  saveHint: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, marginTop: Spacing.lg, borderRadius: Radius.lg, backgroundColor: C.surfaceContainerLow },
  saveHintText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  templateBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: C.primarySoft, marginTop: Spacing.xs },
  templateBtnText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.primary, backgroundColor: C.surfaceContainerLow, marginTop: Spacing.xs },
  addBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  daysRow: { gap: Spacing.xs, paddingVertical: 4 },
  dayChip: { width: 52, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center', gap: 2, borderWidth: 1.5, borderColor: C.outlineVariant },
  dayChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  dayWd: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.outline },
  dayNum: { fontFamily: C.fontDisplay, fontSize: 17, color: C.text },
  dayTextOn: { color: C.onPrimary },
  timeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: C.background, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.outlineVariant, marginTop: Spacing.xs },
  timeBtnText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 16, color: C.text },
  footer: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerPadding, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 0.5, borderTopColor: C.outlineVariant, backgroundColor: C.surface },
  secondaryBtn: { flex: 1, height: 54, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.surfaceContainerLow },
  secondaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primary },
  primaryBtn: { flex: 1, height: 54, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: C.primary },
  primaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.onPrimary },
})
