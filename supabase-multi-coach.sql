-- ============================================================================
-- COACHING APP — Multi-coach SaaS migration (v2)
-- «مربی من» (My Coach) pivots from Reza's personal tool to a multi-coach platform.
-- ============================================================================
-- HOW TO RUN:
--   1. Run supabase-schema.sql FIRST (v1: base tables + RLS).
--   2. Paste this ENTIRE file into the SAME project's SQL Editor and Run.
--      Fully idempotent: re-running is safe (IF NOT EXISTS / DROP IF EXISTS
--      guards everywhere; backfills are conditional).
--   3. After it succeeds, run the STEP 2 seed snippet at the bottom ONCE
--      (uncomment + paste Reza's auth.users UUID) to create coach #1.
--
-- DO NOT run this in the PadelPro project (psgzisrzgddcvfkdlpyd).
--
-- WHAT CHANGES:
--   - NEW table coaches: public coach profiles (slug, capabilities, pricing).
--   - NEW table sport_modules: registry of sport question/program modules.
--   - coach_id FK added to: athletes, questionnaire_responses, programs,
--     program_feedback, coach_slots.
--   - RLS rewritten from "one global coach sees everything" to per-coach
--     isolation: a coach sees ONLY rows tagged with their own coach_id.
--   - user_roles stays (coach/admin gating); a trigger auto-grants the
--     'coach' role when a coaches row is inserted.
--   - athlete_xp_totals view gains coach_id (per-coach leaderboards).
--
-- DESIGN NOTES:
--   - coach_id columns are NULLABLE (not NOT NULL) so this migration stays
--     re-runnable and never orphans pre-existing rows. App code ALWAYS sets
--     coach_id on insert. Rows with NULL coach_id are invisible to coaches
--     (only admin sees them) — see policies below.
--   - Track codes are unchanged ('gym','vip','padel','aionly'). New sports
--     extend the track CHECK via a follow-up migration (single choke point).
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS (same as v1)
-- ============================================================================
create extension if not exists "pgcrypto";


-- ============================================================================
-- 1. COACHES — public coach profiles. One row per coach on the platform.
--    Reza is coach #1 (slug 'reza', capabilities {gym,padel}).
--    capabilities: sport codes this coach offers, e.g. {gym}, {padel},
--      {gym,padel}, later {swimming}, {yoga}. Drives which questionnaire
--      tracks the coach's landing page offers (see sport_modules §2).
--    pricing: per-track prices in Toman, set by the coach/Reza later, e.g.
--      {"gym": 1500000, "vip": 2500000, "padel": 1200000, "aionly": 800000}.
--      Payment wiring is DEFERRED (Reza's doctrine) — this is data only.
--    plan / plan_expires_at: subscription placeholders. Wiring deferred.
-- ============================================================================
create table if not exists coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  slug text unique not null,                     -- url-safe, e.g. 'reza' -> /c/reza
  display_name text not null,                    -- e.g. 'رضا گزی'
  photo_url text,
  bio text not null default '',
  capabilities text[] not null default '{}',    -- sport codes, e.g. '{gym,padel}'
  specialties text[] not null default '{}',     -- free tags, e.g. '{کاهش وزن,پدل رقابتی}'
  pricing jsonb not null default '{}',           -- per-track prices (Toman), data only
  currency text not null default 'IRT',
  plan text not null default 'free',             -- subscription placeholder (wiring deferred)
  plan_expires_at timestamptz,
  is_active boolean not null default true,       -- Reza can deactivate a coach
  created_at timestamptz not null default now()
);
comment on table coaches is 'Coach profiles for the multi-coach SaaS. capabilities drive questionnaire track composition. pricing/plan are data-only; billing wiring is deferred.';

create index if not exists idx_coaches_slug      on coaches(slug);
create index if not exists idx_coaches_user      on coaches(user_id);
create index if not exists idx_coaches_active    on coaches(is_active) where is_active = true;


-- ============================================================================
-- 2. SPORT_MODULES — registry of sport question/program modules.
--    Adding a sport later (swimming, yoga, ...) = one INSERT here +
--    engine work + extending the track CHECK. No schema redesign.
--    question_schema is descriptive (module keys); the canonical question
--    definitions live in the app/questionnaire spec docs.
-- ============================================================================
create table if not exists sport_modules (
  code text primary key,                          -- 'gym' | 'padel' | 'swimming' ...
  label_fa text not null,                         -- 'بدنسازی'
  tracks text[] not null default '{}',            -- tracks this sport contributes
  question_schema jsonb not null default '{}',    -- module keys, e.g. {"basic": "s_padel_basic", "vip_deep": "s_padel_vip"}
  program_engine text not null default '',        -- engine hint, e.g. 'gym_template_v1'
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table sport_modules is 'Sport module registry. New sports plug in via INSERT, not schema changes.';

insert into sport_modules (code, label_fa, tracks, question_schema, program_engine)
values
  ('gym', 'بدنسازی',
   array['gym','aionly'],
   '{"basic": "s_gym_core", "notes": "gym track = core modules; programming via gym engine"}',
   'gym_template_v1'),
  ('padel', 'پدل',
   array['padel','aionly'],
   '{"basic": "s_padel_basic", "vip_deep": "s_padel_vip", "notes": "vip track = gym+padel composition; padel-only = light flow + mobility"}',
   'padel_template_v1')
on conflict (code) do update set
  label_fa = excluded.label_fa,
  tracks = excluded.tracks,
  question_schema = excluded.question_schema,
  program_engine = excluded.program_engine;


-- ============================================================================
-- 3. coach_id COLUMNS — tenant discriminator on every coach-scoped table.
--    Nullable for idempotent backfill safety (see §9). App always sets it.
-- ============================================================================
alter table athletes                add column if not exists coach_id uuid references coaches(id) on delete set null;
alter table questionnaire_responses add column if not exists coach_id uuid references coaches(id) on delete set null;
alter table programs                add column if not exists coach_id uuid references coaches(id) on delete set null;
alter table program_feedback        add column if not exists coach_id uuid references coaches(id) on delete set null;

-- coach_slots.coach_id previously held the coach's auth.users id by
-- convention (unconstrained). It now references coaches.id (the tenant).
-- On a fresh DB this is a clean cutover; the column type (uuid) is unchanged.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coach_slots_coach_id_fkey'
  ) then
    alter table coach_slots
      add constraint coach_slots_coach_id_fkey
      foreign key (coach_id) references coaches(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_athletes_coach   on athletes(coach_id);
create index if not exists idx_qr_coach         on questionnaire_responses(coach_id);
create index if not exists idx_programs_coach   on programs(coach_id);
create index if not exists idx_feedback_coach  on program_feedback(coach_id);


-- ============================================================================
-- 4. HELPER FUNCTIONS — SECURITY DEFINER so RLS policies stay simple and
--    never recurse. (Same no-recursion discipline as v1 §13.)
-- ============================================================================
create or replace function public.my_coach_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select id from coaches where user_id = auth.uid() and is_active = true $$;
comment on function public.my_coach_id() is 'The coach row of the calling user, or NULL. SECURITY DEFINER: bypasses RLS intentionally.';

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin') $$;
comment on function public.is_admin() is 'True when the caller has the admin role. SECURITY DEFINER.';


-- ============================================================================
-- 5. RLS — per-coach isolation.
--    Rule of thumb now: admin sees everything; a coach sees ONLY rows with
--    their own coach_id; athletes see only their own rows (unchanged) and
--    NEVER review_queue / program_feedback (no policies = no access).
--    v1 "coach sees everything" policies are dropped and replaced.
-- ============================================================================
alter table coaches       enable row level security;
alter table sport_modules enable row level security;

-- ---- coaches: PUBLIC read of active coach profiles (powers /c/{slug}
--      landing pages + coach picker). Coaches update only their own row.
--      Authenticated users may insert their OWN row (self-serve onboarding;
--      Reza can deactivate via is_active). See trigger §7 for role grant.
drop policy if exists pol_coaches_public_read on coaches;
create policy pol_coaches_public_read on coaches
  for select using (is_active = true);
drop policy if exists pol_coaches_self_update on coaches;
create policy pol_coaches_self_update on coaches
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists pol_coaches_self_insert on coaches;
create policy pol_coaches_self_insert on coaches
  for insert with check (user_id = auth.uid());

-- ---- sport_modules: public read (questionnaire composition needs it).
drop policy if exists pol_sportmods_public_read on sport_modules;
create policy pol_sportmods_public_read on sport_modules
  for select using (is_active = true);
drop policy if exists pol_sportmods_admin_all on sport_modules;
create policy pol_sportmods_admin_all on sport_modules
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---- athletes: per-coach (replaces v1 pol_athletes_coach_all)
drop policy if exists pol_athletes_coach_all on athletes;
drop policy if exists pol2_athletes_coach_scoped on athletes;
create policy pol2_athletes_coach_scoped on athletes
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
-- (pol_athletes_self_read from v1 is kept as-is.)

-- ---- questionnaire_responses: per-coach (replaces v1 pol_qr_coach_all).
--      Athlete self-insert additionally requires the response's coach_id to
--      match the athlete's own coach_id (binds share-link signups correctly).
drop policy if exists pol_qr_coach_all on questionnaire_responses;
drop policy if exists pol2_qr_coach_scoped on questionnaire_responses;
create policy pol2_qr_coach_scoped on questionnaire_responses
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol_qr_self_insert on questionnaire_responses;
drop policy if exists pol2_qr_self_insert on questionnaire_responses;
create policy pol2_qr_self_insert on questionnaire_responses
  for insert with check (
    exists (
      select 1 from athletes a
      where a.id = questionnaire_responses.athlete_id
        and a.user_id = auth.uid()
        and a.coach_id = questionnaire_responses.coach_id
    )
  );
-- (pol_qr_self_read from v1 is kept as-is.)

-- ---- programs: per-coach (replaces v1 pol_programs_coach_all)
drop policy if exists pol_programs_coach_all on programs;
drop policy if exists pol2_programs_coach_scoped on programs;
create policy pol2_programs_coach_scoped on programs
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
-- (pol_programs_self_read from v1 is kept as-is: own approved/active only.)

-- ---- program_items: per-coach via programs join (replaces v1 pol_items_coach_all)
drop policy if exists pol_items_coach_all on program_items;
drop policy if exists pol2_items_coach_scoped on program_items;
create policy pol2_items_coach_scoped on program_items
  for all
  using (
    public.is_admin()
    or exists (
      select 1 from programs p
      where p.id = program_items.program_id and p.coach_id = public.my_coach_id()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from programs p
      where p.id = program_items.program_id and p.coach_id = public.my_coach_id()
    )
  );
-- (pol_items_self_read from v1 is kept as-is.)

-- ---- review_queue: per-coach via programs join (replaces v1 pol_review_coach_all).
--      Still COACH ONLY — no athlete policies.
drop policy if exists pol_review_coach_all on review_queue;
drop policy if exists pol2_review_coach_scoped on review_queue;
create policy pol2_review_coach_scoped on review_queue
  for all
  using (
    public.is_admin()
    or exists (
      select 1 from programs p
      where p.id = review_queue.program_id and p.coach_id = public.my_coach_id()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from programs p
      where p.id = review_queue.program_id and p.coach_id = public.my_coach_id()
    )
  );

-- ---- program_feedback: per-coach, direct coach_id match (replaces v1
--      pol_feedback_coach_all). Still COACH ONLY — no athlete policies.
drop policy if exists pol_feedback_coach_all on program_feedback;
drop policy if exists pol2_feedback_coach_scoped on program_feedback;
create policy pol2_feedback_coach_scoped on program_feedback
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());

-- ---- xp_events: per-coach via athletes join (replaces v1 pol_xp_coach_all)
drop policy if exists pol_xp_coach_all on xp_events;
drop policy if exists pol2_xp_coach_scoped on xp_events;
create policy pol2_xp_coach_scoped on xp_events
  for all
  using (
    public.is_admin()
    or exists (
      select 1 from athletes a
      where a.id = xp_events.athlete_id and a.coach_id = public.my_coach_id()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from athletes a
      where a.id = xp_events.athlete_id and a.coach_id = public.my_coach_id()
    )
  );
-- (pol_xp_self_read / pol_xp_self_insert from v1 are kept as-is.)

-- ---- coach_slots: a coach manages ONLY their own slots (replaces v1
--      pol_slots_coach_all). Athletes see free slots of THEIR OWN coach
--      (plus their own bookings) — replaces v1 pol_slots_self_read.
drop policy if exists pol_slots_coach_all on coach_slots;
drop policy if exists pol2_slots_coach_scoped on coach_slots;
create policy pol2_slots_coach_scoped on coach_slots
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol_slots_self_read on coach_slots;
drop policy if exists pol2_slots_self_read on coach_slots;
create policy pol2_slots_self_read on coach_slots
  for select using (
    exists (
      select 1 from athletes a
      where a.user_id = auth.uid()
        and (
          (coach_slots.status = 'free' and coach_slots.coach_id = a.coach_id)
          or coach_slots.athlete_id = a.id
        )
    )
  );
drop policy if exists pol_slots_self_book on coach_slots;
drop policy if exists pol2_slots_self_book on coach_slots;
create policy pol2_slots_self_book on coach_slots
  -- Booking = flipping a free slot of YOUR OWN coach to booked with your own athlete_id.
  for update
  using (
    status = 'free'
    and exists (
      select 1 from athletes a
      where a.user_id = auth.uid() and a.coach_id = coach_slots.coach_id
    )
  )
  with check (
    status = 'booked'
    and exists (
      select 1 from athletes a
      where a.id = coach_slots.athlete_id
        and a.user_id = auth.uid()
        and a.coach_id = coach_slots.coach_id
    )
  );


-- ============================================================================
-- 6. athlete_xp_totals — per-coach leaderboard view (adds coach_id).
--    security_invoker: athletes see only their own total through it.
-- ============================================================================
-- DROP first: CREATE OR REPLACE cannot insert coach_id mid-view (PG 42P16,
-- hit live by Reza 2026-10-21). View has no dependents; safe to recreate.
drop view if exists athlete_xp_totals;
create view athlete_xp_totals
with (security_invoker = true) as
select
  e.athlete_id,
  a.coach_id,
  coalesce(sum(e.xp), 0)::bigint as total_xp
from xp_events e
join athletes a on a.id = e.athlete_id
group by e.athlete_id, a.coach_id;
comment on view athlete_xp_totals is 'Leaderboard totals per athlete, now scoped per coach via coach_id.';


-- ============================================================================
-- 7. TRIGGER — inserting a coaches row auto-grants the 'coach' role in
--    user_roles (so RLS helper checks keep working for new coaches).
-- ============================================================================
create or replace function public.grant_coach_role()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- DO NOTHING on conflict: never downgrade an existing 'admin' to 'coach'.
  insert into user_roles (user_id, role)
  values (new.user_id, 'coach')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_coaches_grant_role on coaches;
create trigger trg_coaches_grant_role
  after insert on coaches
  for each row execute function public.grant_coach_role();


-- ============================================================================
-- 8. BACKFILL — attach any pre-existing rows (coach_id IS NULL) to coach #1.
--    No-op on a fresh DB. Safe to re-run: only touches NULL coach_id rows,
--    and only when the 'reza' coach row exists.
-- ============================================================================
do $$
declare
  reza_id uuid;
begin
  select id into reza_id from coaches where slug = 'reza' limit 1;
  if reza_id is not null then
    update athletes                set coach_id = reza_id where coach_id is null;
    update questionnaire_responses set coach_id = reza_id where coach_id is null;
    update programs                set coach_id = reza_id where coach_id is null;
    update program_feedback        set coach_id = reza_id where coach_id is null;
    -- coach_slots: only backfill rows whose coach_id matches no coach yet;
    -- on a fresh DB there are none. (Legacy auth-uuid values can't map.)
  end if;
end $$;


-- ============================================================================
-- STEP 2 (run AFTER this migration, ONCE Reza has signed up in the app):
-- Create Reza as coach #1. Replace the UUID with his real auth.users id
-- (Supabase Dashboard -> Authentication -> Users -> copy his UUID),
-- then UNCOMMENT and run. The trigger auto-grants his 'coach' role.
-- After this, re-run §8's backfill by simply re-running this whole file.
-- ============================================================================
-- insert into coaches (user_id, slug, display_name, bio, capabilities, specialties)
-- values (
--   'PASTE-REZA-AUTH-UUID-HERE',
--   'reza',
--   'رضا گزی',
--   'مربی بدنسازی و پدل — برنامه تمرینی و تغذیه زیر نظر مستقیم مربی',
--   array['gym','padel'],
--   array['بدنسازی','پدل','کاهش وزن','آمادگی مسابقه']
-- )
-- on conflict (user_id) do update set
--   slug = excluded.slug,
--   display_name = excluded.display_name,
--   capabilities = excluded.capabilities,
--   specialties = excluded.specialties;
