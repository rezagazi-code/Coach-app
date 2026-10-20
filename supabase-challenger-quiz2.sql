-- ============================================================================
-- «مربی من» (My Coach) — Challenger quiz bank EXTENSION (10 questions)
-- File: supabase-challenger-quiz2.sql
--
-- RUN ORDER: after supabase-challenger.sql (creates quiz_questions/quiz_options)
--            and after the v2 multi-coach seed that creates coach slug 'reza'.
-- IDEMPOTENT: ON CONFLICT guards on (coach_id, slug) for questions and
--            (question_id, position) for options. Safe to run multiple times.
--            If coach 'reza' does not exist yet, all statements select zero
--            rows and are silently skipped (same convention as quiz1 seed).
--
-- Seed slugs in this file:
--   q-rest-intervals, q-warmup-specific, q-effort-rir, q-calorie-deficit,
--   q-fiber-satiety, q-doms-myth, q-stretch-timing,
--   q-padel-net-height, q-padel-second-serve, q-padel-lob-tactic
-- No overlap with quiz1 slugs (q-protein-total, q-progressive-overload,
--   q-sleep, q-compound, q-hydration, q-padel-serve, q-padel-walls,
--   q-padel-scoring, q-padel-double-bounce, q-padel-let-serve).
--
-- CONTENT RULES: evidence-based ONLY. No supplement-dosage advice, no
--   medication content, no blood-type anything, no pseudoscience.
--   Explanations = the coaching value, revealed only AFTER answering.
-- ============================================================================

-- ---- Q1 (gym, medium): rest intervals for strength work --------------------
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
