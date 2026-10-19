/**
 * Coach Studio (استودیو مربی) — v0.1 scaffold.
 *
 * First screen: the final coaching questionnaire (public/questionnaire.html)
 * rendered full-viewport in an iframe. The questionnaire is a self-contained
 * RTL Persian page: 4 trainee tracks (gym-only, gym+padel VIP, padel-only,
 * AI-only paid), medical red-flag screening, surgery-history per injury,
 * coach report output.
 *
 * The surrounding React shell carries the neon theme + button classes so
 * future screens (coach dashboard, program approvals, XP leaderboard)
 * can share the same design language.
 */
export default function App() {
  return (
    <div className="app-shell">
      <iframe
        title="پرسش‌نامه هوشمند مربی"
        src="questionnaire.html"
        className="questionnaire-frame"
        allowFullScreen
      />
    </div>
  );
}
