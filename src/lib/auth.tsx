/**
 * مربی من — Auth + Entry state (§18).
 *
 * Supabase Auth (GoTrue), password-based v1 (§18.4): athletes sign in with
 * phone+password, coaches with email+password. No SMS OTP (Iranian delivery
 * is unreliable — §18.5), email confirmation stays OFF.
 *
 * PHONE-AS-EMAIL (adopted 2026-10-21): GoTrue's phone provider was never
 * usable here — enabling it on morabi-man demands a paid SMS provider
 * (Twilio) and v1 has no SMS by design. Athlete accounts therefore live in
 * GoTrue as EMAIL identities whose address is deterministically derived
 * from the phone number (see athleteEmail below); the real E.164 number
 * is kept in user metadata and in athletes.phone. The UX is unchanged:
 * athletes still type phone + password. Coach auth is untouched (real
 * email+password).
 *
 * After any sign-in the BOOTSTRAP (§18.3) maps the session to a role:
 *   user_roles row → 'admin' | 'coach' | null (athlete, no row needed)
 *   coach → coaches row; is_active=false ⇒ PENDING screen only (the v6
 *           approval gate — my_coach_id() is NULL, so no data is reachable)
 *   athlete → athletes row; its id feeds the offline queue identity.
 *
 * When the Supabase env keys are missing there is no backend at all: the
 * gate shows the clear dev error (SupabaseNotConfiguredError) and offers a
 * DEMO entry so the Phase-1 offline app keeps working. Once env is filled,
 * the gate is strict — no bypass.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthError, Session } from '@supabase/supabase-js';
import {
  DEFAULT_COACH_SLUG,
  SupabaseNotConfiguredError,
  createAthleteProfile,
  createCoachProfile,
  fetchActiveCoachBySlug,
  fetchAthleteByUserId,
  fetchCoachByUserId,
  fetchMyRole,
  flushQueue,
  isSupabaseConfigured,
  joinCoach,
  persistPendingSubmission,
  setCurrentAthleteId,
  supabase,
  type Athlete,
  type Coach,
  type UserRole,
} from './supabase';

export type AuthStatus =
  | 'loading' // first session check in flight
  | 'signedOut' // configured, no session → the gate
  | 'pending' // coach account exists but is_active=false → approval gate
  | 'completeCoachProfile' // email user, no profile rows at all → finish coach signup
  | 'signedIn'; // session + bootstrap resolved → the 5 tabs

export type AuthErrorCode =
  | 'wrong' // bad credentials
  | 'taken' // phone/email already registered
  | 'takenSlug' // coach link slug already taken by another coach
  | 'checkEmail' // signup ok but no session yet (email confirmation unexpectedly ON)
  | 'checkPhone' // athlete signup ok but no session (confirmation ON for the synthetic-email account; no way for the athlete to complete it in v1)
  | 'busy' // still 429 after backoff
  | 'generic';

/** Coach signup data captured when "Confirm email" is unexpectedly ON:
 *  the profile row cannot be written until a session exists, so the
 *  intent is parked locally and completed at first login (bootstrap). */
const PENDING_COACH_KEY = 'km.pendingCoachProfile.v1';

interface PendingCoachProfile {
  userId: string;
  name: string;
  slug: string;
}

/**
 * Coach profile insert error → honest AuthErrorCode.
 * 2026-10-21 lesson (live bug on رضا's phone): the completion insert can
 * fail with 23505 on coaches_user_id_key when a pre-migration attempt
 * already wrote the row (the row IS written even though the original
 * request errored — RETURNING saw no rows). That is NOT a failure: the
 * row exists and bootstrap can proceed. 23505 on coaches_slug_key means
 * another coach owns the link → inline 'takenSlug'.
 */
