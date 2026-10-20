-- ============================================================================
-- COACHING APP — XP scoring + lifestyle data ingestion (v4)
-- ============================================================================
-- HOW TO RUN:
--   1. Run supabase-schema.sql (v1), supabase-multi-coach.sql (v2),
--      supabase-challenger.sql (v3) FIRST, in that order.
--   2. Paste this ENTIRE file into the SAME project's SQL Editor and Run.
--      Fully idempotent: IF NOT EXISTS / DROP IF EXISTS guards everywhere.
--
-- DO NOT run this in the PadelPro project (psgzisrzgddcvfkdlpyd).
--
-- WHAT CHANGES:
--   - xp_scoring_rules: GLOBAL default XP weights per event type.
--     Every number here is Reza's PROPOSAL STARTER — he tunes the finals.
--   - coach_xp_overrides: per-coach tuning of the same knobs.
--   - Ingestion tables (all with coach_id tenant discriminator + per-coach
--     RLS, same discipline as v2/v3):
--       activity_syncs  — watch data (Health Connect / HealthKit): steps,
--                          active kcal, exercise minutes, distance. One row
--                          per (athlete, date, source): re-syncs upsert.
--       sleep_logs      — sleep minutes + bed/wake (watch or manual).
--       meal_logs       — meal completeness: one row per
--                          (athlete, date, meal_type); upsert on re-log.
--       diet_adherence_weekly — coach's weekly 0-100% diet-adherence rating
--                          (مراعات) or auto-derived; XP = pct x 1.05.
--       workout_logs    — manual workout log; XP ONLY after
--                          verified_by_coach (trigger-guarded, like v3).
--       checkin_locations — coach's gym/court locations (QR codes are
--                          generated client-side from these rows).
--       qr_checkins     — athlete scan events (30-min cooldown per
--                          location is enforced app-side; DB caps backstop).
--   - Guard trigger on xp_events: daily/weekly CAPS enforced in the DB
--     (defense in depth — the app enforces them too). Negative XP rejected.
--   - athlete_xp_weekly: per-coach WEEKLY leaderboard view
--     (athlete_xp_totals stays the all-time board).
--   - NO second XP ledger: every lifestyle event writes into v1's
--     xp_events (new event_type codes, same table).
--
-- BILINGUAL (Reza 2026-10-20): every user-facing string has _fa and _en.
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS (same as v1/v2/v3)
-- ============================================================================
create extension if not exists "pgcrypto";


-- ============================================================================
-- 1. XP_SCORING_RULES — global default XP weights (Reza-tunable).
--    event_type codes are the contract between app and DB.
--    cap_per_day NULL = no cap. enabled=false = event type retired.
-- ============================================================================
create table if not exists xp_scoring_rules (
  event_type text primary key,
  name_fa text not null,
  name_en text not null,
  unit text not null,                 -- steps | minutes | kcal | checkin | session | meal | week | night
  xp_per_unit numeric,                -- NULL = app-computed (see notes)
  cap_per_day int,                    -- NULL = uncapped
  cap_period text not null default 'daily' check (cap_period in ('daily','weekly')),
  enabled boolean not null default true,
  notes text not null default ''
);
comment on table xp_scoring_rules is 'Global XP weight catalog. Athletes can READ (transparency); only admin writes. Per-coach tuning in coach_xp_overrides.';


-- ============================================================================
-- 2. COACH_XP_OVERRIDES — per-coach tuning of the same knobs.
-- ============================================================================
create table if not exists coach_xp_overrides (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id) on delete cascade,
  event_type text not null references xp_scoring_rules(event_type) on delete cascade,
  xp_per_unit numeric,
  cap_per_day int,                    -- NULL here = explicitly uncapped
  enabled boolean not null default true,
  unique (coach_id, event_type)
);
comment on table coach_xp_overrides is 'Per-coach XP tuning. Missing row = global default applies.';


