-- ============================================================================
-- COACHING APP — Supabase schema v1
-- Reza Gazi's gym+padel coaching app (coach-management tool, NOT PadelPro)
-- ============================================================================
-- HOW TO RUN:
--   1. Reza creates a FRESH Supabase project first (morning task).
--   2. Paste this ENTIRE file into that project's SQL Editor and press Run.
--      It runs top-to-bottom with zero edits. Re-running is safe
--      (IF NOT EXISTS / DROP IF EXISTS guards everywhere).
--   3. After it succeeds, run the coach-seed snippet at the very bottom
--      (STEP 2) once Reza has signed up in the app.
--
-- DO NOT run this in the PadelPro project (psgzisrzgddcvfkdlpyd).
-- Tables are created in dependency order: every FOREIGN KEY references a
-- table created EARLIER in this file.
--
-- REVIEW FLOW (see research doc §7):
--   gym/vip/padel tracks: AI draft (status=draft) -> review_queue -> coach
--   approves/edits (approved_at set) -> trainee sees the program.
--   aionly track (paid "program only, no coach"): NO coach review.
--   aionly programs are created_by='ai' (enforced by CHECK below) and go
--   straight to status='active'. They NEVER appear in review_queue and are
--   honestly labeled "AI-generated, no coach review" in the app UI.
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================
create extension if not exists "pgcrypto";  -- gen_random_uuid()


-- ============================================================================
-- 1. ROLES — who is a coach/admin. Athletes are everyone else (auth.users).
--    The app looks up auth.uid() here to decide coach vs athlete access.
-- ============================================================================
create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('coach','admin')),
  created_at timestamptz not null default now()
);
comment on table user_roles is 'App-level roles. coach = Reza (and future staff). Athletes need no row here.';


-- ============================================================================
-- 2. ATHLETES — trainee profiles. All ages: birth_date drives youth logic.
--    user_id is nullable for now; auth wiring comes later.
-- ============================================================================
create table if not exists athletes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  birth_date date,                                  -- drives youth/adult programming
  gender text check (gender in ('male','female')),
  phone text,
  created_at timestamptz not null default now()
);
comment on table athletes is 'Trainee profiles for all ages. One row per trainee.';


-- ============================================================================
-- 3. QUESTIONNAIRE_RESPONSES — one onboarding submission per track.
--    flags holds computed values (bmi, bmi_cat, age_band, injuries[],
--    surgeries[], goal, sleep_hours, days_per_week) for the coach card.
-- ============================================================================
create table if not exists questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  track text not null check (track in ('gym','vip','padel','aionly')),
  answers jsonb not null default '{}',              -- full questionnaire payload
  flags jsonb not null default '{}',                -- computed: bmi, bmi_cat, age_band, injuries[], surgeries[], goal, sleep_hours, days_per_week
  created_at timestamptz not null default now()
);
comment on table questionnaire_responses is 'Onboarding answers + computed flags per track. Newest row per athlete = current intake.';


-- ============================================================================
-- 4. PROGRAMS — workout programs (AI draft or coach-written).
--    aionly CHECK: paid self-service programs are AI-generated ONLY and skip
--    coach review (status goes straight to active; never enters review_queue).
-- ============================================================================
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft','in_review','approved','active','archived')),
  created_by text not null default 'ai'
    check (created_by in ('ai','coach')),
  track text not null check (track in ('gym','vip','padel','aionly')),
  goal text not null,                               -- fat_loss | muscle | padel_perf | health | strength (engine-neutral label)
  split text not null,                              -- fullbody_ab | upper_lower | push_pull_legs ...
  days_per_week int not null,
  ai_summary text not null default '',              -- draft rationale, shown to the COACH only
  coach_notes text not null default '',
  approved_at timestamptz,                          -- set when coach approves (null for aionly)
  created_at timestamptz not null default now(),
  constraint chk_aionly_ai_only check (
    track <> 'aionly' or created_by = 'ai'
  )
);
comment on table programs is 'Workout programs. gym/vip/padel go through coach review; aionly is AI-generated and goes straight to active.';


