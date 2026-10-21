-- ============================================================================
-- «مربی من» (My Coach) — COACH #1 ACTIVATION + CHALLENGER SEEDS (one file)
-- File: supabase-activate-reza.sql
--
-- RUN ONCE in the morabi-man project's SQL Editor (paste all -> Run).
-- Replaces: the v2 STEP 2 seed (needs no auth UUID) + re-running v3 +
-- supabase-challenger-quiz2.sql in full.
--
-- WHAT IT DOES:
--   §1  Activates Reza's own coach row (created in-app, slug 'rezagazi',
--       is_active=false) -> slug 'reza', is_active=true, capabilities
--       {gym,padel}, specialties set, display_name 'رضا گزی'. No auth
--       UUID needed: it finds the row by slug. Defensive: if a 'reza'
--       row already exists it activates THAT one; never errors on re-run.
--       Also ensures his 'coach' role in user_roles (belt-and-braces;
--       the insert trigger normally did this already).
--   §2  v2 §8 backfill: attaches any NULL-coach rows (athletes,
--       questionnaire_responses, programs, program_feedback) to Reza.
--   §3  v3 §12 seeds: 7 challenges + 10 quiz questions + 40 options +
--       question->challenge wiring, all owned by coach slug 'reza'.
--   §4  quiz2 seeds: 10 more questions + 40 options for coach 'reza'.
--
-- IDEMPOTENT: every seed uses ON CONFLICT guards; §1/§2 are no-ops on
-- re-run. Safe to run twice.
--
-- NOTE: two TEST rows exist on the live DB (test athlete + test coach,
-- marked test:true, from verification). §2 will attach any of them that
-- have NULL coach_id to Reza — delete them from the dashboard first if
-- they are still there.
-- ============================================================================


-- ============================================================================
-- §1. ACTIVATE coach #1 (Reza) — no auth UUID needed
-- ============================================================================
do $$
begin
  if exists (select 1 from coaches where slug = 'reza') then
    -- edge: a 'reza' row already exists -> activate and set fields on it
    update coaches
    set is_active   = true,
        display_name = 'رضا گزی',
        capabilities = array['gym','padel'],
        specialties  = array['بدنسازی','پدل','کاهش وزن','آمادگی مسابقه']
    where slug = 'reza';
  elsif exists (select 1 from coaches where slug = 'rezagazi') then
    -- normal case: his in-app row -> promote to slug 'reza' + activate
    update coaches
    set slug         = 'reza',
        is_active    = true,
        display_name = 'رضا گزی',
        bio          = coalesce(nullif(bio, ''),
                             'مربی بدنسازی و پدل — برنامه تمرینی و تغذیه زیر نظر مستقیم مربی'),
        capabilities = array['gym','padel'],
        specialties  = array['بدنسازی','پدل','کاهش وزن','آمادگی مسابقه']
    where slug = 'rezagazi';
  else
    raise notice 'activate-reza: no rezagazi/reza coach row found — Reza must sign up in the app first';
  end if;

  -- belt-and-braces: ensure the 'coach' role (the after-insert trigger
  -- normally granted this already; ON CONFLICT never downgrades admin)
  insert into user_roles (user_id, role)
  select user_id, 'coach' from coaches where slug = 'reza'
  on conflict (user_id) do nothing;
end $$;


-- ============================================================================
-- §2. v2 §8 BACKFILL — attach NULL-coach rows to coach #1
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
  end if;
end $$;


-- ============================================================================
-- §3. v3 §12 SEED CONTENT — challenges + quiz bank for coach 'reza'
--     (extracted verbatim from supabase-challenger.sql §12)
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
-- §4. quiz2 SEED — 10 more questions + 40 options for coach 'reza'
--     (extracted verbatim from supabase-challenger-quiz2.sql)
-- ============================================================================
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-rest-intervals', 'gym', 'medium',
  'برای تمرین قدرتی با وزنه‌های سنگین، استراحت بین ست‌ها بهتر است چقدر باشد؟',
  'For heavy strength training, how long should rest between sets be?',
  'پژوهش‌ها (از جمله متاآنالیزها) نشان می‌دهند استراحت ۲ تا ۵ دقیقه بین ست‌های سنگین، عملکرد هر ست و حجم کل تمرین را بهتر حفظ می‌کند؛ استراحت خیلی کوتاه، وزنه‌های ست‌های بعدی را افت می‌دهد.',
  'Research (including meta-analyses) shows 2–5 minutes of rest between heavy sets better preserves performance and total training volume; very short rests reduce the weight you can lift in later sets.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-rest-intervals options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, '۱۵ تا ۳۰ ثانیه', '15–30 seconds', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-rest-intervals'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'حداکثر ۱ دقیقه', 'At most 1 minute', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-rest-intervals'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, '۱۰ دقیقه یا بیشتر', '10 minutes or more', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-rest-intervals'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, '۲ تا ۵ دقیقه', '2–5 minutes', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-rest-intervals'
