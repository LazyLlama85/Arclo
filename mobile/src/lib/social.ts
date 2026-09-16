// Tempo — social data layer: friends, privacy, friend workouts, sharing.
//
// Backend contract lives in supabase/add_social.sql (applied). Discovery and
// friend stats go through SECURITY DEFINER RPCs so user_profiles RLS stays
// owner-only; friend template browsing rides an RLS policy gated on the owner's
// privacy_workouts. Shares are snapshots under a short code — the link is the
// capability.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal, Split, SplitDay, WorkoutExerciseConfig, WorkoutTemplate } from '@/types'
import { sessionStreak, longestSessionStreak, distinctDayStreak, type StreakRow } from './streak'
import { computeTempoScore } from './tempoScore'
import { BADGE_BY_KEY, badgeStatsFromSessions, computeEarnedBadges } from './badges'
import { BRAND_DOMAIN } from '@/constants/brand'
import { todayStr, addDays, toDateStr } from './dates'

export type PrivacyLevel = 'public' | 'friends' | 'private'

export interface SocialProfile {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  username: string | null
}

export interface FriendEntry extends SocialProfile {
  friendshipId: string
  /** 'friend' = accepted; 'incoming' / 'outgoing' = pending request. */
  state: 'friend' | 'incoming' | 'outgoing'
}

export interface FriendOverview {
  display_name: string | null
  avatar_url: string | null
  username: string | null
  member_since?: string | null
  stats_visible: boolean
  activity_visible: boolean
  goal?: Goal | null
  days_per_week?: number
  total_workouts?: number
  total_sets?: number
  total_volume_lbs?: number
  favorite_muscle?: string | null
  /** Awarded competitive/social badge keys (see lib/badges). */
  stored_badges?: string[]
  streak?: number
  longest_streak?: number
  workouts_this_week?: number
  workouts_this_month?: number
  recent?: { focus: string; date: string }[]
  /** Earned badge keys (derived consistency badges + stored competitive/social). */
  earned_badges?: string[]
}

// ── Own identity (handle + friend code) ───────────────────────────────────────

export interface MyIdentity {
  username: string | null
  friend_code: string | null
}

export async function fetchMyIdentity(client: SupabaseClient, userId: string): Promise<MyIdentity> {
  const { data } = await client
    .from('user_profiles')
    .select('username, friend_code')
    .eq('user_id', userId)
    .maybeSingle()
  return { username: data?.username ?? null, friend_code: data?.friend_code ?? null }
}

/**
 * How many incoming friend requests + workout invites are pending — the same
 * count Profile's Friends header badge already computes. Shared here (Phase 8,
 * 2026-07-17) so Home's Feed button can aggregate the identical signal instead
 * of re-deriving it, without a new backend/table.
 */
export async function fetchSocialNotifCount(client: SupabaseClient, userId: string): Promise<number> {
  const [{ count: requests }, { count: invites }] = await Promise.all([
    client.from('friendships').select('id', { count: 'exact', head: true }).eq('addressee_id', userId).eq('status', 'pending'),
    client.from('workout_invites').select('id', { count: 'exact', head: true }).eq('to_user', userId).eq('status', 'pending'),
  ])
  return (requests ?? 0) + (invites ?? 0)
}

export const USERNAME_RULE = /^[a-z0-9_]{3,20}$/

/**
 * Update the user's @username.
 *
 * `blocked` comes from the database trigger added for App Store Guideline 1.2 —
 * the objectionable-name filter is server-side because this writes straight to
 * `user_profiles` under RLS, so a client-side check would be bypassable.
 */
export async function updateUsername(
  client: SupabaseClient,
  userId: string,
  username: string,
): Promise<'ok' | 'invalid' | 'taken' | 'blocked' | 'failed'> {
  const u = username.trim().toLowerCase().replace(/^@/, '')
  if (!USERNAME_RULE.test(u)) return 'invalid'
  const { error } = await client.from('user_profiles').update({ username: u }).eq('user_id', userId)
  if (!error) return 'ok'
  const msg = `${error.message}`.toLowerCase()
  if (msg.includes('username_not_allowed')) return 'blocked'
  return msg.includes('duplicate') || error.code === '23505' ? 'taken' : 'failed'
}

