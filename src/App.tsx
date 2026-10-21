/**
 * مربی من (My Coach) — coach daily-app shell.
 *
 * Entry is the AuthGate (§18): role select → coach login/signup (with the
 * approval gate) / athlete login / new-athlete questionnaire + signup.
 * Logged-in users skip the gate; an unapproved coach sees ONLY the
 * pending-approval screen. An ACTIVE coach (or admin) lands on the
 * CoachPanel — review queue + my athletes — NEVER on the athlete tabs;
 * athletes (and the offline demo entry) get the 5 bottom tabs: پرسش‌نامه (iframe of the
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
import UpdateGate from './components/UpdateSplash';
import Header from './components/Header';
import AuthGate, { CoachProfileCompletion, PendingApproval } from './components/AuthGate';
import CoachPanel from './components/CoachPanel';
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
  if (auth.status === 'signedIn') {
    // Role routing (JOB 1): an active coach / admin goes to the coach
    // panel, never the athlete questionnaire/tabs. Athletes — and the
    // offline demo entry, which carries no coach identity — get the tabs.
    // (A pending coach never reaches here: status stays 'pending'.)
    const isCoach = !auth.demo && (auth.role !== null || auth.coach !== null);
    if (isCoach) {
      return (
        <div className="app-shell" dir={dir}>
          <Header />
          <CoachPanel />
        </div>
      );
    }
    return <Shell />;
  }
  return (
    <div className="app-shell" dir={dir}>
      <Header />
      {auth.status === 'pending' ? (
        <PendingApproval />
      ) : auth.status === 'completeCoachProfile' ? (
        <CoachProfileCompletion />
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
      {/* Boot order: the updater gate runs first on native (fail-open —
          it can never trap the user) and is a pass-through on web/demo.
          Session persistence (Capacitor Preferences) lives in the auth
          bootstrap below and is untouched by the gate. */}
      <UpdateGate>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </UpdateGate>
    </LangProvider>
  );
}
