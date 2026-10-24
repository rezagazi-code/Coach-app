/**
 * supplementDraft — rule-based AI draft for the doctor-gated supplement pipeline.
 *
 * APPROVED ARCHITECTURE (Reza 2026-10-24): AI draft → coach review/approve →
 * DOCTOR gate for any dose-level decision. Same philosophy as the program
 * review queue.
 *
 * HARD RED LINES (Reza's locked rules — never violate):
 * - The draft NEVER determines what a trainee NEEDS. Every item is a
 *   "candidate for professional review" («کاندید بررسی»). No «needs X»,
 *   no «you should take», no dosage, no timing — anywhere.
 * - The TRAINEE never sees this draft. It surfaces to the coach only, and
 *   to the trainee solely as the approved «گزارش برای پزشک» handoff.
 * - Every surface carries the «not a prescription» disclaimer.
 *
 * Input: the v0.2.14 screening answers from questionnaire_responses.answers
 * (suppUse/suppList, medsUse/medsList, dietType, sun, diagDef/diagList,
 * fatigue). The padel track never answers this block → buildSupplementDraft
 * returns null and the UI shows "no screening data".
 */

export interface BilingualText {
  fa: string;
  en: string;
}

export interface SupplementCandidate {
  itemFA: string;
  itemEN: string;
  rationaleFA: string;
  rationaleEN: string;
}

export interface SupplementDraft {
  /** false when the track never answered the screening block (padel). */
  hasData: boolean;
  candidates: SupplementCandidate[];
  /** Questions the trainee should ask their doctor. */
  doctorQuestions: BilingualText[];
  /** Cautions derived from the medication list. */
  interactionCautions: BilingualText[];
  /** Supplements the trainee already takes — for the doctor to review. */
  currentSupplements: BilingualText | null;
  /** Raw screening answers, for the handoff report. */
  screeningSummary: BilingualText[];
  wadaNote: BilingualText;
  disclaimer: BilingualText;
  generatedAt: string;
}

type Answers = Record<string, unknown>;

const str = (a: Answers, k: string): string => {
  const v = a[k];
  return typeof v === 'string' ? v.trim() : '';
};

const DIET_FA: Record<string, string> = {
  none: 'بدون رژیم خاص',
  vegetarian: 'گیاه‌خوار',
  vegan: 'وگن',
  keto: 'کتوژنیک',
  fasting: 'فستینگ',
};
const DIET_EN: Record<string, string> = {
  none: 'No specific diet',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  keto: 'Ketogenic',
  fasting: 'Fasting',
};
const SUN_FA: Record<string, string> = { low: 'کم', mid: 'متوسط', high: 'زیاد' };
const SUN_EN: Record<string, string> = { low: 'Low', mid: 'Moderate', high: 'High' };