// ── Activity feed + leaderboard ───────────────────────────────────────────────

export interface FeedItem extends SocialProfile {
  focus: string
  completed_at: string
  /** The completed session this row represents — the reaction target. Optional so
   *  the feed still renders if the reactions migration hasn't been applied yet. */
  workout_id?: string
  reaction_count?: number
  i_reacted?: boolean
}

export async function fetchFriendFeed(client: SupabaseClient): Promise<FeedItem[]> {
  const { data } = await client.rpc('friend_feed')
  return ((data ?? []) as (FeedItem & { reaction_count?: number | string; i_reacted?: boolean })[]).map((r) => ({
    ...r,
    reaction_count: Number(r.reaction_count) || 0,
    i_reacted: !!r.i_reacted,
  }))
}

/**
 * Toggle the current user's "nice work" reaction on a friend's completed session.
 * Returns the fresh count + whether the user is now reacting, or null on failure
 * (e.g. offline, or the reactions migration not yet applied — the caller reverts).
 */
export async function toggleActivityReaction(
  client: SupabaseClient,
  workoutId: string,
): Promise<{ count: number; reacted: boolean } | null> {
  const { data, error } = await client.rpc('toggle_activity_reaction', { target_workout: workoutId })
  if (error) return null
  const row = (Array.isArray(data) ? data[0] : data) as { reaction_count?: number | string; i_reacted?: boolean } | null
  if (!row) return null
  return { count: Number(row.reaction_count) || 0, reacted: !!row.i_reacted }
}

export interface LeaderboardRow extends SocialProfile {
  workouts_this_week: number
}

export async function fetchFriendsLeaderboard(client: SupabaseClient): Promise<LeaderboardRow[]> {
  const { data } = await client.rpc('friends_leaderboard')
  return ((data ?? []) as (LeaderboardRow & { workouts_this_week: number | string })[])
    .map((r) => ({ ...r, workouts_this_week: Number(r.workouts_this_week) || 0 }))
}

// ── Leaderboard v2: the three ranked boards (Weekly Consistency / Streak / Tempo) ─
// One RPC returns every rank input per member; the Tempo Score is computed here so
// the formula stays OTA-tunable (see lib/tempoScore.ts). Sorting is client-side so
// all three tabs share one fetch.

export type LeaderboardMetric = 'weekly' | 'streak' | 'tempo'

export interface LeaderboardV2Row extends SocialProfile {
  scheduled_this_week: number
  completed_this_week: number
  active_days_this_week: number
  current_streak: number
  completion_pct: number // 0–100 (0 when nothing was scheduled)
  tempo_score: number // 0–1000
}

/** Map raw leaderboard rows (friends OR group RPC — same shape) to display rows,
 *  computing the Tempo Score client-side. Shared by friends + group boards. */
export function mapLeaderboardV2Rows(rows: Record<string, unknown>[]): LeaderboardV2Row[] {
  return rows.map((r) => {
    const scheduled = Number(r.scheduled_this_week) || 0
    const completed = Number(r.completed_this_week) || 0
    const tempo_score = computeTempoScore({
      dueDays: Number(r.due_28) || 0,
      trainedDays: Number(r.completed_28) || 0,
      weeksMetGoal: Number(r.weeks_met_goal) || 0,
      currentStreak: Number(r.current_streak) || 0,
      goalPerWeek: Number(r.goal_per_week) || 3,
    }).score
    return {
      user_id: String(r.user_id),
      display_name: (r.display_name as string | null) ?? null,
      avatar_url: (r.avatar_url as string | null) ?? null,
      username: (r.username as string | null) ?? null,
      scheduled_this_week: scheduled,
      completed_this_week: completed,
      active_days_this_week: Number(r.active_days_this_week) || 0,
      current_streak: Number(r.current_streak) || 0,
      completion_pct: scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0,
      tempo_score,
    }
  })
}

