-- ============================================================================
-- «مربی من» — v5: چهار ماژول تمرینی/تغذیه/چک‌لیست/چت (§۱۷ سند معماری)
-- RUN ORDER: بعد از supabase-xp-scoring.sql (v4). کاملاً idempotent است —
-- می‌توانید چند بار Run کنید. فقط از raw.githubusercontent.com به رضا بدهید.
--
-- شامل: workout_sessions + logged_sets (لاگر زنده جلسه) + progression_drafts
-- (پیشنهاد موتور پیشرفت — فقط draft، تأیید با مربی) + meal_food_entries
-- (جزئیات ماکرو زیر meal_logs موجود در v4) + nutrition_targets (تارگت‌های
-- مربی) + water_logs + nutrition_daily (ویو) + checklist_items /
-- checklist_completions + messages (چت مربی-شاگرد، متنی).
--
-- ⚠️ مرز سخت دارویی (تصمیم رضا): این فایل هیچ ستون/نوعی برای تجویز دارو
-- یا مکمل ندارد. checklist_items.item_type فقط ۶ مقدار مجاز دارد و هیچ‌کدام
-- دارویی نیست؛ doctor_note یعنی «یادآوری مصرف دارویی که *پزشک* تجویز کرده»
-- (رهگیری، نه تجویز — دوز/نوع را پزشک تعیین می‌کند، نه اپ).
-- ============================================================================


-- ============================================================================
-- 1. WORKOUT_SESSIONS — یک جلسه‌ی تمرینی (نسخه‌ی زنده‌ی برنامه‌ی روز).
--    آفلاین‌تحمل: client_uuid یکتا → سینک idempotent (ثبت مجدد، سطر تکراری
--    نمی‌سازد).
-- ============================================================================
create table if not exists workout_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  program_id uuid references programs(id) on delete set null,
  date date not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_min int check (duration_min is null or (duration_min > 0 and duration_min <= 300)),
  difficulty text check (difficulty is null or difficulty in ('too_easy','just_right','too_hard')),
  avg_rpe numeric check (avg_rpe is null or (avg_rpe >= 7 and avg_rpe <= 10)),
  notes text not null default '',
  client_uuid uuid not null default gen_random_uuid(),
  synced_at timestamptz not null default now(),
  unique (client_uuid)
);
comment on table workout_sessions is 'Live training session. difficulty/avg_rpe = post-session feedback (research rec #3) feeding the progression engine.';
create index if not exists idx_sessions_athlete_date on workout_sessions(athlete_id, date);


-- ============================================================================
-- 2. LOGGED_SETS — هر ست ثبت‌شده: وزن × تکرار + RPE + پرچم رکورد شخصی.
--    PR را اپ سمت کلاینت تشخیص می‌دهد (مقایسه با رکورد قبلی همان حرکت) و
--    is_pr را true می‌کند؛ جشن رکورد هم سمت کلاینت است.
-- ============================================================================
create table if not exists logged_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references workout_sessions(id) on delete cascade,
  program_item_id uuid references program_items(id) on delete set null,
  exercise_id uuid references exercises(id) on delete set null,
  set_number int not null check (set_number between 1 and 50),
  weight_kg numeric not null check (weight_kg >= 0 and weight_kg <= 500),
  reps int not null check (reps between 1 and 200),
  rpe numeric check (rpe is null or (rpe >= 7 and rpe <= 10)),
  is_pr boolean not null default false,
  logged_at timestamptz not null default now(),
  client_uuid uuid not null default gen_random_uuid(),
  unique (client_uuid)
);
comment on table logged_sets is 'Per-set log: weight x reps + RPE (7-10). is_pr set by the app after comparing with the athlete''s history.';
create index if not exists idx_sets_session on logged_sets(session_id);
create index if not exists idx_sets_exercise_athlete on logged_sets(exercise_id, logged_at);


