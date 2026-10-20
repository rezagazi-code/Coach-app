/**
 * مربی من (My Coach) — coach daily-app shell.
 *
 * Entry is the AuthGate (§18): role select → coach login/signup (with the
 * approval gate) / athlete login / new-athlete questionnaire + signup.
 * Logged-in users skip the gate; an unapproved coach sees ONLY the
 * pending-approval screen. The 5 bottom tabs: پرسش‌نامه (iframe of the
 * finalized standalone questionnaire.html), تمرین (live session logger),
 * تغذیه (kcal + macro tanks), چک‌لیست روزانه (coach-assigned HABITS ONLY —
 * never drugs, supplements or prescriptions), چت مربی (demo coach chat).
 *
 * Bilingual FA (default, RTL) + EN (LTR) via LangProvider; neon theme,
 * PadelPro button mechanics, per-coach data isolation (coach_id tenant —
 * single demo coach «رضا گزی» for now, payment wiring deferred).
 *
 * ALL tabs stay mounted (inactive ones are display:none) so tab state —
 * logged sets, nutrition progress, checklist, chat history — survives
 * switching, and the questionnaire iframe loads exactly once.
 */
import { useState, type CSSProperties } from 'react';
import { LangProvider, useLang } from './lib/i18n';
import { AuthProvider, useAuth } from './lib/auth';
import Header from './components/Header';
import AuthGate, { PendingApproval } from './components/AuthGate';
import AthleteOnboarding from './components/AthleteOnboarding';
import TabBar, { type TabId } from './components/TabBar';
import QuestionnaireTab from './tabs/QuestionnaireTab';
import WorkoutTab from './tabs/WorkoutTab';
import NutritionTab from './tabs/NutritionTab';
import ChecklistTab from './tabs/ChecklistTab';
import ChatTab from './tabs/ChatTab';

const HIDDEN: CSSProperties = { display: 'none' };

function Shell() {
  const [tab, setTab] = useState<TabId>('workout');
  const { dir } = useLang();

  const section = (id: TabId, fullBleed = false) => ({
    className: fullBleed ? 'tab-content full-bleed' : 'tab-content',
    style: tab === id ? undefined : HIDDEN,
    'aria-hidden': tab !== id,
  });

  return (
    <div className="app-shell" dir={dir}>
      <Header />
      <main className="tab-host">
        <div {...section('questionnaire', true)}>
          <QuestionnaireTab />
        </div>
        <div {...section('workout')}>
          <WorkoutTab />
        </div>
        <div {...section('nutrition')}>
          <NutritionTab />
        </div>
        <div {...section('checklist')}>
          <ChecklistTab />
        </div>
        <div {...section('chat')}>
          <ChatTab />
        </div>
      </main>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}

/** First-screen switch: gate → (pending) → tabs. No internal screen ever
 *  renders without the auth state resolved (§18.4). */
function Root() {
  const auth = useAuth();
  const { dir } = useLang();
  const [onboarding, setOnboarding] = useState(false);

  if (auth.status === 'loading') {
    return (
      <div className="app-shell auth-loading" dir={dir}>
        <img src="logo.png" alt="" className="auth-loading-logo" />
      </div>
    );
  }
  if (auth.status === 'signedIn') return <Shell />;
  return (
    <div className="app-shell" dir={dir}>
      <Header />
      {auth.status === 'pending' ? (
        <PendingApproval />
      ) : onboarding ? (
        <AthleteOnboarding onBack={() => setOnboarding(false)} />
      ) : (
        <AuthGate onNewAthlete={() => setOnboarding(true)} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </LangProvider>
  );
}