-- ============================================================================
-- 3. ACTIVITY_SYNCS — passive watch data, one row per (athlete, date, source).
--    App upserts on every sync; XP is awarded by threshold-crossing
--    (see §16.5), NOT by this table directly.
-- ============================================================================
create table if not exists activity_syncs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  date date not null,
  source text not null check (source in ('health_connect','health_kit','manual')),
  steps int not null default 0,
  active_kcal int not null default 0,
  exercise_minutes int not null default 0,
  distance_m int not null default 0,
  raw jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  unique (athlete_id, date, source)
);
comment on table activity_syncs is 'Daily watch aggregates. Sanity limits enforced by constraint (absurd values rejected, not silently capped).';
create index if not exists idx_syncs_athlete_date on activity_syncs(athlete_id, date);

-- Sanity limits (idempotent): reject absurd values instead of trusting them.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_activity_syncs_sane') then
    alter table activity_syncs add constraint chk_activity_syncs_sane
      check (steps >= 0 and steps <= 100000
         and active_kcal >= 0 and active_kcal <= 5000
         and exercise_minutes >= 0 and exercise_minutes <= 720
         and distance_m >= 0 and distance_m <= 100000);
  end if;
end $$;


-- ============================================================================
-- 4. SLEEP_LOGS — one row per (athlete, date, source). Watch preferred;
--    manual bed/wake is allowed (honor system; cap still applies).
-- ============================================================================
create table if not exists sleep_logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  date date not null,                       -- the night's "sleep date" (wake-up day)
  sleep_minutes int not null,
  bedtime timestamptz,
  wake_time timestamptz,
  source text not null check (source in ('health_connect','health_kit','manual')),
  synced_at timestamptz not null default now(),
  unique (athlete_id, date, source)
);
comment on table sleep_logs is 'Night sleep. Scoring = duration + consistency (see architecture §16.4).';
create index if not exists idx_sleep_athlete_date on sleep_logs(athlete_id, date);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_sleep_logs_sane') then
    alter table sleep_logs add constraint chk_sleep_logs_sane
      check (sleep_minutes >= 0 and sleep_minutes <= 900);
  end if;
end $$;


-- ============================================================================
-- 5. MEAL_LOGS — meal COMPLETENESS (did they log?). One row per
--    (athlete, date, meal_type): re-logging upserts, so meal spam is
--    structurally impossible (max 4/day = 4 meal types).
-- ============================================================================
create table if not exists meal_logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  date date not null,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  description text not null default '',
  photo_url text,
  logged_at timestamptz not null default now(),
  unique (athlete_id, date, meal_type)
);
comment on table meal_logs is 'Meal-log completeness. XP per logged meal (cap 12/day emerges from the 4 meal types).';
create index if not exists idx_meals_athlete_date on meal_logs(athlete_id, date);


-- ============================================================================
-- 6. DIET_ADHERENCE_WEEKLY — PLAN COMPLIANCE (مراعات: did they stick to
--    the plan?). Coach's weekly 0-100% rating, or auto-derived from logs.
--    This is the "adherence" half; meal_logs is the "completeness" half.
-- ============================================================================
create table if not exists diet_adherence_weekly (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  week_start date not null,                 -- Monday of the rated week
  compliance_pct int not null check (compliance_pct between 0 and 100),
  method text not null default 'coach' check (method in ('coach','auto')),
  notes text not null default '',
  rated_at timestamptz not null default now(),
  unique (athlete_id, week_start)
);
comment on table diet_adherence_weekly is 'Weekly diet-adherence rating (0-100%). XP = pct x 1.05 (0-105/week). Coach-rated or auto.';
create index if not exists idx_adherence_athlete on diet_adherence_weekly(athlete_id);


-- ============================================================================
-- 7. WORKOUT_LOGS — manual workout log. XP ONLY after verified_by_coach
--    (trigger-guarded: athletes cannot flip it — same idiom as v3).
-- ============================================================================
create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  date date not null,
  workout_type text not null default 'gym',   -- gym | padel | run | other
  duration_min int not null check (duration_min > 0 and duration_min <= 300),
  notes text not null default '',
  verified_by_coach boolean not null default false,
  verified_at timestamptz,
  logged_at timestamptz not null default now()
);
comment on table workout_logs is 'Manual workout log. XP awarded only after verified_by_coach (trigger-guarded).';
create index if not exists idx_workouts_athlete_date on workout_logs(athlete_id, date);


