/**
 * مربی من — lightweight bilingual dictionary (FA default, EN toggle).
 * No external library: bundle stays tiny, every string lives in two dicts.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'fa' | 'en';

type Dict = Record<string, string>;

const fa: Dict = {
  'app.name': 'مربی من',
  'tab.questionnaire': 'پرسش‌نامه',
  'tab.workout': 'تمرین',
  'tab.nutrition': 'تغذیه',
  'tab.checklist': 'چک‌لیست',
  'tab.chat': 'چت مربی',

  'w.sessionTitle': 'جلسه امروز: سینه و سرشانه',
  'w.exercise': 'پرس بالاسینه با دمبل',
  'w.set': 'ست',
  'w.weight': 'وزن',
  'w.reps': 'تکرار',
  'w.kg': 'کیلوگرم',
  'w.rpe': 'سختی درک‌شده (RPE)',
  'w.rir': 'تکرار ذخیره',
  'w.logSet': 'ثبت ست',
  'w.logged': 'ست ثبت شد',
  'w.pr': 'رکورد شخصی شکسته شد!',
  'w.prSub': 'تو از همیشه قوی‌تری — همین‌طور ادامه بده!',
  'w.prOk': 'باشه!',
  'w.sessionDone': 'جلسه تموم شد! جلسه چطور بود؟',
  'w.easy': 'خیلی آسون',
  'w.ok': 'مناسب',
  'w.hard': 'خیلی سخت',
  'w.finalThanks': 'ثبت شد — استراحت خوبی داشته باش!',

  'n.title': 'تغذیه امروز',
  'n.kcal': 'کالری',
  'n.remaining': 'کالری مانده تا هدف',
  'n.over': 'کالری بیش از هدف',
  'n.protein': 'پروتئین',
  'n.carbs': 'کربوهیدرات',
  'n.fat': 'چربی',
  'n.water': 'آب',
  'n.g': 'گرم',
  'n.l': 'لیتر',
  'n.tapHint': 'بزن تا سریع ثبت بشه',
  'n.logMeal': 'ثبت وعده',
  'n.mealToast': 'وعده نمونه ثبت شد (۴۵۰ کالری)',
  'n.quickProtein': '+۲۰ گرم پروتئین ثبت شد',
  'n.quickCarbs': '+۳۰ گرم کربوهیدرات ثبت شد',
  'n.quickFat': '+۱۰ گرم چربی ثبت شد',
  'n.quickWater': '+۰.۵ لیتر آب ثبت شد',

  'c.title': 'چک‌لیست روزانه',
  'c.water': 'نوشیدن ۳ لیتر آب',
  'c.waterSub': 'تا پایان شب',
  'c.sleep': 'خواب ساعت ۲۳:۰۰',
  'c.sleepSub': 'زود بخواب، ریکاوری مهمه',
  'c.steps': '۸۰۰۰ قدم',
  'c.stepsSub': 'فعالیت روزانه',
  'c.mobility': 'موبیلیتی صبحگاهی',
  'c.mobilitySub': 'ساعت ۷:۳۰',
  'c.xp': '+۲ XP',
  'c.allDone': 'همه انجام شد — عالی پیش میری!',

  'ch.coach': 'رضا گزی',
  'ch.online': 'آنلاین',
  'ch.placeholder': 'پیام بنویس…',
  'ch.now': 'الان',
  'ch.msg1': 'روی ست آخر پرس سینه عالی بودی! امشب زود بخواب.',
  'ch.msg2': 'ممنون استاد! ست آخر رو کامل زدم.',
  'ch.reply': 'دیدم، آفرین!',

  'auth.tagline': 'دستیار هوشمند مربی',
  'auth.roleTitle': 'چطور وارد می‌شی؟',
  'auth.roleSub': 'نقشت را انتخاب کن',
  'auth.coach': 'مربی',
  'auth.coachSub': 'ورود و ثبت‌نام مربیان',
  'auth.athlete': 'شاگرد',
  'auth.athleteSub': 'ورود شاگردان و شروع برای تازه‌کارها',
  'auth.login': 'ورود',
  'auth.createAccount': 'ساخت حساب',
  'auth.logout': 'خروج',
  'auth.back': 'بازگشت',
  'auth.email': 'ایمیل',
  'auth.phone': 'شماره موبایل',
  'auth.password': 'رمز عبور',
  'auth.confirmPassword': 'تکرار رمز عبور',
  'auth.fullName': 'نام و نام خانوادگی',
  'auth.slug': 'نامک (لینک اختصاصی)',
  'auth.slugHint': 'فقط حروف انگلیسی کوچک، عدد و خط تیره — مثل reza-coach',
  'auth.coachLogin': 'ورود مربی',
  'auth.coachSignup': 'ثبت‌نام مربی',
  'auth.athleteLogin': 'ورود شاگرد',
  'auth.newAthlete': 'شاگرد جدیدم — شروع پرسش‌نامه',
  'auth.noAccount': 'حساب نداری؟ ثبت‌نام کن',
  'auth.haveAccount': 'قبلاً ثبت‌نام کردی؟ وارد شو',
  'auth.pleaseWait': 'لطفاً صبر کن…',
  'auth.welcomeBack': 'خوش برگشتی',
  'auth.pending': 'حساب شما در انتظار تأیید است',
  'auth.pendingSub':
    'ثبت‌نامت انجام شد. حسابت وقتی فعال می‌شود که مدیر آن را تأیید کند؛ بعد از تأیید، با همین ایمیل و رمز وارد شو.',
  'auth.checkStatus': 'بررسی دوباره وضعیت',
  'auth.errRequired': 'همه فیلدها الزامی‌اند',
  'auth.errFieldRequired': 'این فیلد الزامی است',
  'auth.errEmailInvalid': 'ایمیل معتبر نیست',
  'auth.errWrong': 'شماره موبایل یا رمز عبور اشتباه است',
  'auth.errWrongEmail': 'ایمیل یا رمز عبور اشتباه است',
  'auth.errTaken': 'این شماره قبلاً ثبت شده است',
  'auth.errTakenEmail': 'این ایمیل قبلاً ثبت شده است',
  'auth.errPasswordShort': 'رمز عبور باید حداقل ۸ کاراکتر باشد',
  'auth.errPasswordMismatch': 'رمز عبور و تکرارش یکی نیستند',
  'auth.errSlug': 'نامک معتبر نیست — فقط حروف انگلیسی کوچک، عدد و خط تیره',
  'auth.errBusy': 'سرور شلوغ است؛ چند لحظه دیگر دوباره تلاش کن',
  'auth.errGeneric': 'خطایی رخ داد؛ دوباره تلاش کن',
  'auth.errCheckEmail': 'حسابت ساخته شد؛ ایمیلت را تأیید کن و بعد وارد شو.',
  'auth.notConfiguredTitle': 'سرور هنوز وصل نیست (حالت توسعه)',
  'auth.enterDemo': 'ورود به نسخه نمایشی',
  'auth.onboardingTitle': 'پرسش‌نامه شاگرد جدید',
  'auth.onboardingHint': 'اول پرسش‌نامه را کامل کن؛ ساخت حساب قدم آخر است و جواب‌ها تا قبل از آن فقط روی همین دستگاه می‌مانند.',
  'auth.finishSignup': 'قدم آخر: ساخت حساب',

  'cp.title': 'پنل مربی',
  'cp.queue': 'صف بازبینی',
  'cp.athletes': 'شاگردهای من',
  'cp.loading': 'در حال بارگذاری…',
  'cp.loadError': 'بارگذاری اطلاعات ناموفق بود',
  'cp.retry': 'تلاش دوباره',
  'cp.demoNote': 'حالت نمایشی — سرور هنوز وصل نیست؛ داده‌ها نمونه‌اند',
  'cp.queueEmpty': 'صف بازبینی خالی است — همه‌چیز بررسی شده',
  'cp.athletesEmpty': 'هنوز شاگردی ثبت نشده است',
  'cp.bmi': 'شاخص توده بدنی (BMI)',
  'cp.redFlag': 'هشدار آسیب‌دیدگی',
  'cp.injuries': 'آسیب‌ها',
  'cp.surgeries': 'جراحی‌ها',
  'cp.goal': 'هدف',
  'cp.sleep': 'خواب',
  'cp.hours': 'ساعت',
  'cp.daysPerWeek': 'روز تمرین در هفته',
  'cp.ageBand': 'بازه سنی',
  'cp.answersTitle': 'خلاصه پاسخ‌های پرسش‌نامه',
  'cp.noAnswers': 'پاسخی برای نمایش نیست',
  'cp.approve': 'تأیید برنامه',
  'cp.reject': 'رد برنامه',
  'cp.approved': 'برنامه تأیید شد',
  'cp.rejected': 'برنامه رد شد',
  'cp.actionError': 'عملیات ناموفق بود؛ دوباره تلاش کن',
  'cp.noteLabel': 'نظر مربی / ضعف‌های بدنی',
  'cp.notePlaceholder': 'ضعف‌های بدنی، محدودیت‌ها و نکات مهم این شاگرد…',
  'cp.noteHint': 'برنامه بر اساس پرسش‌نامه و نظر مربی نوشته می‌شود',
  'cp.saveNote': 'ذخیره نظر',
  'cp.noteSaved': 'نظر مربی ذخیره شد',
  'cp.noteLocalOnly': 'روی همین دستگاه ذخیره شد — هنوز برنامه‌ای برای این شاگرد ساخته نشده',
  'cp.track.gym': 'باشگاه',
  'cp.track.vip': 'ویژه — باشگاه + پدل',
  'cp.track.padel': 'پدل',
  'cp.track.aionly': 'برنامه هوشمند',
  'cp.submittedAt': 'زمان ارسال',
  'cp.programStatus': 'وضعیت برنامه',
  'cp.status.draft': 'پیش‌نویس',
  'cp.status.in_review': 'در حال بازبینی',
  'cp.status.approved': 'تأییدشده',
  'cp.status.active': 'فعال',
  'cp.status.archived': 'بایگانی',
};

const en: Dict = {
  'app.name': 'My Coach',
  'tab.questionnaire': 'Form',
  'tab.workout': 'Workout',
  'tab.nutrition': 'Nutrition',
  'tab.checklist': 'Checklist',
  'tab.chat': 'Coach chat',

  'w.sessionTitle': "Today's session: Chest & Shoulders",
  'w.exercise': 'Incline dumbbell press',
  'w.set': 'Set',
  'w.weight': 'Weight',
  'w.reps': 'Reps',
  'w.kg': 'kg',
  'w.rpe': 'Perceived exertion (RPE)',
  'w.rir': 'reps in reserve',
  'w.logSet': 'Log set',
  'w.logged': 'Set logged',
  'w.pr': 'New personal record!',
  'w.prSub': 'You are stronger than ever — keep it up!',
  'w.prOk': 'Nice!',
  'w.sessionDone': 'Session complete! How was it?',
  'w.easy': 'Very easy',
  'w.ok': 'Just right',
  'w.hard': 'Very hard',
  'w.finalThanks': 'Saved — rest well!',

  'n.title': "Today's nutrition",
  'n.kcal': 'kcal',
  'n.remaining': 'kcal left to goal',
  'n.over': 'kcal over goal',
  'n.protein': 'Protein',
  'n.carbs': 'Carbs',
  'n.fat': 'Fat',
  'n.water': 'Water',
  'n.g': 'g',
  'n.l': 'L',
  'n.tapHint': 'Tap to quick-log',
  'n.logMeal': 'Log meal',
  'n.mealToast': 'Demo meal logged (450 kcal)',
  'n.quickProtein': '+20g protein logged',
  'n.quickCarbs': '+30g carbs logged',
  'n.quickFat': '+10g fat logged',
  'n.quickWater': '+0.5L water logged',

  'c.title': 'Daily checklist',
  'c.water': 'Drink 3L water',
  'c.waterSub': 'by end of day',
  'c.sleep': 'Sleep by 23:00',
  'c.sleepSub': 'sleep early, recovery matters',
  'c.steps': '8000 steps',
  'c.stepsSub': 'daily activity',
  'c.mobility': 'Morning mobility',
  'c.mobilitySub': 'at 7:30',
  'c.xp': '+2 XP',
  'c.allDone': 'All done — amazing progress!',

  'ch.coach': 'Reza Gazi',
  'ch.online': 'online',
  'ch.placeholder': 'Type a message…',
  'ch.now': 'now',
  'ch.msg1': 'You crushed the last bench set! Sleep early tonight.',
  'ch.msg2': 'Thanks coach! Finished the last set fully.',
  'ch.reply': 'Saw it, well done!',

  'auth.tagline': 'Smart coach assistant',
  'auth.roleTitle': 'How are you joining?',
  'auth.roleSub': 'Choose your role',
  'auth.coach': 'Coach',
  'auth.coachSub': 'Coach login & signup',
  'auth.athlete': 'Athlete',
  'auth.athleteSub': 'Athlete login, or start if you are new',
  'auth.login': 'Log in',
  'auth.createAccount': 'Create account',
  'auth.logout': 'Log out',
  'auth.back': 'Back',
  'auth.email': 'Email',
  'auth.phone': 'Mobile number',
  'auth.password': 'Password',
  'auth.confirmPassword': 'Confirm password',
  'auth.fullName': 'Full name',
  'auth.slug': 'Slug (your personal link)',
  'auth.slugHint': 'Lowercase letters, numbers and dashes only — e.g. reza-coach',
  'auth.coachLogin': 'Coach login',
  'auth.coachSignup': 'Coach signup',
  'auth.athleteLogin': 'Athlete login',
  'auth.newAthlete': "I'm new — start the questionnaire",
  'auth.noAccount': 'No account yet? Sign up',
  'auth.haveAccount': 'Already registered? Log in',
  'auth.pleaseWait': 'Please wait…',
  'auth.welcomeBack': 'Welcome back',
  'auth.pending': 'Your account is pending approval',
  'auth.pendingSub':
    'Your signup is complete. Your account activates once the admin approves it; after approval, log in with the same email and password.',
  'auth.checkStatus': 'Check status again',
  'auth.errRequired': 'All fields are required',
  'auth.errFieldRequired': 'This field is required',
  'auth.errEmailInvalid': 'Invalid email address',
  'auth.errWrong': 'Wrong number or password',
  'auth.errWrongEmail': 'Wrong email or password',
  'auth.errTaken': 'This number is already registered',
  'auth.errTakenEmail': 'This email is already registered',
  'auth.errPasswordShort': 'Password must be at least 8 characters',
  'auth.errPasswordMismatch': 'Passwords do not match',
  'auth.errSlug': 'Invalid slug — lowercase letters, numbers and dashes only',
  'auth.errBusy': 'Server is busy — try again in a moment',
  'auth.errGeneric': 'Something went wrong — please try again',
  'auth.errCheckEmail': 'Account created; confirm your email, then log in.',
  'auth.notConfiguredTitle': 'Server not connected yet (development mode)',
  'auth.enterDemo': 'Enter demo',
  'auth.onboardingTitle': 'New athlete questionnaire',
  'auth.onboardingHint':
    'Complete the questionnaire first; creating your account is the final step, and until then your answers stay only on this device.',
  'auth.finishSignup': 'Final step: create your account',

  'cp.title': 'Coach panel',
  'cp.queue': 'Review queue',
  'cp.athletes': 'My athletes',
  'cp.loading': 'Loading…',
  'cp.loadError': 'Could not load data',
  'cp.retry': 'Retry',
  'cp.demoNote': 'Demo mode — server not connected yet; data is sample data',
  'cp.queueEmpty': 'Review queue is empty — everything is reviewed',
  'cp.athletesEmpty': 'No athletes yet',
  'cp.bmi': 'BMI',
  'cp.redFlag': 'Injury red flag',
  'cp.injuries': 'Injuries',
  'cp.surgeries': 'Surgeries',
  'cp.goal': 'Goal',
  'cp.sleep': 'Sleep',
  'cp.hours': 'h',
  'cp.daysPerWeek': 'Training days / week',
  'cp.ageBand': 'Age band',
  'cp.answersTitle': 'Questionnaire answers',
  'cp.noAnswers': 'No answers to show',
  'cp.approve': 'Approve program',
  'cp.reject': 'Reject program',
  'cp.approved': 'Program approved',
  'cp.rejected': 'Program rejected',
  'cp.actionError': 'Action failed — please retry',
  'cp.noteLabel': 'Coach note / body weaknesses',
  'cp.notePlaceholder': "This athlete's weaknesses, limitations and key notes…",
  'cp.noteHint': 'The program is drafted from the questionnaire + this coach note',
  'cp.saveNote': 'Save note',
  'cp.noteSaved': 'Coach note saved',
  'cp.noteLocalOnly': 'Saved on this device — no program exists for this athlete yet',
  'cp.track.gym': 'Gym',
  'cp.track.vip': 'VIP — gym + padel',
  'cp.track.padel': 'Padel',
  'cp.track.aionly': 'AI program',
  'cp.submittedAt': 'Submitted',
  'cp.programStatus': 'Program status',
  'cp.status.draft': 'Draft',
  'cp.status.in_review': 'In review',
  'cp.status.approved': 'Approved',
  'cp.status.active': 'Active',
  'cp.status.archived': 'Archived',
};

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Convert digits to Persian when the UI is in Farsi; leave separators alone. */
function faNum(value: number | string): string {
  return String(value)
    .replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)])
    .replace(/\./g, '٫');
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: 'rtl' | 'ltr';
  /** Translate a dictionary key. */
  t: (key: string) => string;
  /** Localize a number (Persian digits in FA mode). */
  num: (v: number | string) => string;
}

const Ctx = createContext<LangCtx | null>(null);

/**
 * Persisted language — the SINGLE source the standalone questionnaire
 * (public/questionnaire.html, same origin) also reads: localStorage key
 * below, with a `?lang=` query / postMessage fallback for contexts where
 * the iframe cannot share storage (e.g. file://). Keep the key in sync
 * with LANG_KEY in questionnaire.html.
 */
export const LANG_STORAGE_KEY = 'km.lang.v1';

function initialLang(): Lang {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'en' ? 'en' : 'fa';
  } catch {
    return 'fa';
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, l);
    } catch {
      /* storage unavailable — language still applies this session */
    }
  };
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, [lang]);
  const value = useMemo<LangCtx>(() => {
    const dict = lang === 'fa' ? fa : en;
    const t = (key: string) => dict[key] ?? key;
    const num = (v: number | string) => (lang === 'fa' ? faNum(v) : String(v));
    return { lang, setLang, dir: lang === 'fa' ? 'rtl' : 'ltr', t, num };
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLang must be used inside <LangProvider>');
  return ctx;
}

/** Raw dictionary lookup outside React (rarely needed). */
export const rawDict = (l: Lang): Dict => (l === 'fa' ? fa : en);