-- ============================================================================
-- 5. EXERCISES — our curated exercise database (seeded once from wger, then
--    curated manually: Persian names/cues, padel tags, contraindications,
--    youth flags). This table is OUR source of truth; no runtime API calls.
-- ============================================================================
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'wger',              -- wger | manual | api_ninjas
  source_id text,                                   -- id in the original source
  name_en text not null,
  name_fa text not null,                            -- curated manually
  cue_fa text not null default '',                 -- 1-2 line execution cue in Persian
  category text not null,                           -- legs | push | pull | core | ...
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  equipment text[] not null default '{}',
  difficulty int not null default 2 check (difficulty between 1 and 3),
  image_url text,                                   -- nullable (not all wger rows have images)
  image_license text,                               -- store license per item for attribution
  padel_tags text[] not null default '{}',         -- rotational_power, leg_drive, shoulder_prehab, elbow_prehab, core_stability, agility
  contraindications text[] not null default '{}',  -- shoulder:overhead, knee:loaded_flexion, back:axial_load, wrist:loaded_extension
  youth_safe boolean not null default true,
  youth_notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table exercises is 'Curated exercise library. Athletes only ever see is_active rows.';


-- ============================================================================
-- 6. EXERCISE_ALTERNATIVES — safe swaps (equipment swap / injury-safe /
--    easier / harder). Powers the coach''s one-tap "swap exercise" action.
-- ============================================================================
create table if not exists exercise_alternatives (
  exercise_id uuid not null references exercises(id) on delete cascade,
  alt_exercise_id uuid not null references exercises(id) on delete cascade,
  reason text not null check (reason in ('equipment_swap','injury_safe','easier','harder')),
  primary key (exercise_id, alt_exercise_id)
);
comment on table exercise_alternatives is 'Swap graph for exercises. reason: equipment_swap | injury_safe | easier | harder.';


-- ============================================================================
-- 7. PROGRAM_ITEMS — one row per exercise per training day in a program.
-- ============================================================================
create table if not exists program_items (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  day_number int not null,
  exercise_id uuid not null references exercises(id),
  sets int not null,
  reps text not null,                               -- "8-12" or "30s" (text keeps ranges/labels flexible)
  rest_sec int not null default 90,
  item_order int not null default 0,
  coach_note text not null default '',
  is_ai_suggestion boolean not null default true    -- false once the coach edits/locks it
);
comment on table program_items is 'Exercises inside a program, ordered per training day.';