-- ============================================================================
-- 3. PROGRESSION_DRAFTS — پیشنهاد موتور پیشرفت برای جلسه‌ی بعد.
--    فقط DRAFT است؛ مربی در داشبورد تأیید/رد می‌کند (مثل review_queue —
--    شاگرد هرگز این جدول را نمی‌بیند).
-- ============================================================================
create table if not exists progression_drafts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  suggested_changes jsonb not null default '[]',
  -- suggested_changes: [{program_item_id, field: weight_kg|reps|sets, from, to, reason_fa, reason_en}]
  basis jsonb not null default '{}',
  -- basis: {sessions_analyzed, avg_rpe, prs_hit, difficulty_trend}
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
comment on table progression_drafts is 'Progression engine suggestions (draft only). Coach approves -> new program version. Athletes NEVER see this table.';


-- ============================================================================
-- 4. MEAL_FOOD_ENTRIES — جزئیات ماکروی هر وعده، زیرمجموعه‌ی meal_logs (v4).
--    meal_logs «ثبت کرد؟» را می‌سنجد؛ این جدول «چی خورد؟» را.
-- ============================================================================
create table if not exists meal_food_entries (
  id uuid primary key default gen_random_uuid(),
  meal_log_id uuid not null references meal_logs(id) on delete cascade,
  food_name_fa text not null default '',
  food_name_en text not null default '',
  grams numeric not null check (grams > 0 and grams <= 2000),
  protein_g numeric not null default 0 check (protein_g >= 0 and protein_g <= 1000),
  carbs_g numeric not null default 0 check (carbs_g >= 0 and carbs_g <= 1000),
  fat_g numeric not null default 0 check (fat_g >= 0 and fat_g <= 1000),
  kcal numeric not null default 0 check (kcal >= 0 and kcal <= 5000),
  logged_at timestamptz not null default now()
);
comment on table meal_food_entries is 'Macro detail per food item inside a meal_log (v4). Sums feed the nutrition dashboard tanks.';
create index if not exists idx_foodentries_meal on meal_food_entries(meal_log_id);


-- ============================================================================
-- 5. NUTRITION_TARGETS — تارگت‌های روزانه‌ای که مربی برای شاگرد می‌گذارد.
--    تاریخچه‌دار: effective_from جدید = تارگت جدید (قدیمی‌ها برای گزارش می‌مانند).
-- ============================================================================
create table if not exists nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  protein_g numeric not null check (protein_g >= 0 and protein_g <= 1000),
  carbs_g numeric not null check (carbs_g >= 0 and carbs_g <= 1000),
  fat_g numeric not null check (fat_g >= 0 and fat_g <= 500),
  water_ml int not null check (water_ml > 0 and water_ml <= 8000),
  kcal int not null check (kcal > 0 and kcal <= 10000),
  effective_from date not null default current_date,
  set_at timestamptz not null default now(),
  unique (athlete_id, effective_from)
);
comment on table nutrition_targets is 'Coach-set daily nutrition targets per athlete. History kept via effective_from.';


-- ============================================================================
-- 6. WATER_LOGS — ثبت آب. هر ثبت یک سطر؛ داشبورد جمع روزانه را نشان می‌دهد.
-- ============================================================================
create table if not exists water_logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  coach_id uuid references coaches(id) on delete cascade,
  date date not null,
  ml int not null check (ml > 0 and ml <= 5000),
  logged_at timestamptz not null default now()
);
comment on table water_logs is 'Water intake entries. Dashboard sums per day vs nutrition_targets.water_ml.';
create index if not exists idx_water_athlete_date on water_logs(athlete_id, date);