on conflict (question_id, position) do nothing;

-- ---- Q2 (gym, easy): specific warm-up -------------------------------------
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-warmup-specific', 'gym', 'easy',
  'بهترین شروع یک جلسه تمرین قدرتی چیست؟',
  'What is the best way to start a strength session?',
  'گرم‌کردنِ مخصوص همان حرکت (چند دقیقه فعالیت عمومی + ۱ تا ۲ ست سبک از حرکت اصلی) دمای عضله را بالا می‌برد، فرم را تمرین می‌دهد و طبق مرور پژوهش‌ها عملکرد را بهتر و ریسک آسیب را کمتر می‌کند.',
  'A movement-specific warm-up (a few minutes of general activity + 1–2 light sets of the main lift) raises muscle temperature, rehearses form, and per research reviews improves performance and lowers injury risk.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-warmup-specific options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'شروع مستقیم با سنگین‌ترین وزنه', 'Starting directly with the heaviest weight', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-warmup-specific'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'فقط کشش ایستا به مدت ۲۰ دقیقه', 'Only 20 minutes of static stretching', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-warmup-specific'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'نوشیدن قهوه و شروع تمرین', 'Drinking coffee and starting the workout', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-warmup-specific'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'چند دقیقه فعالیت عمومی + ۱ تا ۲ ست سبک از حرکت اصلی', 'A few minutes of general activity + 1–2 light sets of the main lift', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-warmup-specific'
on conflict (question_id, position) do nothing;

-- ---- Q3 (gym, medium): training to failure / RIR ---------------------------
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-effort-rir', 'gym', 'medium',
  'آیا برای رشد عضله باید هر ست را تا ناتوانی کامل (از کار افتادن) رفت؟',
  'Do you need to take every set to complete failure for muscle growth?',
  'نه. پژوهش‌ها نشان می‌دهند تمرین «نزدیکِ ناتوانی» (۱ تا ۳ تکرار مانده به ناتوانی) تقریباً به‌اندازه رفتن تا ناتوانی کامل عضله می‌سازد، ولی با خستگی و ریسک آسیب کمتر — پس می‌توانی حجم بیشتری را با کیفیت انجام دهی.',
  'No. Research shows training "close to failure" (1–3 reps in reserve) builds nearly as much muscle as going to full failure, but with less fatigue and injury risk — so you can handle more quality volume.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-effort-rir options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'بله، هر ست باید تا از کار افتادن کامل پیش برود', 'Yes, every set must go to complete failure', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-effort-rir'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'بله، وگرنه عضله اصلاً رشد نمی‌کند', 'Yes, otherwise muscles will not grow at all', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-effort-rir'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'فقط ست اول مهم است، بقیه مهم نیست', 'Only the first set matters, the rest do not', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-effort-rir'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'نه؛ نزدیک ناتوانی (۱ تا ۳ تکرار مانده) کافی است', 'No; close to failure (1–3 reps in reserve) is enough', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-effort-rir'
on conflict (question_id, position) do nothing;

-- ---- Q4 (general, easy): energy deficit drives fat loss [nutrition] --------
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-calorie-deficit', 'general', 'easy',
  'کاهش چربی بدن در اصل به چه چیزی بستگی دارد؟',
  'What does body-fat loss fundamentally depend on?',
  'به «کسری انرژی» در طول هفته‌ها: یعنی به‌طور میانگین کالری کمتری نسبت به آنچه می‌سوزانی دریافت کنی. هیچ ماده غذایی به‌تنهایی چربی نمی‌سوزاند و هیچ ماده‌ای به‌تنهایی چاق‌کننده نیست — مجموع کالری تعیین‌کننده است.',
  'On an energy deficit sustained over weeks: on average, taking in fewer calories than you burn. No single food burns fat and no single food makes you fat on its own — total calories decide.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-calorie-deficit options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'حذف کامل نان و برنج', 'Cutting out all bread and rice', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-calorie-deficit'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'نخوردن شام به‌تنهایی', 'Skipping dinner alone', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-calorie-deficit'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'خوردن یک ماده «چربی‌سوز» خاص', 'Eating one special "fat-burning" food', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-calorie-deficit'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'کسری انرژی پایدار در طول هفته‌ها', 'A sustained energy deficit over weeks', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-calorie-deficit'
