-- ============================================================================
-- COACHING APP — Challenger («هماورد» / Challenger) module migration (v3)
-- ============================================================================
-- HOW TO RUN:
--   1. Run supabase-schema.sql (v1) THEN supabase-multi-coach.sql (v2) FIRST.
--   2. Paste this ENTIRE file into the SAME project's SQL Editor and Run.
--      Fully idempotent: IF NOT EXISTS / DROP IF EXISTS guards everywhere.
--   3. Seed content (§7) attaches to coach slug 'reza' (coach #1). If Reza
--      hasn't run the v2 STEP 2 seed yet, the seeds are skipped silently —
--      just re-run this file after he does.
--
-- DO NOT run this in the PadelPro project (psgzisrzgddcvfkdlpyd).
--
-- WHAT CHANGES:
--   - NEW tables: challenges, challenge_participants,
--     challenge_quiz_questions, quiz_questions, quiz_options, quiz_attempts.
--   - Quiz answer keys are NEVER exposed to athletes:
--       * quiz_options_public view exposes options WITHOUT is_correct
--         (security_invoker: athletes only see options of challenges
--         they joined, via the base-table RLS).
--       * get_question_explanation() reveals the explanation + correct
--         answer ONLY after the athlete has submitted an attempt.
--       * grade_quiz_attempt() trigger computes is_correct server-side —
--         clients can never self-award.
--   - Challenge XP flows into the EXISTING xp_events ledger
--     (event_type = 'challenge_sport' / 'challenge_quiz') so the per-coach
--     leaderboard (athlete_xp_totals) picks it up automatically.
--     No parallel XP system (GOAL.md bug #4 lesson: ledger, not totals).
--   - Anti-cheat v1: honor system + coach verification flag
--     (verified_by_coach, guarded by trigger: athletes cannot flip it).
--     Better options (watch-data verification, photo proof) are documented
--     in the architecture doc §15 — future work, not this migration.
--
-- BILINGUAL (Reza 2026-10-20): every user-facing string has _fa and _en.
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS (same as v1/v2)
-- ============================================================================
create extension if not exists "pgcrypto";


-- ============================================================================
-- 1. CHALLENGES — a coach's challenges. Two types:
--    'sport'  = physical self-challenge (streak / PR / session count ...)
--    'quiz'   = knowledge challenge (multiple-choice + explanation)
--    Lifecycle: draft -> active -> completed (-> archived).
--    sport: free-text sport code matching the sport_modules registry
--      ('gym', 'padel', 'general', later 'swimming' ...) — intentionally NOT
--      a CHECK constraint, so a new sport needs no schema change.
-- ============================================================================
create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id) on delete cascade,
  slug text,                                            -- stable key for seeds; unique per coach
  title_fa text not null,
  title_en text not null,
  description_fa text not null default '',
  description_en text not null default '',
  challenge_type text not null check (challenge_type in ('sport','quiz')),
  sport text not null default 'general',
  status text not null default 'draft'
    check (status in ('draft','active','completed','archived')),
  xp_reward int not null default 0,                     -- headline XP bonus on completion
  rules jsonb not null default '{}',                    -- e.g. {"target_days":30,"xp_per_day":5}
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz not null default now(),
  unique (coach_id, slug)
);
comment on table challenges is 'Challenger («هماورد») module: coach-created self-challenges, sport + quiz.';
create index if not exists idx_challenges_coach  on challenges(coach_id);
create index if not exists idx_challenges_status on challenges(status);


-- ============================================================================
-- 2. CHALLENGE_PARTICIPANTS — athletes who joined a challenge.
--    progress: e.g. {"days_done":12,"target_days":30} or {"correct":7,"total":10}.
--    verified_by_coach: v1 anti-cheat — ONLY the coach (or admin) can flip
--    it (enforced by trigger trg_guard_verification, not just app code).
-- ============================================================================
create table if not exists challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  status text not null default 'joined'
    check (status in ('joined','completed','failed')),
  progress jsonb not null default '{}',
  verified_by_coach boolean not null default false,
  verified_at timestamptz,
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (challenge_id, athlete_id)
);
comment on table challenge_participants is 'Athlete enrolment + progress per challenge. verified_by_coach is coach-only (trigger-guarded).';
create index if not exists idx_chpart_challenge on challenge_participants(challenge_id);
create index if not exists idx_chpart_athlete   on challenge_participants(athlete_id);