-- ============================================================================
-- 8. REVIEW_QUEUE — coach approval inbox. One row per submitted program.
--    flags_snapshot freezes the athlete''s flags at submit time so the coach
--    card is skimmable (BMI badge, injury red flags, age band, goal, sleep).
--    aionly programs NEVER get a row here (no coach review by design).
-- ============================================================================
create table if not exists review_queue (
  program_id uuid primary key references programs(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  decision text check (decision in ('approved','edited','rejected')),
  flags_snapshot jsonb not null default '{}',       -- {bmi, bmi_cat, age_band, injuries[], goal, sleep, days}
  coach_feedback text not null default ''
);
comment on table review_queue is 'Coach approval inbox. Athletes must NEVER see this table. aionly programs skip it entirely.';


-- ============================================================================
-- 9. PROGRAM_FEEDBACK — every coach edit is logged here. This is the raw
--    material for the draft-accuracy learning loop (weekly report: which
--    swaps happen 3+ times -> candidate rule updates, approved by Reza).
-- ============================================================================
create table if not exists program_feedback (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  coach_id uuid,                                    -- the coach who made the edit
  change_type text not null,                        -- swap_exercise | change_sets_reps | remove | add_note
  details jsonb not null default '{}',              -- e.g. {"from_exercise_id": "...", "to_exercise_id": "..."}
  created_at timestamptz not null default now()
);
comment on table program_feedback is 'Coach edit log. Feeds the draft-accuracy learning loop. Athletes must NEVER see this table.';


-- ============================================================================
-- 10. XP_EVENTS — auditable XP ledger (leaderboard is derived, never stored).
-- ============================================================================
create table if not exists xp_events (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  event_type text not null,                         -- gym_session | padel_match | win | streak
  xp int not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
comment on table xp_events is 'XP ledger. Leaderboard totals are derived from here, never stored.';


-- ============================================================================
-- 10b. ATHLETE_XP_TOTALS — leaderboard view (security_invoker: athletes only
--     see their own total through it).
-- ============================================================================
create or replace view athlete_xp_totals
with (security_invoker = true) as
select
  athlete_id,
  coalesce(sum(xp), 0)::bigint as total_xp
from xp_events
group by athlete_id;
comment on view athlete_xp_totals is 'Leaderboard totals per athlete, derived from xp_events.';


-- ============================================================================
-- 11. COACH_SLOTS — bookable time slots. Coach publishes free slots;
--     an athlete books one by claiming it (athlete_id + status=booked).
-- ============================================================================
create table if not exists coach_slots (
  coach_id uuid not null,                           -- auth.users id of the coach
  slot_start timestamptz not null,
  slot_end timestamptz not null check (slot_end > slot_start),
  athlete_id uuid references athletes(id) on delete set null,
  status text not null default 'free'
    check (status in ('free','booked','done','cancelled')),
  primary key (coach_id, slot_start)
);
comment on table coach_slots is 'Coach availability slots. Athletes see free slots and can book their own.';


-- ============================================================================
-- 12. INDEXES — all FKs + hot query paths
-- ============================================================================
create index if not exists idx_qr_athlete          on questionnaire_responses(athlete_id);
create index if not exists idx_qr_athlete_created  on questionnaire_responses(athlete_id, created_at);
create index if not exists idx_programs_athlete         on programs(athlete_id);
create index if not exists idx_programs_athlete_created on programs(athlete_id, created_at);
create index if not exists idx_programs_status          on programs(status);
create index if not exists idx_items_program   on program_items(program_id);
create index if not exists idx_items_exercise  on program_items(exercise_id);
create index if not exists idx_alt_exercise     on exercise_alternatives(exercise_id);
create index if not exists idx_alt_alt          on exercise_alternatives(alt_exercise_id);
create index if not exists idx_feedback_program on program_feedback(program_id);
create index if not exists idx_xp_athlete         on xp_events(athlete_id);
create index if not exists idx_xp_athlete_created on xp_events(athlete_id, created_at);
create index if not exists idx_slots_athlete  on coach_slots(athlete_id);
create index if not exists idx_exercises_active on exercises(is_active);


-- ============================================================================
-- 13. ROW LEVEL SECURITY
--    Rule of thumb: coach (role in user_roles as coach/admin) sees and
--    manages everything. Athletes see ONLY their own rows — and never
--    review_queue or program_feedback (no policies = no access).
--    Athletes read only approved/active programs (drafts stay hidden until
--    the coach approves) and only is_active exercises.
-- ============================================================================
alter table user_roles              enable row level security;
alter table athletes                enable row level security;
alter table questionnaire_responses enable row level security;
alter table programs                enable row level security;
alter table program_items           enable row level security;
alter table review_queue            enable row level security;
alter table program_feedback        enable row level security;
alter table xp_events               enable row level security;
alter table exercises               enable row level security;
alter table exercise_alternatives   enable row level security;
alter table coach_slots             enable row level security;

-- ---- user_roles: users can read their OWN role row only.
--      (No coach-wide policy here: a policy querying user_roles would recurse.)
drop policy if exists pol_user_roles_self_read on user_roles;
create policy pol_user_roles_self_read on user_roles
  for select using (user_id = auth.uid());

-- ---- athletes
drop policy if exists pol_athletes_coach_all on athletes;
create policy pol_athletes_coach_all on athletes
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));
drop policy if exists pol_athletes_self_read on athletes;
create policy pol_athletes_self_read on athletes
  for select using (user_id = auth.uid());

-- ---- questionnaire_responses
drop policy if exists pol_qr_coach_all on questionnaire_responses;
create policy pol_qr_coach_all on questionnaire_responses
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));
drop policy if exists pol_qr_self_read on questionnaire_responses;
create policy pol_qr_self_read on questionnaire_responses
  for select using (
    exists (select 1 from athletes a where a.id = questionnaire_responses.athlete_id and a.user_id = auth.uid())
  );
drop policy if exists pol_qr_self_insert on questionnaire_responses;
create policy pol_qr_self_insert on questionnaire_responses
  for insert with check (
    exists (select 1 from athletes a where a.id = questionnaire_responses.athlete_id and a.user_id = auth.uid())
  );

