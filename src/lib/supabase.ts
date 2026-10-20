/**
 * Supabase client + typed data layer for مربی من.
 *
 * ENV ONLY — keys come from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY,
 * never hardcoded. Until Reza creates the Supabase project, reads throw
 * a clear SupabaseNotConfiguredError and writes are buffered in the local
 * offline queue, so the app keeps working and nothing is lost.
 *
 * Column types below match the migration files EXACTLY:
 *   v1 supabase-schema.sql        — athletes, questionnaire_responses,
 *                                   programs, xp_events, review_queue (§8)
 *   v2 supabase-multi-coach.sql   — adds coach_id (uuid) to those tables
 *   v4 supabase-xp-scoring.sql    — meal_logs
 *   v5 supabase-training-log.sql  — workout_sessions, logged_sets,
 *                                   checklist_completions, messages
 *
 * Architecture: per-coach data isolation (coach_id tenant, per-coach RLS).
 * Phase 1 = single-coach (Reza). coach_id columns are uuid — never store
 * the demo slug below in them.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';

/** Demo coach identity for UI/mock data ONLY (NOT a uuid — never a DB value). */
export const DEMO_COACH_ID = 'coach-reza-gazi';

/**
 * Slug of the coach a new athlete joins at signup (§18.1 step 6).
 * The /c/{slug} route does not exist in the app yet, and Phase 1 is
 * single-coach (Reza, seeded with slug 'reza' per v6 §7) — so signup
 * resolves this slug through the public coach read instead of a URL param.
 * When routing lands, the slug comes from the route and this is only a
 * fallback.
 */
export const DEFAULT_COACH_SLUG = 'reza';

// --------------------------------------------------------------------------
// Environment — fail loud in dev, never silently ship a wrong endpoint.
// --------------------------------------------------------------------------

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // warn, not error: unconfigured is the app's supported demo mode, and an
  // error-level log on every boot pollutes the console for every flow.
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Create a .env file (see .env.example) — keys are NEVER hardcoded. ' +
      'The app runs in offline mode: session logs stay in the local queue.'
  );
}

// Native-safe auth storage (PadelPro lesson: Supabase's default WebView
// localStorage lost the session on EVERY APK update and users had to log
// in from scratch; Capacitor Preferences is platform storage that
// survives updates. On web Preferences falls back to localStorage, so
// browser behavior is unchanged.)
const authStorage = {
  getItem: async (key: string): Promise<string | null> =>
    (await Preferences.get({ key })).value ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    await Preferences.set({ key, value });
  },
  removeItem: async (key: string): Promise<void> => {
    await Preferences.remove({ key });
  },
};

export const supabase: SupabaseClient = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
  {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env ' +
        '(keys are never hardcoded). Writes are buffered in the offline queue until then.'
    );
    this.name = 'SupabaseNotConfiguredError';
  }
}

function requireClient(): SupabaseClient {
  if (!isSupabaseConfigured) throw new SupabaseNotConfiguredError();
  return supabase;
}

// --------------------------------------------------------------------------
// Row types — 1:1 with the v1–v6 SQL migrations.
// --------------------------------------------------------------------------

export type Track = 'gym' | 'vip' | 'padel' | 'aionly';
export type ProgramStatus = 'draft' | 'in_review' | 'approved' | 'active' | 'archived';
export type SessionDifficulty = 'too_easy' | 'just_right' | 'too_hard';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type SenderRole = 'coach' | 'athlete';

/** v1 athletes + v2 coach_id. */
export interface Athlete {
  id: string;
  user_id: string | null;
  full_name: string;
  birth_date: string | null; // date
  gender: 'male' | 'female' | null;
  phone: string | null;
  coach_id: string | null;
  created_at: string;
}

/** v1 questionnaire_responses + v2 coach_id. answers/flags are raw jsonb. */
export interface QuestionnaireResponse {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  track: Track;
  answers: Record<string, unknown>;
  flags: Record<string, unknown>; // bmi, bmi_cat, age_band, injuries[], surgeries[], goal, sleep_hours, days_per_week
  created_at: string;
}

/** v1 programs + v2 coach_id. */
export interface Program {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  status: ProgramStatus;
  created_by: 'ai' | 'coach';
  track: Track;
  goal: string; // fat_loss | muscle | padel_perf | health | strength
  split: string; // fullbody_ab | upper_lower | push_pull_legs …
  days_per_week: number;
  ai_summary: string;
  coach_notes: string;
  approved_at: string | null;
  created_at: string;
}

