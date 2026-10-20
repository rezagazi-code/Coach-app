/**
 * مربی من — Auth + Entry state (§18).
 *
 * Supabase Auth (GoTrue), password-based v1 (§18.4): athletes sign in with
 * phone+password, coaches with email+password. No SMS OTP (Iranian delivery
 * is unreliable — §18.5), email/phone confirmation stays OFF.
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
  | 'signedIn'; // session + bootstrap resolved → the 5 tabs

export type AuthErrorCode =
  | 'wrong' // bad credentials
  | 'taken' // phone/email already registered
  | 'checkEmail' // signup ok but no session yet (confirmation unexpectedly ON)
  | 'busy' // still 429 after backoff
  | 'generic';

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
  signOut: () => Promise<void>;
  /** Re-run the §18.3 bootstrap (pending screen "check again"). */
  refresh: () => Promise<void>;
  /** Demo entry — only meaningful while unconfigured. */
  enterDemo: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

/**
 * Iranian mobile → E.164, the form GoTrue phone auth expects.
 * 09xxxxxxxxx / 9xxxxxxxxx → +98…; an already-international number passes
 * through. Applied identically at signup and login so they always match.
 */
export function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s-]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('0098')) return `+${p.slice(2)}`;
  if (p.startsWith('09') && p.length === 11) return `+98${p.slice(1)}`;
  if (p.startsWith('9') && p.length === 10) return `+98${p}`;
  if (p.startsWith('98') && p.length === 12) return `+${p}`;
  return p;
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
        const myAthlete = await fetchAthleteByUserId(userId);
        if (run !== runRef.current) return;
        setAthlete(myAthlete);
        setCurrentAthleteId(myAthlete?.id ?? null);
        if (myAthlete) void flushQueue(); // stamp queued pre-login writes
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
      if (!res.data.session) {
        // §18 expects "Confirm email" OFF, so a session should exist. If the
        // dashboard has it ON, the profile write must wait for first login —
        // tell the user to confirm + log in instead of failing silently.
        return { ok: false, code: 'checkEmail' };
      }
      try {
        // §18.2 step 1: profile row, INACTIVE — role comes only on approval.
        await createCoachProfile({ user_id: user.id, slug: input.slug, display_name: input.name.trim() });
      } catch (err) {
        console.error('[auth] coach profile insert failed', err);
        return { ok: false, code: 'generic' };
      }
      await bootstrap(res.data.session);
      return { ok: true };
    },
    [bootstrap]
  );

  const signInAthlete = useCallback(
    async (phone: string, password: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return { ok: false, code: 'generic' };
      const res = await callAuth(() =>
        supabase.auth.signInWithPassword({ phone: normalizePhone(phone), password })
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
      const res = await callAuth(() => supabase.auth.signUp({ phone, password: input.password }));
      if (res.error) {
        console.error('[auth] athlete sign-up failed', res.error);
        return { ok: false, code: mapAuthError(res.error) };
      }
      const user = res.data.user;
      if (!user) return { ok: false, code: 'generic' };
      if (!res.data.session) return { ok: false, code: 'checkEmail' };
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
      signOut,
      refresh,
      enterDemo,
    }),
    [status, demo, session, role, coach, athlete, signInCoach, signUpCoach, signInAthlete, signUpAthlete, signOut, refresh, enterDemo]
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
