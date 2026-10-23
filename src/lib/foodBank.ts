/**
 * «بانک غذاها» (Food bank) — a reference list of ~35 Iranian-common foods
 * with per-serving approximate nutrition values.
 *
 * SOURCE CONVENTION: all perUnit* values are APPROXIMATE and based on
 * published USDA FoodData Central values for the stated serving size
 * (servingFA/servingEN). They are never measured, never personalized.
 *
 * ⛔ Medication boundary (Reza's hard red line): this module contains NO
 * supplement types, NO dosages, NO «you should take X» language, and NO
 * personalized «you need X» phrasing. vitaminNote fields are GENERAL
 * educational food-composition facts only (e.g. «ویتامین C»).
 */
export interface FoodBankItem {
  id: string;
  nameFA: string;
  nameEN: string;
  /** Plate-compatible unit — used when a coach picks this food for a plate item. */
  unit: 'g' | 'pcs' | 'cup';
  /** Human serving size of one tap (e.g. «۱۰۰ گرم» / '100g'). */
  servingFA: string;
  servingEN: string;
  /** Numeric amount of one tap, in `unit` (e.g. 100 for «۱۰۰ گرم»). */
  tapAmount: number;
  /** Approximate nutrition per ONE tap (per the serving above). */
  perUnitKcal: number;
  perUnitProtein: number; // grams
  perUnitCarbs: number; // grams
  perUnitFat: number; // grams
  /** GENERAL educational food-composition note only. Never personalized. */
  vitaminNoteFA?: string;
  vitaminNoteEN?: string;
}