export async function fetchLeaderboardV2(client: SupabaseClient): Promise<LeaderboardV2Row[]> {
  const { data } = await client.rpc('friends_leaderboard_v2')
  return mapLeaderboardV2Rows((data ?? []) as Record<string, unknown>[])
}

/** Sort (a copy of) the rows for a given board. Ties break toward more real work done. */
export function sortLeaderboard(rows: LeaderboardV2Row[], metric: LeaderboardMetric): LeaderboardV2Row[] {
  const by = [...rows]
  if (metric === 'streak') {
    by.sort((a, b) => b.current_streak - a.current_streak || b.completed_this_week - a.completed_this_week)
  } else if (metric === 'tempo') {
    by.sort((a, b) => b.tempo_score - a.tempo_score || b.completed_this_week - a.completed_this_week)
  } else {
    by.sort(
      (a, b) =>
        b.completed_this_week - a.completed_this_week ||
        b.completion_pct - a.completion_pct ||
        b.current_streak - a.current_streak,
    )
  }
  return by
}

// ── Activity events (richer feed) ─────────────────────────────────────────────
// Non-completion feed items (streak milestones, badges…). Completions still come
// from friend_feed(); the Friends screen merges the two streams chronologically.

export interface FriendEventItem extends SocialProfile {
  kind: 'streak_milestone' | 'perfect_week' | 'badge'
  payload: Record<string, unknown>
  created_at: string
}

export async function fetchFriendEvents(client: SupabaseClient): Promise<FriendEventItem[]> {
  const { data } = await client.rpc('friend_events')
  return ((data ?? []) as (FriendEventItem & { payload?: Record<string, unknown> })[]).map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name,
    avatar_url: r.avatar_url,
    username: r.username,
    kind: r.kind,
    payload: r.payload ?? {},
    created_at: r.created_at,
  }))
}

/** Feed copy for a non-completion event, e.g. "reached a 30-day streak". */
export function describeFriendEvent(e: FriendEventItem): string {
  if (e.kind === 'streak_milestone') return `reached a ${Number(e.payload?.n) || ''}-day streak`
  if (e.kind === 'perfect_week') return 'completed every scheduled workout this week'
  if (e.kind === 'badge') return `earned the ${BADGE_BY_KEY[String(e.payload?.key ?? '')]?.label ?? ''} badge`.replace('  ', ' ')
  return 'hit a milestone'
}

/**
 * App-open social sweep (best-effort, non-blocking): award competitive badges for
 * the closed week/month, then publish this user's streak-milestone feed events
 * (deduped server-side) so friends' feeds stay fresh. Safe if the migrations aren't
 * applied yet — every step is caught.
 */
