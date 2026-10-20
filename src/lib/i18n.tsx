/**
 * مربی من — lightweight bilingual dictionary (FA default, EN toggle).
 * No external library: bundle stays tiny, every string lives in two dicts.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

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

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('fa');
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
