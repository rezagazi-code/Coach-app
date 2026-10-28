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
 *   v7 supabase-questionnaire-submit.sql — client_uuid on responses +
 *                                   programs; athlete self-submit policies
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

// Empty strings count as UNSET: a host/CI that defines the vars but leaves
// them blank must land in demo mode, not crash createClient('') with
// "supabaseUrl is required" and white-screen the app before the gate.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || undefined;

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

/** v1 questionnaire_responses + v2 coach_id + v7 client_uuid. answers/flags are raw jsonb. */
export interface QuestionnaireResponse {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  track: Track;
  answers: Record<string, unknown>;
  flags: Record<string, unknown>; // bmi, bmi_cat, age_band, injuries[], surgeries[], goal, sleep_hours, days_per_week
  client_uuid: string | null; // v7: submission idempotency key (UNIQUE)
  created_at: string;
}

/** v1 programs + v2 coach_id + v7 client_uuid. */
export interface Program {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  client_uuid: string | null; // v7: derived from the submission's client_uuid (UNIQUE)
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

/**
 * A program exercise as built by buildProgramExercises() in
 * public/questionnaire.html and persisted in
 * questionnaire_responses.answers._program.exercises (single-day shape
 * [{day:1, exercises:[...]}] for now — the questionnaire issues one
 * session repeated days_per_week times).
 */
export interface ProgramExercise {
  id: string; // EX_DB key, or "<key>-alt<i>" for a home-friendly alternative
  nameFA: string;
  nameEN: string;
  setsFA: string;
  setsEN: string;
  noteFA: string;
  noteEN: string;
  video: string; // MuscleWiki demo URL, or "" when none exists
}

/** One training day of a persisted program. */
export interface ProgramExerciseDay {
  day: number;
  exercises: ProgramExercise[];
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
  coach_id?: string | null;
  track: Track;
  answers: Record<string, unknown>;
  flags?: Record<string, unknown>;
  client_uuid?: string | null;
}): Promise<QuestionnaireResponse> {
  const row = {
    athlete_id: input.athlete_id,
    coach_id: input.coach_id ?? null,
    track: input.track,
    answers: input.answers,
    flags: input.flags ?? {},
    client_uuid: input.client_uuid ?? null,
  };
  const client = requireClient();
  // With a client_uuid the write is an upsert on the v7 UNIQUE index, so a
  // resubmit (double-tap, retry, offline re-sync) lands on the SAME row.
  const query = input.client_uuid
    ? client.from('questionnaire_responses').upsert(row, { onConflict: 'client_uuid' })
    : client.from('questionnaire_responses').insert(row);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data as QuestionnaireResponse;
}

/**
 * The questionnaire response behind a specific review card — NOT simply the
 * athlete's newest response: an athlete may submit twice (S1→P1, S2→P2) and
 * the coach may open P1's card after S2 exists. Fetching "latest" would then
 * return S2's answers/flags while the decision applies to P1. The review row
 * is written after its program syncs, so the response for THIS program is
 * the newest one created at or before the review's submitted_at. Falls back
 * to the latest response when no cutoff is known.
 */
export async function questionnaireResponseForReview(
  athleteId: string,
  submittedAt: string | null
): Promise<QuestionnaireResponse | null> {
  const client = requireClient();
  const query = client.from('questionnaire_responses').select('*').eq('athlete_id', athleteId);
  const { data, error } = await (submittedAt ? query.lte('created_at', submittedAt) : query)
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
  // Write order matters: the program row goes FIRST, the review_queue row
  // LAST. Both writes are idempotent, so if the second write fails the card
  // simply re-appears in the pending queue and the coach can re-decide the
  // same way. The reverse order (queue decided first) would strand the
  // program in 'in_review' with the decision invisible and no UI path to
  // recover it — observed class: split-brain between the two tables.
  const patch =
    input.decision === 'approved'
      ? { status: 'approved' as ProgramStatus, approved_at: now }
      : { status: 'draft' as ProgramStatus, approved_at: null };
  const { error: programError } = await client
    .from('programs')
    .update(patch)
    .eq('id', input.program_id);
  if (programError) throw programError;
  const { error } = await client
    .from('review_queue')
    .update({
      decision: input.decision,
      reviewed_at: now,
      coach_feedback: input.coach_feedback ?? '',
    })
    .eq('program_id', input.program_id);
  if (error) throw error;
}

/** The athlete's newest program (any status) — carries the coach note. */
export async function latestProgramFor(athleteId: string): Promise<Program | null> {
  const programs = await listPrograms(athleteId);
  return programs[0] ?? null;
}

/**
 * The athlete's newest program row plus the coach's display name
 * (best-effort: RLS may hide the coaches table from athletes, in which
 * case the name stays null and the UI falls back to a nameless label).
 * Powers the trainee-side program status card in the workout tab.
 */
export async function getAthleteLatestProgram(
  athleteId: string
): Promise<{ program: Program; coachName: string | null } | null> {
  const program = await latestProgramFor(athleteId);
  if (!program) return null;
  let coachName: string | null = null;
  if (program.coach_id) {
    try {
      const { data } = await requireClient()
        .from('coaches')
        .select('display_name')
        .eq('id', program.coach_id)
        .maybeSingle();
      coachName = (data as { display_name?: string } | null)?.display_name ?? null;
    } catch {
      /* coach name is a nicety, not a requirement */
    }
  }
  return { program, coachName };
}