-- ============================================================================
-- 8. CHECKIN_LOCATIONS + QR_CHECKINS — gym/court QR flow.
--    Coach registers locations; QR codes are generated CLIENT-SIDE from
--    these rows (no backend needed — same note as v2 §7). Athlete scans
--    in-app -> qr_checkins row -> app awards XP (30-min cooldown per
--    location enforced app-side; DB daily cap is the backstop).
-- ============================================================================
create table if not exists checkin_locations (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id) on delete cascade,
  code text not null,                       -- short code embedded in the QR
  name_fa text not null,
  name_en text not null,
  is_active boolean not null default true,
  unique (coach_id, code)
);
comment on table checkin_locations is 'Coach gym/court locations for QR check-in. QR encodes the code; generation is client-side.';

create table if not exists qr_checkins (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  location_code text not null,
  scanned_at timestamptz not null default now()
);
comment on table qr_checkins is 'Athlete QR scan events. Cooldown + caps enforced app-side; xp_events cap trigger is the backstop.';
create index if not exists idx_qr_athlete_scanned on qr_checkins(athlete_id, scanned_at);


-- ============================================================================
-- 9. XP CAP GUARD — trigger on xp_events (defense in depth).
--    The app enforces caps too; this makes double-award structurally
--    impossible even via direct API. Event types with no rule row
--    (v1 codes, challenge_* codes) pass through uncapped.
-- ============================================================================
create or replace function public.enforce_xp_caps()
returns trigger
language plpgsql
as $$
declare
  v_cap int;
  v_period text := 'daily';
  v_override int;
  v_coach uuid;
  v_start timestamptz;
  v_window interval;
  v_already int;
begin
  if NEW.xp < 0 then
    raise exception 'xp_events: negative xp not allowed (event_type=%)', NEW.event_type;
  end if;

  select r.cap_per_day, r.cap_period
    into v_cap, v_period
    from public.xp_scoring_rules r
   where r.event_type = NEW.event_type and r.enabled;

  if not found or v_cap is null then
    return NEW;  -- no cap configured for this event type
  end if;

  -- Per-coach override wins when a row exists (NULL override = explicitly uncapped).
  select a.coach_id into v_coach from public.athletes a where a.id = NEW.athlete_id;
  select o.cap_per_day into v_override
    from public.coach_xp_overrides o
   where o.coach_id = v_coach and o.event_type = NEW.event_type and o.enabled;
  if found then
    if v_override is null then return NEW; end if;
    v_cap := v_override;
  end if;

  if v_period = 'weekly' then
    v_start := date_trunc('week', NEW.created_at);
    v_window := interval '7 days';
  else
    v_start := date_trunc('day', NEW.created_at);
    v_window := interval '1 day';
  end if;

  select coalesce(sum(xp), 0)::int into v_already
    from public.xp_events
   where athlete_id = NEW.athlete_id
     and event_type = NEW.event_type
     and created_at >= v_start
     and created_at < v_start + v_window;

  if v_already + NEW.xp > v_cap then
    raise exception 'xp_events: cap exceeded for % (cap %, already %, new %)',
      NEW.event_type, v_cap, v_already, NEW.xp;
  end if;

  return NEW;
end;
$$;
comment on function public.enforce_xp_caps() is 'DB backstop: daily/weekly XP caps per event type (with per-coach overrides). App enforces too.';

drop trigger if exists trg_xp_caps on xp_events;
create trigger trg_xp_caps
  before insert on xp_events
  for each row execute function public.enforce_xp_caps();