/** v1 xp_events. XP is additive-only (DB trigger rejects negatives). */
export interface XpEvent {
  id: string;
  athlete_id: string;
  event_type: string; // gym_session | padel_match | … (v4 source enum lives in meta)
  xp: number;
  meta: Record<string, unknown>; // may carry meta.client_uuid for offline idempotency
  created_at: string;
}

/** v5 workout_sessions. client_uuid is UNIQUE — the offline idempotency key. */
export interface WorkoutSession {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  program_id: string | null;
  date: string; // date
  started_at: string;
  completed_at: string | null;
  duration_min: number | null;
  difficulty: SessionDifficulty | null;
  avg_rpe: number | null; // 7–10
  notes: string;
  client_uuid: string;
  synced_at: string;
}

/** v5 logged_sets. client_uuid is UNIQUE — the offline idempotency key. */
export interface LoggedSet {
  id: string;
  session_id: string;
  program_item_id: string | null;
  exercise_id: string | null;
  set_number: number; // 1–50
  weight_kg: number; // 0–500
  reps: number; // 1–200
  rpe: number | null; // 7–10
  is_pr: boolean;
  logged_at: string;
  client_uuid: string;
}

/** v4 meal_logs. UNIQUE (athlete_id, date, meal_type). */
export interface MealLog {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  date: string; // date
  meal_type: MealType;
  description: string;
  photo_url: string | null;
  logged_at: string;
}

/** v5 checklist_completions. UNIQUE (checklist_item_id, date). */
export interface ChecklistCompletion {
  id: string;
  checklist_item_id: string;
  athlete_id: string;
  date: string; // date
  value: number | null;
  completed_at: string;
}

/** v5 messages — coach ↔ athlete text chat (v1: text only, ≤2000 chars). */
export interface ChatMessage {
  id: string;
  coach_id: string | null;
  athlete_id: string;
  sender_role: SenderRole;
  body: string;
  read_at: string | null;
  created_at: string;
}

/**
 * v1 review_queue (§8) — the coach approval inbox. One row per submitted
 * program; decision NULL = still pending. flags_snapshot freezes the
 * athlete's flags at submit time ({bmi, bmi_cat, age_band, injuries[],
 * goal, sleep, days}). Coach-only table: athletes have NO RLS policy.
 */
export interface ReviewQueueItem {
  program_id: string;
  submitted_at: string;
  reviewed_at: string | null;
  decision: 'approved' | 'edited' | 'rejected' | null;
  flags_snapshot: Record<string, unknown>;
  coach_feedback: string;
}

/** A pending review_queue row joined with its program + athlete. */
export interface PendingReview {
  review: ReviewQueueItem;
  program: Program;
  athlete: Athlete | null;
}

/** v1 user_roles. Athletes have NO row here (§18.5: no self-escalation —
 *  the only policy on user_roles is self-SELECT; roles are written solely
 *  by the v6 approval trigger or Reza's admin seed). */
export type UserRole = 'coach' | 'admin';

/** v2 coaches + v6 approval fields (approved_at / approved_by). */
export interface Coach {
  id: string;
  user_id: string | null;
  slug: string;
  display_name: string;
  photo_url: string | null;
  bio: string;
  capabilities: string[]; // sport codes, e.g. ['gym','padel']
  specialties: string[];
  pricing: Record<string, unknown>;
  currency: string;
  plan: string;
  plan_expires_at: string | null;
  is_active: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
}

/** v6 athlete_coaches — athlete ↔ coach memberships. */
export interface AthleteCoach {
  id: string;
  athlete_id: string;
  coach_id: string;
  is_primary: boolean;
  status: 'active' | 'left' | 'removed';
  joined_at: string;
}

// --------------------------------------------------------------------------
// Current-athlete identity (set at login; null in demo mode).
// --------------------------------------------------------------------------

const ATHLETE_KEY = 'km.athleteId.v1';

export function getCurrentAthleteId(): string | null {
  try {
    return localStorage.getItem(ATHLETE_KEY);
  } catch {
    return null;
  }
}

export function setCurrentAthleteId(id: string | null) {
  try {
    if (id) localStorage.setItem(ATHLETE_KEY, id);
    else localStorage.removeItem(ATHLETE_KEY);
  } catch {
    /* storage unavailable — identity stays session-only */
  }
}