-- ---- programs (athletes read only their own APPROVED/ACTIVE programs)
drop policy if exists pol_programs_coach_all on programs;
create policy pol_programs_coach_all on programs
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));
drop policy if exists pol_programs_self_read on programs;
create policy pol_programs_self_read on programs
  for select using (
    status in ('approved','active')
    and exists (select 1 from athletes a where a.id = programs.athlete_id and a.user_id = auth.uid())
  );

-- ---- program_items (athletes read items of their own approved/active programs)
drop policy if exists pol_items_coach_all on program_items;
create policy pol_items_coach_all on program_items
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));
drop policy if exists pol_items_self_read on program_items;
create policy pol_items_self_read on program_items
  for select using (
    exists (
      select 1 from programs p
      join athletes a on a.id = p.athlete_id
      where p.id = program_items.program_id
        and p.status in ('approved','active')
        and a.user_id = auth.uid()
    )
  );

-- ---- review_queue: COACH ONLY. No athlete policies (deny by default).
drop policy if exists pol_review_coach_all on review_queue;
create policy pol_review_coach_all on review_queue
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));

-- ---- program_feedback: COACH ONLY. No athlete policies (deny by default).
drop policy if exists pol_feedback_coach_all on program_feedback;
create policy pol_feedback_coach_all on program_feedback
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));

-- ---- xp_events
drop policy if exists pol_xp_coach_all on xp_events;
create policy pol_xp_coach_all on xp_events
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));
drop policy if exists pol_xp_self_read on xp_events;
create policy pol_xp_self_read on xp_events
  for select using (
    exists (select 1 from athletes a where a.id = xp_events.athlete_id and a.user_id = auth.uid())
  );
drop policy if exists pol_xp_self_insert on xp_events;
create policy pol_xp_self_insert on xp_events
  -- App records XP from the client (workout/padel session completions).
  -- Real anti-gaming validation belongs server-side (Edge Function / service_role);
  -- RLS alone cannot prove a workout happened.
  for insert with check (
    exists (select 1 from athletes a where a.id = xp_events.athlete_id and a.user_id = auth.uid())
  );

-- ---- exercises (athletes read only active ones)
drop policy if exists pol_exercises_coach_all on exercises;
create policy pol_exercises_coach_all on exercises
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));
drop policy if exists pol_exercises_self_read on exercises;
create policy pol_exercises_self_read on exercises
  for select using (is_active = true);

-- ---- exercise_alternatives (athletes may read the swap graph)
drop policy if exists pol_alt_coach_all on exercise_alternatives;
create policy pol_alt_coach_all on exercise_alternatives
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));
drop policy if exists pol_alt_self_read on exercise_alternatives;
create policy pol_alt_self_read on exercise_alternatives
  for select using (true);

-- ---- coach_slots (athletes see free slots + their own bookings; can book a free slot)
drop policy if exists pol_slots_coach_all on coach_slots;
create policy pol_slots_coach_all on coach_slots
  for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role in ('coach','admin')));
drop policy if exists pol_slots_self_read on coach_slots;
create policy pol_slots_self_read on coach_slots
  for select using (
    status = 'free'
    or exists (select 1 from athletes a where a.id = coach_slots.athlete_id and a.user_id = auth.uid())
  );
drop policy if exists pol_slots_self_book on coach_slots;
create policy pol_slots_self_book on coach_slots
  -- Booking = flipping a free slot to booked with your own athlete_id.
  for update
  using (status = 'free')
  with check (
    status = 'booked'
    and exists (select 1 from athletes a where a.id = coach_slots.athlete_id and a.user_id = auth.uid())
  );


-- ============================================================================
-- STEP 2 (run AFTER the schema, once Reza has signed up in the app):
-- Give Reza the coach role. Replace the UUID with his real auth.users id
-- (Supabase Dashboard -> Authentication -> Users -> copy his UUID).
-- ============================================================================
-- insert into user_roles (user_id, role)
-- values ('PASTE-REZA-AUTH-UUID-HERE', 'coach')
-- on conflict (user_id) do update set role = excluded.role;
