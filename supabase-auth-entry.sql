-- ============================================================================
-- supabase-auth-entry.sql — v6 — AUTH + ENTRY (ورود و احراز هویت)
-- «مربی من» (My Coach) — multi-coach SaaS
-- RUN ORDER: after supabase-training-log.sql (v5). IDEMPOTENT — safe to re-run.
-- SPEC: hidden_files/saas-pivot-architecture.md §18
--
-- WHAT THIS ADDS (v1–v5 lacked it):
--   1. Coach approval gate: approved_at / approved_by on coaches;
--      is_active now defaults FALSE; 'coach' role is granted on APPROVAL
--      (update), not on signup (insert). Never downgrades admins.
--   2. athlete_coaches junction: one athlete can join a SECOND coach later
--      (athletes.coach_id from v2 stays the PRIMARY coach).
--   3. Athlete self-insert policy on athletes (entry flow: questionnaire →
--      signup with phone+password → athlete creates own row).
--   4. my_coach_ids() helper + membership-aware insert policy for
--      questionnaire_responses (replaces the single-coach check).
--
-- DASHBOARD CHECKLIST (Supabase Dashboard → Authentication — NOT sql):
--   [ ] Sign In / Providers → Phone: "Confirm phone" = OFF
--       (precedent: PadelPro turned "Confirm email" OFF 2026-10-12.
--        Iranian SMS delivery is unreliable; v1 uses phone+PASSWORD, no OTP.)
--   [ ] Auth → Password protection: minimum length 8, "Leaked password
--       protection" = ON.
--   [ ] Auth → Rate limits: keep Supabase defaults; tighten if abused.
--       Client adds exponential backoff on 429.
-- ============================================================================


-- ============================================================================
-- 1. COACH APPROVAL FIELDS
--    New coaches sign up INACTIVE (is_active=false) until Reza approves.
-- ============================================================================
alter table coaches add column if not exists approved_at timestamptz;
alter table coaches
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

-- New signups start inactive. (Existing rows keep their current value —
-- Reza's own seed sets is_active=true explicitly; see §6.)
alter table coaches alter column is_active set default false;

comment on column coaches.approved_at is 'When Reza approved this coach (NULL = pending).';
comment on column coaches.approved_by is 'Admin (Reza) who approved. NULL until approved.';


-- ============================================================================
-- 2. ROLE GRANT MOVES FROM SIGNUP (insert) TO APPROVAL (update)
--    Old behavior (v2): insert → instant 'coach' role. That bypasses the gate.
--    New behavior: role is granted ONLY when is_active flips false → true.
--    The on-conflict-do-nothing NEVER downgrades an existing 'admin'.
-- ============================================================================
drop trigger if exists trg_coaches_grant_role on coaches;
drop function if exists public.grant_coach_role();

create or replace function public.grant_coach_role_on_approval()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (old.is_active is distinct from true and new.is_active = true) then
    insert into user_roles (user_id, role)
    values (new.user_id, 'coach')
    on conflict (user_id) do nothing;   -- never downgrade an admin to coach
  end if;
  return new;
end;
$$;
comment on function public.grant_coach_role_on_approval() is
  'Grants coach role on approval (is_active false→true). SECURITY DEFINER; never downgrades admins.';

drop trigger if exists trg_coaches_grant_role_on_approval on coaches;
create trigger trg_coaches_grant_role_on_approval
  after update of is_active on coaches
  for each row execute function public.grant_coach_role_on_approval();


-- ============================================================================
-- 3. athlete_coaches — MANY-TO-MANY: one athlete, several coaches
--    athletes.coach_id (v2) stays the PRIMARY coach (drives coach policies).
--    This table records every membership incl. later joins. Exactly one
--    primary per athlete (partial unique index).
-- ============================================================================
create table if not exists athlete_coaches (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id   uuid not null references coaches(id) on delete cascade,
  is_primary boolean not null default false,
  status text not null default 'active'
    check (status in ('active','left','removed')),
  joined_at timestamptz not null default now(),
  unique (athlete_id, coach_id)
);
comment on table athlete_coaches is
  'Athlete↔coach memberships. One athlete may join a second coach later. athletes.coach_id remains the primary.';

create unique index if not exists uq_athlete_coaches_primary
  on athlete_coaches (athlete_id) where is_primary = true;
create index if not exists idx_athlete_coaches_athlete on athlete_coaches (athlete_id);
create index if not exists idx_athlete_coaches_coach   on athlete_coaches (coach_id);

alter table athlete_coaches enable row level security;

-- select: admin | the athlete themself | the coach of that membership
drop policy if exists pol6_ac_select on athlete_coaches;
create policy pol6_ac_select on athlete_coaches
  for select using (
    public.is_admin()
    or coach_id = public.my_coach_id()
    or exists (
      select 1 from athletes a
      where a.id = athlete_coaches.athlete_id and a.user_id = auth.uid()
    )
  );

-- insert: admin | athlete joining themself | coach adding to own roster
-- (v1: athlete joins via /c/{slug} link. Coach-invite approval is future.)
drop policy if exists pol6_ac_insert on athlete_coaches;
create policy pol6_ac_insert on athlete_coaches
  for insert with check (
    public.is_admin()
    or coach_id = public.my_coach_id()
    or exists (
      select 1 from athletes a
      where a.id = athlete_coaches.athlete_id and a.user_id = auth.uid()
    )
  );

-- update: admin | own coach (e.g. remove) | athlete themself (leave)
drop policy if exists pol6_ac_update on athlete_coaches;
create policy pol6_ac_update on athlete_coaches
  for update using (
    public.is_admin()
    or coach_id = public.my_coach_id()
    or exists (
      select 1 from athletes a
      where a.id = athlete_coaches.athlete_id and a.user_id = auth.uid()
    )
  );

-- delete: admin only (prefer status flips: 'left' / 'removed')
drop policy if exists pol6_ac_delete on athlete_coaches;
create policy pol6_ac_delete on athlete_coaches
  for delete using (public.is_admin());


-- ============================================================================
-- 4. HELPER — all ACTIVE coach ids of the calling athlete
--    (primary + later joins). SECURITY DEFINER, no recursion.
-- ============================================================================
create or replace function public.my_coach_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select ac.coach_id
  from athlete_coaches ac
  join athletes a on a.id = ac.athlete_id
  where a.user_id = auth.uid()
    and ac.status = 'active'
$$;
comment on function public.my_coach_ids() is
  'Active coach ids of the calling athlete (primary + joined). SECURITY DEFINER.';


-- ============================================================================
-- 5. ATHLETE ENTRY POLICIES
--    Flow: questionnaire (local) → signup phone+password → insert own
--    athletes row → insert membership → insert responses. Pre-auth the app
--    writes NOTHING to the DB (no anon-write RLS holes).
-- ============================================================================

-- 5a. Athlete creates their OWN athletes row. The primary coach must be an
--     ACTIVE coach (binds the /c/{slug} share-link flow; blocks attaching
--     to deactivated/nonexistent coaches). Residual v1 note: any active
--     coach id is attachable — coach-side join approval is a future flow.
drop policy if exists pol6_athletes_self_insert on athletes;
create policy pol6_athletes_self_insert on athletes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from coaches c
      where c.id = athletes.coach_id and c.is_active = true
    )
  );