// --------------------------------------------------------------------------
// Typed query helpers. All throw SupabaseNotConfiguredError when env is
// missing — callers fall back to demo data / the offline queue.
// --------------------------------------------------------------------------

export async function fetchAthlete(athleteId: string): Promise<Athlete | null> {
  const { data, error } = await requireClient()
    .from('athletes')
    .select('*')
    .eq('id', athleteId)
    .maybeSingle();
  if (error) throw error;
  return (data as Athlete | null) ?? null;
}

export async function listAthletes(): Promise<Athlete[]> {
  const { data, error } = await requireClient()
    .from('athletes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Athlete[];
}

export async function saveQuestionnaireResponse(input: {
  athlete_id: string;
  track: Track;
  answers: Record<string, unknown>;
  flags?: Record<string, unknown>;
}): Promise<QuestionnaireResponse> {
  const { data, error } = await requireClient()
    .from('questionnaire_responses')
    .insert({ ...input, flags: input.flags ?? {} })
    .select()
    .single();
  if (error) throw error;
  return data as QuestionnaireResponse;
}

export async function latestQuestionnaireResponse(
  athleteId: string
): Promise<QuestionnaireResponse | null> {
  const { data, error } = await requireClient()
    .from('questionnaire_responses')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as QuestionnaireResponse | null) ?? null;
}

export async function listPrograms(athleteId: string): Promise<Program[]> {
  const { data, error } = await requireClient()
    .from('programs')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Program[];
}

/** The program the athlete actually trains from (newest approved/active). */
export async function activeProgramFor(athleteId: string): Promise<Program | null> {
  const { data, error } = await requireClient()
    .from('programs')
    .select('*')
    .eq('athlete_id', athleteId)
    .in('status', ['active', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Program | null) ?? null;
}

export async function listXpEvents(athleteId: string, sinceIso?: string): Promise<XpEvent[]> {
  let q = requireClient()
    .from('xp_events')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: true });
  if (sinceIso) q = q.gte('created_at', sinceIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as XpEvent[];
}

/** Direct XP insert (online path). Offline callers: enqueueXpEvent below. */
export async function awardXp(input: {
  athlete_id: string;
  event_type: string;
  xp: number;
  meta?: Record<string, unknown>;
}): Promise<XpEvent> {
  const { data, error } = await requireClient()
    .from('xp_events')
    .insert({ ...input, meta: input.meta ?? {} })
    .select()
    .single();
  if (error) throw error;
  return data as XpEvent;
}

export async function upsertWorkoutSession(
  session: Partial<WorkoutSession> & Pick<WorkoutSession, 'athlete_id' | 'client_uuid'>
): Promise<WorkoutSession> {
  const { data, error } = await requireClient()
    .from('workout_sessions')
    .upsert(session, { onConflict: 'client_uuid' })
    .select()
    .single();
  if (error) throw error;
  return data as WorkoutSession;
}

export async function insertLoggedSets(sets: Array<Partial<LoggedSet>>): Promise<LoggedSet[]> {
  const { data, error } = await requireClient()
    .from('logged_sets')
    .upsert(sets, { onConflict: 'client_uuid' })
    .select();
  if (error) throw error;
  return (data ?? []) as LoggedSet[];
}

export async function listWorkoutSessions(athleteId: string): Promise<WorkoutSession[]> {
  const { data, error } = await requireClient()
    .from('workout_sessions')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkoutSession[];
}

export async function logMeal(input: {
  athlete_id: string;
  date: string;
  meal_type: MealType;
  description?: string;
  photo_url?: string | null;
}): Promise<MealLog> {
  const { data, error } = await requireClient()
    .from('meal_logs')
    .upsert({ description: '', ...input }, { onConflict: 'athlete_id,date,meal_type' })
    .select()
    .single();
  if (error) throw error;
  return data as MealLog;
}

export async function completeChecklistItem(input: {
  checklist_item_id: string;
  athlete_id: string;
  date: string;
  value?: number | null;
}): Promise<ChecklistCompletion> {
  const { data, error } = await requireClient()
    .from('checklist_completions')
    .upsert({ value: null, ...input }, { onConflict: 'checklist_item_id,date' })
    .select()
    .single();
  if (error) throw error;
  return data as ChecklistCompletion;
}

