-- ============================================================================
-- supabase-athlete-delete.sql — coach-scoped DELETE for the "delete trainee"
-- flow (CoachPanel «حذف شاگرد»).
--
-- Deleting a trainee = DELETE FROM athletes WHERE id = ... . The schema's
-- FK cascades (ON DELETE CASCADE) then wipe all of the athlete's app data:
-- questionnaire_responses, programs (+ program_items, program_feedback,
-- review_queue via programs), nutrition_targets, nutrition_logs (+
-- meal_food_entries via meal_logs), supplement_reviews, workout_sessions (+
-- logged_sets), meal_logs, sleep_logs, water_logs, checklist_completions,
-- xp_events, messages, qr_checkins, activity_syncs, quiz_attempts,
-- diet_adherence_weekly, workout_logs, progression_drafts,
-- challenge_participants, checkin_locations, athlete_coaches.
--
-- RLS subtlety: cascaded deletes are checked against RLS too. Every table
-- above already has a coach-scoped FOR ALL policy — EXCEPT athlete_coaches,
-- whose DELETE policy (pol6_ac_delete) is admin-only. Without the policy
-- below, the cascade hits athlete_coaches, gets denied, and the whole
-- DELETE rolls back. This migration adds ONLY that missing policy.
--
-- The auth.users login row is NOT touched (cannot be deleted with the
-- client key) — the coach removes it from the Supabase dashboard →
-- Authentication section (the app shows this note after deletion).
--
-- Idempotent: safe to run multiple times.
-- ============================================================================

drop policy if exists pol_athlete_delete_coach_ac on athlete_coaches;

create policy pol_athlete_delete_coach_ac on athlete_coaches
  for delete
  using (public.is_admin() or coach_id = public.my_coach_id());

comment on policy pol_athlete_delete_coach_ac on athlete_coaches is
  'Coach can delete their own athlete_coaches link rows (needed for the delete-trainee cascade); admins keep full access.';