-- ============================================================================
-- 7. NUTRITION_DAILY (view) — جمع روزانه‌ی ماکرو + آب برای داشبورد تغذیه.
--    security_invoker: RLS جدول‌های پایه برای caller اعمال می‌شود.
-- ============================================================================
create or replace view nutrition_daily
with (security_invoker = true) as
with meals as (
  select ml.athlete_id, ml.date,
         coalesce(sum(e.protein_g), 0)::numeric as protein_g,
         coalesce(sum(e.carbs_g), 0)::numeric as carbs_g,
         coalesce(sum(e.fat_g), 0)::numeric as fat_g,
         coalesce(sum(e.kcal), 0)::numeric as kcal,
         count(distinct ml.id)::int as meals_logged
  from meal_logs ml
  left join meal_food_entries e on e.meal_log_id = ml.id
  group by ml.athlete_id, ml.date
),
water as (
  select athlete_id, date, coalesce(sum(ml), 0)::numeric as water_ml
  from water_logs
  group by athlete_id, date
),
days as (
  select athlete_id, date from meals
  union
  select athlete_id, date from water
)
select d.athlete_id, d.date,
       coalesce(m.protein_g, 0) as protein_g,
       coalesce(m.carbs_g, 0) as carbs_g,
       coalesce(m.fat_g, 0) as fat_g,
       coalesce(m.kcal, 0) as kcal,
       coalesce(m.meals_logged, 0) as meals_logged,
       coalesce(w.water_ml, 0) as water_ml
from days d
left join meals m on m.athlete_id = d.athlete_id and m.date = d.date
left join water w on w.athlete_id = d.athlete_id and w.date = d.date;
comment on view nutrition_daily is 'Daily macro + water sums per athlete for the nutrition dashboard (vs nutrition_targets).';


-- ============================================================================
-- 8. CHECKLIST_ITEMS + CHECKLIST_COMPLETIONS — چک‌لیست روزانه‌ی مربی.
--    ⛔ مرز دارویی: item_type فقط ۶ مقدار مجاز دارد — هیچ نوع دارویی/
--    مکملی در آن نیست و هرگز اضافه نخواهد شد. doctor_note یعنی «یادآوری
--    مصرف دارویی که *پزشک* تجویز کرده» — رهگیری عادت، نه تجویز (دوز و نوع
--    را پزشک تعیین می‌کند، نه اپ، نه مربی از طریق اپ).
-- ============================================================================
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  title_fa text not null,
  title_en text not null,
  item_type text not null check (item_type in (
    'water',        -- هدف آب روزانه (مثلاً ۳ لیتر)
    'sleep',        -- ساعت خواب هدف (مثلاً ۲۳:۰۰)
    'steps',        -- هدف قدم روزانه
    'mobility',     -- تمرین موبیلیتی/کششی
    'habit',        -- عادت عمومی (مثلاً «بدون نوشابه»)
    'doctor_note'   -- یادآوری: «دارویی که پزشکت تجویز کرده را مصرف کن»
                    -- (متن را مربی می‌نویسد؛ فقط رهگیری، نه تجویز)
  )),
  target_value numeric,                 -- مثلاً 3000 (میلی‌لیتر) یا 10000 (قدم)
  target_unit text not null default '', -- 'ml' | 'steps' | 'min' | ''
  scheduled_time time,                  -- ساعت یادآوری (اختیاری)
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
comment on table checklist_items is 'Coach-assigned daily checklist. HARD MEDICATION BOUNDARY: item_type whitelist contains NO drug/supplement types — the app never prescribes. doctor_note = tracking-only reminder of doctor-prescribed medication.';
create index if not exists idx_checklist_athlete on checklist_items(athlete_id, is_active);

