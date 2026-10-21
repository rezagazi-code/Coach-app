-- ============================================================================
-- COACHING APP — coach profile completion fix (2026-10-21)
-- Run AFTER supabase-auth-entry.sql (v6). Fully idempotent.
--
-- BUG (caught live on-device by رضا): «ساخت پروفایل مربی» (complete coach
-- profile) failed with a generic error although the auth account existed.
--
-- ROOT CAUSE: createCoachProfile does .insert().select().single() and the
-- bootstrap's fetchCoachByUserId reads the row back. The only SELECT policy
-- on coaches was pol_coaches_public_read (is_active = true). A coach profile
-- is created INACTIVE (is_active = false, pending approval), so:
--   1. the INSERT's RETURNING clause saw zero rows → PostgREST rejected the
--      request (42501) EVEN THOUGH THE ROW WAS WRITTEN — the app showed a
--      generic error and the retry then hit a unique violation, also generic;
--   2. bootstrap could never read the pending row, so the completion form
--      would loop forever.
--
-- FIX: coaches may SELECT their OWN row regardless of is_active. Public
-- read of active profiles (pol_coaches_public_read) is untouched.
-- ============================================================================

drop policy if exists pol_coaches_self_read on coaches;

create policy pol_coaches_self_read on coaches
  for select using (user_id = auth.uid());

comment on policy pol_coaches_self_read on coaches is
  'Coach reads their own profile row, including while INACTIVE (pending approval).';