export async function listMessages(athleteId: string): Promise<ChatMessage[]> {
  const { data, error } = await requireClient()
    .from('messages')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export async function sendMessage(input: {
  athlete_id: string;
  sender_role: SenderRole;
  body: string;
  coach_id?: string | null;
}): Promise<ChatMessage> {
  const { data, error } = await requireClient()
    .from('messages')
    .insert({ coach_id: null, ...input })
    .select()
    .single();
  if (error) throw error;
  return data as ChatMessage;
}

// --------------------------------------------------------------------------
// AUTH + ENTRY helpers (§18) — role → bootstrap mapping and the two signup
// profile writes. Reads use the caller's own session, so RLS does the
// isolation; user_roles is self-SELECT only (§18.5).
// --------------------------------------------------------------------------

/** §18.3 step 1: the caller's role, or null for athletes (no row needed). */
export async function fetchMyRole(userId: string): Promise<UserRole | null> {
  const { data, error } = await requireClient()
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.role as UserRole | undefined) ?? null;
}

/** §18.3 step 3: the caller's own coach profile (any active state). */
export async function fetchCoachByUserId(userId: string): Promise<Coach | null> {
  const { data, error } = await requireClient()
    .from('coaches')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Coach | null) ?? null;
}

/** §18.1 step 1: public profile of an ACTIVE coach (powers /c/{slug}). */
export async function fetchActiveCoachBySlug(slug: string): Promise<Coach | null> {
  const { data, error } = await requireClient()
    .from('coaches')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return (data as Coach | null) ?? null;
}

/** §18.3 step 4: the caller's own athlete profile. */
export async function fetchAthleteByUserId(userId: string): Promise<Athlete | null> {
  const { data, error } = await requireClient()
    .from('athletes')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Athlete | null) ?? null;
}

/**
 * §18.2 step 1: coach signup profile write. is_active is forced false —
 * the v6 approval gate: the 'coach' role is granted by the DB trigger only
 * when Reza flips is_active to true, never at signup.
 */
export async function createCoachProfile(input: {
  user_id: string;
  slug: string;
  display_name: string;
}): Promise<Coach> {
  const { data, error } = await requireClient()
    .from('coaches')
    .insert({ ...input, is_active: false })
    .select()
    .single();
  if (error) throw error;
  return data as Coach;
}

/**
 * §18.1 step 6: athlete signup profile write. The v6 self-insert policy
 * requires coach_id to be an ACTIVE coach — resolve the slug first.
 */
export async function createAthleteProfile(input: {
  user_id: string;
  full_name: string;
  phone: string;
  coach_id: string;
}): Promise<Athlete> {
  const { data, error } = await requireClient()
    .from('athletes')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as Athlete;
}

/** §18.1 step 6: membership row (first join = primary coach). */
export async function joinCoach(input: {
  athlete_id: string;
  coach_id: string;
  is_primary: boolean;
}): Promise<AthleteCoach> {
  const { data, error } = await requireClient()
    .from('athlete_coaches')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as AthleteCoach;
}

// --------------------------------------------------------------------------
// COACH CONSOLE helpers — the review queue + per-athlete coach notes.
// Every read runs under the signed-in coach's session, so per-coach RLS
// (v2: review_queue is scoped through programs.coach_id) does the tenant
// isolation; nothing here takes a coach_id from the caller.
// --------------------------------------------------------------------------

/**
 * Pending submissions for the review queue (صف بازبینی), oldest first so
 * the coach works FIFO. Each row embeds its program and the program's
 * athlete; the card data (track, BMI, injury flags) comes from the frozen
 * flags_snapshot — no extra round-trips per card.
 */
export async function listPendingReviews(): Promise<PendingReview[]> {
  const { data, error } = await requireClient()
    .from('review_queue')
    .select('*, program:programs(*, athlete:athletes(*))')
    .is('decision', null)
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const out: PendingReview[] = [];
  for (const row of rows) {
    const r = row as unknown as ReviewQueueItem & {
      program: (Program & { athlete?: Athlete | null }) | null;
    };
    if (!r.program) continue; // orphaned queue row — nothing reviewable
    const { athlete, ...program } = r.program;
    out.push({
      review: {
        program_id: r.program_id,
        submitted_at: r.submitted_at,
        reviewed_at: r.reviewed_at,
        decision: r.decision,
        flags_snapshot: r.flags_snapshot ?? {},
        coach_feedback: r.coach_feedback ?? '',
      },
      program: program as Program,
      athlete: athlete ?? null,
    });
  }
  return out;
}