/**
 * The athlete's newest APPROVED/ACTIVE program plus the coach's display
 * name (same shape as getAthleteLatestProgram). Used when the newest
 * program overall is dead (draft/archived — e.g. a resubmission the coach
 * rejected): the older approved program is still the trainee's live
 * program, and hiding it behind a «no program» card would strand the
 * trainee with no session until the next approval.
 */
export async function getAthleteActiveProgram(
  athleteId: string
): Promise<{ program: Program; coachName: string | null } | null> {
  const program = await activeProgramFor(athleteId);
  if (!program) return null;
  let coachName: string | null = null;
  if (program.coach_id) {
    try {
      const { data } = await requireClient()
        .from('coaches')
        .select('display_name')
        .eq('id', program.coach_id)
        .maybeSingle();
      coachName = (data as { display_name?: string } | null)?.display_name ?? null;
    } catch {
      /* coach name is a nicety, not a requirement */
    }
  }
  return { program, coachName };
}

/**
 * The athlete's newest questionnaire response — carries
 * answers._program.exercises (see buildProgramExercises in
 * public/questionnaire.html), which is what the workout tab renders the
 * approved session from.
 */
/**
 * Delete a trainee COMPLETELY. Removes the athletes row; the schema's
 * ON DELETE CASCADE FKs then wipe all of the athlete's app data
 * (questionnaire_responses, programs + items/feedback/review_queue,
 * nutrition_targets/logs, supplement_reviews, workout_sessions + sets,
 * meal/sleep/water logs, checklist, xp_events, messages, quiz attempts,
 * etc.). RLS (pol2_athletes_coach_scoped) restricts this to the coach's
 * own athletes, and supabase-athlete-delete.sql adds the one missing
 * cascade policy (athlete_coaches DELETE).
 *
 * The auth.users login row CANNOT be deleted with the client key — the
 * coach must remove it from the Supabase dashboard (Authentication).
 * Throws on server/RLS errors so the UI can show a proper error toast
 * (never a silent no-op).
 */