create table if not exists checklist_completions (
  id uuid primary key default gen_random_uuid(),
  checklist_item_id uuid not null references checklist_items(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  date date not null,
  value numeric,                        -- مقدار ثبت‌شده (اختیاری؛ مثلاً ml آب)
  completed_at timestamptz not null default now(),
  unique (checklist_item_id, date)
);
comment on table checklist_completions is 'One row per (item, day). Completion feeds habit_checklist XP.';
create index if not exists idx_checkcomp_athlete_date on checklist_completions(athlete_id, date);


-- ============================================================================
-- 9. MESSAGES — چت متنی مربی ↔ شاگرد (v1: فقط متن، بدون مدیا).
--    هر جفت (coach, athlete) یک رشته‌ی گفتگوست. read_at برای بج «خوانده‌نشده».
-- ============================================================================
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references coaches(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  sender_role text not null check (sender_role in ('coach','athlete')),
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table messages is 'Coach-athlete text chat (v1: text only, no media). read_at drives unread badges.';
create index if not exists idx_messages_pair on messages(coach_id, athlete_id, created_at);


-- ============================================================================
-- 10. RLS — همان idiom چهار نسخه‌ی قبلی:
--     مربی: is_admin() یا coach_id = my_coach_id() | شاگرد: سطرهای خودش.
-- ============================================================================

-- ---- workout_sessions / logged_sets: مربی (همه) + شاگرد (سطرهای خودش)
alter table workout_sessions enable row level security;
drop policy if exists pol5_sessions_coach on workout_sessions;
create policy pol5_sessions_coach on workout_sessions
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol5_sessions_athlete_own on workout_sessions;
create policy pol5_sessions_athlete_own on workout_sessions
  for all
  using (exists (select 1 from athletes a where a.id = workout_sessions.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a where a.id = workout_sessions.athlete_id and a.user_id = auth.uid()));

alter table logged_sets enable row level security;
drop policy if exists pol5_sets_coach on logged_sets;
create policy pol5_sets_coach on logged_sets
  for all
  using (exists (select 1 from workout_sessions s where s.id = logged_sets.session_id
                 and (public.is_admin() or s.coach_id = public.my_coach_id())))
  with check (exists (select 1 from workout_sessions s where s.id = logged_sets.session_id
                 and (public.is_admin() or s.coach_id = public.my_coach_id())));
drop policy if exists pol5_sets_athlete_own on logged_sets;
create policy pol5_sets_athlete_own on logged_sets
  for all
  using (exists (select 1 from workout_sessions s join athletes a on a.id = s.athlete_id
                 where s.id = logged_sets.session_id and a.user_id = auth.uid()))
  with check (exists (select 1 from workout_sessions s join athletes a on a.id = s.athlete_id
                 where s.id = logged_sets.session_id and a.user_id = auth.uid()));

-- ---- progression_drafts: فقط مربی (شاگرد هرگز نمی‌بیند — مثل review_queue)
alter table progression_drafts enable row level security;
drop policy if exists pol5_progdraft_coach on progression_drafts;
create policy pol5_progdraft_coach on progression_drafts
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());

-- ---- meal_food_entries: از طریق meal_log والد (مربی/شاگرد)
alter table meal_food_entries enable row level security;
drop policy if exists pol5_foodentries_coach on meal_food_entries;
create policy pol5_foodentries_coach on meal_food_entries
  for all
  using (exists (select 1 from meal_logs ml where ml.id = meal_food_entries.meal_log_id
                 and (public.is_admin() or ml.coach_id = public.my_coach_id())))
  with check (exists (select 1 from meal_logs ml where ml.id = meal_food_entries.meal_log_id
                 and (public.is_admin() or ml.coach_id = public.my_coach_id())));
drop policy if exists pol5_foodentries_athlete_own on meal_food_entries;
create policy pol5_foodentries_athlete_own on meal_food_entries
  for all
  using (exists (select 1 from meal_logs ml join athletes a on a.id = ml.athlete_id
                 where ml.id = meal_food_entries.meal_log_id and a.user_id = auth.uid()))
  with check (exists (select 1 from meal_logs ml join athletes a on a.id = ml.athlete_id
                 where ml.id = meal_food_entries.meal_log_id and a.user_id = auth.uid()));

-- ---- nutrition_targets: مربی می‌نویسد؛ شاگرد فقط سطرهای خودش را می‌خواند
alter table nutrition_targets enable row level security;
drop policy if exists pol5_targets_coach on nutrition_targets;
create policy pol5_targets_coach on nutrition_targets
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol5_targets_athlete_read on nutrition_targets;
create policy pol5_targets_athlete_read on nutrition_targets
  for select
  using (exists (select 1 from athletes a where a.id = nutrition_targets.athlete_id and a.user_id = auth.uid()));

-- ---- water_logs: مربی (همه) + شاگرد (سطرهای خودش)
alter table water_logs enable row level security;
drop policy if exists pol5_water_coach on water_logs;
create policy pol5_water_coach on water_logs
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol5_water_athlete_own on water_logs;
create policy pol5_water_athlete_own on water_logs
  for all
  using (exists (select 1 from athletes a where a.id = water_logs.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a where a.id = water_logs.athlete_id and a.user_id = auth.uid()));

-- ---- checklist_items / checklist_completions: مربی (همه) + شاگرد (آیتم‌های خودش)
alter table checklist_items enable row level security;
drop policy if exists pol5_checklist_coach on checklist_items;
create policy pol5_checklist_coach on checklist_items
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or coach_id = public.my_coach_id());
drop policy if exists pol5_checklist_athlete_own on checklist_items;
create policy pol5_checklist_athlete_own on checklist_items
  for select
  using (exists (select 1 from athletes a where a.id = checklist_items.athlete_id and a.user_id = auth.uid()));