/**
 * Record the coach's decision on a queued program. The program lifecycle
 * mirrors it: approved → status 'approved' + approved_at stamp; rejected
 * → back to 'draft' so the draft can be reworked and resubmitted.
 */
export async function decideReview(input: {
  program_id: string;
  decision: 'approved' | 'rejected';
  coach_feedback?: string;
}): Promise<void> {
  const client = requireClient();
  const now = new Date().toISOString();
  const { error } = await client
    .from('review_queue')
    .update({
      decision: input.decision,
      reviewed_at: now,
      coach_feedback: input.coach_feedback ?? '',
    })
    .eq('program_id', input.program_id);
  if (error) throw error;
  const patch =
    input.decision === 'approved'
      ? { status: 'approved' as ProgramStatus, approved_at: now }
      : { status: 'draft' as ProgramStatus, approved_at: null };
  const { error: programError } = await client
    .from('programs')
    .update(patch)
    .eq('id', input.program_id);
  if (programError) throw programError;
}

/** The athlete's newest program (any status) — carries the coach note. */
export async function latestProgramFor(athleteId: string): Promise<Program | null> {
  const programs = await listPrograms(athleteId);
  return programs[0] ?? null;
}

/**
 * Save the coach's note / body-weaknesses assessment on the athlete's
 * program. programs.coach_notes is the field program drafting reads
 * (together with the questionnaire) — see CoachPanel's note UI copy.
 */
export async function updateProgramCoachNotes(programId: string, coachNotes: string): Promise<void> {
  const { error } = await requireClient()
    .from('programs')
    .update({ coach_notes: coachNotes })
    .eq('id', programId);
  if (error) throw error;
}

// --------------------------------------------------------------------------
// OFFLINE QUEUE — localStorage-backed write queue with sync-on-reconnect.
//
// Idempotency (no duplicate submits, ever):
//  - workout_sessions / logged_sets: upsert on UNIQUE client_uuid.
//  - meal_logs: upsert on UNIQUE (athlete_id, date, meal_type).
//  - checklist_completions: upsert on UNIQUE (checklist_item_id, date).
//  - xp_events: meta.client_uuid is pre-checked before insert (the table
//    has no client_uuid column; meta jsonb carries it).
//  - messages: no natural unique key in the schema — inserted once and
//    removed from the queue only after the server confirms.
// Ordering: a logged_set is flushed only after its workout_session has
// left the queue (FK safety). Entries die after 25 failed attempts.
// --------------------------------------------------------------------------

export type QueueTable =
  | 'workout_sessions'
  | 'logged_sets'
  | 'meal_logs'
  | 'checklist_completions'
  | 'xp_events'
  | 'messages';

export interface QueueEntry {
  id: string;
  table: QueueTable;
  data: Record<string, unknown>;
  attempts: number;
  queuedAt: string;
}

const QUEUE_KEY = 'km.offlineQueue.v1';
const QUEUE_MAX_ENTRIES = 500;
const QUEUE_MAX_ATTEMPTS = 25;

/** Tables whose rows cannot exist without an athlete — kept queued until identity exists. */
const ATHLETE_REQUIRED: Partial<Record<QueueTable, boolean>> = {
  workout_sessions: true,
  meal_logs: true,
  checklist_completions: true,
  xp_events: true,
  messages: true,
};

/** Deterministic UUID (v5-shaped) derived from a seed string. For writes
 *  whose identity is naturally unique — a logged set IS (session, set
 *  number) — so if an enqueue ever fires twice for the same logical set,
 *  both writes carry the SAME client_uuid and the upsert collapses them
 *  instead of minting a duplicate row (PadelPro idempotency lesson:
 *  in-memory-only "already processed" markers are not a guard). */
export function deterministicUuid(seed: string): string {
  const bytes = new Array<number>(16).fill(0);
  for (let lane = 0; lane < 4; lane++) {
    let h = (0x811c9dc5 ^ Math.imul(lane + 1, 0x9e3779b9)) >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= (seed.charCodeAt(i) + lane) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
    bytes[lane * 4] = (h >>> 24) & 0xff;
    bytes[lane * 4 + 1] = (h >>> 16) & 0xff;
    bytes[lane * 4 + 2] = (h >>> 8) & 0xff;
    bytes[lane * 4 + 3] = h & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version-5 shape
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newClientUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback (non-secure contexts): RFC-4122 v4 shape from Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readQueue(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueueEntry[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_MAX_ENTRIES)));
  } catch {
    /* storage full/blocked — queue stays in memory this run only */
  }
}

