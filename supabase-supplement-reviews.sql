-- ============================================================================
-- supabase-supplement-reviews.sql — doctor-gated supplement pipeline
-- (Reza 2026-10-24, approved «بسازش»).
--
-- Pipeline: AI draft (rule-based, from screening answers) → coach
-- review/approve in CoachPanel → DOCTOR gate for any dose-level decision.
-- Same philosophy as the program review queue.
--
-- RED LINES (enforced by design, not just policy):
-- - This table stores NO dosages, NO timing, NO "needs X" language.
--   Drafts are "candidates for professional review" only.
-- - Athletes can SELECT only APPROVED rows — the unapproved AI draft is
--   never visible to the trainee (not even their own).
--
-- RUN: paste into Supabase SQL Editor and Run. Idempotent (safe to re-run).
-- NOTE (Supabase rule in force from Oct 30, 2026): explicit GRANTs for
-- anon / authenticated / service_role are included below in this file.
-- ============================================================================

create table if not exists supplement_reviews (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete set null,
  response_id uuid references questionnaire_responses(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  -- Snapshot of the AI draft as the coach saw it. Candidate language only;
  -- this column must NEVER carry dosages, timing, or "needs X" phrasing.
  draft_snapshot jsonb not null default '{}',
  coach_note text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  -- One review row per athlete: always reflects the latest questionnaire
  -- response (response_id). A newer submission supersedes the old decision.
  unique (athlete_id)
);

comment on table supplement_reviews is
  'Doctor-gated supplement pipeline: AI draft → coach review → doctor gate. No dosages ever. Athletes read APPROVED rows only.';

alter table supplement_reviews enable row level security;

-- ---- coaches: per-coach tenant isolation (no helper-function dependency —
--      works whether or not the multi-coach helpers exist).
drop policy if exists pol_suppreview_coach_all on supplement_reviews;
create policy pol_suppreview_coach_all on supplement_reviews
  for all
  using (
    exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
    or exists (
      select 1 from coaches c
      where c.user_id = auth.uid() and c.is_active = true
        and c.id = supplement_reviews.coach_id
    )
  )
  with check (
    exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
    or exists (
      select 1 from coaches c
      where c.user_id = auth.uid() and c.is_active = true
        and c.id = supplement_reviews.coach_id
    )
  );

-- ---- athletes: read ONLY their own APPROVED reviews (the doctor handoff).
--      Pending/rejected drafts are invisible — the trainee never sees the
--      unapproved AI draft.
drop policy if exists pol_suppreview_athlete_read on supplement_reviews;
create policy pol_suppreview_athlete_read on supplement_reviews
  for select
  using (
    status = 'approved'
    and exists (
      select 1 from athletes a
      where a.id = supplement_reviews.athlete_id and a.user_id = auth.uid()
    )
  );

-- ---- explicit GRANTs (Supabase Data API rule, in force Oct 30, 2026) ----
grant select, insert, update, delete on supplement_reviews to authenticated;
grant select on supplement_reviews to anon;
grant all on supplement_reviews to service_role;
