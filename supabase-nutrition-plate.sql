-- ============================================================================
-- «مربی من» (My Coach) — «بشقاب روزانه» (Daily Plate) nutrition (v8)
-- File: supabase-nutrition-plate.sql
--
-- RUN ORDER: after supabase-questionnaire-submit.sql (v7). IDEMPOTENT — safe
-- to re-run. Reza runs this in the Supabase SQL Editor of the morabi-man
-- project.
--
-- WHAT THIS FILE DOES (additive only — no v1–v7 object is weakened):
--   1. Extends the existing v5 nutrition_targets table with two jsonb
--      columns: food_items (the coach's per-athlete food program —
--      [{key,label_fa,label_en,unit,target}]) and prescriptions
--      (doctor-prescribed supplement NAMES ONLY — [{name_fa,name_en}];
--      ⛔ medication boundary: the app never stores or suggests supplement
--      DOSAGES; that lane belongs to a doctor/pharmacist, enforced by
--      convention — there is no dosage field anywhere).
--   2. Creates nutrition_logs: the trainee's per-day plate log
--      (items [{key,amount,over}], score 0–100). UNIQUE (athlete_id,
--      log_date) — one log per athlete per day; the client upserts.
--   3. RLS on nutrition_logs mirroring the v5 water_logs discipline:
--      coach (own athletes) FOR ALL + athlete (own rows) FOR ALL.
--   4. Explicit GRANTs for the new table IN THIS FILE (Supabase rule:
--      from Oct 30, 2026, new public-schema tables need explicit GRANTs in
--      the same migration; existing tables keep their grants).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. nutrition_targets — add food program + prescription columns.
-- ----------------------------------------------------------------------------
alter table nutrition_targets
  add column if not exists food_items jsonb not null default '[]'::jsonb;
comment on column nutrition_targets.food_items is
  'Coach-set daily food program: [{key,label_fa,label_en,unit(g|pcs|cup|ml),target}]. v8 «بشقاب روزانه».';

alter table nutrition_targets
  add column if not exists prescriptions jsonb not null default '[]'::jsonb;
comment on column nutrition_targets.prescriptions is
  'Doctor-prescribed supplement NAMES ONLY: [{name_fa,name_en}]. No dosages — medication boundary (doctor/pharmacist only).';


-- ----------------------------------------------------------------------------
-- 2. nutrition_logs — trainee daily plate log.
-- ----------------------------------------------------------------------------
create table if not exists nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  log_date date not null,
  items jsonb not null default '[]'::jsonb,
  score int not null default 0 check (score >= 0 and score <= 100),
  created_at timestamptz not null default now(),
  unique (athlete_id, log_date)
);
comment on table nutrition_logs is
  'Trainee daily «بشقاب روزانه» log (v8). items: [{key,amount,over}] — over=true when logged > target; the coach sees an over-eating flag.';
create index if not exists idx_nutrition_logs_athlete_date on nutrition_logs(athlete_id, log_date desc);
comment on column nutrition_logs.items is
  'Logged amounts per food item key: [{key, amount, over}]. over = amount exceeded the coach target.';
comment on column nutrition_logs.score is
  'Daily completion score 0–100 (avg of min(amount/target,1) over program items).';


-- ----------------------------------------------------------------------------
-- 3. RLS — nutrition_logs: coach (own athletes) + athlete (own rows).
--    Same discipline as v5 water_logs.
-- ----------------------------------------------------------------------------
alter table nutrition_logs enable row level security;

drop policy if exists pol8_nutrition_logs_coach on nutrition_logs;
create policy pol8_nutrition_logs_coach on nutrition_logs
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
comment on policy pol8_nutrition_logs_coach on nutrition_logs is
  'Coach reads/writes logs of their own athletes (tenant isolation); admin bypass.';

drop policy if exists pol8_nutrition_logs_athlete_own on nutrition_logs;
create policy pol8_nutrition_logs_athlete_own on nutrition_logs
  for all
  using (exists (select 1 from athletes a
                 where a.id = nutrition_logs.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a
                      where a.id = nutrition_logs.athlete_id and a.user_id = auth.uid()));
comment on policy pol8_nutrition_logs_athlete_own on nutrition_logs is
  'Athlete reads/writes only their own daily logs.';


-- ----------------------------------------------------------------------------
-- 4. Explicit GRANTs (same migration — required for new tables).
--    RLS still governs; these only permit reaching the table through the
--    API roles.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on nutrition_logs to anon, authenticated, service_role;