export function queueLength(): number {
  return readQueue().length;
}

export function enqueueWrite(table: QueueTable, data: Record<string, unknown>): QueueEntry {
  const entry: QueueEntry = {
    id: newClientUuid(),
    table,
    data,
    attempts: 0,
    queuedAt: new Date().toISOString(),
  };
  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);
  if (isSupabaseConfigured && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    void flushQueue();
  }
  return entry;
}

/**
 * Queue one fully-logged workout session + all its sets (the app's main
 * offline write path). Returns the client-generated session id — also the
 * session's client_uuid, so re-syncs upsert instead of duplicating.
 */
export function queueSessionLog(input: {
  athlete_id: string | null;
  date: string; // YYYY-MM-DD
  program_id?: string | null;
  sets: Array<{
    exercise_id?: string | null;
    program_item_id?: string | null;
    set_number: number;
    weight_kg: number;
    reps: number;
    rpe?: number | null;
    is_pr?: boolean;
  }>;
  difficulty?: SessionDifficulty | null;
  avg_rpe?: number | null;
  notes?: string;
}): string {
  const sessionId = newClientUuid();
  const now = new Date().toISOString();
  enqueueWrite('workout_sessions', {
    id: sessionId,
    athlete_id: input.athlete_id,
    coach_id: null,
    program_id: input.program_id ?? null,
    date: input.date,
    started_at: now,
    completed_at: input.difficulty ? now : null,
    duration_min: null,
    difficulty: input.difficulty ?? null,
    avg_rpe: input.avg_rpe ?? null,
    notes: input.notes ?? '',
    client_uuid: sessionId,
  });
  for (const s of input.sets) {
    const setUuid = deterministicUuid(`${sessionId}:${s.set_number}`);
    enqueueWrite('logged_sets', {
      id: setUuid,
      session_id: sessionId,
      program_item_id: s.program_item_id ?? null,
      exercise_id: s.exercise_id ?? null,
      set_number: s.set_number,
      weight_kg: s.weight_kg,
      reps: s.reps,
      rpe: s.rpe ?? null,
      is_pr: s.is_pr ?? false,
      logged_at: now,
      client_uuid: setUuid,
    });
  }
  return sessionId;
}

/** Queue a single set into an already-queued/created session. */
export function enqueueLoggedSet(sessionId: string, set: {
  exercise_id?: string | null;
  program_item_id?: string | null;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe?: number | null;
  is_pr?: boolean;
}): string {
  const setUuid = deterministicUuid(`${sessionId}:${set.set_number}`);
  enqueueWrite('logged_sets', {
    id: setUuid,
    session_id: sessionId,
    program_item_id: set.program_item_id ?? null,
    exercise_id: set.exercise_id ?? null,
    set_number: set.set_number,
    weight_kg: set.weight_kg,
    reps: set.reps,
    rpe: set.rpe ?? null,
    is_pr: set.is_pr ?? false,
    logged_at: new Date().toISOString(),
    client_uuid: setUuid,
  });
  return setUuid;
}

export function enqueueMealLog(input: {
  athlete_id: string | null;
  date: string;
  meal_type: MealType;
  description?: string;
}): void {
  enqueueWrite('meal_logs', { description: '', ...input });
}

export function enqueueChecklistCompletion(input: {
  checklist_item_id: string;
  athlete_id: string | null;
  date: string;
  value?: number | null;
}): void {
  enqueueWrite('checklist_completions', { value: null, ...input });
}

/** XP via the queue — meta.client_uuid makes re-syncs no-ops. */
export function enqueueXpEvent(input: {
  athlete_id: string | null;
  event_type: string;
  xp: number;
  meta?: Record<string, unknown>;
}): void {
  enqueueWrite('xp_events', {
    ...input,
    meta: { ...(input.meta ?? {}), client_uuid: newClientUuid() },
  });
}

export function enqueueMessage(input: {
  athlete_id: string | null;
  sender_role: SenderRole;
  body: string;
}): void {
  enqueueWrite('messages', { coach_id: null, ...input });
}

