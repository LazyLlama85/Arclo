// Tempo — Settings (modal).
//
// Split out of Profile (which used to carry both "who you are" — stats,
// history, body, social — and "how the app behaves" — calendar sync,
// notifications, subscription, account — in one 1700-line screen). Profile
// keeps identity/history; this owns configuration. Reached from a gear icon
// in Profile's header. Every row below is moved verbatim from Profile — same
// handlers, same behavior, same copy — this is a relocation, not a rewrite.

import { ScrollView, TouchableOpacity, View, Text, StyleSheet, Alert, Linking, ActivityIndicator, Switch } from 'react-native'
import { useState, useCallback, useEffect } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import Constants from 'expo-constants'
import { Spacing, Radius, type Palette } from '@/constants/theme'
import { BRAND_NAME } from '@/constants/brand'
import { useTheme, useThemedStyles, useThemeMode, type ThemeMode } from '@/theme'
import { ScreenHeader, DismissButton } from '@/components/brand'
import { ScreenTransition } from '@/components/motion'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { getCalendarPermissionStatus } from '@/services/calendarService'
import { isGoogleCalendarConnected } from '@/services/googleCalendar/CalendarAuthService'
import { autoSyncEnabled, syncUpcomingWorkouts, purgeSyncedWorkouts, removeAllTempoEvents } from '@/lib/calendarAutoSync'
import { autoScheduleUpcoming, autoSchedulingEnabled } from '@/lib/autoSchedule'
import { describePauseUntil } from '@/lib/pauseMode'
import { deleteAccount } from '@/lib/account'
import { useUnitStore, unitLabel, type WeightUnit } from '@/lib/units'
import { useFocusModePrefStore } from '@/lib/focusModePref'
import { setPushEnabled as applyPushEnabled } from '@/lib/pushTokens'
import {
  loadNotificationPrefs, setServerRuleEnabled, setPreWorkoutEnabled,
  getMasterPushEnabled, setMasterPushEnabled,
  DEFAULT_PREFS, type NotificationPrefs, type ServerRule,
} from '@/lib/notificationPrefs'
import { scheduleWorkoutReminders, cancelAllReminders, hasReminderPermission } from '@/lib/notifications'
import { useProAccess, useEntitlementStore } from '@/stores/entitlements'
import { presentCustomerCenter } from '@/lib/purchases'
import { STORE } from '@/lib/storeCopy'
import { useTutorialStore } from '@/stores/tutorial'
import { T } from '@/lib/tutorial'
import { OptionSheet } from '@/components/OptionSheet'
import { track } from '@/lib/analytics'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function availabilitySummary(tod: string | null | undefined, flex: string | null | undefined): string {
  return `${tod ? cap(tod) : 'Any time'} · ${flex ? cap(flex) : 'Balanced'}`
}

type SettingRowProps = { icon: string; label: string; value: string; onPress?: () => void }
function SettingRow({ icon, label, value, onPress }: SettingRowProps) {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <TouchableOpacity style={styles.settingRow} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon as any} size={18} color={C.primary} />
      </View>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={C.outlineVariant} />}
    </TouchableOpacity>
  )
}