function mapCoachProfileInsertError(err: unknown): AuthErrorCode {
  const msg = (err as { code?: string; message?: string }) ?? {};
  if (msg.code === '23505') {
    if (msg.message && msg.message.includes('coaches_slug_key')) return 'takenSlug';
    // user_id unique violation (or unknown 23505): likely an orphan row from
    // a previous attempt — let the caller verify and recover.
    return 'generic';
  }
  return 'generic';
}

/** Post-insert recovery: if the caller's coach row already exists (e.g. a
 *  pre-fix attempt wrote it), return it so bootstrap can proceed instead
 *  of failing with a generic error. */
async function recoverExistingCoachProfile(userId: string) {
  try {
    return await fetchCoachByUserId(userId);
  } catch {
    return null;
  }
}

function storePendingCoachProfile(p: PendingCoachProfile): void {
  try {
    localStorage.setItem(PENDING_COACH_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — the completion form at login is the fallback */
  }
}

function readPendingCoachProfile(userId: string): PendingCoachProfile | null {
  try {
    const raw = localStorage.getItem(PENDING_COACH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCoachProfile;
    return parsed && parsed.userId === userId && parsed.slug ? parsed : null;
  } catch {
    return null;
  }
}

function clearPendingCoachProfile(): void {
  try {
    localStorage.removeItem(PENDING_COACH_KEY);
  } catch {
    /* ignore */
  }
}

export interface AuthResult {
  ok: boolean;
  code?: AuthErrorCode;
}

interface AuthCtx {
  status: AuthStatus;
  /** True when the app runs without a backend (env missing) in demo mode. */
  unconfigured: boolean;
  demo: boolean;
  session: Session | null;
  role: UserRole | null;
  coach: Coach | null;
  athlete: Athlete | null;
  signInCoach: (email: string, password: string) => Promise<AuthResult>;
  signUpCoach: (input: { name: string; email: string; password: string; slug: string }) => Promise<AuthResult>;
  signInAthlete: (phone: string, password: string) => Promise<AuthResult>;
  signUpAthlete: (input: { name: string; phone: string; password: string }) => Promise<AuthResult>;
  /** Finish a coach signup whose profile write was deferred by email
   *  confirmation (bootstrap status 'completeCoachProfile'). */
  completeCoachProfile: (input: { name: string; slug: string }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** Re-run the §18.3 bootstrap (pending screen "check again"). */
  refresh: () => Promise<void>;
  /** Demo entry — only meaningful while unconfigured. */
  enterDemo: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

/**
 * Iranian mobile → E.164 (+98…), the canonical form of the number.
 * 09xxxxxxxxx / 9xxxxxxxxx → +98…; an already-international number passes
 * through. Applied identically at signup and login so they always match.
 * This E.164 string is what athletes.phone stores and what athleteEmail
 * derives the auth identity from.
 */
export function normalizePhone(raw: string): string {
  // Persian (۰-۹) and Arabic-Indic (٠-٩) digits → Latin, so a number typed
  // with a FA keyboard matches the E.164 form GoTrue expects.
  const latin = raw
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const p = latin.replace(/[\s-]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('0098')) return `+${p.slice(2)}`;
  if (p.startsWith('09') && p.length === 11) return `+98${p.slice(1)}`;
  if (p.startsWith('9') && p.length === 10) return `+98${p}`;
  if (p.startsWith('98') && p.length === 12) return `+${p}`;
  return p;
}

/** Domain for synthetic athlete auth identities (phone-as-email,
 *  2026-10-21). Addresses here are never mailed; they only name the
 *  GoTrue user. The domain MUST resolve in DNS: GoTrue validates the
 *  email host at signup — the first choice, athlete.morabi-man.app, was
 *  rejected live with `email_address_invalid` because morabi-man.app is
 *  NXDOMAIN. The project's own Supabase hostname resolves, is scoped to
 *  this project, and receives no mail. WARNING: this value is baked into
 *  every athlete's auth identity — changing it later means migrating
 *  existing users' emails in auth.users, not just editing this line. */
export const ATHLETE_EMAIL_DOMAIN = 'mxvrpycitowqkduzvhdy.supabase.co';

/**
 * The athlete's GoTrue identity: a deterministic synthetic email derived
 * from the normalized E.164 number — `p<digits>@<ATHLETE_EMAIL_DOMAIN>`
 * (digits only, no '+'). Same number in ⇒ same address out, at signup,
 * login, and everywhere else, so the mapping needs no storage.
 */
export function athleteEmail(rawPhone: string): string {
  const digits = normalizePhone(rawPhone).replace(/\D/g, '');
  return `p${digits}@${ATHLETE_EMAIL_DOMAIN}`;
}

/** True when a GoTrue user is an athlete identity (synthetic email, or a
 *  legacy phone identity should one ever exist). */
export function isAthleteIdentity(user: { email?: string | null; phone?: string | null }): boolean {
  if (user.phone) return true;
  return typeof user.email === 'string' && user.email.endsWith(`@${ATHLETE_EMAIL_DOMAIN}`);
}

/** §18.5: exponential backoff when GoTrue rate-limits (429). */
async function callAuth<T extends { error: AuthError | null }>(fn: () => Promise<T>): Promise<T> {
  const delays = [600, 1200, 2400];
  let res = await fn();
  for (const d of delays) {
    if (!res.error || res.error.status !== 429) break;
    await new Promise((r) => setTimeout(r, d));
    res = await fn();
  }
  return res;
}

function mapAuthError(error: AuthError): AuthErrorCode {
  if (error.status === 429) return 'busy';
  const msg = error.message.toLowerCase();
  if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
    return 'taken';
  }
  if (msg.includes('invalid login credentials')) return 'wrong';
  return 'generic';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [demo, setDemo] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const runRef = useRef(0);

  /** §18.3 bootstrap: session → role → coach/athlete profile → status. */
  const bootstrap = useCallback(async (next: Session | null) => {
    const run = ++runRef.current;
    if (!next) {
      setSession(null);
      setRole(null);
      setCoach(null);
      setAthlete(null);
      setCurrentAthleteId(null);
      if (run === runRef.current) setStatus(isSupabaseConfigured ? 'signedOut' : 'loading');
      return;
    }
    setSession(next);
    try {
      const userId = next.user.id;
      const [myRole, myCoach] = await Promise.all([fetchMyRole(userId), fetchCoachByUserId(userId)]);
      if (run !== runRef.current) return;
      setRole(myRole);
      setCoach(myCoach);
      // Approval gate (§18.2): an inactive coach profile — or a coach role
      // without an approved profile — sees the pending screen ONLY.
      const coachPending =
        myRole !== 'admin' && ((myCoach !== null && !myCoach.is_active) || (myRole === 'coach' && !myCoach?.is_active));
      if (coachPending) {
        setAthlete(null);
        setCurrentAthleteId(null);
        setStatus('pending');
        return;
      }
      if (myRole === 'admin' || myCoach) {
        // Coach console / admin: not an athlete identity.
        setAthlete(null);
        setCurrentAthleteId(null);
      } else {
        let myAthlete = await fetchAthleteByUserId(userId);
        if (run !== runRef.current) return;
        if (!myAthlete && isAthleteIdentity(next.user)) {
          // Deferred-profile recovery (§18.1 step 6): the athlete signed up
          // while no ACTIVE coach was seeded, so the profile insert was
          // skipped — without this, bootstrap would leave athlete: null
          // forever (questionnaire submissions never flush, queue writes
          // held, re-signup just returns 'taken'). The coach may exist now:
          // complete the profile exactly like the signup-time path, from
          // the phone stored in the signup metadata (the name the athlete
          // typed was never persisted, so the phone doubles as display
          // name until they edit their profile).
          try {
            const coachRow = await fetchActiveCoachBySlug(DEFAULT_COACH_SLUG);
            if (run !== runRef.current) return;
            if (coachRow) {
              const meta = (next.user.user_metadata ?? {}) as Record<string, unknown>;
              const metaPhone = typeof meta.phone === 'string' ? meta.phone : '';
              const emailDigits =
                typeof next.user.email === 'string'
                  ? (next.user.email.split('@')[0] ?? '').replace(/^p/i, '').replace(/\D/g, '')
                  : '';
              const phone = metaPhone || (emailDigits ? `+${emailDigits}` : '');
              const healed = await createAthleteProfile({
                user_id: userId,
                full_name: phone || 'athlete',
                phone,
                coach_id: coachRow.id,
              });
              await joinCoach({ athlete_id: healed.id, coach_id: coachRow.id, is_primary: true });
              myAthlete = healed;
              console.info('[auth] deferred athlete profile completed for', userId);
            }
          } catch (err) {
            console.error('[auth] deferred athlete profile healing failed', err);
          }
          // Stale-run guard (same pattern as every other await above):
          // signIn/signUp call bootstrap() explicitly AND onAuthStateChange
          // fires for the same session — a losing run must not write its
          // (possibly still-null) athlete over the winner's.
          if (run !== runRef.current) return;
        }
        setAthlete(myAthlete);
        setCurrentAthleteId(myAthlete?.id ?? null);
        if (myAthlete) void flushQueue(); // stamp queued pre-login writes
        if (myAthlete?.coach_id) {
          // A questionnaire submission may still be waiting in storage
          // (signup-time persist interrupted, or the athlete re-did the
          // questionnaire in its tab) — flush it under this identity.
          void persistPendingSubmission({
            athleteId: myAthlete.id,
            coachId: myAthlete.coach_id,
          })
            .then((r) => {
              // The ProgramStatusCard's mount-time refresh can race ahead
              // of this flush (offline submit → app reopened online): when
              // the submission actually synced, announce it so the card
              // re-reads — mirrors the online/visibilitychange path.
              if (r === 'synced') window.dispatchEvent(new CustomEvent('km-queue-flushed'));
            })
            .catch((err) => console.error('[auth] pending submission flush failed', err));
        }
        if (!myAthlete && !myRole && !myCoach && !isAthleteIdentity(next.user)) {
          // ORPHAN email identity: no role, no coach row, no athlete row.
          // This is a coach whose profile insert never ran — with
          // "Confirm email" unexpectedly ON, signUpCoach returns before a
          // session exists (the PadelPro signup-block trap class). Athlete
          // identities are excluded: a row-less athlete user (synthetic
          // email, phone-as-email) is an athlete whose profile was
          // deferred (no active coach seeded yet).
          // Heal from the stored signup intent; without one (confirmed on
          // another device), route to the completion form — never
          // silently into the athlete shell with the wrong role.
          const intent = readPendingCoachProfile(userId);
          if (intent) {
            try {
              await createCoachProfile({ user_id: userId, slug: intent.slug, display_name: intent.name });
              clearPendingCoachProfile();
              const healed = await fetchCoachByUserId(userId);
              if (run !== runRef.current) return;
              if (healed) {
                setCoach(healed);
                setStatus(healed.is_active ? 'signedIn' : 'pending');
                return;
              }
            } catch (err) {
              console.error('[auth] pending coach profile completion failed', err);
              clearPendingCoachProfile();
            }
          }
          setStatus('completeCoachProfile');
          return;
        }
      }
      setStatus('signedIn');
    } catch (err) {
      // A session exists but the profile reads failed (e.g. migrations not
      // run yet). Don't lock the user out: enter with identity unresolved —
      // RLS still protects every table server-side.
      console.error('[auth] bootstrap failed', err);
      if (run === runRef.current) setStatus('signedIn');
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // No backend: stay on the gate (dev error + demo entry) — never
      // pretend a session exists.
      setStatus('signedOut');
      return;
    }
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      void bootstrap(next);
    });
    return () => data.subscription.unsubscribe();
  }, [bootstrap]);

  const signInCoach = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return { ok: false, code: 'generic' };
      const res = await callAuth(() => supabase.auth.signInWithPassword({ email: email.trim(), password }));
      if (res.error) {
        console.error('[auth] coach sign-in failed', res.error);
        return { ok: false, code: mapAuthError(res.error) };
      }
      await bootstrap(res.data.session);
      return { ok: true };
    },
    [bootstrap]
  );

  const signUpCoach = useCallback(
    async (input: { name: string; email: string; password: string; slug: string }): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return { ok: false, code: 'generic' };
      const res = await callAuth(() =>
        supabase.auth.signUp({ email: input.email.trim(), password: input.password })
      );
      if (res.error) {
        console.error('[auth] coach sign-up failed', res.error);
        return { ok: false, code: mapAuthError(res.error) };
      }
      const user = res.data.user;
      if (!user) return { ok: false, code: 'generic' };
      // GoTrue obfuscates a duplicate signup: a user object with NO
      // identities and no error means "already registered" — same guard as
      // signUpAthlete. Without it a duplicate coach email is misreported as
      // a pending email confirmation.
      if (Array.isArray(user.identities) && user.identities.length === 0) {
        return { ok: false, code: 'taken' };
      }
      if (!res.data.session) {
        // §18 expects "Confirm email" OFF, so a session should exist. If the
        // dashboard has it ON, the profile write must wait for first login —
        // park the intent locally so bootstrap can complete it then, and
        // tell the user to confirm + log in instead of failing silently.
        storePendingCoachProfile({ userId: user.id, name: input.name.trim(), slug: input.slug });
        return { ok: false, code: 'checkEmail' };
      }
      try {
        // §18.2 step 1: profile row, INACTIVE — role comes only on approval.
        await createCoachProfile({ user_id: user.id, slug: input.slug, display_name: input.name.trim() });
      } catch (err) {
        console.error('[auth] coach profile insert failed', err);
        // Idempotent recovery: the row may already exist from a previous
        // attempt (pre-fix inserts wrote the row but errored on RETURNING).
        const existing = await recoverExistingCoachProfile(user.id);
        if (existing) {
          await bootstrap(res.data.session);
          return { ok: true };
        }
        return { ok: false, code: mapCoachProfileInsertError(err) };
      }
      await bootstrap(res.data.session);
      return { ok: true };
    },
    [bootstrap]
  );

  const signInAthlete = useCallback(
    async (phone: string, password: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return { ok: false, code: 'generic' };
      // Phone-as-email: the password sign-in runs against the synthetic
      // email derived from the number — the user still types phone+password.
      const res = await callAuth(() =>
        supabase.auth.signInWithPassword({ email: athleteEmail(phone), password })
      );
      if (res.error) {
        console.error('[auth] athlete sign-in failed', res.error);
        return { ok: false, code: mapAuthError(res.error) };
      }
      await bootstrap(res.data.session);
      return { ok: true };
    },
    [bootstrap]
  );

  const signUpAthlete = useCallback(
    async (input: { name: string; phone: string; password: string }): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return { ok: false, code: 'generic' };
      const phone = normalizePhone(input.phone);
      // Phone-as-email: the account is an email identity on the synthetic
      // address; the real E.164 number rides in user metadata (and lands
      // in athletes.phone below) so no profile data changes.
      const res = await callAuth(() =>
        supabase.auth.signUp({
          email: athleteEmail(phone),
          password: input.password,
          options: { data: { phone, role_intent: 'athlete' } },
        })
      );
      if (res.error) {
        console.error('[auth] athlete sign-up failed', res.error);
        return { ok: false, code: mapAuthError(res.error) };
      }
      const user = res.data.user;
      if (!user) return { ok: false, code: 'generic' };
      // GoTrue obfuscates a duplicate signup when confirmation is ON: a
      // user object with NO identities and no error. That is "already
      // registered", not a pending confirmation — say so honestly.
      if (Array.isArray(user.identities) && user.identities.length === 0) {
        return { ok: false, code: 'taken' };
      }
      // Confirmation ON for the synthetic-email account would strand the
      // athlete (no mailbox to confirm from, no SMS flow in v1) — report
      // it as its own state, never as "confirm your email".
      if (!res.data.session) return { ok: false, code: 'checkPhone' };
      // §18.1 step 6: athletes row → primary membership. The v6 self-insert
      // policy requires an ACTIVE coach, resolved from the coach's slug.
      // If no active coach is seeded yet the profile write is skipped (the
      // account itself exists; the row is completed on a later pass) rather
      // than failing the signup.
      try {
        const coachRow = await fetchActiveCoachBySlug(DEFAULT_COACH_SLUG);
        if (coachRow) {
          const athleteRow = await createAthleteProfile({
            user_id: user.id,
            full_name: input.name.trim(),
            phone,
            coach_id: coachRow.id,
          });
          await joinCoach({ athlete_id: athleteRow.id, coach_id: coachRow.id, is_primary: true });
          // §18.1 step 6, final write: the questionnaire was completed
          // BEFORE signup and its submission has been waiting in local
          // storage — persist it now that the membership exists (the v6/v7
          // insert policies require it). Idempotent + queue-backed: a
          // failure here never fails the signup; bootstrap retries it.
          await persistPendingSubmission({ athleteId: athleteRow.id, coachId: coachRow.id }).catch(
            (err) => console.error('[auth] questionnaire submit persist failed (will retry)', err)
          );
        } else {
          console.warn('[auth] no active coach for slug', DEFAULT_COACH_SLUG, '— athlete profile deferred');
        }
      } catch (err) {
        console.error('[auth] athlete profile insert failed (deferred)', err);
      }
      await bootstrap(res.data.session);
      return { ok: true };
    },
    [bootstrap]
  );

  const completeCoachProfile = useCallback(
    async (input: { name: string; slug: string }): Promise<AuthResult> => {
      if (!isSupabaseConfigured || !session) return { ok: false, code: 'generic' };
      try {
        // Same §18.2 step 1 as signUpCoach: INACTIVE profile, role on approval.
        await createCoachProfile({ user_id: session.user.id, slug: input.slug, display_name: input.name.trim() });
      } catch (err) {
        console.error('[auth] coach profile completion failed', err);
        // Idempotent recovery: the row may already exist from a previous
        // attempt (this is exactly what happened to رضا on 2026-10-21 —
        // the first tap wrote the row, the retry hit the unique constraint).
        const existing = await recoverExistingCoachProfile(session.user.id);
        if (existing) {
          clearPendingCoachProfile();
          await bootstrap(session);
          return { ok: true };
        }
        return { ok: false, code: mapCoachProfileInsertError(err) };
      }
      clearPendingCoachProfile();
      await bootstrap(session);
      return { ok: true };
    },
    [bootstrap, session]
  );

  const signOut = useCallback(async () => {
    setDemo(false);
    if (isSupabaseConfigured) {
      await supabase.auth.signOut(); // onAuthStateChange re-runs bootstrap(null)
    }
    await bootstrap(null);
    setStatus('signedOut');
  }, [bootstrap]);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data } = await supabase.auth.getSession();
    await bootstrap(data.session);
  }, [bootstrap]);

  const enterDemo = useCallback(() => {
    setDemo(true);
    setStatus('signedIn');
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      unconfigured: !isSupabaseConfigured,
      demo,
      session,
      role,
      coach,
      athlete,
      signInCoach,
      signUpCoach,
      signInAthlete,
      signUpAthlete,
      completeCoachProfile,
      signOut,
      refresh,
      enterDemo,
    }),
    [status, demo, session, role, coach, athlete, signInCoach, signUpCoach, signInAthlete, signUpAthlete, completeCoachProfile, signOut, refresh, enterDemo]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The not-configured message, shared by the gate + onboarding screens. */
export const NOT_CONFIGURED_MESSAGE = new SupabaseNotConfiguredError().message;

