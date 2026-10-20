-- ============================================================================
-- «مربی من» (My Coach) — Questionnaire submit wiring (v7)
-- File: supabase-questionnaire-submit.sql
--
-- RUN ORDER: after supabase-auth-entry.sql (v6). IDEMPOTENT — safe to re-run.
-- Reza runs this in the Supabase SQL Editor of the morabi-man project.
--
-- WHY THIS FILE EXISTS — the §18.1 submit flow runs entirely under the
-- ATHLETE's own session (questionnaire → signup → persist), and the v1–v6
-- policies left three gaps that made it impossible:
--   1. No idempotency key on the submit path: questionnaire_responses and
--      programs had no client_uuid, so a double-tap / retry / offline
--      re-sync could mint duplicate rows (PadelPro double-submit lesson).
--   2. programs had NO athlete INSERT policy (coach FOR ALL + athlete
--      SELECT of approved/active only) — the athlete could not create the
--      AI draft program their submission produces.
--   3. review_queue was coach-only FOR ALL — the athlete could not create
--      the queue row that puts the draft in front of their coach.
--
-- WHAT THIS FILE DOES (additive only — no v1–v6 policy is weakened):
--   1. client_uuid uuid columns + UNIQUE indexes on questionnaire_responses
--      and programs (NULLs stay distinct, so all pre-existing rows are
--      unaffected; the client upserts on client_uuid).
--   2. A narrow athlete self-submit INSERT policy on programs: own row
--      only, created_by='ai', approved_at must be NULL, coach must be one
--      of the athlete's ACTIVE coaches, and the status is pinned by track —
--      coach tracks enter as 'in_review', aionly goes straight to 'active'
--      (its designed no-coach-review path, chk_aionly_ai_only already
--      forces created_by='ai'). An athlete can NEVER insert 'approved' or
--      'draft' rows, and still cannot UPDATE any program.
--   3. A narrow athlete INSERT policy on review_queue: undecided rows only
--      (decision/reviewed_at NULL), only for the athlete's OWN program that
--      is currently 'in_review' on a coach track. Athletes still have NO
--      select/update/delete on review_queue — the table stays invisible to
--      them; this grants insert of exactly one row per own submission.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Idempotency keys (offline-queue upsert targets, same pattern as v5's
--    workout_sessions / logged_sets client_uuid).
-- ----------------------------------------------------------------------------
alter table questionnaire_responses add column if not exists client_uuid uuid;
create unique index if not exists uq_qr_client_uuid
  on questionnaire_responses (client_uuid);

alter table programs add column if not exists client_uuid uuid;
create unique index if not exists uq_programs_client_uuid
  on programs (client_uuid);

comment on column questionnaire_responses.client_uuid is
  'Client-generated submission id (v7). Minted when the questionnaire starts; UNIQUE — resubmits upsert onto the same row.';
comment on column programs.client_uuid is
  'Client-generated id of the submission that created this program (v7). Derived deterministically from the submission client_uuid; UNIQUE.';


-- ----------------------------------------------------------------------------
-- 2. Helper — is this program the caller's own, awaiting coach review?
--    SECURITY DEFINER (same discipline as my_coach_id / my_coach_ids):
--    the review_queue policy below must see the athlete's in_review
--    program, but the athlete's own programs SELECT policy only exposes
--    approved/active rows — a plain policy subquery would find nothing.
-- ----------------------------------------------------------------------------
create or replace function public.own_program_in_review(pid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from programs p
    join athletes a on a.id = p.athlete_id
    where p.id = pid
      and a.user_id = auth.uid()
      and p.status = 'in_review'
      and p.track <> 'aionly'
  )
$$;
comment on function public.own_program_in_review(uuid) is
  'True when pid is the calling athlete''s own program, in_review on a coach track. SECURITY DEFINER — used by the v7 review_queue self-submit policy.';


-- ----------------------------------------------------------------------------
-- 3. programs — athlete self-submit INSERT (the AI draft at questionnaire
--    submit). Mirrors the v6 questionnaire_responses membership discipline.
-- ----------------------------------------------------------------------------
drop policy if exists pol7_programs_self_submit on programs;
create policy pol7_programs_self_submit on programs
  for insert with check (
    created_by = 'ai'
    and approved_at is null
    and coach_id in (select public.my_coach_ids())
    and exists (
      select 1 from athletes a
      where a.id = programs.athlete_id
        and a.user_id = auth.uid()
    )
    and (
      (track = 'aionly' and status = 'active')
      or (track <> 'aionly' and status = 'in_review')
    )
  );
comment on policy pol7_programs_self_submit on programs is
  'Athlete submits their own AI draft: coach tracks as in_review, aionly as active; never approved, never coach-authored.';


-- ----------------------------------------------------------------------------
-- 4. review_queue — athlete creates the undecided queue row for their own
--    in_review program. INSERT only; the coach policies from v2 are
--    untouched and athletes still cannot read this table.
-- ----------------------------------------------------------------------------
drop policy if exists pol7_review_self_submit on review_queue;
create policy pol7_review_self_submit on review_queue
  for insert with check (
    decision is null
    and reviewed_at is null
    and public.own_program_in_review(review_queue.program_id)
  );
comment on policy pol7_review_self_submit on review_queue is
  'Athlete enqueues their own in_review program for coach review. Insert-only; no athlete read on review_queue.';