on conflict (question_id, position) do nothing;

-- ---- Q5 (general, easy): dietary fiber and satiety [nutrition] -------------
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-fiber-satiety', 'general', 'easy',
  'فیبر غذایی چه کمکی به کنترل وزن می‌کند؟',
  'How does dietary fiber help with weight control?',
  'فیبر (در سبزیجات، حبوبات و غلات کامل) حجم غذا را زیاد و هضم را کندتر می‌کند؛ در نتیجه زودتر و طولانی‌تر سیر می‌مانی و کمتر سراغ خوراکی‌های اضافه می‌روی. بیشتر آدم‌ها فیبر کافی نمی‌خورند.',
  'Fiber (from vegetables, legumes and whole grains) adds bulk to meals and slows digestion, so you feel full sooner and for longer and snack less. Most people do not eat enough fiber.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-fiber-satiety options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'متابولیسم را دو برابر می‌کند', 'It doubles your metabolism', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-fiber-satiety'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'جلوی جذب همه کالری‌ها را می‌گیرد', 'It blocks absorption of all calories', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-fiber-satiety'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'باعث می‌شود دیگر پروتئین نخوری', 'It makes protein unnecessary', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-fiber-satiety'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'سیری را بیشتر و پرخوری را کمتر می‌کند', 'It increases fullness and reduces overeating', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-fiber-satiety'
on conflict (question_id, position) do nothing;

-- ---- Q6 (gym, easy): DOMS is not proof of a good workout -------------------
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-doms-myth', 'gym', 'easy',
  'آیا درد عضلانی روز بعد از تمرین، نشانه‌ی تمرین خوب است؟',
  'Is next-day muscle soreness a sign of a good workout?',
  'نه لزوماً. این درد (سفتی تأخیری) بیشتر از ناآشنا بودنِ حرکت می‌آید، نه از کیفیت تمرین؛ با تکرار حرکت، درد کمتر می‌شود ولی عضله همچنان رشد می‌کند. پیشرفت را با قدرت و عملکرد بسنج، نه با درد.',
  'Not necessarily. This soreness (DOMS) comes mainly from the movement being unfamiliar, not from workout quality; as you repeat the exercise the soreness fades while muscle still grows. Judge progress by strength and performance, not pain.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-doms-myth options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'بله؛ هرچه درد بیشتر، رشد بیشتر', 'Yes; the more pain, the more growth', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-doms-myth'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'بله؛ بدون درد عضله ساخته نمی‌شود', 'Yes; without soreness no muscle is built', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-doms-myth'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'بله؛ درد یعنی آسیب‌دیدن و بزرگ‌شدن عضله', 'Yes; soreness means the muscle was damaged and is growing', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-doms-myth'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'نه؛ پیشرفت را با قدرت و عملکرد باید سنجید', 'No; progress should be judged by strength and performance', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-doms-myth'
on conflict (question_id, position) do nothing;

-- ---- Q7 (gym, medium): long static stretching right before heavy lifting ---
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-stretch-timing', 'gym', 'medium',
  'کشش ایستای طولانی دقیقاً قبل از وزنه‌ی سنگین چه اثری دارد؟',
  'What does long static stretching right before heavy lifting do?',
  'مرور پژوهش‌ها نشان می‌دهد کشش ایستای طولانی (بیش از ~۱ دقیقه برای هر عضله) دقیقاً قبل از تمرین قدرتی می‌تواند موقتاً قدرت و توان خروجی را چند درصد کم کند. جای بهتر آن: بعد از تمرین یا در جلسه‌ای جدا؛ قبل از تمرین، گرم‌کردن پویا مناسب‌تر است.',
  'Research reviews show long static stretching (over ~1 minute per muscle) right before strength training can temporarily reduce strength and power output by a few percent. It belongs after training or in a separate session; before training, a dynamic warm-up is the better choice.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-stretch-timing options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'قدرت را محسوساً افزایش می‌دهد', 'It noticeably increases strength', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-stretch-timing'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'هیچ اثری ندارد', 'It has no effect at all', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-stretch-timing'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'باعث عضله‌سازی سریع‌تر می‌شود', 'It speeds up muscle growth', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-stretch-timing'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'می‌تواند موقتاً قدرت و توان را کم کند', 'It can temporarily reduce strength and power', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-stretch-timing'
