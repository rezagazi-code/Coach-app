/**
 * کمک مربی (Komak-e Morabi) — coach daily-app shell.
 *
 * 5 bottom tabs: پرسش‌نامه (iframe of the finalized standalone
 * questionnaire.html), تمرین (live session logger), تغذیه (kcal + macro
 * tanks), چک‌لیست روزانه (coach-assigned HABITS ONLY — never drugs,
 * supplements or prescriptions), چت مربی (demo coach chat).
 *
 * Bilingual FA (default, RTL) + EN (LTR) via LangProvider; neon theme,
 * PadelPro button mechanics, per-coach data isolation (coach_id tenant —
 * single demo coach «رضا گزی» for now, payment wiring deferred).
 */
import { useState } from 'react';
import { LangProvider, useLang } from './lib/i18n';
import Header from './components/Header';
import TabBar, { type TabId } from './components/TabBar';
import QuestionnaireTab from './tabs/QuestionnaireTab';
import WorkoutTab from './tabs/WorkoutTab';
import NutritionTab from './tabs/NutritionTab';
import ChecklistTab from './tabs/ChecklistTab';
import ChatTab from './tabs/ChatTab';

function Shell() {
  const [tab, setTab] = useState<TabId>('workout');
  const { dir } = useLang();

  return (
    <div className="app-shell" dir={dir}>
      <Header />
      <main key={tab} className={tab === 'questionnaire' ? 'tab-content full-bleed neon-rise' : 'tab-content neon-rise'}>
        {tab === 'questionnaire' && <QuestionnaireTab />}
        {tab === 'workout' && <WorkoutTab />}
        {tab === 'nutrition' && <NutritionTab />}
        {tab === 'checklist' && <ChecklistTab />}
        {tab === 'chat' && <ChatTab />}
      </main>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}