-- 5b. questionnaire_responses insert: replace the single-coach check (v2)
--     with the membership check — an athlete may submit to ANY of their
--     coaches (primary or later-joined).
drop policy if exists pol2_qr_self_insert on questionnaire_responses;
drop policy if exists pol3_qr_self_insert on questionnaire_responses;
create policy pol3_qr_self_insert on questionnaire_responses
  for insert with check (
    exists (
      select 1 from athletes a
      where a.id = questionnaire_responses.athlete_id
        and a.user_id = auth.uid()
    )
    and questionnaire_responses.coach_id in (select public.my_coach_ids())
  );

-- 5c. UNCHANGED and already multi-coach-safe (kept as-is):
--     pol_athletes_self_read (own row), pol_qr_self_read (own responses),
--     pol_programs_self_read (own approved/active programs, any coach).


-- ============================================================================
-- 6. NO SELF-ROLE-ESCALATION — documented lock (no new policies needed)
--    user_roles has exactly ONE policy: self SELECT (v1). There is NO
--    insert/update/delete policy for authenticated users, so no client can
--    grant itself 'coach' or 'admin'. Roles are written ONLY by:
--      (a) the approval trigger above (SECURITY DEFINER, coach only,
--          never downgrades), or
--      (b) the admin seed below (run by Reza via SQL editor / service role).
-- ============================================================================


-- ============================================================================
-- 7. ADMIN SEED — Reza as admin + coach #1 (run ONCE, then delete/ignore)
--    1. Reza signs up in the app with EMAIL + password (coach signup;
--       lands INACTIVE/pending like everyone else).
--    2. In Supabase SQL editor, find his auth user id:
--         select id, email from auth.users where email = 'rezagazi@gmail.com';
--    3. Replace <REZA_AUTH_UUID> below and Run.
-- ============================================================================
-- insert into user_roles (user_id, role)
-- values ('<REZA_AUTH_UUID>', 'admin')
-- on conflict (user_id) do update set role = 'admin';
--
-- insert into coaches (user_id, slug, display_name, capabilities, specialties,
--                      is_active, approved_at, approved_by)
-- values ('<REZA_AUTH_UUID>', 'reza', 'رضا گزی', '{gym,padel}',
--         '{بدنسازی,پدل رقابتی}', true, now(), '<REZA_AUTH_UUID>')
-- on conflict (user_id) do update set
--   is_active = true, approved_at = now(), approved_by = '<REZA_AUTH_UUID>';