export async function deleteAthlete(athleteId: string): Promise<void> {
  const { error } = await requireClient().from('athletes').delete().eq('id', athleteId);
  if (error) throw error;
}
export async function getAthleteLatestResponse(
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
// QUESTIONNAIRE SUBMIT (§18.1) — the end-to-end persist for «ساخت برنامه».
//
// The standalone questionnaire page (public/questionnaire.html) mints a
// submission client_uuid when the questionnaire STARTS and, on submit,
// stores the payload under PENDING_SUBMISSION_KEY (same-origin localStorage)
// + posts it to the parent frame. Per §18.1 step 3 nothing reaches the DB
// before signup; afterwards persistPendingSubmission() flushes it:
//
//   questionnaire_responses  (upsert on client_uuid — v7 UNIQUE)
//   programs                 (AI draft; upsert on a client_uuid derived
//                             deterministically from the submission's, so
//                             retries collapse onto the same program)
//     status by track: gym/vip/padel → 'in_review' (awaits the coach),
//                      aionly → 'active' (no coach review, honest AI label)
//   review_queue             (coach tracks only; ignoreDuplicates on the
//                             program_id PK — a retry never resurrects or
//                             overwrites a decided row)
//
// An aionly submission blocked by the red-flag screening (any safety
// answer = yes) persists ONLY the response: no program is issued, exactly
// as the page's results screen states.
// --------------------------------------------------------------------------

/** localStorage key shared with public/questionnaire.html (same origin). */
export const PENDING_SUBMISSION_KEY = 'km.pendingSubmission.v1';

export interface QuestionnaireSubmission {
  /** Minted at questionnaire start; the idempotency key for the whole submit. */
  clientUuid: string;
  /**
   * Athlete logged in when the payload was stored (null = anonymous —
   * the onboarding funnel, or written by questionnaire.html which cannot
   * stamp). persistPendingSubmission refuses to flush a payload stamped
   * for athlete X under athlete Y (shared-device / logout-login race),
   * so one athlete's answers can never become another's program.
   */
  athleteId?: string | null;
  track: Track;
  answers: Record<string, unknown>;
  /** Coach-card snapshot: bmi, bmi_cat, age_band, injuries[], surgeries[], goal, sleep_hours, days_per_week. */
  flags: Record<string, unknown>;
  program: {
    goal: string;
    split: string;
    days_per_week: number;
    ai_summary: string;
    /** Structured picks from buildProgramExercises() — additive, optional. */
    exercises?: ProgramExerciseDay[];
  };
  /** aionly + any red-flag answer = yes → screening blocked any program. */
  redFlagBlocked: boolean;
  submittedAt: string;
}

/** The program's client_uuid is DERIVED from the submission's: one
 *  submission ⇒ exactly one program, however often the submit re-runs. */
export function programClientUuid(submissionUuid: string): string {
  return deterministicUuid(`${submissionUuid}:program`);
}

export function storePendingSubmission(
  payload: QuestionnaireSubmission,
  athleteId: string | null,
): void {
  try {
    localStorage.setItem(
      PENDING_SUBMISSION_KEY,
      JSON.stringify({ ...payload, athleteId: athleteId ?? null }),
    );
  } catch {
    /* storage unavailable — the in-session postMessage path still delivers */
  }
}

export function readPendingSubmission(): QuestionnaireSubmission | null {
  try {
    const raw = localStorage.getItem(PENDING_SUBMISSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuestionnaireSubmission;
    return parsed && typeof parsed.clientUuid === 'string' && parsed.track ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingSubmission(): void {
  try {
    localStorage.removeItem(PENDING_SUBMISSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Direct (online) submit. Every write is an idempotent upsert, so calling
 * this twice for the same payload is a no-op the second time. Throws on
 * server/RLS errors — callers that can wait use persistPendingSubmission,
 * which falls back to the offline queue.
 */
export async function submitQuestionnaire(input: {
  athlete_id: string;
  coach_id: string;
  payload: QuestionnaireSubmission;
}): Promise<{ response: QuestionnaireResponse; program: Program | null; blocked: boolean }> {
  const { payload } = input;
  const response = await saveQuestionnaireResponse({
    athlete_id: input.athlete_id,
    coach_id: input.coach_id,
    track: payload.track,
    answers: payload.answers,
    flags: payload.flags,
    client_uuid: payload.clientUuid,
  });
  if (payload.redFlagBlocked) {
    // Safety screening said "see a doctor first" — the response documents
    // the screening; NO program and NO queue row are created.
    return { response, program: null, blocked: true };
  }
  const client = requireClient();
  const { data, error } = await client
    .from('programs')
    .upsert(
      {
        athlete_id: input.athlete_id,
        coach_id: input.coach_id,
        client_uuid: programClientUuid(payload.clientUuid),
        status: payload.track === 'aionly' ? 'active' : 'in_review',
        created_by: 'ai',
        track: payload.track,
        goal: payload.program.goal,
        split: payload.program.split,
        days_per_week: payload.program.days_per_week,
        ai_summary: payload.program.ai_summary,
        coach_notes: '',
        approved_at: null,
      },
      { onConflict: 'client_uuid' }
    )
    .select()
    .single();
  if (error) throw error;
  const program = data as Program;
  if (payload.track !== 'aionly') {
    const { error: queueError } = await client
      .from('review_queue')
      .upsert(
        { program_id: program.id, flags_snapshot: payload.flags },
        { onConflict: 'program_id', ignoreDuplicates: true }
      );
    if (queueError) throw queueError;
  }
  return { response, program, blocked: false };
}

/** Queue entries still holding (part of) this submission, if any. */
export function submissionQueueDepth(payload: QuestionnaireSubmission): number {
  const programUuid = programClientUuid(payload.clientUuid);
  return readQueue().filter(
    (e) =>
      e.data.client_uuid === payload.clientUuid ||
      e.data.client_uuid === programUuid ||
      e.data.program_client_uuid === programUuid
  ).length;
}

/**
 * Flush the stored questionnaire submission for a now-identified athlete.
 * Queue-first (the same sync engine as workout logging): the entries are
 * enqueued with their idempotency keys and flushed; only when every
 * expected row is confirmed synced is the stored payload cleared. Safe to
 * call repeatedly — a second call finds no payload, or finds the rows
 * already confirmed synced (synced-key guard) and enqueues nothing, so a
 * re-run is a true no-op and never re-upserts. Returns 'none' | 'stored'
 * (no backend) | 'synced' | 'queued'.
 */
export async function persistPendingSubmission(input: {
  athleteId: string;
  coachId: string;
}): Promise<'none' | 'stored' | 'synced' | 'queued'> {
  const payload = readPendingSubmission();
  if (!payload) return 'none';
  if (!isSupabaseConfigured) return 'stored';
  // Identity guard: a payload stored while athlete X was logged in must
  // never flush under athlete Y (e.g. X submitted offline, logged out, Y
  // logged in on the same device — Y's bootstrap would otherwise claim
  // X's answers as their own program). Drop it rather than contaminate;
  // X can re-submit. Anonymous payloads (onboarding funnel) flush under
  // the first claimant as before.
  const stamped = payload.athleteId ?? null;
  if (stamped && stamped !== input.athleteId) {
    clearPendingSubmission();
    return 'none';
  }
  // Dedup: an earlier call may already have queued this submission — the
  // payload stays stored until the queue drains, and persistPendingSubmission
  // runs on every bootstrap. Re-enqueueing would mint duplicate entries,
  // including a programs entry baked with status 'in_review' that could
  // flush AFTER a coach decision and regress it (status + approved_at
  // overwritten, queue row decided → card gone from the pending list with
  // no recovery path). Entries already queued are simply flushed; rows
  // already confirmed synced are skipped by the synced-key guard inside
  // enqueueSubmission, so a post-flush re-run enqueues nothing.
  if (submissionQueueDepth(payload) === 0) {
    enqueueSubmission(payload, input.athleteId, input.coachId);
  }
  await flushQueue();
  if (submissionQueueDepth(payload) === 0) {
    // An empty queue is NOT proof of sync: flushQueue drops entries after
    // 25 failed attempts (and past the provenance-hold cap). Clearing here
    // on a dropped submission reported 'synced' to the callers, the status
    // card re-read, found no program and no pending payload, and showed
    // «no program» — the athlete's whole questionnaire silently vanished
    // (no response, no program, no queue row) with no recovery path.
    // Only clear when every expected row is confirmed synced; otherwise
    // keep the payload stored and report 'queued', so the next run
    // re-enqueues fresh entries — the synced-key guards skip the rows
    // that did land, so the retry repairs exactly the dropped ones.
    const programUuid = programClientUuid(payload.clientUuid);
    const responseSynced = isSubmissionKeySynced('questionnaire_responses', {
      client_uuid: payload.clientUuid,
    });
    const programSynced =
      payload.redFlagBlocked || isSubmissionKeySynced('programs', { client_uuid: programUuid });
    const reviewSynced =
      payload.redFlagBlocked ||
      payload.track === 'aionly' ||
      isSubmissionKeySynced('review_queue', { program_client_uuid: programUuid });
    if (responseSynced && programSynced && reviewSynced) {
      clearPendingSubmission();
      return 'synced';
    }
    return 'queued';
  }
  return 'queued';
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
//  - questionnaire_responses / programs: upsert on UNIQUE client_uuid (v7);
//    the program's uuid is derived deterministically from the submission's.
//  - review_queue: PK is program_id — upserted with ignoreDuplicates once
//    its program has synced (a retry never touches a decided row).
// Ordering: a logged_set is flushed only after its workout_session has
// left the queue, and a review_queue entry only after its program (FK
// safety). Entries die after 25 failed attempts.
// --------------------------------------------------------------------------

export type QueueTable =
  | 'workout_sessions'
  | 'logged_sets'
  | 'meal_logs'
  | 'checklist_completions'
  | 'xp_events'
  | 'messages'
  | 'questionnaire_responses'
  | 'programs'
  | 'review_queue';

export interface QueueEntry {
  id: string;
  table: QueueTable;
  data: Record<string, unknown>;
  attempts: number;
  queuedAt: string;
  /**
   * Athlete identity known at enqueue time (may be null when logged out).
   * Binds provenance: flush-time stamping must never attribute an entry
   * to an athlete who wasn't the owner when it was created.
   */
  enqueuedBy?: string | null;
  /**
   * First ISO timestamp the provenance hold quarantined this entry.
   * Lets the hold expire (PROVENANCE_HOLD_MAX_MS) when the owner's identity
   * can never return, instead of stranding the entry forever.
   */
  heldSince?: string;
}

const QUEUE_KEY = 'km.offlineQueue.v1';
const QUEUE_MAX_ENTRIES = 500;
const QUEUE_MAX_ATTEMPTS = 25;
/**
 * How long the provenance hold (below) may quarantine an entry whose owner
 * never comes back (e.g. the athlete row was deleted and re-created with a
 * new id — enqueuedBy can then never match again). Past this the entry is
 * dropped so the queue can't strand rows forever.
 */
const PROVENANCE_HOLD_MAX_MS = 7 * 24 * 3600_000;

/**
 * Idempotency keys of submission rows CONFIRMED synced (pushEntry succeeded
 * for them). Guards the phantom re-enqueue: after a submission's entries
 * flush, a later persistPendingSubmission call sees an empty queue and would
 * re-enqueue the same rows; the questionnaire_responses/programs upserts then
 * hit the conflict→UPDATE path, which 403s for athletes (INSERT-only RLS)
 * and burns retries until the 25-attempt drop. Skipping already-synced keys
 * keeps a re-run a true no-op.
 */
const SYNCED_KEYS_KEY = 'km.syncedSubmissionKeys.v1';
const SYNCED_KEYS_MAX = 300;

function readSyncedKeys(): string[] {
  try {
    const raw = localStorage.getItem(SYNCED_KEYS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeSyncedKeys(keys: string[]): void {
  try {
    localStorage.setItem(SYNCED_KEYS_KEY, JSON.stringify(keys.slice(-SYNCED_KEYS_MAX)));
  } catch {
    /* storage unavailable — the guard simply doesn't apply */
  }
}

/** Stable idempotency key for a submission queue entry, or null when n/a. */
function submissionSyncKey(table: QueueTable, data: Record<string, unknown>): string | null {
  if (table === 'questionnaire_responses' || table === 'programs') {
    const uuid = typeof data.client_uuid === 'string' ? data.client_uuid : null;
    return uuid ? `${table}:${uuid}` : null;
  }
  if (table === 'review_queue') {
    const uuid = typeof data.program_client_uuid === 'string' ? data.program_client_uuid : null;
    return uuid ? `review_queue:${uuid}` : null;
  }
  return null;
}

export function isSubmissionKeySynced(table: QueueTable, data: Record<string, unknown>): boolean {
  const key = submissionSyncKey(table, data);
  return key !== null && readSyncedKeys().includes(key);
}

function markSubmissionKeySynced(table: QueueTable, data: Record<string, unknown>): void {
  const key = submissionSyncKey(table, data);
  if (!key) return;
  const keys = readSyncedKeys();
  if (!keys.includes(key)) {
    keys.push(key);
    writeSyncedKeys(keys);
  }
}

/** Tables whose rows cannot exist without an athlete — kept queued until identity exists. */
const ATHLETE_REQUIRED: Partial<Record<QueueTable, boolean>> = {
  workout_sessions: true,
  meal_logs: true,
  checklist_completions: true,
  xp_events: true,
  messages: true,
  questionnaire_responses: true,
  programs: true,
  review_queue: true,
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

export function enqueueWrite(
  table: QueueTable,
  data: Record<string, unknown>,
  enqueuedByOverride?: string | null,
): QueueEntry {
  // Bind provenance to the KNOWN identity, not the ambient session:
  // persistPendingSubmission (athlete signup) runs BEFORE bootstrap, when
  // km.athleteId.v1 may still hold the previous device user's id. Binding
  // the new athlete's submission entries to that stale session would
  // attribute them to the old athlete, and the provenance hold in
  // flushQueue would quarantine them under the new athlete forever —
  // a shared-device submission silently never syncing. Callers that know
  // the identity pass it explicitly; everyone else uses the session.
  const enqueuedBy =
    enqueuedByOverride !== undefined ? enqueuedByOverride : getCurrentAthleteId();
  // Bind provenance at enqueue time, not flush time: a null athlete_id on
  // an entry created while an identity is known belongs to THAT identity.
  // Stamping it at flush with whoever logs in next would let a different
  // athlete on the same device absorb the previous owner's entries.
  const bound: Record<string, unknown> =
    'athlete_id' in data && (data.athlete_id === null || data.athlete_id === undefined)
      ? { ...data, athlete_id: enqueuedBy }
      : data;
  const entry: QueueEntry = {
    id: newClientUuid(),
    table,
    data: bound,
    attempts: 0,
    queuedAt: new Date().toISOString(),
    enqueuedBy,
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

/** XP via the queue — meta.client_uuid makes re-syncs no-ops. A
 * caller-supplied meta.client_uuid wins over the minted one: the flush path
 * skips rows whose meta->>client_uuid is already in the ledger, so a
 * deterministic key (e.g. one per habit/day) makes the award idempotent
 * across re-enqueues and toggle-off/on cycles. */
export function enqueueXpEvent(input: {
  athlete_id: string | null;
  event_type: string;
  xp: number;
  meta?: Record<string, unknown>;
}): void {
  enqueueWrite('xp_events', {
    ...input,
    meta: { client_uuid: newClientUuid(), ...(input.meta ?? {}) },
  });
}

export function enqueueMessage(input: {
  athlete_id: string | null;
  sender_role: SenderRole;
  body: string;
}): void {
  enqueueWrite('messages', { coach_id: null, ...input });
}

/**
 * Queue a full questionnaire submission (response → program → review row)
 * for the offline sync engine. All three entries carry the submission's
 * idempotency keys; the review entry references its program by
 * program_client_uuid and is flushed only after the program has synced
 * (same FK-ordering discipline as logged_sets after their session).
 */
export function enqueueSubmission(
  payload: QuestionnaireSubmission,
  athleteId: string | null,
  coachId: string | null
): void {
  // Pass the KNOWN athlete identity explicitly: this runs at signup before
  // bootstrap, when the ambient session may still be the previous device
  // user's (see enqueueWrite). All three entries belong to athleteId.
  // Sync-key guard: never re-enqueue a row already confirmed synced — a
  // post-flush persistPendingSubmission re-run sees an empty queue and would
  // otherwise mint phantom entries whose upserts 403 on the conflict→UPDATE
  // path (athletes hold INSERT-only RLS on these tables).
  const responseData = {
    athlete_id: athleteId,
    coach_id: coachId,
    track: payload.track,
    answers: payload.answers,
    flags: payload.flags,
    client_uuid: payload.clientUuid,
  };
  if (!isSubmissionKeySynced('questionnaire_responses', responseData)) {
    enqueueWrite('questionnaire_responses', responseData, athleteId);
  }
  if (payload.redFlagBlocked) return; // screening blocked: response only
  const programUuid = programClientUuid(payload.clientUuid);
  const programData = {
    athlete_id: athleteId,
    coach_id: coachId,
    client_uuid: programUuid,
    status: payload.track === 'aionly' ? 'active' : 'in_review',
    created_by: 'ai',
    track: payload.track,
    goal: payload.program.goal,
    split: payload.program.split,
    days_per_week: payload.program.days_per_week,
    ai_summary: payload.program.ai_summary,
    coach_notes: '',
    approved_at: null,
  };
  if (!isSubmissionKeySynced('programs', programData)) {
    enqueueWrite('programs', programData, athleteId);
  }
  if (payload.track !== 'aionly') {
    const reviewData = {
      program_client_uuid: programUuid,
      flags_snapshot: payload.flags,
    };
    if (!isSubmissionKeySynced('review_queue', reviewData)) {
      enqueueWrite('review_queue', reviewData, athleteId);
    }
  }
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
    case 'questionnaire_responses': {
      const { error } = await client
        .from('questionnaire_responses')
        .upsert(d, { onConflict: 'client_uuid' });
      if (error) throw error;
      return;
    }
    case 'programs': {
      const { error } = await client.from('programs').upsert(d, { onConflict: 'client_uuid' });
      if (error) throw error;
      return;
    }
    case 'review_queue': {
      // d.program_client_uuid is an internal queue key, NOT a column: the
      // program_id FK is resolved from the synced program row at push time.
      const programUuid = typeof d.program_client_uuid === 'string' ? d.program_client_uuid : null;
      if (!programUuid) throw new Error('review_queue entry missing program_client_uuid');
      const { data, error } = await client
        .from('programs')
        .select('id')
        .eq('client_uuid', programUuid)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('program not synced yet');
      const { error: insertError } = await client.from('review_queue').upsert(
        { program_id: (data as { id: string }).id, flags_snapshot: d.flags_snapshot ?? {} },
        { onConflict: 'program_id', ignoreDuplicates: true }
      );
      if (insertError) throw insertError;
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
  // Ids present when this run started. Entries enqueued mid-run (e.g. a
  // workout logged while a background flush is in flight) are NOT in the
  // snapshot — but the old code returned early from the concurrent call
  // and nothing re-triggered, so they sat unsynced until the next
  // online/visibilitychange event, which may never come in-session.
  let snapshotIds: Set<string> | null = null;
  try {
    const client = requireClient();
    const snapshot = readQueue();
    snapshotIds = new Set(snapshot.map((e) => e.id));
    // Entries logged before login carry athlete_id=null — stamp the
    // identity known now so they can finally sync. Provenance guard: only
    // entries with unknown provenance (logged out) or bound to the current
    // athlete may be stamped. An entry bound to a DIFFERENT athlete stays
    // queued until they log back in — stamping it here would write one
    // athlete's workouts/meals/XP into another athlete's record.
    const currentAthlete = getCurrentAthleteId();
    if (currentAthlete) {
      for (const e of snapshot) {
        if (!e.data.athlete_id && 'athlete_id' in e.data) {
          if (!e.enqueuedBy || e.enqueuedBy === currentAthlete) {
            e.data = { ...e.data, athlete_id: currentAthlete };
            // Bind provenance at claim time too: without this, an entry
            // stamped here but not flushed in this run (FK wait / offline)
            // keeps enqueuedBy=null, and a later login by someone else
            // would flush it under the wrong session — RLS 403 burn on
            // every attempt until the 25-retry cap silently drops it.
            e.enqueuedBy = currentAthlete;
          }
        }
      }
    }
    const pendingSessionIds = new Set(
      snapshot.filter((e) => e.table === 'workout_sessions').map((e) => String(e.data.id))
    );
    // review_queue entries wait for their program (keyed by client_uuid):
    // the set shrinks as program entries flush, so FIFO order holds.
    const pendingProgramUuids = new Set(
      snapshot.filter((e) => e.table === 'programs').map((e) => String(e.data.client_uuid))
    );
    const keepById = new Map<string, QueueEntry>(); // snapshot entries that stay queued
    const pushedIds = new Set<string>();
    const droppedIds = new Set<string>();
    let flushed = 0;
    for (const entry of snapshot) {
      // Provenance hold (completes the b5282cd intent): an entry bound at
      // enqueue time to an athlete who is NOT the current session's athlete
      // waits for its owner — it never flushes under a different identity
      // (or anonymously after logout). RLS ties each row to the auth.uid
      // of its athlete, so such a flush would 403 every time, burn one of
      // the 25 retries per attempt, and silently drop the other athlete's
      // workouts/meals/XP. 'online'/'visibilitychange' fire flushes often,
      // so without this hold the retries would burn out fast.
      if (entry.enqueuedBy != null && entry.enqueuedBy !== currentAthlete) {
        // Quarantine cap: the hold skips attempts++, so if the owner's
        // identity can never return (e.g. the athlete row was deleted and
        // re-created with a new id) the entry would sit here forever.
        // Drop it after PROVENANCE_HOLD_MAX_MS so the queue can't strand
        // rows unboundedly; normal logout/login cycles release long before.
        const nowMs = Date.now();
        if (!entry.heldSince) {
          entry.heldSince = new Date(nowMs).toISOString();
        } else if (nowMs - Date.parse(entry.heldSince) > PROVENANCE_HOLD_MAX_MS) {
          console.warn('[queue] dropping entry held past quarantine cap', entry.table, entry.id);
          droppedIds.add(entry.id);
          continue;
        }
        keepById.set(entry.id, entry); // owner not logged in — wait
        continue;
      }
      const needsAthlete = ATHLETE_REQUIRED[entry.table] === true;
      // Only entries that CARRY an athlete_id can be blocked by a missing
      // one (review_queue entries reference their program instead).
      const missingAthlete = needsAthlete && 'athlete_id' in entry.data && !entry.data.athlete_id;
      // logged_sets wait for their session: pendingSessionIds shrinks as
      // sessions flush, so FIFO order (session queued before its sets) holds.
      const sessionPending =
        entry.table === 'logged_sets' && pendingSessionIds.has(String(entry.data.session_id));
      const programPending =
        entry.table === 'review_queue' && pendingProgramUuids.has(String(entry.data.program_client_uuid));
      if (missingAthlete) {
        keepById.set(entry.id, entry); // no identity yet — wait for login
        continue;
      }
      if (sessionPending || programPending) {
        keepById.set(entry.id, entry); // parent row not synced yet — FK safety
        continue;
      }
      try {
        await pushEntry(client, entry);
        pushedIds.add(entry.id);
        markSubmissionKeySynced(entry.table, entry.data);
        flushed++;
        if (entry.table === 'workout_sessions') pendingSessionIds.delete(String(entry.data.id));
        if (entry.table === 'programs') pendingProgramUuids.delete(String(entry.data.client_uuid));
      } catch {
        entry.attempts++;
        if (entry.attempts < QUEUE_MAX_ATTEMPTS) {
          keepById.set(entry.id, entry);
        } else {
          // Retry-cap death: the entry MUST leave the queue. The merge
          // below re-reads `latest` from storage — where this entry still
          // sits with its pre-increment attempts — so without recording
          // the drop here, the merge resurrects it at attempts-1 and it
          // retries forever (every online/visibilitychange flush), never
          // reaching the 25-attempt death the queue contract promises.
          // (For questionnaire submissions the stored payload still
          // repairs exactly the dropped rows on the next persist run.)
          console.warn('[queue] dropping entry after max attempts', entry.table, entry.id);
          droppedIds.add(entry.id);
        }
      }
    }
    // Merge against the LATEST queue: entries enqueued while this flush was
    // in flight are not in the snapshot and must survive; snapshot entries
    // that were pushed are gone; kept entries use their attempts-updated copy.
    const latest = readQueue();
    const finalQueue = latest
      .filter((e) => !pushedIds.has(e.id) && !droppedIds.has(e.id))
      .map((e) => keepById.get(e.id) ?? e);
    writeQueue(finalQueue);
    return { flushed, pending: finalQueue.length };
  } finally {
    flushing = false;
    // Drain what arrived mid-run: a chained pass only triggers on entries
    // that were NOT in this run's snapshot, so held entries (provenance
    // hold, missing athlete, FK wait) can never spin it into a loop —
    // each chained pass re-checks the same condition on its own snapshot.
    const started = snapshotIds;
    if (started && readQueue().some((e) => !started.has(e.id))) {
      void flushQueue();
    }
  }
}

// Sync automatically when connectivity returns.
if (typeof window !== 'undefined') {
  // When a background flush drains the queue completely, announce it so
  // status views that depend on synced rows can re-read. The in-session
  // submit path re-dispatches its own event (QuestionnaireTab), but these
  // background paths had nothing: e.g. an aionly questionnaire submitted
  // offline would sync here and the program-status card would stay on
  // «pending» until the next app restart. Only the full-drain transition
  // announces (flushed > 0 && nothing left) — not every no-op flush.
  const flushThenAnnounce = () => {
    flushQueue()
      .then(({ flushed, pending }) => {
        if (flushed > 0 && pending === 0) {
          window.dispatchEvent(new CustomEvent('km-queue-flushed'));
        }
      })
      .catch((err) => console.error('[offline-queue] background flush failed', err));
  };
  window.addEventListener('online', flushThenAnnounce);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushThenAnnounce();
  });
}

// --------------------------------------------------------------------------
// «بشقاب روزانه» (Daily Plate) nutrition helpers (v8).
// nutrition_targets is the v5 table extended by v8 with food_items +
// prescriptions jsonb columns. nutrition_logs is the v8 per-day log.
// All calls run under the caller's own session; RLS does the isolation:
//   - coach: only rows whose coach_id is their own coach row
//   - athlete: only their own athlete_id
// --------------------------------------------------------------------------

/** One food item in the coach's daily food program. */
export interface NutritionFoodItem {
  key: string;
  label_fa: string;
  label_en: string;
  unit: 'g' | 'pcs' | 'cup' | 'ml';
  target: number;
}

/**
 * Doctor-prescribed supplement NAME ONLY. ⛔ Medication boundary: there is
 * no dosage field by design — dosages belong to a doctor/pharmacist.
 */
export interface NutritionPrescription {
  name_fa: string;
  name_en: string;
}

export interface NutritionTargetsRow {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  food_items: NutritionFoodItem[];
  prescriptions: NutritionPrescription[];
  effective_from: string;
}

/** One logged food item in the trainee's daily plate. */
export interface NutritionLogItem {
  key: string;
  amount: number;
  over: boolean;
  /**
   * Sentinel '__rx' entry only: the «نسخه پزشک» names (fa|en keys) the
   * trainee marked as taken that day. Lives inside the existing jsonb
   * `items` column — no schema change. Readers ignore it for over-eating
   * (over is always false) since it has no food key.
   */
  rxTaken?: string[];
  /**
   * '__bank' entries only: bank-food taps from «بانک غذاها». Lives inside
   * the existing jsonb `items` column — no schema change. Readers ignore
   * these for over-eating (over is always false) since they carry no plate
   * item key. All macro values are APPROXIMATE (per-unit bank values ×
   * tap count), never personalized medical guidance.
   */
  bankId?: string;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/** Sentinel key used for the prescription-adherence entry in `items`. */
export const NUTRITION_RX_SENTINEL = '__rx';

/** Sentinel key used for food-bank taps in `items`. */
export const NUTRITION_BANK_SENTINEL = '__bank';

export interface NutritionLog {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  log_date: string; // date
  items: NutritionLogItem[];
  score: number;
  created_at: string;
}

/** Today in the device's local timezone (YYYY-MM-DD). */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const safeItems = (v: unknown): NutritionFoodItem[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is NutritionFoodItem =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { key?: unknown }).key === 'string' &&
          typeof (x as { target?: unknown }).target === 'number'
      )
    : [];

const safeRx = (v: unknown): NutritionPrescription[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is NutritionPrescription =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { name_fa?: unknown }).name_fa === 'string' &&
          (x as { name_fa: string }).name_fa.trim() !== ''
      )
    : [];

const safeLogItems = (v: unknown): NutritionLogItem[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is NutritionLogItem =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { key?: unknown }).key === 'string' &&
          typeof (x as { amount?: unknown }).amount === 'number'
      )
    : [];

/**
 * The athlete's CURRENT food program: newest nutrition_targets row
 * (effective_from ordering). Returns null when the coach set none.
 */
export async function latestNutritionTargetsFor(
  athleteId: string
): Promise<NutritionTargetsRow | null> {
  const { data, error } = await requireClient()
    .from('nutrition_targets')
    .select('id, athlete_id, coach_id, food_items, prescriptions, effective_from')
    .eq('athlete_id', athleteId)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as NutritionTargetsRow;
  return { ...row, food_items: safeItems(row.food_items), prescriptions: safeRx(row.prescriptions) };
}

/**
 * Coach sets/replaces the athlete's daily food program. Upserts onto
 * today's row (unique (athlete_id, effective_from)) so a coach editing
 * twice in one day rewrites the same row; older days stay as history.
 * The v5 macro columns are NOT NULL — they carry neutral defaults when
 * the plate UI is the source of truth (food_items is what renders).
 */
export async function upsertNutritionTargets(input: {
  athlete_id: string;
  coach_id: string | null;
  food_items: NutritionFoodItem[];
  prescriptions: NutritionPrescription[];
}): Promise<void> {
  const { error } = await requireClient()
    .from('nutrition_targets')
    .upsert(
      {
        athlete_id: input.athlete_id,
        coach_id: input.coach_id,
        food_items: input.food_items,
        prescriptions: input.prescriptions,
        effective_from: localDateStr(),
        // v5 macro columns: neutral defaults; the plate items are the
        // coach's real program. water_ml/kcal must satisfy > 0 checks.
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        water_ml: 3000,
        kcal: 1,
      },
      { onConflict: 'athlete_id,effective_from' }
    );
  if (error) throw error;
}

/**
 * The athlete's most recent plate log within the last `daysBack` days
 * (default 7). Used by the coach panel for the over-eating flag.
 */
export async function latestNutritionLogFor(
  athleteId: string,
  daysBack = 7
): Promise<NutritionLog | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const { data, error } = await requireClient()
    .from('nutrition_logs')
    .select('id, athlete_id, coach_id, log_date, items, score, created_at')
    .eq('athlete_id', athleteId)
    .gte('log_date', localDateStr(cutoff))
    .order('log_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as NutritionLog;
  return { ...row, items: safeLogItems(row.items) };
}

/**
 * Trainee saves today's plate. Upserts on (athlete_id, log_date) so
 * re-saving the same day rewrites it instead of duplicating.
 */
export async function upsertNutritionLog(input: {
  athlete_id: string;
  coach_id: string | null;
  log_date: string;
  items: NutritionLogItem[];
  score: number;
  /** «نسخه پزشک» names (fa|en keys) the trainee marked as taken. Stored as the '__rx' sentinel entry in `items`. */
  rx_taken?: string[];
}): Promise<NutritionLog> {
  const rxTaken = (input.rx_taken ?? []).filter((s) => typeof s === 'string' && s.length > 0);
  const payload: NutritionLogItem[] = rxTaken.length
    ? [...input.items, { key: NUTRITION_RX_SENTINEL, amount: rxTaken.length, over: false, rxTaken }]
    : input.items;
  const { data, error } = await requireClient()
    .from('nutrition_logs')
    .upsert(
      {
        athlete_id: input.athlete_id,
        coach_id: input.coach_id,
        log_date: input.log_date,
        items: payload,
        score: Math.max(0, Math.min(100, Math.round(input.score))),
      },
      { onConflict: 'athlete_id,log_date' }
    )
    .select('id, athlete_id, coach_id, log_date, items, score, created_at')
    .single();
  if (error) throw error;
  const row = data as NutritionLog;
  return { ...row, items: safeLogItems(row.items) };
}

// ---------------------------------------------------------------------------
// Supplement reviews — the doctor-gated supplement pipeline (Reza 2026-10-24).
// AI draft (supplementDraft.ts) → coach review/approve → DOCTOR gate for any
// dose-level decision. Same philosophy as the program review queue.
//
// RED LINES: the draft never says what a trainee NEEDS (candidates for
// professional review only), no dosage fields exist anywhere, and the
// trainee never sees the unapproved draft — only the approved doctor
// handoff report. Server persistence lives in `supplement_reviews`
// (migration supabase-supplement-reviews.sql); demo/offline mode uses
// localStorage via readLocalSuppReviews/writeLocalSuppReviews.
// ---------------------------------------------------------------------------

export type SupplementReviewStatus = 'pending' | 'approved' | 'rejected';

export interface SupplementReview {
  id: string;
  athlete_id: string;
  coach_id: string | null;
  response_id: string | null;
  status: SupplementReviewStatus;
  /** Snapshot of the AI draft as the coach saw it (jsonb). */
  draft_snapshot: Record<string, unknown>;
  coach_note: string;
  decided_at: string | null;
  created_at: string;
}

const SUPP_REVIEW_LOCAL = 'km.suppreview.v1';

export function readLocalSuppReviews(): Record<string, SupplementReview> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SUPP_REVIEW_LOCAL) ?? '{}') as Record<
      string,
      SupplementReview
    >;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLocalSuppReviews(reviews: Record<string, SupplementReview>): void {
  try {
    localStorage.setItem(SUPP_REVIEW_LOCAL, JSON.stringify(reviews));
  } catch {
    /* ignore */
  }
}

/** Newest supplement review for the athlete (one row per athlete). */
export async function getSupplementReview(athleteId: string): Promise<SupplementReview | null> {
  const { data, error } = await requireClient()
    .from('supplement_reviews')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SupplementReview | null) ?? null;
}

/**
 * Coach decision on the supplement draft. Upsert keyed on athlete_id — one
 * review row per athlete, always reflecting the latest questionnaire
 * response (response_id). No dosage fields exist on this table by design.
 */
export async function saveSupplementReview(input: {
  athlete_id: string;
  coach_id: string | null;
  response_id: string | null;
  status: SupplementReviewStatus;
  draft_snapshot: Record<string, unknown>;
  coach_note: string;
}): Promise<SupplementReview> {
  const { data, error } = await requireClient()
    .from('supplement_reviews')
    .upsert(
      {
        athlete_id: input.athlete_id,
        coach_id: input.coach_id,
        response_id: input.response_id,
        status: input.status,
        draft_snapshot: input.draft_snapshot,
        coach_note: input.coach_note.slice(0, 2000),
        decided_at: new Date().toISOString(),
      },
      { onConflict: 'athlete_id' }
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as SupplementReview;
}