async function pushEntry(client: SupabaseClient, entry: QueueEntry): Promise<void> {
  const d = entry.data;
  switch (entry.table) {
    case 'workout_sessions': {
      const { error } = await client.from('workout_sessions').upsert(d, { onConflict: 'client_uuid' });
      if (error) throw error;
      return;
    }
    case 'logged_sets': {
      const { error } = await client.from('logged_sets').upsert(d, { onConflict: 'client_uuid' });
      if (error) throw error;
      return;
    }
    case 'meal_logs': {
      const { error } = await client
        .from('meal_logs')
        .upsert(d, { onConflict: 'athlete_id,date,meal_type' });
      if (error) throw error;
      return;
    }
    case 'checklist_completions': {
      const { error } = await client
        .from('checklist_completions')
        .upsert(d, { onConflict: 'checklist_item_id,date' });
      if (error) throw error;
      return;
    }
    case 'xp_events': {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const uuid = typeof meta.client_uuid === 'string' ? meta.client_uuid : null;
      if (uuid) {
        const { data, error } = await client
          .from('xp_events')
          .select('id')
          .eq('athlete_id', d.athlete_id as string)
          .filter('meta->>client_uuid', 'eq', uuid)
          .limit(1);
        if (error) throw error;
        if (data && data.length > 0) return; // already synced — idempotent skip
      }
      const { error } = await client.from('xp_events').insert(d);
      if (error) throw error;
      return;
    }
    case 'messages': {
      const { error } = await client.from('messages').insert(d);
      if (error) throw error;
      return;
    }
  }
}

let flushing = false;

/**
 * Push every queued write, in order. Safe to call any time: no-op when
 * unconfigured or offline. Entries that still can't go (missing athlete,
 * session not yet synced, server error) stay queued for the next flush.
 */
export async function flushQueue(): Promise<{ flushed: number; pending: number }> {
  if (flushing || !isSupabaseConfigured) return { flushed: 0, pending: queueLength() };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { flushed: 0, pending: queueLength() };
  }
  flushing = true;
  try {
    const client = requireClient();
    const snapshot = readQueue();
    // Entries logged before login carry athlete_id=null — stamp the
    // identity known now so they can finally sync.
    const currentAthlete = getCurrentAthleteId();
    if (currentAthlete) {
      for (const e of snapshot) {
        if (!e.data.athlete_id && 'athlete_id' in e.data) {
          e.data = { ...e.data, athlete_id: currentAthlete };
        }
      }
    }
    const pendingSessionIds = new Set(
      snapshot.filter((e) => e.table === 'workout_sessions').map((e) => String(e.data.id))
    );
    const keepById = new Map<string, QueueEntry>(); // snapshot entries that stay queued
    const pushedIds = new Set<string>();
    let flushed = 0;
    for (const entry of snapshot) {
      const needsAthlete = ATHLETE_REQUIRED[entry.table] === true;
      // logged_sets wait for their session: pendingSessionIds shrinks as
      // sessions flush, so FIFO order (session queued before its sets) holds.
      const sessionPending =
        entry.table === 'logged_sets' && pendingSessionIds.has(String(entry.data.session_id));
      if (!entry.data.athlete_id && needsAthlete) {
        keepById.set(entry.id, entry); // no identity yet — wait for login
        continue;
      }
      if (sessionPending) {
        keepById.set(entry.id, entry); // session not synced yet — FK safety
        continue;
      }
      try {
        await pushEntry(client, entry);
        pushedIds.add(entry.id);
        flushed++;
        if (entry.table === 'workout_sessions') pendingSessionIds.delete(String(entry.data.id));
      } catch {
        entry.attempts++;
        if (entry.attempts < QUEUE_MAX_ATTEMPTS) keepById.set(entry.id, entry);
      }
    }
    // Merge against the LATEST queue: entries enqueued while this flush was
    // in flight are not in the snapshot and must survive; snapshot entries
    // that were pushed are gone; kept entries use their attempts-updated copy.
    const latest = readQueue();
    const finalQueue = latest
      .filter((e) => !pushedIds.has(e.id))
      .map((e) => keepById.get(e.id) ?? e);
    writeQueue(finalQueue);
    return { flushed, pending: finalQueue.length };
  } finally {
    flushing = false;
  }
}

// Sync automatically when connectivity returns.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void flushQueue();
  });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushQueue();
  });
}