-- ============================================================================
-- 10. WORKOUT VERIFICATION GUARD — athletes cannot flip verified_by_coach
--     on their own workout logs (same idiom as v3 guard_participant_verification).
-- ============================================================================
create or replace function public.guard_workout_verification()
returns trigger
language plpgsql
as $$
begin
  if new.verified_by_coach is distinct from old.verified_by_coach
     and not (
       public.is_admin()
       or new.coach_id = public.my_coach_id()
     ) then
    raise exception 'only the coach can change workout verification';
  end if;
  return new;
end;
$$;
comment on function public.guard_workout_verification() is 'Athletes cannot self-verify manual workouts.';

drop trigger if exists trg_guard_workout_verification on workout_logs;
create trigger trg_guard_workout_verification
  before update on workout_logs
  for each row execute function public.guard_workout_verification();


-- ============================================================================
-- 11. ATHLETE_XP_WEEKLY — per-coach WEEKLY leaderboard view.
--     security_invoker: inherits xp_events RLS (coach sees own athletes,
--     athlete sees own rows) — no extra policy needed.
-- ============================================================================
create or replace view athlete_xp_weekly
with (security_invoker = true) as
select
  a.coach_id,
  e.athlete_id,
  date_trunc('week', e.created_at)::date as week_start,
  coalesce(sum(e.xp), 0)::bigint as total_xp
from xp_events e
join athletes a on a.id = e.athlete_id
group by a.coach_id, e.athlete_id, date_trunc('week', e.created_at)::date;
comment on view athlete_xp_weekly is 'Weekly XP leaderboard, per coach (week starts Monday). All-time board stays athlete_xp_totals.';


-- ============================================================================
-- 12. RLS — same discipline as v2/v3: coach sees own tenant, athlete sees
--     own rows, NULL coach_id rows invisible to coaches, admin sees all.
-- ============================================================================

-- ---- xp_scoring_rules: public read (transparency: athletes see the game
--      rules); admin-only write.
alter table xp_scoring_rules enable row level security;
drop policy if exists pol4_rules_public_read on xp_scoring_rules;
create policy pol4_rules_public_read on xp_scoring_rules
  for select using (true);
drop policy if exists pol4_rules_admin_write on xp_scoring_rules;
create policy pol4_rules_admin_write on xp_scoring_rules
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---- coach_xp_overrides: coach manages own rows.
alter table coach_xp_overrides enable row level security;
drop policy if exists pol4_xpoverride_coach on coach_xp_overrides;
create policy pol4_xpoverride_coach on coach_xp_overrides
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());

-- ---- activity_syncs / sleep_logs / meal_logs / workout_logs:
--      coach scoped (all ops); athlete manages OWN rows.
alter table activity_syncs enable row level security;
drop policy if exists pol4_syncs_coach on activity_syncs;
create policy pol4_syncs_coach on activity_syncs
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol4_syncs_athlete_own on activity_syncs;
create policy pol4_syncs_athlete_own on activity_syncs
  for all
  using (exists (select 1 from athletes a where a.id = activity_syncs.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a where a.id = activity_syncs.athlete_id and a.user_id = auth.uid()));

alter table sleep_logs enable row level security;
drop policy if exists pol4_sleep_coach on sleep_logs;
create policy pol4_sleep_coach on sleep_logs
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol4_sleep_athlete_own on sleep_logs;
create policy pol4_sleep_athlete_own on sleep_logs
  for all
  using (exists (select 1 from athletes a where a.id = sleep_logs.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a where a.id = sleep_logs.athlete_id and a.user_id = auth.uid()));

alter table meal_logs enable row level security;
drop policy if exists pol4_meals_coach on meal_logs;
create policy pol4_meals_coach on meal_logs
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol4_meals_athlete_own on meal_logs;
create policy pol4_meals_athlete_own on meal_logs
  for all
  using (exists (select 1 from athletes a where a.id = meal_logs.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a where a.id = meal_logs.athlete_id and a.user_id = auth.uid()));