export async function syncSocialOnOpen(client: SupabaseClient, userId: string, daysPerWeek?: number | null): Promise<void> {
  if (!userId) return
  try { await client.rpc('claim_competitive_badges') } catch { /* pre-migration / offline */ }
  try {
    // Previously computed via new Date().toISOString().slice(0,10) — that's
    // the UTC date, not local, so a user behind UTC could have "today"
    // silently read as tomorrow for part of their evening, judging a
    // not-yet-settled streak miss a day early. planned_date is always local.
    const today = todayStr()
    const since = addDays(today, -120)
    const { data } = await client
      .from('scheduled_workouts')
      .select('planned_date, status, actual_duration_min')
      .eq('user_id', userId)
      .gte('planned_date', since)
    // A friend-feed milestone ("reached a 30-day streak") is an active claim
    // about real calendar days, not just an internal display convention — uses
    // the honest distinct-day count (see streak.ts) so a user training twice
    // in one day can't appear to cross a milestone after half the real days.
    const streak = distinctDayStreak((data ?? []) as StreakRow[], today)
    const events = [7, 14, 30, 50, 100]
      .filter((n) => streak >= n)
      .map((n) => ({ user_id: userId, kind: 'streak_milestone', dedupe: `streak:${n}`, payload: { n } }))
    if (events.length) {
      await client.from('activity_events').upsert(events, { onConflict: 'user_id,kind,dedupe', ignoreDuplicates: true })
    }
  } catch { /* best-effort */ }
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export async function searchProfiles(client: SupabaseClient, query: string): Promise<SocialProfile[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const { data } = await client.rpc('search_profiles', { q })
  return (data ?? []) as SocialProfile[]
}

// ── Friendships ───────────────────────────────────────────────────────────────

export async function fetchFriends(client: SupabaseClient, userId: string): Promise<FriendEntry[]> {
  const { data } = await client
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
  const rows = (data ?? []) as { id: string; requester_id: string; addressee_id: string; status: string }[]
  if (!rows.length) return []

  const otherIds = rows.map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id))
  const { data: profiles } = await client.rpc('get_public_profiles', { ids: otherIds })
  const byId = new Map(((profiles ?? []) as SocialProfile[]).map((p) => [p.user_id, p]))

  return rows.map((r) => {
    const otherId = r.requester_id === userId ? r.addressee_id : r.requester_id
    const p = byId.get(otherId)
    return {
      friendshipId: r.id,
      user_id: otherId,
      display_name: p?.display_name ?? null,
      avatar_url: p?.avatar_url ?? null,
      username: p?.username ?? null,
      state: r.status === 'accepted' ? 'friend' : r.requester_id === userId ? 'outgoing' : 'incoming',
    }
  })
}

export async function sendFriendRequest(client: SupabaseClient, userId: string, toUserId: string): Promise<boolean> {
  const { error } = await client.from('friendships').insert({ requester_id: userId, addressee_id: toUserId })
  return !error
}

export async function acceptFriendRequest(client: SupabaseClient, friendshipId: string): Promise<boolean> {
  const { error } = await client
    .from('friendships')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', friendshipId)
  return !error
}

/** Decline an incoming request, cancel an outgoing one, or unfriend. */
export async function removeFriendship(client: SupabaseClient, friendshipId: string): Promise<boolean> {
  const { error } = await client.from('friendships').delete().eq('id', friendshipId)
  return !error
}

// ── Friend profile + workouts ─────────────────────────────────────────────────

export async function fetchFriendOverview(client: SupabaseClient, targetUserId: string): Promise<FriendOverview | null> {
  const { data } = await client.rpc('friend_overview', { target: targetUserId })
  if (!data) return null
  const raw = data as FriendOverview & { sessions?: StreakRow[] }
  const now = new Date()
  // Previously .toISOString().slice(0,10) (UTC) for both "today" and "Monday
  // of this week" — the same class of bug already fixed in syncSocialOnOpen
  // above: a user behind UTC could read the wrong local calendar day for
  // part of their evening.
  const today = todayStr(now)
  // Week starts Monday (matches the leaderboard's date_trunc('week')).
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const mondayStr = toDateStr(monday)
  const monthStr = `${today.slice(0, 7)}-01`
  const sessions = raw.sessions ?? []
  return {
    ...raw,
    streak: raw.sessions ? sessionStreak(sessions, today) : undefined,
    longest_streak: raw.sessions ? longestSessionStreak(sessions, today) : undefined,
    workouts_this_week: raw.sessions
      ? sessions.filter((s) => s.status === 'completed' && s.planned_date >= mondayStr).length
      : undefined,
    workouts_this_month: raw.sessions
      ? sessions.filter((s) => s.status === 'completed' && s.planned_date >= monthStr).length
      : undefined,
    // Derived consistency badges (from their session history) + stored competitive/
    // social badges — computed here so friend-profile just renders them.
    earned_badges: raw.sessions
      ? [...computeEarnedBadges(
          badgeStatsFromSessions(sessions, raw.days_per_week ?? 3, today, {
            totalWorkouts: raw.total_workouts, totalVolume: raw.total_volume_lbs,
          }),
          new Set(raw.stored_badges ?? []),
        )]
      : (raw.stored_badges ?? []),
  }
}

