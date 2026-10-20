/**
 * Supabase client for کمک مربی.
 *
 * CODE ONLY — keys come from the environment, never hardcoded.
 * No live project exists yet; the client logs a warning until
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are configured.
 *
 * Architecture: per-coach data isolation. Every table carries a
 * `coach_id` tenant column; demo data uses the single coach below.
 */
import { createClient } from '@supabase/supabase-js';

/** Demo coach (single-coach data for now): رضا گزی / Reza Gazi. */
export const DEMO_COACH_ID = 'coach-reza-gazi';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — client is a stub until env is configured. No keys are hardcoded.'
  );
}

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key'
);

export const isSupabaseConfigured = Boolean(url && anonKey);