export function buildSupplementDraft(answers: Answers | null | undefined): SupplementDraft | null {
  if (!answers || typeof answers !== 'object') return null;
  // The padel track never answers the screening block — nothing to draft from.
  if (!answers.suppUse) return null;

  const draft: SupplementDraft = {
    hasData: true,
    candidates: [],
    doctorQuestions: [],
    interactionCautions: [],
    currentSupplements: null,
    screeningSummary: [],
    wadaNote: {
      fa: 'ورزشکاران: هر مکملی باید از نظر لیست ممنوعه‌ی وادا و خطر آلودگی محصول بررسی شود.',
      en: 'For athletes: any supplement must be checked against the WADA prohibited list and contamination risk.',
    },
    disclaimer: {
      fa: 'این پیش‌نویس تجویز پزشکی نیست؛ تصمیم نهایی درباره‌ی نوع و دوز هر مکمل فقط با پزشک است.',
      en: 'This draft is not a medical prescription; the final decision on the type and dose of any supplement rests with the doctor only.',
    },
    generatedAt: new Date().toISOString(),
  };

  const dietType = str(answers, 'dietType');
  const sun = str(answers, 'sun');

  // ---- screening summary (raw answers, for the handoff report) ----
  const yn = (v: string) => (v === 'yes' ? { fa: 'بله', en: 'Yes' } : { fa: 'خیر', en: 'No' });
  const suppUse = str(answers, 'suppUse');
  const medsUse = str(answers, 'medsUse');
  const diagDef = str(answers, 'diagDef');
  const fatigue = str(answers, 'fatigue');
  draft.screeningSummary.push({
    fa: `مصرف مکمل: ${yn(suppUse).fa}${str(answers, 'suppList') ? ` (${str(answers, 'suppList')})` : ''}`,
    en: `Supplement use: ${yn(suppUse).en}${str(answers, 'suppList') ? ` (${str(answers, 'suppList')})` : ''}`,
  });
  draft.screeningSummary.push({
    fa: `داروی مصرفی: ${yn(medsUse).fa}${str(answers, 'medsList') ? ` (${str(answers, 'medsList')})` : ''}`,
    en: `Medication: ${yn(medsUse).en}${str(answers, 'medsList') ? ` (${str(answers, 'medsList')})` : ''}`,
  });
  if (dietType) {
    draft.screeningSummary.push({
      fa: `رژیم غذایی: ${DIET_FA[dietType] ?? dietType}`,
      en: `Diet: ${DIET_EN[dietType] ?? dietType}`,
    });
  }
  if (sun) {
    draft.screeningSummary.push({
      fa: `آفتاب روزانه: ${SUN_FA[sun] ?? sun}`,
      en: `Daily sun: ${SUN_EN[sun] ?? sun}`,
    });
  }
  draft.screeningSummary.push({
    fa: `کمبود تشخیص‌داده‌شده: ${yn(diagDef).fa}${str(answers, 'diagList') ? ` (${str(answers, 'diagList')})` : ''}`,
    en: `Diagnosed deficiency: ${yn(diagDef).en}${str(answers, 'diagList') ? ` (${str(answers, 'diagList')})` : ''}`,
  });
  if (fatigue) {
    draft.screeningSummary.push({ fa: `خستگی مداوم: ${yn(fatigue).fa}`, en: `Persistent fatigue: ${yn(fatigue).en}` });
  }

  // ---- candidates for professional review (NEVER "needs X") ----
  if (dietType === 'vegan' || dietType === 'vegetarian') {
    const dietFa = dietType === 'vegan' ? 'وگن' : 'گیاه‌خوار';
    const dietEn = dietType === 'vegan' ? 'Vegan' : 'Vegetarian';
    draft.candidates.push({
      itemFA: 'B12',
      itemEN: 'B12',
      rationaleFA: `رژیم ${dietFa} — کاندید بررسی`,
      rationaleEN: `${dietEn} diet — candidate for review`,
    });
    draft.candidates.push({
      itemFA: 'آهن',
      itemEN: 'Iron',
      rationaleFA: `رژیم ${dietFa} — کاندید بررسی`,
      rationaleEN: `${dietEn} diet — candidate for review`,
    });
    draft.candidates.push({
      itemFA: 'پروتئین',
      itemEN: 'Protein',
      rationaleFA: `رژیم ${dietFa} — کاندید بررسی (کفایت دریافت)`,
      rationaleEN: `${dietEn} diet — candidate for review (intake adequacy)`,
    });
  }
  if (sun === 'low') {
    draft.candidates.push({
      itemFA: 'ویتامین D',
      itemEN: 'Vitamin D',
      rationaleFA: 'آفتاب روزانه کم — کاندید بررسی',
      rationaleEN: 'Low daily sun — candidate for review',
    });
  }

  // ---- diagnosed deficiency → follow the doctor's prescription, not a new one ----
  if (diagDef === 'yes') {
    draft.doctorQuestions.push({
      fa: `کمبود تشخیص‌داده‌شده ثبت شد${str(answers, 'diagList') ? `: ${str(answers, 'diagList')}` : ''} — پیگیری نسخه پزشک`,
      en: `Diagnosed deficiency recorded${str(answers, 'diagList') ? `: ${str(answers, 'diagList')}` : ''} — follow up on the doctor's prescription`,
    });
  }

  // ---- current medications → interaction caution for the doctor ----
  if (medsUse === 'yes') {
    draft.interactionCautions.push({
      fa: `داروهای مصرفی ثبت شد${str(answers, 'medsList') ? `: ${str(answers, 'medsList')}` : ''} — قبل از هر تصمیم مکمل، پزشک باید تداخل‌ها را بررسی کند`,
      en: `Medications recorded${str(answers, 'medsList') ? `: ${str(answers, 'medsList')}` : ''} — the doctor must check interactions before any supplement decision`,
    });
  }

  // ---- persistent fatigue → referral, not a prescription ----
  if (fatigue === 'yes') {
    draft.doctorQuestions.push({
      fa: 'خستگی مداوم — پیشنهاد آزمایش خون / ارجاع به پزشک',
      en: 'Persistent fatigue — suggestion: blood test / doctor referral',
    });
  }

  // ---- already-taken supplements → for the doctor to review ----
  if (suppUse === 'yes' && str(answers, 'suppList')) {
    draft.currentSupplements = {
      fa: `مکمل‌های فعلی: ${str(answers, 'suppList')} — جهت بررسی توسط پزشک`,
      en: `Current supplements: ${str(answers, 'suppList')} — for the doctor to review`,
    };
  }

  return draft;
}

/**
 * Plain-text bilingual handoff report («گزارش برای پزشک») from an APPROVED
 * review. The trainee takes this to their doctor. Candidate language only —
 * no doses, no timing, no prescription.
 */
export function renderDoctorHandoffText(
  draft: SupplementDraft,
  athleteName: string,
  coachName: string | null,
): string {
  const L: string[] = [];
  L.push('🩺 گزارش برای پزشک / Doctor handoff report');
  L.push(`شاگرد: ${athleteName}`);
  if (coachName) L.push(`مربی بررسی‌کننده: ${coachName}`);
  L.push('');
  L.push('— خلاصه غربالگری / Screening summary —');
  for (const s of draft.screeningSummary) L.push(`• ${s.fa}`);
  if (draft.candidates.length) {
    L.push('');
    L.push('— کاندیدهای بررسی / Candidates for professional review —');
    for (const c of draft.candidates) L.push(`• ${c.itemFA} — ${c.rationaleFA}`);
  }
  if (draft.currentSupplements) {
    L.push('');
    L.push(`• ${draft.currentSupplements.fa}`);
  }
  if (draft.interactionCautions.length) {
    L.push('');
    L.push('— احتیاط تداخل / Interaction cautions —');
    for (const c of draft.interactionCautions) L.push(`• ${c.fa}`);
  }
  if (draft.doctorQuestions.length) {
    L.push('');
    L.push('— پرسش‌های پیشنهادی برای پزشک / Suggested questions for the doctor —');
    for (const q of draft.doctorQuestions) L.push(`• ${q.fa}`);
  }
  L.push('');
  L.push(`• ${draft.wadaNote.fa}`);
  L.push('');
  L.push(`⚠ ${draft.disclaimer.fa}`);
  L.push('تصمیم درباره نوع و دوز هر مکمل فقط با پزشک است.');
  return L.join('\n');
}