/** Templates the viewer is allowed to see (RLS enforces the owner's privacy). */
export async function fetchFriendTemplates(client: SupabaseClient, ownerId: string): Promise<WorkoutTemplate[]> {
  const { data } = await client
    .from('workout_templates')
    .select('*')
    .eq('user_id', ownerId)
    .order('updated_at', { ascending: false })
  return (data ?? []) as WorkoutTemplate[]
}

/**
 * Copy someone else's template into the viewer's library with attribution —
 * "Push (Jacob's)". The copy is fully owned by the viewer; edits never touch
 * the original. Custom exercises the viewer can't read are dropped.
 */
export async function copyTemplateToLibrary(
  client: SupabaseClient,
  userId: string,
  template: WorkoutTemplate,
  ownerName: string | null,
): Promise<string | null> {
  const readable = await readableExerciseIds(client, template.exercise_ids)
  const ids = template.exercise_ids.filter((id) => readable.has(id))
  if (!ids.length) return null
  const config = (template.config ?? []).filter((c) => readable.has(c.exercise_id))
  const name = ownerName ? `${template.name} (${possessive(ownerName)})` : template.name
  const { data, error } = await client
    .from('workout_templates')
    .insert({
      user_id: userId,
      name: name.slice(0, 60),
      exercise_ids: ids,
      config,
      notes: ownerName ? `Shared by ${ownerName}` : null,
      est_duration_min: template.est_duration_min,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  return error ? null : (data?.id ?? null)
}

// ── Privacy ───────────────────────────────────────────────────────────────────

export interface PrivacyPrefs {
  privacy_workouts: PrivacyLevel
  privacy_stats: PrivacyLevel
  privacy_activity: PrivacyLevel
  privacy_availability: PrivacyLevel
}

export async function fetchPrivacy(client: SupabaseClient, userId: string): Promise<PrivacyPrefs> {
  const { data } = await client
    .from('user_profiles')
    .select('privacy_workouts, privacy_stats, privacy_activity, privacy_availability')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    privacy_workouts: (data?.privacy_workouts as PrivacyLevel) ?? 'friends',
    privacy_stats: (data?.privacy_stats as PrivacyLevel) ?? 'friends',
    privacy_activity: (data?.privacy_activity as PrivacyLevel) ?? 'friends',
    privacy_availability: (data?.privacy_availability as PrivacyLevel) ?? 'friends',
  }
}

export async function updatePrivacy(client: SupabaseClient, userId: string, patch: Partial<PrivacyPrefs>): Promise<boolean> {
  const { error } = await client.from('user_profiles').update(patch).eq('user_id', userId)
  return !error
}

// ── Sharing ───────────────────────────────────────────────────────────────────

export interface WorkoutShare {
  id: string
  code: string
  owner_id: string
  owner_name: string | null
  name: string
  /** 'workout' = one template; 'split' = a whole weekly program. */
  kind: 'workout' | 'split'
  exercises: { id: string; name: string }[]
  config: WorkoutExerciseConfig[]
  /** Present when kind='split': the full weekday→workout pattern snapshot. */
  days: SplitDay[] | null
  /** Distinct equipment the workout needs (preview chips). */
  equipment: string[]
  est_duration_min: number
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // no 0/O/1/l/i lookalikes

function makeShareCode(): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return out
}

// BRAND_DOMAIN is the real, currently-live domain (see repo-root CNAME + web/)
// — this used to point at tempo.app, a domain the product never owned, so
// every share message sent from My Workouts/My Splits linked nowhere.
// web/share.html (§26 L27) is what actually resolves this path now, with a
// public (logged-out) preview.
export function shareUrl(code: string): string {
  return `https://${BRAND_DOMAIN}/w/${code}`
}

// Snapshot names + distinct equipment for a set of exercise ids, so previews
// render fully even for exercises the viewer can't read.
async function snapshotExercises(client: SupabaseClient, ids: string[]): Promise<{
  exercises: { id: string; name: string }[]
  equipment: string[]
}> {
  const { data: exRows } = ids.length
    ? await client.from('exercises').select('id, name, required_equipment').in('id', ids)
    : { data: [] }
  const rows = (exRows ?? []) as { id: string; name: string; required_equipment: string[] }[]
  const byId = new Map(rows.map((e) => [e.id, e]))
  return {
    exercises: ids.map((id) => ({ id, name: byId.get(id)?.name ?? 'Exercise' })),
    equipment: [...new Set(rows.flatMap((e) => e.required_equipment ?? []))],
  }
}

async function insertShare(client: SupabaseClient, row: Record<string, unknown>): Promise<WorkoutShare | null> {
  // Retry once on the (astronomically unlikely) code collision.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await client
      .from('workout_shares')
      .insert({ ...row, code: makeShareCode() })
      .select('*')
      .single()
    if (!error && data) return data as WorkoutShare
    if (error && !`${error.message}`.includes('duplicate')) return null
  }
  return null
}