alter table workout_logs enable row level security;
drop policy if exists pol4_workouts_coach on workout_logs;
create policy pol4_workouts_coach on workout_logs
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol4_workouts_athlete_own on workout_logs;
create policy pol4_workouts_athlete_own on workout_logs
  for all
  using (exists (select 1 from athletes a where a.id = workout_logs.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a where a.id = workout_logs.athlete_id and a.user_id = auth.uid()));
-- (verified_by_coach flips are additionally trigger-guarded: §10.)

-- ---- diet_adherence_weekly: coach writes; athlete reads OWN only.
alter table diet_adherence_weekly enable row level security;
drop policy if exists pol4_adherence_coach on diet_adherence_weekly;
create policy pol4_adherence_coach on diet_adherence_weekly
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol4_adherence_athlete_read on diet_adherence_weekly;
create policy pol4_adherence_athlete_read on diet_adherence_weekly
  for select
  using (exists (select 1 from athletes a where a.id = diet_adherence_weekly.athlete_id and a.user_id = auth.uid()));

-- ---- checkin_locations: coach manages own; athletes of that coach read.
alter table checkin_locations enable row level security;
drop policy if exists pol4_locations_coach on checkin_locations;
create policy pol4_locations_coach on checkin_locations
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol4_locations_athlete_read on checkin_locations;
create policy pol4_locations_athlete_read on checkin_locations
  for select
  using (exists (
    select 1 from athletes a
    where a.user_id = auth.uid() and a.coach_id = checkin_locations.coach_id
  ));

-- ---- qr_checkins: coach reads own tenant; athlete inserts + reads own.
alter table qr_checkins enable row level security;
drop policy if exists pol4_qr_coach on qr_checkins;
create policy pol4_qr_coach on qr_checkins
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol4_qr_athlete_own on qr_checkins;
create policy pol4_qr_athlete_own on qr_checkins
  for all
  using (exists (select 1 from athletes a where a.id = qr_checkins.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a where a.id = qr_checkins.athlete_id and a.user_id = auth.uid()));


-- ============================================================================
-- 13. SEED — default XP weights (PROPOSAL STARTERS — Reza tunes finals).
--     Idempotent: on conflict do nothing.
-- ============================================================================
insert into xp_scoring_rules
  (event_type, name_fa, name_en, unit, xp_per_unit, cap_per_day, cap_period, enabled, notes)
values
  ('activity_steps',       'قدم روزانه',            'Daily steps',        'steps',   0.001, 15,  'daily',  true, '1 XP per 1,000 steps. Watch only.'),
  ('activity_exercise',    'دقایق تمرین',           'Exercise minutes',   'minutes', 0.1,   12,  'daily',  true, '1 XP per 10 min. Watch only.'),
  ('activity_calories',    'کالری فعال',            'Active calories',    'kcal',    0.01,  10,  'daily',  true, '1 XP per 100 kcal. Watch only.'),
  ('activity_qr_checkin',  'ورود با QR',            'QR check-in',        'checkin', 10,    20,  'daily',  true, '10 XP per scan. 30-min cooldown per location (app-side).'),
  ('activity_workout_log', 'ثبت تمرین دستی',        'Manual workout log', 'session', 10,    10,  'daily',  true, 'XP only after verified_by_coach = true.'),
  ('nutrition_meal_log',   'ثبت وعده غذایی',        'Meal log',           'meal',    3,     12,  'daily',  true, 'Completeness: 3 XP per logged meal (max 4 types/day).'),
  ('nutrition_adherence',  'مراعات برنامه غذایی',   'Diet adherence',     'week',    1.05,  105, 'weekly', true, 'Weekly 0-100% rating (coach or auto). XP = pct x 1.05.'),
  ('sleep_night',          'خواب شبانه',            'Night sleep',        'night',   NULL,  10,  'daily',  true, 'App-computed 0-10: duration + consistency (arch §16.4).')
on conflict (event_type) do nothing;


-- ============================================================================
-- DONE. Next: hand the raw.githubusercontent.com link of THIS file to Reza
-- (never a blob URL), after v1+v2+v3 are confirmed run.
-- ============================================================================