export default function SettingsScreen() {
  const C = useTheme()
  const styles = useThemedStyles(makeStyles)
  const router = useRouter()
  const { mode, setMode } = useThemeMode()
  const { profile, session, signOut, refreshProfile } = useAuthStore()
  const userId = session?.user.id ?? ''

  const [calendarStatus, setCalendarStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null)
  const [googleConnected, setGoogleConnected] = useState(false)

  // Server-driven push toggle for this device
  const [pushEnabled, setPushEnabled] = useState(true)
  // Per-rule notification preferences (§6.1) — finer control beneath the master
  // switch. pre_workout is device-local; the rest are account-level.
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)
  // The full per-type list stays collapsed by default — showing all 7 rows
  // unconditionally overwhelmed the one switch most people actually want. It
  // reveals itself only when the user taps "Customize" to go looking for it.
  const [showNotifDetails, setShowNotifDetails] = useState(false)

  // Weight display unit (lb/kg) — a device preference; storage stays lbs.
  const unit = useUnitStore((s) => s.unit)
  const setUnit = useUnitStore((s) => s.setUnit)
  const focusModeEnabled = useFocusModePrefStore((s) => s.enabled)
  const setFocusModeEnabled = useFocusModePrefStore((s) => s.setEnabled)

  // "Add workouts to my calendar" — default on; only acts once a calendar is connected.
  const [autoSync, setAutoSync] = useState(autoSyncEnabled(profile))
  // "Automatically schedule workout times" — default on. Independent of calendar
  // connection: a connected calendar is still read for busy times in manual mode.
  const [autoScheduleTimes, setAutoScheduleTimes] = useState(autoSchedulingEnabled(profile))

  const [deleting, setDeleting] = useState(false)
  const [removingEvents, setRemovingEvents] = useState(false)

  // App Store-required account deletion. Double-confirm (it's irreversible and wipes
  // all data), then call the server function and sign out on success. The two
  // confirms are modeled as sheet stages instead of nested Alert.alerts.
  const [deleteAccountStage, setDeleteAccountStage] = useState<'confirm' | 'final' | null>(null)
  const [removeEventsSheet, setRemoveEventsSheet] = useState(false)
  const runDelete = async () => {
    setDeleting(true)
    const res = await deleteAccount(supabase)
    setDeleting(false)
    if (res.ok) {
      await signOut()
      // This screen is a modal pushed on top of (tabs) — signing out swaps the
      // stack underneath to /sign-in, but a presented modal doesn't auto-dismiss
      // just because the screen behind it changed. Without this it stayed on
      // screen until the user tapped the back arrow themselves.
      if (router.canDismiss()) router.dismissAll()
    } else {
      Alert.alert('Couldn’t delete account', `Something went wrong (${res.error}). Please try again, or contact support if it continues.`)
    }
  }
  const handleDeleteAccount = () => {
    if (deleting) return
    setDeleteAccountStage('confirm')
  }

  // A guest's anonymous session IS the account — there is no way to sign back in.
  // One casual tap must never be able to permanently orphan weeks of training data.
  const [signOutSheetVisible, setSignOutSheetVisible] = useState(false)
  const confirmSignOut = () => setSignOutSheetVisible(true)

  // Refresh both calendar connections on focus so the row reflects a connect/
  // disconnect made elsewhere (Smart Scheduler, Calendar Setup) without a reload.
  useFocusEffect(
    useCallback(() => {
      getCalendarPermissionStatus().then(setCalendarStatus)
      isGoogleCalendarConnected().then(setGoogleConnected).catch(() => setGoogleConnected(false))
    }, []),
  )

  // Reflect the user's push on/off state when the screen gains focus. Read from the
  // user-level flag (not the device token, which may not exist) so it's accurate.
  useFocusEffect(
    useCallback(() => {
      if (userId) getMasterPushEnabled(supabase, userId).then(setPushEnabled).catch(() => {})
    }, [userId]),
  )

  // Load the per-rule notification preferences (§6.1).
  useEffect(() => {
    if (userId) loadNotificationPrefs(supabase, userId).then(setNotifPrefs).catch(() => {})
  }, [userId])

  const togglePush = async (next: boolean) => {
    setPushEnabled(next) // optimistic
    if (!userId) return

    // Flip device_tokens first — when turning ON this is also what prompts for
    // OS permission (if never granted) and registers the token.
    const deviceResult = await applyPushEnabled(supabase, userId, next).catch(() => 'error' as const)

    // iOS never re-shows its own prompt once denied — requestPermissionsAsync
    // just resolves 'denied' again instantly. An in-app switch literally cannot
    // fix that, so don't pretend it did: revert and send the user to the one
    // place that can, system Settings.
    if (next && deviceResult === 'permission_denied') {
      setPushEnabled(false)
      Alert.alert(
        'Notifications are off in Settings',
        `${BRAND_NAME} needs permission from iOS to send reminders. Turn notifications on for ${BRAND_NAME} in system Settings, then flip this switch again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      )
      return
    }

    // Persist at the USER level so the switch STICKS even when no device token is
    // registered (the old device_tokens-only path silently reverted on those devices).
    const masterOk = await setMasterPushEnabled(supabase, userId, next)

    // A genuine write failure (network drop, etc.) — revert AND say why, rather
    // than the old behavior of silently re-reading the server and letting the
    // switch appear to "slide back" on its own with no explanation.
    if (!masterOk || deviceResult === 'error') {
      setPushEnabled(!next)
      Alert.alert('Could not update', 'Check your connection and try again.')
    }
  }

  // Flip one account-level retention rule (§6.1). Optimistic; the edge function
  // reads the persisted value at send time.
  const toggleServerRule = (rule: ServerRule) => async (next: boolean) => {
    setNotifPrefs((p) => ({ ...p, [rule]: next })) // optimistic
    if (!userId) return
    await setServerRuleEnabled(supabase, userId, rule, next).catch(() => {})
  }

  // The pre-workout reminder is a LOCAL notification — toggling it re-plays the
  // device's schedule immediately: off cancels pending reminders, on re-schedules
  // the coming sessions (same reconciliation Home runs on focus).
  const togglePreWorkout = async (next: boolean) => {
    setNotifPrefs((p) => ({ ...p, pre_workout: next })) // optimistic
    setPreWorkoutEnabled(next)
    try {
      if (!next) {
        await cancelAllReminders()
      } else if (userId && (await hasReminderPermission())) {
        const todayStr = new Date().toISOString().slice(0, 10)
        const { data: upcoming } = await supabase
          .from('scheduled_workouts')
          .select('id, focus, planned_date, planned_start_time, planned_duration_min, status')
          .eq('user_id', userId)
          .eq('status', 'scheduled')
          .gte('planned_date', todayStr)
        await scheduleWorkoutReminders((upcoming ?? []) as any)
      }
    } catch { /* reminders are best-effort */ }
  }

  // Tempo Pro (§10). Both rows stay hidden while Pro is dormant (proEnabled false),
  // so Settings is visually unchanged until the flag is flipped on.
  const { isPro, proEnabled } = useProAccess()
  // Tester tools (remote-gated; never shown to the public). Lets a beta tester flip
  // Pro on/off on-device to preview both the free/paywall and unlocked experiences.
  const tester = useEntitlementStore((s) => s.tester)
  const devProOverride = useEntitlementStore((s) => s.devProOverride)
  const setDevProOverride = useEntitlementStore((s) => s.setDevProOverride)
  const openPaywall = () => { track('paywall_shown', { context: 'settings' }); router.push({ pathname: '/paywall', params: { context: 'settings' } }) }

  // Replay the guided walkthrough: re-arm the Concepts tour (the definitions —
  // what a workout/split is, generate vs. schedule, etc. — taught across Home /
  // Plan / Profile) plus the Home + Plan spotlight tours ("where things are") +
  // re-show the first-session coach overlay, then drop the user on Home where
  // Concepts auto-starts (it's gated identically to the other tours, so simply
  // being armed + not-yet-done + no active tour is enough — no manual startTour
  // call needed here).
  const replayTour = () => {
    const tut = useTutorialStore.getState()
    tut.completeStep('welcome_done') // ensure the welcome gate stays satisfied
    tut.replay(T.conceptsTour)
    tut.replay(T.homeTour)
    tut.replay(T.planTour)
    try {
      const ls = (globalThis as { localStorage?: Storage }).localStorage
      ls?.removeItem('tempo.coach.session')
    } catch { /* best-effort */ }
    Alert.alert('Tour reset', 'The walkthrough will play again the next time you open Home.', [
      {
        text: 'Show me',
        onPress: () => {
          // Settings is a MODAL pushed on top of the tabs (reached via Profile's
          // gear icon) — a plain push to Home left it stacked underneath, so the
          // tour was invisible until the user manually swiped/backed out of
          // Settings themselves. Dismiss the modal stack first so Home is what's
          // actually on screen when the tour starts.
          if (router.canDismiss()) router.dismissAll()
          router.replace('/(tabs)')
        },
      },
    ])
  }

  // Which calendar Tempo schedules around — prefer the user's chosen provider,
  // else whichever is actually connected.
  const connectedCalendar =
    profile?.preferred_calendar === 'google' && googleConnected ? 'Google Calendar'
      : profile?.preferred_calendar === 'device' && calendarStatus === 'granted' ? 'Device Calendar'
        : googleConnected ? 'Google Calendar'
          : calendarStatus === 'granted' ? 'Device Calendar'
            : null
  const calendarConnected = !!connectedCalendar
  const calendarValue = connectedCalendar
    ? `${connectedCalendar} connected`
    : 'Connect to sync workouts'

  // Keep the auto-sync toggle in step with the stored preference.
  useEffect(() => { setAutoSync(autoSyncEnabled(profile)) }, [profile?.calendar_autosync])
  useEffect(() => { setAutoScheduleTimes(autoSchedulingEnabled(profile)) }, [profile?.scheduling_mode])

  // Toggle automatic scheduling. Switching ON immediately places upcoming workouts
  // around the calendar; switching OFF just stops Tempo from moving times.
  const toggleAutoSchedule = async (next: boolean) => {
    setAutoScheduleTimes(next) // optimistic
    if (userId) {
      try {
        await supabase.from('user_profiles').update({ scheduling_mode: next ? 'auto' : 'manual' }).eq('user_id', userId)
        await refreshProfile()
      } catch { /* keep the optimistic toggle */ }
      if (next) autoScheduleUpcoming(supabase, userId).catch(() => {})
    }
  }

  // Toggle "add workouts to my calendar". Turning it ON (with a calendar connected)
  // immediately syncs upcoming workouts; turning it OFF removes every Tempo event we
  // ever added, so the user's calendar goes back to exactly how it was.
  const toggleAutoSync = async (next: boolean) => {
    setAutoSync(next) // optimistic
    if (userId) {
      try {
        await supabase.from('user_profiles').update({ calendar_autosync: next }).eq('user_id', userId)
        await refreshProfile()
      } catch { /* keep the optimistic toggle */ }
    }
    if (next && calendarConnected) {
      syncUpcomingWorkouts(supabase, userId, { ...(profile as any), calendar_autosync: true }).catch(() => {})
    } else if (!next) {
      // Clean up after ourselves — delete all Tempo-added events from the calendar.
      // Fixed 2026-08-02: this used to be fire-and-forget with no failure
      // feedback at all — if the calendar API failed partway (network,
      // revoked permission), the toggle still flipped off silently while
      // stale Tempo events stayed on the user's calendar, contradicting the
      // UI's own "no Tempo events left behind" promise. purgeSyncedWorkouts
      // never rejects (each row is its own best-effort try/catch), so the
      // only way to see a partial failure is comparing removed vs. total.
      // The toggle itself still stays off either way — that's still the
      // user's real intent (no NEW events going forward) — this just makes a
      // cleanup failure visible instead of invisible.
      const { removed, total } = await purgeSyncedWorkouts(supabase, userId).catch(() => ({ removed: 0, total: 0 }))
      if (removed < total) {
        Alert.alert(
          'Some events may remain',
          `Auto-sync is off, but ${BRAND_NAME} couldn’t confirm every synced event was removed from your calendar. Use "Delete ${BRAND_NAME} events from calendar" below to clean up manually.`,
        )
      }
    }
  }

  // "Remove all Tempo events" — wipe every "Tempo · …" / "Tempo: …" event off the
  // connected calendar(s), including orphans we no longer track, and forget the
  // pointers. Useful after lots of re-planning leaves stray events behind.
  const handleRemoveAllTempoEvents = () => {
    if (!userId || removingEvents) return
    if (!calendarConnected) {
      Alert.alert('No calendar connected', `Connect a calendar first — then ${BRAND_NAME} can remove its events from it.`)
      return
    }
    setRemoveEventsSheet(true)
  }
  const doRemoveAllTempoEvents = async () => {
    if (!userId) return
    setRemovingEvents(true)
    let count = 0
    try { count = await removeAllTempoEvents(supabase, userId) } catch { /* best-effort */ }
    // Turn auto-add off too, so they don't immediately come back.
    try {
      await supabase.from('user_profiles').update({ calendar_autosync: false }).eq('user_id', userId)
      await refreshProfile()
    } catch { /* best-effort */ }
    setAutoSync(false)
    setRemovingEvents(false)
    Alert.alert(
      'Done',
      count > 0
        ? `Removed ${count} ${BRAND_NAME} event${count === 1 ? '' : 's'} from your calendar.`
        : `No ${BRAND_NAME} events were found on your calendar.`,
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenTransition>
      <ScreenHeader
        title="Settings"
        size="sm"
        leading={<DismissButton onPress={() => router.back()} label="Close settings" />}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── Calendar & Scheduling ───────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Calendar & Scheduling</Text>
          <View style={styles.card}>
            <SettingRow
              icon="time-outline"
              label="AVAILABILITY & SCHEDULE"
              value={availabilitySummary(profile?.preferred_time_of_day, profile?.schedule_flexibility)}
              onPress={() => router.push('/availability')}
            />
            <View style={styles.divider} />
            <SettingRow
              icon="calendar-outline"
              label="CALENDAR"
              value={calendarValue}
              onPress={() => router.push('/calendar-setup')}
            />
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="sparkles-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>AUTOMATIC SCHEDULING</Text>
                <Text style={styles.settingValue}>
                  {autoScheduleTimes ? `${BRAND_NAME} places workouts around your day` : "You schedule workouts yourself"}
                </Text>
              </View>
              <Switch
                value={autoScheduleTimes}
                onValueChange={toggleAutoSchedule}
                trackColor={{ true: C.primary, false: C.outlineVariant }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="sync-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>ADD WORKOUTS TO CALENDAR</Text>
                <Text style={styles.settingValue}>
                  {calendarConnected ? (autoSync ? 'Auto-adding your workouts' : 'Off') : 'Connect a calendar first'}
                </Text>
              </View>
              <Switch
                value={autoSync && calendarConnected}
                onValueChange={toggleAutoSync}
                disabled={!calendarConnected}
                trackColor={{ true: C.primary, false: C.outlineVariant }}
                thumbColor="#fff"
              />
            </View>
            {calendarConnected && (
              <>
                <View style={styles.divider} />
                <SettingRow
                  icon="trash-outline"
                  label={`REMOVE ALL ${BRAND_NAME.toUpperCase()} EVENTS`}
                  value={removingEvents ? 'Removing…' : `Delete ${BRAND_NAME} events from calendar`}
                  onPress={handleRemoveAllTempoEvents}
                />
              </>
            )}
            <View style={styles.divider} />
            <SettingRow
              icon="pause-circle-outline"
              label="PAUSE MY PLAN"
              value={profile?.paused_until ? `Paused until ${describePauseUntil(profile.paused_until)}` : 'Going away? Pause without breaking your streak'}
              onPress={() => router.push('/pause-mode')}
            />
          </View>
        </View>

        {/* ── Subscription (Tempo Pro) — its own group; only while Pro is live ─ */}
        {proEnabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Subscription</Text>
            <View style={styles.card}>
              {!isPro ? (
                <TouchableOpacity style={styles.settingRow} onPress={openPaywall} activeOpacity={0.7}>
                  <View style={[styles.settingIcon, { backgroundColor: C.primarySoft }]}>
                    <Ionicons name="sparkles" size={18} color={C.primary} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>{BRAND_NAME.toUpperCase()} PRO</Text>
                    <Text style={styles.settingValue}>Unlock adaptive coaching & deep analytics</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.primary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.settingRow} onPress={() => void presentCustomerCenter()} activeOpacity={0.7}>
                  <View style={[styles.settingIcon, { backgroundColor: C.primarySoft }]}>
                    <Ionicons name="star" size={18} color={C.primary} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>{BRAND_NAME.toUpperCase()} PRO</Text>
                    <Text style={styles.settingValue}>Active — manage subscription</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.outlineVariant} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ── Tester Tools — remote-gated (app_config `tester_tools`); never shown to
            the public. Flips Pro on/off ON THIS DEVICE so a beta tester can preview
            both the free/paywall experience and the fully-unlocked one — without a
            real purchase and without editing the database each time. ─ */}
        {tester && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tester Tools</Text>
            <View style={styles.card}>
              <View style={styles.settingRow}>
                <View style={[styles.settingIcon, { backgroundColor: C.primarySoft }]}>
                  <Ionicons name="flask-outline" size={18} color={C.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>{BRAND_NAME.toUpperCase()} PRO (TESTER)</Text>
                  <Text style={styles.settingValue}>
                    {isPro ? 'On — Pro features unlocked' : 'Off — paywalls & free limits show'}
                  </Text>
                </View>
                <Switch
                  value={isPro}
                  onValueChange={(v) => setDevProOverride(v)}
                  trackColor={{ true: C.primary, false: C.outlineVariant }}
                  thumbColor="#fff"
                />
              </View>
              {devProOverride !== null && (
                <>
                  <View style={styles.divider} />
                  <SettingRow
                    icon="refresh-outline"
                    label="USE REAL SUBSCRIPTION STATE"
                    value="Clear the tester override"
                    onPress={() => setDevProOverride(null)}
                  />
                </>
              )}
            </View>
          </View>
        )}

        {/* ── App ─────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="notifications-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>NOTIFICATIONS</Text>
                <Text style={styles.settingValue}>{pushEnabled ? 'Reminders & nudges on' : 'Off for this device'}</Text>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={togglePush}
                trackColor={{ true: C.primary, false: C.outlineVariant }}
                thumbColor="#fff"
              />
            </View>

            {/* Per-rule controls (§6.1) — mute one nag without silencing the rest.
                Collapsed by default: 7 individual rows overwhelmed the one switch
                most people actually want, so they only appear once asked for. */}
            <TouchableOpacity
              style={styles.prefRow}
              onPress={() => setShowNotifDetails((v) => !v)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={showNotifDetails ? 'Hide notification types' : 'Customize notification types'}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.prefLabel}>Customize notification types</Text>
                <Text style={styles.prefSub}>{showNotifDetails ? 'Showing all 7' : 'Missed workout, streak alerts, and more'}</Text>
              </View>
              <Ionicons name={showNotifDetails ? 'chevron-up' : 'chevron-down'} size={18} color={C.textSecondary} />
            </TouchableOpacity>

            {showNotifDetails && ([
              { key: 'pre_workout', label: 'Pre-workout reminder', sub: '30 minutes before a session', server: false },
              { key: 'missed_workout', label: 'Missed workout', sub: 'A gentle nudge if you miss one', server: true },
              { key: 'streak_at_risk', label: 'Streak at risk', sub: "Evening reminder when today's is still open", server: true },
              { key: 'weekly_report', label: 'Weekly report', sub: 'Your Sunday progress recap', server: true },
              { key: 'free_time_gap', label: 'Free time suggestions', sub: 'A quick workout when you have a gap', server: true },
              { key: 'partner_reminder', label: 'Workout partner', sub: 'When a workout you planned with a friend is coming up', server: true },
              { key: 'friend_competition', label: 'Friend competition', sub: "When you're close on the weekly leaderboard", server: true },
            ] as const).map((r) => {
              const disabled = r.server && !pushEnabled
              return (
                <View key={r.key} style={[styles.prefRow, disabled && { opacity: 0.45 }]}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.prefLabel}>{r.label}</Text>
                    <Text style={styles.prefSub}>{r.sub}</Text>
                  </View>
                  <Switch
                    value={notifPrefs[r.key]}
                    onValueChange={r.server ? toggleServerRule(r.key as ServerRule) : togglePreWorkout}
                    disabled={disabled}
                    trackColor={{ true: C.primary, false: C.outlineVariant }}
                    thumbColor="#fff"
                  />
                </View>
              )
            })}

            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="contrast-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>APPEARANCE</Text>
                <Text style={styles.settingValue}>{mode === 'dark' ? 'Dark' : 'Light'}</Text>
              </View>
              <View style={styles.themeToggle}>
                {(['dark', 'light'] as ThemeMode[]).map((m) => {
                  const on = mode === m
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[styles.themeOpt, on && styles.themeOptOn]}
                      onPress={() => setMode(m)}
                      activeOpacity={0.85}
                      accessibilityLabel={m === 'dark' ? 'Dark mode' : 'Light mode'}
                    >
                      <Ionicons name={m === 'dark' ? 'moon' : 'sunny'} size={15} color={on ? C.onPrimary : C.outline} />
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="scale-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>UNITS</Text>
                <Text style={styles.settingValue}>{unit === 'kg' ? 'Kilograms' : 'Pounds'}</Text>
              </View>
              <View style={styles.themeToggle}>
                {(['lb', 'kg'] as WeightUnit[]).map((u) => {
                  const on = unit === u
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[styles.themeOpt, on && styles.themeOptOn]}
                      onPress={() => setUnit(u)}
                      activeOpacity={0.85}
                      accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
                    >
                      <Text style={[styles.unitOptText, on && { color: C.onPrimary }]}>{u}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="expand-outline" size={18} color={C.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>WORKOUT FOCUS MODE</Text>
                <Text style={styles.settingValue}>
                  {focusModeEnabled ? 'Full-screen active-set view during sets' : 'Off — use the scrolling list only'}
                </Text>
              </View>
              <Switch
                value={focusModeEnabled}
                onValueChange={setFocusModeEnabled}
                trackColor={{ true: C.primary, false: C.outlineVariant }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.divider} />
            <SettingRow icon="school-outline" label="REPLAY APP TOUR" value="Show the guided walkthrough again" onPress={replayTour} />
          </View>
        </View>

        {/* ── Account ─────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <SettingRow
              icon="hand-left-outline"
              label="BLOCKED ACCOUNTS"
              value="See and undo who you've blocked"
              onPress={() => router.push('/blocked-users')}
            />
            <SettingRow icon="shield-outline" label="PRIVACY & TERMS" value="View" onPress={() => router.push('/legal')} />
          </View>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={confirmSignOut} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* App Store-required: delete account + all data from within the app. */}
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator color={C.error} />
          ) : (
            <Text style={styles.deleteText}>Delete Account</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.deleteHint}>Permanently erases your account and all data.</Text>

        {/* Brand footer */}
        <View style={styles.brandFooter}>
          <Image
            source={require('@/assets/images/tempo-logo.png')}
            style={styles.brandFooterLogo}
            contentFit="contain"
            accessibilityLabel={BRAND_NAME}
          />
          <Text style={styles.brandFooterVersion}>{BRAND_NAME} · Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
        </View>
      </ScrollView>

      <OptionSheet
        visible={deleteAccountStage === 'confirm'}
        title="Delete account?"
        subtitle="This permanently deletes your account and all your data — plans, workouts, logs, and progress. This cannot be undone."
        options={[{ key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true }]}
        onSelect={() => setDeleteAccountStage('final')}
        onClose={() => setDeleteAccountStage(null)}
      />
      <OptionSheet
        visible={deleteAccountStage === 'final'}
        title="Are you absolutely sure?"
        subtitle={
          // Deleting the account does NOT cancel the subscription — the store
          // owns billing, and nothing this app does can stop it. Saying so is
          // not a legal nicety: a subscriber who deletes their account and then
          // keeps getting charged files a chargeback and leaves a one-star
          // review, and both are deserved if we never told them. Only shown to
          // someone who actually has a subscription, so it is a warning rather
          // than noise.
          isPro
            ? `Your account and every workout you’ve logged will be erased immediately. There’s no way to recover it.

This does NOT cancel your subscription. You’ll keep being charged until you cancel it in ${STORE.manage}.`
            : 'Your account and every workout you’ve logged will be erased immediately. There’s no way to recover it.'
        }
        options={[{ key: 'delete', label: 'Delete forever', icon: 'trash-outline', destructive: true }]}
        onSelect={() => { setDeleteAccountStage(null); runDelete() }}
        onClose={() => setDeleteAccountStage(null)}
      />
      <OptionSheet
        visible={signOutSheetVisible}
        title={session?.user.is_anonymous ? 'Sign out of guest account?' : 'Sign out?'}
        subtitle={session?.user.is_anonymous
          ? 'You’re using a guest account, and guest accounts can’t be signed back into. Signing out permanently loses your plan, workouts, and progress.'
          : 'You can sign back in any time.'}
        options={[{ key: 'signOut', label: session?.user.is_anonymous ? 'Sign out anyway' : 'Sign Out', icon: 'log-out-outline', destructive: true }]}
        onSelect={() => {
          setSignOutSheetVisible(false)
          void signOut().then(() => { if (router.canDismiss()) router.dismissAll() })
        }}
        onClose={() => setSignOutSheetVisible(false)}
      />
      <OptionSheet
        visible={removeEventsSheet}
        title={`Remove all ${BRAND_NAME} events?`}
        subtitle={`This deletes every ${BRAND_NAME} workout event from your connected calendar(s). Your ${BRAND_NAME} plan itself is untouched — only the calendar copies are removed.`}
        options={[{ key: 'remove', label: 'Remove all', icon: 'trash-outline', destructive: true }]}
        onSelect={() => { setRemoveEventsSheet(false); void doRemoveAllTempoEvents() }}
        onClose={() => setRemoveEventsSheet(false)}
      />
      </ScreenTransition>
    </SafeAreaView>
  )
}

const makeStyles = (C: Palette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: Spacing.containerPadding, paddingBottom: 60, gap: Spacing.lg },

  section: { gap: Spacing.sm },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: C.text, letterSpacing: -0.1 },

  card: { backgroundColor: C.background, borderRadius: Radius.xl, borderWidth: 1, borderColor: C.outlineVariant, overflow: 'hidden' },

  settingRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md },
  settingIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: C.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  settingInfo: { flex: 1 },
  settingLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.outline, letterSpacing: 0.5 },
  settingValue: { fontFamily: 'Inter_500Medium', fontSize: 15, color: C.text, marginTop: 1 },
  // Per-rule notification sub-rows (§6.1) — indented under the master switch.
  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, paddingLeft: 64,
  },
  prefLabel: { fontFamily: 'Inter_500Medium', fontSize: 14, color: C.text },
  prefSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textSecondary, marginTop: 1 },
  divider: { height: 1, backgroundColor: C.surfaceContainerHigh, marginLeft: 64 },

  themeToggle: { flexDirection: 'row', backgroundColor: C.surfaceContainerLow, borderRadius: Radius.full, padding: 3, gap: 3, borderWidth: 1, borderColor: C.outlineVariant },
  themeOpt: { width: 38, height: 30, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  themeOptOn: { backgroundColor: C.primary },
  unitOptText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.outline, textTransform: 'uppercase' },

  signOutBtn: { height: 52, backgroundColor: C.surfaceContainerLow, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  signOutText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.error },
  deleteBtn: { marginTop: Spacing.sm, height: 48, alignItems: 'center', justifyContent: 'center' },
  deleteText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.error },
  deleteHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.outline, textAlign: 'center', marginTop: 2 },

  brandFooter: { alignItems: 'center', marginTop: Spacing.xl, marginBottom: Spacing.lg, gap: 8 },
  brandFooterLogo: { width: 44, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.outlineVariant },
  brandFooterVersion: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.outline, letterSpacing: 0.2 },
})