/** Snapshot a template into a share row; returns the share (with code). */
export async function createWorkoutShare(
  client: SupabaseClient,
  userId: string,
  ownerName: string | null,
  template: WorkoutTemplate,
): Promise<WorkoutShare | null> {
  const { exercises, equipment } = await snapshotExercises(client, template.exercise_ids)
  return insertShare(client, {
    owner_id: userId,
    owner_name: ownerName,
    name: template.name,
    kind: 'workout',
    exercises,
    equipment,
    config: template.config ?? [],
    est_duration_min: template.est_duration_min,
  })
}

/** Snapshot a whole split (weekly program) into a share row. */
export async function createSplitShare(
  client: SupabaseClient,
  userId: string,
  ownerName: string | null,
  split: Split,
): Promise<WorkoutShare | null> {
  const allIds = [...new Set(split.days.flatMap((d) => d.exercise_ids ?? []))]
  const { exercises, equipment } = await snapshotExercises(client, allIds)
  const trainingDays = split.days.filter((d) => !d.rest && (d.exercise_ids?.length ?? 0) > 0)
  const estMin = Math.round(
    trainingDays.reduce((n, d) => n + (d.config?.reduce((s, c) => s + c.sets, 0) ?? 9) * 2.7, 0)
      / Math.max(1, trainingDays.length),
  )
  return insertShare(client, {
    owner_id: userId,
    owner_name: ownerName,
    name: split.name,
    kind: 'split',
    exercises,
    equipment,
    config: [],
    days: split.days,
    est_duration_min: Math.max(20, estMin),
  })
}

/** Import a shared split as the viewer's own (inactive) split, with attribution. */
export async function importSplitShare(
  client: SupabaseClient,
  userId: string,
  share: WorkoutShare,
): Promise<{ id: string | null; dropped: number }> {
  const days = share.days ?? []
  const allIds = [...new Set(days.flatMap((d) => d.exercise_ids ?? []))]
  const readable = await readableExerciseIds(client, allIds)
  let dropped = 0
  const cleanDays: SplitDay[] = days.map((d) => {
    if (d.rest || !d.exercise_ids?.length) return d
    const ids = d.exercise_ids.filter((id) => readable.has(id))
    dropped += d.exercise_ids.length - ids.length
    if (!ids.length) return { weekday: d.weekday, label: 'Rest', rest: true }
    return {
      ...d,
      template_id: null,
      exercise_ids: ids,
      config: (d.config ?? []).filter((c) => readable.has(c.exercise_id)),
    }
  })
  if (!cleanDays.some((d) => !d.rest && (d.exercise_ids?.length ?? 0) > 0)) {
    return { id: null, dropped }
  }
  const name = share.owner_name ? `${share.name} (${possessive(share.owner_name)})` : share.name
  const { data, error } = await client
    .from('splits')
    .insert({ user_id: userId, name: name.slice(0, 60), days: cleanDays, is_active: false })
    .select('id')
    .single()
  return { id: error ? null : (data?.id ?? null), dropped }
}