on conflict (question_id, position) do nothing;

-- ---- Q8 (padel, medium): net height rule ----------------------------------
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-padel-net-height', 'padel', 'medium',
  'ارتفاع تور پدل در مرکز زمین چقدر است؟',
  'How high is a padel net at the center of the court?',
  'طبق قوانین رسمی فدراسیون بین‌المللی پدل، تور در مرکز ۸۸ سانتی‌متر و در دو انتها (کنار ستون‌ها) ۹۲ سانتی‌متر ارتفاع دارد — کمی کوتاه‌تر از تور تنیس.',
  'Under the official International Padel Federation rules, the net is 88 cm at the center and 92 cm at the ends (by the posts) — slightly lower than a tennis net.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-padel-net-height options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, '۷۵ سانتی‌متر', '75 cm', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-net-height'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, '۱ متر', '1 meter', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-net-height'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, '۱٫۰۷ متر، مثل تنیس', '1.07 m, same as tennis', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-net-height'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, '۸۸ سانتی‌متر', '88 cm', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-net-height'
on conflict (question_id, position) do nothing;

-- ---- Q9 (padel, easy): second serve ----------------------------------------
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-padel-second-serve', 'padel', 'easy',
  'در پدل اگر سرویس اول خطا شود چه اتفاقی می‌افتد؟',
  'In padel, what happens if the first serve is a fault?',
  'مثل تنیس، یک سرویس دوم هم داری. اگر سرویس دوم هم خطا شود (دابل‌فالت)، امتیاز به حریف می‌رسد.',
  'Like tennis, you get a second serve. If the second serve is also a fault (double fault), the point goes to your opponents.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-padel-second-serve options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'امتیاز فوراً به حریف می‌رسد', 'The point immediately goes to the opponents', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-second-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'هم‌تیمی باید سرویس بزند', 'Your partner must serve instead', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-second-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'سرویس بدون محدودیت تکرار می‌شود', 'The serve is repeated without limit', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-second-serve'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'یک سرویس دوم هم داری', 'You get a second serve', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-second-serve'
on conflict (question_id, position) do nothing;

-- ---- Q10 (padel, medium): the lob as the key defensive shot [tactics] -------
insert into quiz_questions
  (coach_id, slug, sport, difficulty, question_fa, question_en, explanation_fa, explanation_en)
select c.id, 'q-padel-lob-tactic', 'padel', 'medium',
  'وقتی حریف‌ها تور را گرفته‌اند و تو زیر فشار هستی، بهترین ضربه برای پس گرفتن تور چیست؟',
  'When your opponents own the net and you are under pressure, what is the best shot to win the net back?',
  'لابِ بلند و عمیق پشتِ حریف‌ها: توپ را از بالای سرشان رد می‌کند، آن‌ها را از تور عقب می‌راند و به تو و هم‌تیمی‌ات فرصت می‌دهد جلو بیایید و تور را بگیرید. لاب، مهم‌ترین ضربه‌ی دفاعی-تهاجمی پدل است.',
  'A high, deep lob over your opponents: it pushes them back off the net and gives you and your partner time to move forward and take the net. The lob is padel''s most important attacking-defensive shot.'
from coaches c where c.slug = 'reza'
on conflict (coach_id, slug) do nothing;

-- q-padel-lob-tactic options (correct: position 3)
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 0, 'اسمش (ضربه محکم) از عقب زمین', 'A hard smash from the back of the court', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-lob-tactic'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 1, 'ضربه کوتاه (دراپ‌شات) جلوی تور', 'A drop shot right in front of the net', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-lob-tactic'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 2, 'درایو تند و صاف به سمت حریف', 'A fast, flat drive at the opponent', false
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-lob-tactic'
on conflict (question_id, position) do nothing;
insert into quiz_options (question_id, position, option_fa, option_en, is_correct)
select qq.id, 3, 'لاب بلند و عمیق پشت حریف‌ها', 'A high, deep lob behind the opponents', true
from quiz_questions qq join coaches c on c.id = qq.coach_id where c.slug='reza' and qq.slug='q-padel-lob-tactic'
on conflict (question_id, position) do nothing;

-- ============================================================================
-- END of quiz2 seed — 10 questions × 4 options = 50 idempotent inserts.
-- ============================================================================