alter table checklist_completions enable row level security;
drop policy if exists pol5_checkcomp_coach on checklist_completions;
create policy pol5_checkcomp_coach on checklist_completions
  for all
  using (exists (select 1 from checklist_items ci where ci.id = checklist_completions.checklist_item_id
                 and (public.is_admin() or ci.coach_id = public.my_coach_id())))
  with check (exists (select 1 from checklist_items ci where ci.id = checklist_completions.checklist_item_id
                 and (public.is_admin() or ci.coach_id = public.my_coach_id())));
drop policy if exists pol5_checkcomp_athlete_own on checklist_completions;
create policy pol5_checkcomp_athlete_own on checklist_completions
  for all
  using (exists (select 1 from checklist_items ci join athletes a on a.id = ci.athlete_id
                 where ci.id = checklist_completions.checklist_item_id and a.user_id = auth.uid()))
  with check (exists (select 1 from checklist_items ci join athletes a on a.id = ci.athlete_id
                 where ci.id = checklist_completions.checklist_item_id and a.user_id = auth.uid()));

-- ---- messages: مربیِ همان جفت + شاگردِ همان جفت.
--      درج: هر نقش فقط با sender_role خودش می‌تواند بنویسد (جعل نقش غیرممکن).
alter table messages enable row level security;
drop policy if exists pol5_messages_coach on messages;
create policy pol5_messages_coach on messages
  for all
  using (public.is_admin() or coach_id = public.my_coach_id())
  with check (public.is_admin() or (coach_id = public.my_coach_id() and sender_role = 'coach'));
drop policy if exists pol5_messages_athlete on messages;
create policy pol5_messages_athlete on messages
  for all
  using (exists (select 1 from athletes a where a.id = messages.athlete_id and a.user_id = auth.uid()))
  with check (exists (select 1 from athletes a where a.id = messages.athlete_id and a.user_id = auth.uid())
              and sender_role = 'athlete');


-- ============================================================================
-- 11. SEED: قانون XP برای چک‌لیست روزانه (کاتالوگ v4 را گسترش می‌دهد —
--     لجر دوم ساخته نمی‌شود).
-- ============================================================================
insert into xp_scoring_rules (event_type, name_fa, name_en, unit, xp_per_unit, cap_per_day, cap_period, enabled, notes)
values ('habit_checklist', 'تکمیل آیتم چک‌لیست روزانه', 'Daily checklist item completion',
        'item', 2, 10, 'daily', true,
        'Mobility/habit/doctor-note/sleep-time/water/steps items. Items that already have their own XP channel (e.g. steps via watch) should not double-award — app picks one channel per completion.')
on conflict (event_type) do nothing;


-- ============================================================================
-- v5 DONE. ترتیب اجرا: v1 → v2 → v3 → v4 → v5 (این فایل).
-- ============================================================================