-- ============================================================================
-- 3. QUIZ_QUESTIONS — per-coach question bank (bilingual). The platform seed
--    bank is owned by coach #1 (Reza, slug 'reza'); other coaches "adopt"
--    questions app-side (INSERT..SELECT into their own coach_id) — tenancy
--    stays pure: quiz_questions.coach_id is NEVER null-shared.
--    explanation_fa/en = the coaching value, revealed only AFTER answering
--    (see get_question_explanation()).
-- ============================================================================
create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id) on delete cascade,
  slug text,                                            -- stable key for seeds; unique per coach
  sport text not null default 'general',               -- gym | padel | general (sport_modules codes)
  difficulty text not null default 'medium'
    check (difficulty in ('easy','medium','hard')),
  question_fa text not null,
  question_en text not null,
  explanation_fa text not null default '',
  explanation_en text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (coach_id, slug)
);
comment on table quiz_questions is 'Bilingual quiz bank, per coach. Explanations are the coaching value.';
create index if not exists idx_quizq_coach on quiz_questions(coach_id);
create index if not exists idx_quizq_sport on quiz_questions(sport);


-- ============================================================================
-- 4. QUIZ_OPTIONS — answer options. is_correct is NEVER exposed to athletes
--    (see quiz_options_public view + RLS below).
-- ============================================================================
create table if not exists quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references quiz_questions(id) on delete cascade,
  position int not null default 0,
  option_fa text not null,
  option_en text not null,
  is_correct boolean not null default false,
  unique (question_id, position)
);
comment on table quiz_options is 'Answer options. is_correct hidden from athletes (quiz_options_public view).';
create index if not exists idx_quizo_question on quiz_options(question_id);


-- ============================================================================
-- 5. CHALLENGE_QUIZ_QUESTIONS — which questions a quiz challenge uses, ordered.
-- ============================================================================
create table if not exists challenge_quiz_questions (
  challenge_id uuid not null references challenges(id) on delete cascade,
  question_id uuid not null references quiz_questions(id) on delete cascade,
  position int not null default 0,
  primary key (challenge_id, question_id)
);


-- ============================================================================
-- 6. QUIZ_ATTEMPTS — one attempt per athlete per question per challenge (v1).
--    is_correct is computed SERVER-SIDE by trigger (never trusted from client).
-- ============================================================================
create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  question_id uuid not null references quiz_questions(id) on delete cascade,
  selected_option_id uuid references quiz_options(id) on delete set null,
  is_correct boolean not null default false,           -- set by trigger, not client
  answered_at timestamptz not null default now(),
  unique (challenge_id, athlete_id, question_id)
);
comment on table quiz_attempts is 'Quiz answers. is_correct is server-graded (trigger).';
create index if not exists idx_quiza_challenge on quiz_attempts(challenge_id);
create index if not exists idx_quiza_athlete   on quiz_attempts(athlete_id);


-- ============================================================================
-- 7. SERVER-SIDE GRADING + VERIFICATION GUARD (triggers)
-- ============================================================================
create or replace function public.grade_quiz_attempt()
returns trigger
language plpgsql
as $$
declare v_correct boolean;
begin
  select qo.is_correct into v_correct
  from quiz_options qo
  where qo.id = new.selected_option_id;
  new.is_correct := coalesce(v_correct, false);
  return new;
end $$;
comment on function public.grade_quiz_attempt() is 'Grades quiz attempts server-side from quiz_options.is_correct.';

drop trigger if exists trg_grade_quiz_attempt on quiz_attempts;
create trigger trg_grade_quiz_attempt
  before insert on quiz_attempts
  for each row execute function public.grade_quiz_attempt();

create or replace function public.guard_participant_verification()
returns trigger
language plpgsql
as $$
begin
  if new.verified_by_coach is distinct from old.verified_by_coach
     and not (
       public.is_admin()
       or exists (
         select 1 from challenges c
         where c.id = new.challenge_id
           and c.coach_id = public.my_coach_id()
       )
     ) then
    raise exception 'only the coach can change verification';
  end if;
  return new;
end $$;
comment on function public.guard_participant_verification() is 'Athletes cannot flip verified_by_coach on their own rows.';

drop trigger if exists trg_guard_verification on challenge_participants;
create trigger trg_guard_verification
  before update on challenge_participants
  for each row execute function public.guard_participant_verification();