export const FOOD_BANK: FoodBankItem[] = [
  // ——— پروتئین‌ها / proteins ———
  { id: 'chicken-breast', tapAmount: 100, nameFA: 'سینه مرغ', nameEN: 'Chicken breast', unit: 'g', servingFA: '۱۰۰ گرم', servingEN: '100g', perUnitKcal: 165, perUnitProtein: 31, perUnitCarbs: 0, perUnitFat: 3.6, vitaminNoteFA: 'منبع ویتامین‌های B', vitaminNoteEN: 'B vitamins source' },
  { id: 'chicken-thigh', tapAmount: 100, nameFA: 'ران مرغ', nameEN: 'Chicken thigh', unit: 'g', servingFA: '۱۰۰ گرم', servingEN: '100g', perUnitKcal: 177, perUnitProtein: 18, perUnitCarbs: 0, perUnitFat: 11 },
  { id: 'beef', tapAmount: 100, nameFA: 'گوشت گاو (کم‌چرب)', nameEN: 'Lean beef', unit: 'g', servingFA: '۱۰۰ گرم', servingEN: '100g', perUnitKcal: 176, perUnitProtein: 20, perUnitCarbs: 0, perUnitFat: 10, vitaminNoteFA: 'آهن و ویتامین B12', vitaminNoteEN: 'Iron & vitamin B12' },
  { id: 'lamb', tapAmount: 100, nameFA: 'گوشت بره', nameEN: 'Lamb', unit: 'g', servingFA: '۱۰۰ گرم', servingEN: '100g', perUnitKcal: 282, perUnitProtein: 25, perUnitCarbs: 0, perUnitFat: 20 },
  { id: 'salmon', tapAmount: 100, nameFA: 'ماهی سالمون', nameEN: 'Salmon', unit: 'g', servingFA: '۱۰۰ گرم', servingEN: '100g', perUnitKcal: 206, perUnitProtein: 22, perUnitCarbs: 0, perUnitFat: 12, vitaminNoteFA: 'ویتامین D و امگا-۳', vitaminNoteEN: 'Vitamin D & omega-3' },
  { id: 'canned-tuna', tapAmount: 100, nameFA: 'تن ماهی (در آب)', nameEN: 'Canned tuna (in water)', unit: 'g', servingFA: '۱۰۰ گرم', servingEN: '100g', perUnitKcal: 108, perUnitProtein: 23, perUnitCarbs: 0, perUnitFat: 1 },
  { id: 'egg', tapAmount: 1, nameFA: 'تخم‌مرغ', nameEN: 'Egg', unit: 'pcs', servingFA: '۱ عدد', servingEN: '1 pc', perUnitKcal: 70, perUnitProtein: 6, perUnitCarbs: 0.5, perUnitFat: 5, vitaminNoteFA: 'ویتامین‌های B و D', vitaminNoteEN: 'B & D vitamins' },
  { id: 'egg-white', tapAmount: 1, nameFA: 'سفیده تخم‌مرغ', nameEN: 'Egg white', unit: 'pcs', servingFA: '۱ عدد', servingEN: '1 pc', perUnitKcal: 17, perUnitProtein: 3.6, perUnitCarbs: 0.2, perUnitFat: 0.1 },
  // ——— لبنیات / dairy ———
  { id: 'milk', tapAmount: 1, nameFA: 'شیر کم‌چرب', nameEN: 'Low-fat milk', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 102, perUnitProtein: 8, perUnitCarbs: 12, perUnitFat: 2.4, vitaminNoteFA: 'کلسیم و ویتامین D', vitaminNoteEN: 'Calcium & vitamin D' },
  { id: 'yogurt', tapAmount: 1, nameFA: 'ماست کم‌چرب', nameEN: 'Low-fat yogurt', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 154, perUnitProtein: 13, perUnitCarbs: 17, perUnitFat: 4, vitaminNoteFA: 'کلسیم', vitaminNoteEN: 'Calcium' },
  { id: 'greek-yogurt', tapAmount: 1, nameFA: 'ماست یونانی', nameEN: 'Greek yogurt', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 146, perUnitProtein: 20, perUnitCarbs: 8, perUnitFat: 4, vitaminNoteFA: 'کلسیم', vitaminNoteEN: 'Calcium' },
  { id: 'doogh', tapAmount: 1, nameFA: 'دوغ', nameEN: 'Doogh (yogurt drink)', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 99, perUnitProtein: 6, perUnitCarbs: 12, perUnitFat: 2 },
  { id: 'cheese', tapAmount: 30, nameFA: 'پنیر سفید', nameEN: 'White cheese', unit: 'g', servingFA: '۳۰ گرم', servingEN: '30g', perUnitKcal: 80, perUnitProtein: 4.5, perUnitCarbs: 1, perUnitFat: 6.5, vitaminNoteFA: 'کلسیم', vitaminNoteEN: 'Calcium' },
  { id: 'kashk', tapAmount: 100, nameFA: 'کشک', nameEN: 'Kashk (dried whey)', unit: 'g', servingFA: '۱۰۰ گرم', servingEN: '100g', perUnitKcal: 105, perUnitProtein: 16, perUnitCarbs: 7, perUnitFat: 1, vitaminNoteFA: 'کلسیم', vitaminNoteEN: 'Calcium' },
  // ——— کربوهیدرات‌ها / carbs ———
  { id: 'cooked-rice', tapAmount: 1, nameFA: 'برنج پخته', nameEN: 'Cooked rice', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 205, perUnitProtein: 4.3, perUnitCarbs: 44.5, perUnitFat: 0.4 },
  { id: 'bread', tapAmount: 1, nameFA: 'نان (لواش/سنگک)', nameEN: 'Iranian flatbread', unit: 'pcs', servingFA: '۱ تکه متوسط (~۸۰ گرم)', servingEN: '1 medium pc (~80g)', perUnitKcal: 210, perUnitProtein: 6, perUnitCarbs: 42, perUnitFat: 1.5 },
  { id: 'cooked-pasta', tapAmount: 1, nameFA: 'ماکارونی پخته', nameEN: 'Cooked pasta', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 158, perUnitProtein: 5.8, perUnitCarbs: 33, perUnitFat: 0.9 },
  { id: 'potato', tapAmount: 1, nameFA: 'سیب‌زمینی پخته', nameEN: 'Boiled potato', unit: 'pcs', servingFA: '۱ عدد متوسط', servingEN: '1 medium', perUnitKcal: 130, perUnitProtein: 2.7, perUnitCarbs: 30, perUnitFat: 0.1, vitaminNoteFA: 'پتاسیم و ویتامین C', vitaminNoteEN: 'Potassium & vitamin C' },
  { id: 'cooked-lentils', tapAmount: 1, nameFA: 'عدس پخته', nameEN: 'Cooked lentils', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 230, perUnitProtein: 18, perUnitCarbs: 40, perUnitFat: 0.8, vitaminNoteFA: 'فیبر و آهن گیاهی', vitaminNoteEN: 'Fiber & plant iron' },
  { id: 'cooked-beans', tapAmount: 1, nameFA: 'لوبیای پخته', nameEN: 'Cooked kidney beans', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 225, perUnitProtein: 15, perUnitCarbs: 41, perUnitFat: 0.9, vitaminNoteFA: 'فیبر', vitaminNoteEN: 'Fiber' },
  { id: 'chickpeas', tapAmount: 1, nameFA: 'نخود پخته', nameEN: 'Cooked chickpeas', unit: 'cup', servingFA: '۱ لیوان', servingEN: '1 cup', perUnitKcal: 269, perUnitProtein: 14.5, perUnitCarbs: 45, perUnitFat: 4.2, vitaminNoteFA: 'فیبر', vitaminNoteEN: 'Fiber' },
  { id: 'oats', tapAmount: 100, nameFA: 'جو دوسر', nameEN: 'Oats', unit: 'g', servingFA: '۱۰۰ گرم', servingEN: '100g', perUnitKcal: 389, perUnitProtein: 16.9, perUnitCarbs: 66.3, perUnitFat: 6.9, vitaminNoteFA: 'فیبر', vitaminNoteEN: 'Fiber' },
  // ——— میوه‌ها / fruits ———
  { id: 'banana', tapAmount: 1, nameFA: 'موز', nameEN: 'Banana', unit: 'pcs', servingFA: '۱ عدد', servingEN: '1 pc', perUnitKcal: 105, perUnitProtein: 1.3, perUnitCarbs: 27, perUnitFat: 0.4, vitaminNoteFA: 'پتاسیم و ویتامین B6', vitaminNoteEN: 'Potassium & vitamin B6' },
  { id: 'apple', tapAmount: 1, nameFA: 'سیب', nameEN: 'Apple', unit: 'pcs', servingFA: '۱ عدد', servingEN: '1 pc', perUnitKcal: 95, perUnitProtein: 0.5, perUnitCarbs: 25, perUnitFat: 0.3, vitaminNoteFA: 'فیبر و ویتامین C', vitaminNoteEN: 'Fiber & vitamin C' },
  { id: 'orange', tapAmount: 1, nameFA: 'پرتقال', nameEN: 'Orange', unit: 'pcs', servingFA: '۱ عدد', servingEN: '1 pc', perUnitKcal: 62, perUnitProtein: 1.2, perUnitCarbs: 15.4, perUnitFat: 0.2, vitaminNoteFA: 'ویتامین C', vitaminNoteEN: 'Vitamin C' },
  { id: 'dates', tapAmount: 1, nameFA: 'خرما', nameEN: 'Dates', unit: 'pcs', servingFA: '۱ عدد', servingEN: '1 pc', perUnitKcal: 67, perUnitProtein: 0.4, perUnitCarbs: 18, perUnitFat: 0, vitaminNoteFA: 'پتاسیم', vitaminNoteEN: 'Potassium' },
  { id: 'raisins', tapAmount: 30, nameFA: 'کشمش', nameEN: 'Raisins', unit: 'g', servingFA: '۳۰ گرم', servingEN: '30g', perUnitKcal: 90, perUnitProtein: 0.9, perUnitCarbs: 24, perUnitFat: 0.2 },
  // ——— مغزها و تنقلات / nuts & snacks ———
  { id: 'mixed-nuts', tapAmount: 30, nameFA: 'آجیل مخلوط', nameEN: 'Mixed nuts', unit: 'g', servingFA: '۳۰ گرم', servingEN: '30g', perUnitKcal: 172, perUnitProtein: 5, perUnitCarbs: 5, perUnitFat: 16, vitaminNoteFA: 'ویتامین E', vitaminNoteEN: 'Vitamin E' },
  { id: 'almonds', tapAmount: 30, nameFA: 'بادام', nameEN: 'Almonds', unit: 'g', servingFA: '۳۰ گرم', servingEN: '30g', perUnitKcal: 174, perUnitProtein: 6.4, perUnitCarbs: 6.1, perUnitFat: 15, vitaminNoteFA: 'ویتامین E', vitaminNoteEN: 'Vitamin E' },
  { id: 'walnuts', tapAmount: 30, nameFA: 'گردو', nameEN: 'Walnuts', unit: 'g', servingFA: '۳۰ گرم', servingEN: '30g', perUnitKcal: 196, perUnitProtein: 4.6, perUnitCarbs: 4.1, perUnitFat: 19.5, vitaminNoteFA: 'اسیدهای چرب امگا-۳', vitaminNoteEN: 'Omega-3 fatty acids' },
  { id: 'peanut-butter', tapAmount: 16, nameFA: 'کره بادام‌زمینی', nameEN: 'Peanut butter', unit: 'g', servingFA: '۱ قاشق غذاخوری (۱۶ گرم)', servingEN: '1 tbsp (16g)', perUnitKcal: 94, perUnitProtein: 4, perUnitCarbs: 3.2, perUnitFat: 8.2 },
  { id: 'honey', tapAmount: 21, nameFA: 'عسل', nameEN: 'Honey', unit: 'g', servingFA: '۱ قاشق غذاخوری (۲۱ گرم)', servingEN: '1 tbsp (21g)', perUnitKcal: 64, perUnitProtein: 0, perUnitCarbs: 17.3, perUnitFat: 0 },
  { id: 'dark-chocolate', tapAmount: 30, nameFA: 'شکلات تلخ', nameEN: 'Dark chocolate', unit: 'g', servingFA: '۳۰ گرم', servingEN: '30g', perUnitKcal: 170, perUnitProtein: 2.3, perUnitCarbs: 14, perUnitFat: 13 },
  { id: 'chips', tapAmount: 30, nameFA: 'چیپس', nameEN: 'Potato chips', unit: 'g', servingFA: '۳۰ گرم', servingEN: '30g', perUnitKcal: 152, perUnitProtein: 2, perUnitCarbs: 15, perUnitFat: 10.6 },
  { id: 'biscuits', tapAmount: 2, nameFA: 'بیسکویت ساده', nameEN: 'Plain biscuits', unit: 'pcs', servingFA: '۲ عدد', servingEN: '2 pcs', perUnitKcal: 90, perUnitProtein: 1.2, perUnitCarbs: 15, perUnitFat: 2.5 },
];