// Throws on a real read failure (network/RLS) so the caller can distinguish
// that from a genuine "no share matches this code" — both used to collapse
// into the same `null`, so a transient offline moment read as "this link is
// dead," actively misinforming the user about a link that's actually fine.
//
// Goes through the get_workout_share_by_code RPC (SECURITY DEFINER), not a
// direct table select — workout_shares' own RLS is owner-only (F10: the
// previous "any signed-in user" policy let anyone enumerate every user's
// shares directly via PostgREST). The share-by-code model is a capability
// URL ("if you have the code, you're meant to see it"), which only the RPC
// can express — a direct .select().eq('code', ...) would now correctly find
// nothing for a share you don't own.
export async function fetchWorkoutShare(client: SupabaseClient, code: string): Promise<WorkoutShare | null> {
  const { data, error } = await client
    .rpc('get_workout_share_by_code', { p_code: code.trim().toLowerCase() })
  if (error) throw error
  const rows = (data ?? []) as WorkoutShare[]
  return rows[0] ?? null
}

/** Import a shared workout into the viewer's library, with attribution. */
export async function importWorkoutShare(
  client: SupabaseClient,
  userId: string,
  share: WorkoutShare,
): Promise<{ id: string | null; dropped: number }> {
  const allIds = share.exercises.map((e) => e.id)
  const readable = await readableExerciseIds(client, allIds)
  const ids = allIds.filter((id) => readable.has(id))
  if (!ids.length) return { id: null, dropped: allIds.length }
  const config = (share.config ?? []).filter((c) => readable.has(c.exercise_id))
  const name = share.owner_name ? `${share.name} (${possessive(share.owner_name)})` : share.name
  const { data, error } = await client
    .from('workout_templates')
    .insert({
      user_id: userId,
      name: name.slice(0, 60),
      exercise_ids: ids,
      config,
      notes: share.owner_name ? `Shared by ${share.owner_name}` : null,
      est_duration_min: share.est_duration_min,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  return { id: error ? null : (data?.id ?? null), dropped: allIds.length - ids.length }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readableExerciseIds(client: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { data } = await client.from('exercises').select('id').in('id', ids)
  return new Set(((data ?? []) as { id: string }[]).map((e) => e.id))
}

const EQUIPMENT_LABELS: Record<string, string> = {
  full_gym: 'Full gym', dumbbells: 'Dumbbells', barbell: 'Barbell', kettlebell: 'Kettlebells',
  resistance_bands: 'Bands', pull_up_bar: 'Pull-up bar', bodyweight: 'Bodyweight',
}

/** "Dumbbells · Pull-up bar" / "Bodyweight only" — preview chip copy. */
export function equipmentSummaryLabel(equipment: string[] | null | undefined): string {
  const eq = (equipment ?? []).filter((e) => e !== 'bodyweight')
  if (!eq.length) return 'Bodyweight only'
  if (eq.includes('full_gym')) return 'Full gym'
  return eq.map((e) => EQUIPMENT_LABELS[e] ?? e).slice(0, 3).join(' · ')
}

/** "Jacob" → "Jacob's", "Chris" → "Chris'". First name only, keeps labels short. */
export function possessive(name: string): string {
  const first = name.trim().split(/\s+/)[0] || name.trim()
  return first.endsWith('s') || first.endsWith('S') ? `${first}'` : `${first}'s`
}