-- ============================================================================
-- 8. QUIZ_OPTIONS_PUBLIC — athlete-safe view (no is_correct column).
--    security_invoker: athletes only see options of challenges they joined
--    (enforced by the base-table RLS below).
-- ============================================================================
create or replace view quiz_options_public
with (security_invoker = true) as
select id, question_id, position, option_fa, option_en
from quiz_options;
comment on view quiz_options_public is 'Athlete-safe options: no is_correct. Base-table RLS still applies.';


-- ============================================================================
-- 9. GET_QUESTION_EXPLANATION — reveals explanation + correct answer ONLY
--    after the caller has submitted an attempt (SECURITY DEFINER, checks
--    quiz_attempts for auth.uid()). Coaches read the base table directly.
-- ============================================================================
create or replace function public.get_question_explanation(q uuid)
returns table (explanation_fa text, explanation_en text, correct_option_id uuid)
language sql
security definer
set search_path = public
as $$
  select qq.explanation_fa, qq.explanation_en,
         (select qo.id from quiz_options qo
          where qo.question_id = q and qo.is_correct
          limit 1)
  from quiz_questions qq
  where qq.id = q
    and exists (
      select 1 from quiz_attempts qa
      join athletes a on a.id = qa.athlete_id
      where qa.question_id = q
        and a.user_id = auth.uid()
    );
$$;
comment on function public.get_question_explanation(uuid) is 'Reveals explanation + correct answer only after the athlete answered.';


-- ============================================================================
-- 10. RLS — per-coach isolation (same discipline as v2: my_coach_id() /
--     is_admin() SECURITY DEFINER helpers; NULL-coach rows invisible to
--     coaches; athletes see only their own rows).
-- ============================================================================
alter table challenges                enable row level security;
alter table challenge_participants    enable row level security;
alter table challenge_quiz_questions  enable row level security;
alter table quiz_questions            enable row level security;
alter table quiz_options              enable row level security;
alter table quiz_attempts             enable row level security;

-- ---- challenges: coach scoped (all ops)
drop policy if exists pol3_challenges_coach_scoped on challenges;
create policy pol3_challenges_coach_scoped on challenges
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());

-- ---- challenges: athletes read ACTIVE challenges of their own coach
drop policy if exists pol3_challenges_athlete_read on challenges;
create policy pol3_challenges_athlete_read on challenges
  for select
  using (
    status = 'active'
    and exists (
      select 1 from athletes a
      where a.user_id = auth.uid()
        and a.coach_id = challenges.coach_id
    )
  );

-- ---- challenges: public (anon) reads ACTIVE challenges of active coaches
--        (showcase on the /c/{slug} landing — same spirit as public coach
--        profiles in v2).
drop policy if exists pol3_challenges_public_read on challenges;
create policy pol3_challenges_public_read on challenges
  for select to anon
  using (
    status = 'active'
    and exists (
      select 1 from coaches c
      where c.id = challenges.coach_id and c.is_active
    )
  );

-- ---- challenge_participants: coach scoped (all ops)
drop policy if exists pol3_chpart_coach_scoped on challenge_participants;
create policy pol3_chpart_coach_scoped on challenge_participants
  for all
  using (
    public.is_admin()
    or exists (
      select 1 from challenges c
      where c.id = challenge_participants.challenge_id
        and c.coach_id = public.my_coach_id()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from challenges c
      where c.id = challenge_participants.challenge_id
        and c.coach_id = public.my_coach_id()
    )
  );

-- ---- challenge_participants: athletes manage their OWN rows
--        (verified_by_coach flips are blocked by trigger, not RLS)
drop policy if exists pol3_chpart_athlete_own on challenge_participants;
create policy pol3_chpart_athlete_own on challenge_participants
  for all
  using (
    exists (
      select 1 from athletes a
      where a.id = challenge_participants.athlete_id
        and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from athletes a
      where a.id = challenge_participants.athlete_id
        and a.user_id = auth.uid()
    )
  );

-- ---- challenge_quiz_questions: coach scoped (all ops)
drop policy if exists pol3_chqq_coach_scoped on challenge_quiz_questions;
create policy pol3_chqq_coach_scoped on challenge_quiz_questions
  for all
  using (
    public.is_admin()
    or exists (
      select 1 from challenges c
      where c.id = challenge_quiz_questions.challenge_id
        and c.coach_id = public.my_coach_id()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from challenges c
      where c.id = challenge_quiz_questions.challenge_id
        and c.coach_id = public.my_coach_id()
    )
  );

-- ---- challenge_quiz_questions: athletes read the question list of
--        challenges they joined (options come via quiz_options_public)
drop policy if exists pol3_chqq_athlete_joined on challenge_quiz_questions;
create policy pol3_chqq_athlete_joined on challenge_quiz_questions
  for select
  using (
    exists (
      select 1 from challenge_participants cp
      join athletes a on a.id = cp.athlete_id
      where cp.challenge_id = challenge_quiz_questions.challenge_id
        and a.user_id = auth.uid()
    )
  );

-- ---- quiz_questions: coach scoped (all ops)
drop policy if exists pol3_quizq_coach_scoped on quiz_questions;
create policy pol3_quizq_coach_scoped on quiz_questions
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());

-- ---- quiz_questions: athletes read questions of THEIR coach's challenges
--        they joined (same-tenant enforced via the challenge's coach_id)
drop policy if exists pol3_quizq_athlete_joined on quiz_questions;
create policy pol3_quizq_athlete_joined on quiz_questions
  for select
  using (
    exists (
      select 1 from challenge_quiz_questions cqq
      join challenges c on c.id = cqq.challenge_id
      join challenge_participants cp on cp.challenge_id = c.id
      join athletes a on a.id = cp.athlete_id
      where cqq.question_id = quiz_questions.id
        and a.user_id = auth.uid()
        and c.coach_id = a.coach_id
    )
  );

-- ---- quiz_options: coach scoped (all ops, incl. is_correct)
drop policy if exists pol3_quizo_coach_scoped on quiz_options;
create policy pol3_quizo_coach_scoped on quiz_options
  for all
  using (
    public.is_admin()
    or exists (
      select 1 from quiz_questions qq
      where qq.id = quiz_options.question_id
        and qq.coach_id = public.my_coach_id()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from quiz_questions qq
      where qq.id = quiz_options.question_id
        and qq.coach_id = public.my_coach_id()
    )
  );

-- ---- quiz_options: athletes may SELECT options of their joined challenges
--        (they NEVER see is_correct — they must go through the
--        quiz_options_public view, which hides that column).
drop policy if exists pol3_quizo_athlete_joined on quiz_options;
create policy pol3_quizo_athlete_joined on quiz_options
  for select
  using (
    exists (
      select 1 from challenge_quiz_questions cqq
      join challenges c on c.id = cqq.challenge_id
      join challenge_participants cp on cp.challenge_id = c.id
      join athletes a on a.id = cp.athlete_id
      where cqq.question_id = quiz_options.question_id
        and a.user_id = auth.uid()
        and c.coach_id = a.coach_id
    )
  );

-- ---- quiz_attempts: coach scoped via the challenge (all ops)
drop policy if exists pol3_quiza_coach_scoped on quiz_attempts;
create policy pol3_quiza_coach_scoped on quiz_attempts
  for all
  using (
    public.is_admin()
    or exists (
      select 1 from challenges c
      where c.id = quiz_attempts.challenge_id
        and c.coach_id = public.my_coach_id()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from challenges c
      where c.id = quiz_attempts.challenge_id
        and c.coach_id = public.my_coach_id()
    )
  );

-- ---- quiz_attempts: athletes read their own attempts
drop policy if exists pol3_quiza_athlete_read on quiz_attempts;
create policy pol3_quiza_athlete_read on quiz_attempts
  for select
  using (
    exists (
      select 1 from athletes a
      where a.id = quiz_attempts.athlete_id
        and a.user_id = auth.uid()
    )
  );

-- ---- quiz_attempts: athletes INSERT their own attempts, only on ACTIVE
--        challenges and only for questions that belong to that challenge.
--        (is_correct is graded by trigger — never trusted from the client.)
drop policy if exists pol3_quiza_athlete_insert on quiz_attempts;
create policy pol3_quiza_athlete_insert on quiz_attempts
  for insert
  with check (
    exists (
      select 1 from athletes a
      where a.id = quiz_attempts.athlete_id
        and a.user_id = auth.uid()
    )
    and exists (
      select 1 from challenges c
      where c.id = quiz_attempts.challenge_id
        and c.status = 'active'
    )
    and exists (
      select 1 from challenge_quiz_questions cqq
      where cqq.challenge_id = quiz_attempts.challenge_id
        and cqq.question_id = quiz_attempts.question_id
    )
  );


-- ============================================================================
-- 11. XP CONVENTION (app-level writes into the v1 xp_events ledger)
--     Challenge XP uses event_type 'challenge_sport' / 'challenge_quiz' and
--     meta = {"challenge_id": "<uuid>", "kind": "completion"|"milestone",
--              "participant_id": "<uuid>"}. The per-coach leaderboard
--     (athlete_xp_totals) picks it up with no extra work. No parallel XP
--     system. Suggested defaults (coach can override per challenge via
--     the rules jsonb):
--       quiz:     10 XP per correct answer + completion bonus (xp_reward)
--                 when score >= rules.passing_score
--       sport:    rules.xp_per_day (or per session) + xp_reward on completion
--                 once verified_by_coach = true
-- ============================================================================


-- ============================================================================
-- 12. SEED CONTENT — owned by coach #1 (slug 'reza'). Evidence-based only:
--     no pseudoscience, no supplement/medication protocols (Reza's doctrine).
--     Skipped silently if coach 'reza' doesn't exist yet — re-run after the
--     v2 STEP 2 seed. Idempotent via (coach_id, slug) / (question_id,
--     position) conflicts.
-- ============================================================================

-- ---- 12a. Five sport challenges (هماورد ورزشی / Sport Challenger)
insert into challenges
  (coach_id, slug, title_fa, title_en, description_fa, description_en,
   challenge_type, sport, status, xp_reward, rules)
select c.id, 'streak-30',
  'رگبار ۳۰ روزه', '30-Day Training Streak',
  '۳۰ روز پشت سر هم تمرین کن و رگبارت را نگه دار. هر روز تمرین = ۵ امتیاز.',
  'Train 30 days in a row and keep the streak alive. Each training day = 5 XP.',
  'sport', 'gym', 'active', 150,
  '{"target_days": 30, "xp_per_day": 5, "completion_bonus": 150}'::jsonb
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into challenges
  (coach_id, slug, title_fa, title_en, description_fa, description_en,
   challenge_type, sport, status, xp_reward, rules)
select c.id, 'squat-pr',
  'رکورد شخصی اسکوات', 'Squat Personal Record',
  'رکورد یک‌تکراری (1RM) اسکواتت را با فرم صحیح بشکن. ثبت ویدیو برای تأیید مربی.',
  'Break your one-rep-max (1RM) squat with correct form. Video log for coach verification.',
  'sport', 'gym', 'active', 100,
  '{"kind": "pr_attempt", "xp_reward": 100, "requires_video": true}'::jsonb
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into challenges
  (coach_id, slug, title_fa, title_en, description_fa, description_en,
   challenge_type, sport, status, xp_reward, rules)
select c.id, 'steps-10k-14',
  '۱۴ روز، روزی ۱۰ هزار قدم', '14 Days of 10K Steps',
  '۱۴ روز پیاپی حداقل ۱۰٬۰۰۰ قدم در روز. NEAT بالا = ریکاوری و چربی‌سوزی بهتر.',
  'At least 10,000 steps a day for 14 days straight. Higher NEAT = better recovery and fat loss.',
  'sport', 'general', 'active', 80,
  '{"target_days": 14, "daily_goal_steps": 10000, "xp_per_day": 5, "completion_bonus": 80}'::jsonb
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into challenges
  (coach_id, slug, title_fa, title_en, description_fa, description_en,
   challenge_type, sport, status, xp_reward, rules)
select c.id, 'plank-3min',
  'پلانک ۳ دقیقه‌ای', '3-Minute Plank Hold',
  'یک پلانک ممتد ۳ دقیقه‌ای با فرم صحیح (بدن صاف، شکم سفت).',
  'One continuous 3-minute plank with correct form (straight body, braced core).',
  'sport', 'gym', 'active', 60,
  '{"kind": "hold", "target_seconds": 180, "xp_reward": 60}'::jsonb
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into challenges
  (coach_id, slug, title_fa, title_en, description_fa, description_en,
   challenge_type, sport, status, xp_reward, rules)
select c.id, 'padel-20',
  '۲۰ جلسه پدل در ۲ ماه', '20 Padel Sessions in 2 Months',
  'در ۶۰ روز، ۲۰ جلسه پدل (هر جلسه ۱ ساعت) بازی کن. تداوم، مهارت می‌سازد.',
  'Play 20 padel sessions (1 hour each) within 60 days. Consistency builds skill.',
  'sport', 'padel', 'active', 120,
  '{"target_sessions": 20, "window_days": 60, "xp_per_session": 5, "completion_bonus": 120}'::jsonb
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- ---- 12b. Ten quiz questions (5 gym/nutrition + 5 padel), bilingual,
--        evidence-based. Explanations = the coaching value.
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-protein-total', 'gym', 'medium',
  'برای عضله‌سازی، مهم‌ترین عامل تغذیه‌ای کدام است؟',
  'For muscle building, what matters most nutritionally?',
  'پژوهش‌ها نشان می‌دهند مجموع پروتئین دریافتی در کل روز (حدود ۱٫۶ تا ۲٫۲ گرم به‌ازای هر کیلوگرم وزن بدن) عامل اصلی رشد عضله است — نه دقیقه‌ی دقیق مصرف بعد از تمرین.',
  'Research shows total daily protein intake (~1.6–2.2 g per kg of body weight) is the main driver of muscle growth — not the exact minute you eat after training.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-progressive-overload', 'gym', 'easy',
  'اصل «اضافه‌بار تدریجی» یعنی چه؟',
  'What does "progressive overload" mean?',
  'عضله وقتی رشد می‌کند که به‌تدریج با فشار بیشتری مواجه شود: وزنه‌ی سنگین‌تر، تکرار بیشتر یا حجم بالاتر در طول هفته‌ها.',
  'Muscles grow when progressively exposed to more stress: heavier weight, more reps, or higher volume over the weeks.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-sleep', 'gym', 'easy',
  'کمبود خواب چه اثری بر ریکاوری دارد؟',
  'How does lack of sleep affect recovery?',
  'خواب ۷ تا ۹ ساعت برای ترشح هورمون رشد و بازسازی عضله ضروری است؛ کم‌خوابی مزمن قدرت و تمرکز را هم کم می‌کند.',
  '7–9 hours of sleep are essential for growth-hormone release and muscle repair; chronic short sleep also reduces strength and focus.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-compound', 'gym', 'medium',
  'مزیت اصلی حرکات چندمفصلی (کامپاند) چیست؟',
  'What is the main advantage of compound movements?',
  'حرکاتی مثل اسکوات، ددلیفت و پرس سینه هم‌زمان چند گروه عضلانی را درگیر می‌کنند؛ برای همین پایه‌ی برنامه‌های قدرتی‌اند و بازده بالایی دارند.',
  'Moves like the squat, deadlift and bench press engage several muscle groups at once — that is why they anchor strength programs and are so efficient.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-hydration', 'gym', 'easy',
  'کم‌آبی بدن از چه حدی عملکرد ورزشی را مختل می‌کند؟',
  'From what point does dehydration impair athletic performance?',
  'از دست دادن حدود ۲٪ وزن بدن به‌صورت آب، تمرکز، استقامت و قدرت را کم می‌کند؛ پس در تمرین آب بنوشید و منتظر تشنگی نمانید.',
  'Losing about 2% of body weight as water reduces focus, endurance and strength — so drink during training instead of waiting to feel thirsty.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-padel-serve', 'padel', 'easy',
  'سرویس در پدل چگونه زده می‌شود؟',
  'How is the serve hit in padel?',
  'سرویس باید از پایین (زیر کمر) زده شود و توپ ابتدا یک‌بار به زمین بخورد؛ سرویس از بالا خطاست.',
  'The serve must be underhand (below the waist) after the ball bounces once; an overhand serve is a fault.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-padel-walls', 'padel', 'medium',
  'دیوارهای شیشه‌ای چه زمانی در بازی‌اند؟',
  'When are the glass walls in play?',
  'توپ ابتدا باید یک‌بار به زمین بخورد؛ بعد از آن برخورد به دیوار (شیشه یا توری) بازی را ادامه می‌دهد و توپ همچنان زنده است.',
  'The ball must bounce on the ground first; after that, hitting the wall (glass or mesh) keeps the rally alive.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-padel-scoring', 'padel', 'easy',
  'شمارش امتیاز در هر گیم پدل چگونه است؟',
  'How is scoring counted within a padel game?',
  'مثل تنیس: ۱۵، ۳۰، ۴۰ و گیم؛ در تساوی ۴۰-۴۰ (دیوس) در بسیاری از تورنمنت‌ها «گلدن پوینت» اعمال می‌شود.',
  'Like tennis: 15, 30, 40 and game; at 40-40 (deuce) many tournaments use a "golden point".'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-padel-double-bounce', 'padel', 'easy',
  'اگر توپ دو بار در زمین شما به زمین بخورد چه می‌شود؟',
  'What happens if the ball bounces twice on your side?',
  'امتیاز به حریف می‌رسد؛ هر تیم فقط یک‌بار حق دارد بگذارد توپ به زمین بخورد و بعد باید آن را برگرداند.',
  'The point goes to your opponents; each side may let the ball bounce only once before returning it.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-padel-let-serve', 'padel', 'medium',
  'اگر سرویس به تور بخورد ولی در باکس سرویس حریف بیفتد؟',
  'If the serve hits the net cord but lands in the service box?',
  '«لت» است و سرویس تکرار می‌شود؛ اگر در باکس نیفتد، خطا محسوب می‌شود.',
  'It is a "let" and the serve is replayed; if it does not land in the box, it is a fault.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- ---- 12c. Options: 4 per question, exactly one correct (position 3).
--        Template per question: options 0..2 distractors, option 3 correct.
--        (Positions are display order; the app should shuffle per attempt.)

-- q-protein-total
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'خوردن پروتئین دقیقاً تا ۳۰ دقیقه بعد از تمرین', 'Eating protein within exactly 30 minutes after training', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-protein-total'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'حذف کامل چربی از رژیم', 'Cutting all fat from the diet', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-protein-total'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'تمرین ناشتا هر روز', 'Training fasted every day', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-protein-total'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'دریافت کافی پروتئین در مجموع کل روز', 'Sufficient total protein intake across the whole day', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-protein-total'
on conflict (question_id, position) do nothing;

-- q-progressive-overload
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'هر جلسه همان وزنه و تکرار قبلی', 'Same weight and reps every session', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-progressive-overload'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'تمرین فقط یک عضله در ماه', 'Training only one muscle per month', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-progressive-overload'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'استراحت کامل بین هر ست به مدت یک ساعت', 'One full hour of rest between sets', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-progressive-overload'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'افزایش تدریجی فشار تمرین در طول زمان', 'Gradually increasing training stress over time', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-progressive-overload'
on conflict (question_id, position) do nothing;

-- q-sleep
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'اثری ندارد؛ فقط اراده مهم است', 'No effect; only willpower matters', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-sleep'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'فقط اشتها را زیاد می‌کند', 'It only increases appetite', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-sleep'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'باعث عضله‌سازی بیشتر می‌شود', 'It builds more muscle', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-sleep'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'ریکاوری، قدرت و تمرکز را مختل می‌کند', 'It impairs recovery, strength and focus', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-sleep'
on conflict (question_id, position) do nothing;

-- q-compound
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'فقط برای حرفه‌ای‌ها مناسب‌اند', 'They are only for professionals', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-compound'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'فقط یک مفصل را درگیر می‌کنند', 'They engage only one joint', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-compound'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'کالری کمتری می‌سوزانند', 'They burn fewer calories', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-compound'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'هم‌زمان چند گروه عضلانی را درگیر می‌کنند', 'They engage several muscle groups at once', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-compound'
on conflict (question_id, position) do nothing;

-- q-hydration
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'فقط در هوای گرم مهم است', 'It only matters in hot weather', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-hydration'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'تشنگی نشانه‌ی کافی بودن آب بدن است', 'Thirst means you are well hydrated', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-hydration'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'کم‌آبی هیچ اثری بر عملکرد ندارد', 'Dehydration does not affect performance', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-hydration'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'از دست دادن حدود ۲٪ وزن بدن به‌صورت آب', 'Losing about 2% of body weight as water', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-hydration'
on conflict (question_id, position) do nothing;

-- q-padel-serve
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'از بالا مثل تنیس', 'Overhand like tennis', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'بدون برخورد توپ به زمین، از پایین', 'Underhand without a bounce', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'با پرتاب توپ به هوا و ضربه والی', 'Tossing the ball up and volleying it', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'از پایین (زیر کمر) بعد از یک‌بار برخورد توپ به زمین', 'Underhand (below the waist) after the ball bounces once', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-serve'
on conflict (question_id, position) do nothing;

-- q-padel-walls
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'دیوارها هیچ‌وقت در بازی نیستند', 'The walls are never in play', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-walls'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'فقط قبل از برخورد توپ به زمین', 'Only before the ball bounces', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-walls'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'فقط در سرویس', 'Only on the serve', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-walls'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'بعد از اولین برخورد توپ به زمین، بازی ادامه دارد', 'After the ball’s first bounce, the rally continues off the wall', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-walls'
on conflict (question_id, position) do nothing;

-- q-padel-scoring
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, '۱، ۲، ۳ مثل بسکتبال', '1, 2, 3 like basketball', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-scoring'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'هر امتیاز یک گیم است', 'Each point is a game', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-scoring'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'فقط برنده و بازنده دارد، شمارش ندارد', 'No counting, just winner and loser', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-scoring'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'مثل تنیس: ۱۵، ۳۰، ۴۰', 'Like tennis: 15, 30, 40', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-scoring'
on conflict (question_id, position) do nothing;

-- q-padel-double-bounce
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'بازی ادامه پیدا می‌کند', 'The rally continues', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-double-bounce'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'امتیاز تکرار می‌شود', 'The point is replayed', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-double-bounce'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'اخطار می‌گیرید', 'You get a warning', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-double-bounce'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'امتیاز به حریف می‌رسد', 'The point goes to the opponents', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-double-bounce'
on conflict (question_id, position) do nothing;

-- q-padel-let-serve
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'خطاست و امتیاز به حریف می‌رسد', 'It is a fault and the point is lost', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-let-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'بازی ادامه پیدا می‌کند', 'Play continues', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-let-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'سرویس بعدی از دست می‌رود', 'You lose your second serve', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-let-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'لت است و سرویس تکرار می‌شود', 'It is a let and the serve is replayed', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-let-serve'
on conflict (question_id, position) do nothing;

-- ---- 12d. Two quiz challenges wiring the seed questions (bonus: makes the
--        seed bank immediately usable).
insert into challenges
  (coach_id, slug, title_fa, title_en, description_fa, description_en,
   challenge_type, sport, status, xp_reward, rules)
select c.id, 'quiz-gym-knowledge',
  'کوییز دانش بدنسازی', 'Gym Knowledge Quiz',
  '۵ سؤال درباره‌ی اصول تمرین و تغذیه. بعد از هر پاسخ، توضیح علمی‌اش را می‌بینی — همین توضیح، ارزش مربیگری کوییز است.',
  '5 questions on training and nutrition principles. After each answer you see the scientific explanation — that explanation is the coaching value of the quiz.',
  'quiz', 'gym', 'active', 50,
  '{"xp_per_correct": 10, "passing_score": 4, "completion_bonus": 50}'::jsonb
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

insert into challenges
  (coach_id, slug, title_fa, title_en, description_fa, description_en,
   challenge_type, sport, status, xp_reward, rules)
select c.id, 'quiz-padel-rules',
  'کوییز قوانین پدل', 'Padel Rules Quiz',
  '۵ سؤال درباره‌ی قوانین پدل. دانستن قوانین، بخشی از «دانش» یک بازیکن خوب است.',
  '5 questions on padel rules. Knowing the rules is part of what makes a good player "knowledgeable".',
  'quiz', 'padel', 'active', 50,
  '{"xp_per_correct": 10, "passing_score": 4, "completion_bonus": 50}'::jsonb
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- link gym questions (positions 0..4)
insert into challenge_quiz_questions (challenge_id, question_id, position)
select ch.id, qq.id, pos.p
from coaches c
join challenges ch on ch.coach_id = c.id and ch.slug = 'quiz-gym-knowledge'
join quiz_questions qq on qq.coach_id = c.id
join (values ('q-protein-total',0),('q-progressive-overload',1),('q-sleep',2),('q-compound',3),('q-hydration',4)) as pos(slug,p)
  on qq.slug = pos.slug
where c.slug = 'reza'
on conflict do nothing;

-- link padel questions (positions 0..4)
insert into challenge_quiz_questions (challenge_id, question_id, position)
select ch.id, qq.id, pos.p
from coaches c
join challenges ch on ch.coach_id = c.id and ch.slug = 'quiz-padel-rules'
join quiz_questions qq on qq.coach_id = c.id
join (values ('q-padel-serve',0),('q-padel-walls',1),('q-padel-scoring',2),('q-padel-double-bounce',3),('q-padel-let-serve',4)) as pos(slug,p)
  on qq.slug = pos.slug
where c.slug = 'reza'
on conflict do nothing;


-- ============================================================================
-- END OF v3 — Challenger («هماورد») module.
-- Run order: v1 (supabase-schema.sql) -> v2 (supabase-multi-coach.sql) ->
--            v3 (this file). All idempotent; re-running is safe.
-- ============================================================================
